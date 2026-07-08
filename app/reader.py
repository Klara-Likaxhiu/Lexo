import json
import re

from app import ai
from app.book_routes import search_open_library
from app.reader_models import ReaderProfileRequest


def _safe_json_loads(result: str, fallback: dict) -> dict:
    try:
        return json.loads(result)
    except json.JSONDecodeError:
        fallback["raw_result"] = result
        return fallback


# ---------------------------------------------------------------------------
# Recommendation exclusion — deterministic safety net
#
# LLM prompts ask the model to skip books the reader has already engaged with,
# but models are unreliable at this. These helpers guarantee it server-side by
# stripping any recommended title that appears in the reader's library
# (finished, reading, want-to-read, not interested) or explicit excluded list.
# ---------------------------------------------------------------------------

_SHELVES = ("read", "reading", "want", "not_interested")


def _normalize_title(title) -> str:
    return str(title or "").strip().lower()


def _collect_excluded_titles(reader_profile, library=None) -> set[str]:
    titles: set[str] = set()
    profile = reader_profile if isinstance(reader_profile, dict) else {}

    for book in profile.get("excluded_books", []) or []:
        if isinstance(book, str):
            titles.add(_normalize_title(book))
        elif isinstance(book, dict):
            titles.add(_normalize_title(book.get("title")))

    for lib in (library, profile.get("library")):
        if not isinstance(lib, dict):
            continue
        for shelf in _SHELVES:
            for book in lib.get(shelf, []) or []:
                if isinstance(book, dict):
                    titles.add(_normalize_title(book.get("title")))
                elif isinstance(book, str):
                    titles.add(_normalize_title(book))

    titles.discard("")
    return titles


def _filter_books(books, excluded: set[str]) -> list:
    if not isinstance(books, list):
        return []
    return [
        book
        for book in books
        if isinstance(book, dict) and _normalize_title(book.get("title")) not in excluded
    ]


def _apply_intelligence_exclusions(parsed: dict, excluded: set[str]) -> None:
    if not excluded or not isinstance(parsed, dict):
        return

    discover = parsed.get("discover") or {}
    sections = discover.get("sections") or []
    for section in sections:
        if isinstance(section, dict):
            section["books"] = _filter_books(section.get("books", []), excluded)

    dashboard = parsed.get("dashboard") or {}
    top_pick = dashboard.get("top_pick") or {}
    if isinstance(top_pick, dict) and _normalize_title(top_pick.get("title")) in excluded:
        replacement = None
        for section in sections:
            books = section.get("books") if isinstance(section, dict) else None
            if books:
                replacement = books[0]
                break
        if replacement:
            dashboard["top_pick"] = {"match": replacement.get("match", 90), **replacement}


def analyze_reader_profile(data: ReaderProfileRequest) -> dict:
    prompt = f"""
You are BookMindAI, an AI book recommendation assistant.

Analyze this reader based on their quiz answers, books read, and reading level.

Quiz answers:
{data.quiz_answers}

Books already read:
{data.books_read}

Reading level:
{data.reading_level}

Return ONLY valid JSON in this exact structure:

{{
  "reader_type": "string",
  "favorite_genres": ["string"],
  "confirmed_reading_level": "string",
  "book_preferences": ["string"],
  "recommendations": [
    {{
      "title": "string",
      "author": "string",
      "genre": "string",
      "difficulty": "string",
      "reason": "string"
    }}
  ]
}}
"""

    result = ai._openai_chat_completion(
        [
            {
                "role": "system",
                "content": "You are an expert book recommendation assistant. Return only valid JSON.",
            },
            {
                "role": "user",
                "content": prompt,
            },
        ],
        temperature=0.5,
    )

    parsed_result = _safe_json_loads(result, {"recommendations": []})
    parsed_result["engine"] = ai.engine_name()

    return parsed_result


def recommend_with_book_data(data: ReaderProfileRequest) -> dict:
    from app.cover_service import enrich_profile_recommendations

    reader_result = analyze_reader_profile(data)
    profile_payload = {
        "reader_type": reader_result.get("reader_type"),
        "favorite_genres": reader_result.get("favorite_genres"),
        "confirmed_reading_level": reader_result.get("confirmed_reading_level"),
        "book_preferences": reader_result.get("book_preferences"),
        "recommendations": [
            {"ai_recommendation": book, "book_data": None}
            for book in reader_result.get("recommendations", [])
            if book.get("title")
        ],
    }
    enrich_profile_recommendations(profile_payload)

    return {
        "reader_type": profile_payload.get("reader_type"),
        "favorite_genres": profile_payload.get("favorite_genres"),
        "confirmed_reading_level": profile_payload.get("confirmed_reading_level"),
        "book_preferences": profile_payload.get("book_preferences"),
        "recommendations": profile_payload.get("recommendations", []),
        "engine": reader_result.get("engine"),
    }


def reading_companion(question: str, reader_profile: dict | None = None) -> dict:
    prompt = f"""
You are BookMindAI, an AI librarian.

User Question:
{question}

Full Reader Context:
{reader_profile}

Important recommendation rules:
- Do NOT recommend books listed inside excluded_books.
- Do NOT recommend books the user already read, is reading, wants to read, or marked not interested.
- Use discovery answers, extra discovery answers, mood, goal, and library to personalize.
- Use the reader's star ratings and written reviews (field: reviews): favor books similar to those they rated 4-5 stars or reviewed positively, and avoid the style of books they rated 1-2 stars.
- Weight favorite genres and Reader DNA heavily, and respect disliked genres.
- Keep it book-focused, not therapy-focused.

Respond ONLY in valid JSON.

Use this exact structure:

{{
  "message": "short friendly introduction",
  "mood_detected": "string",
  "reasoning": ["short reason 1", "short reason 2", "short reason 3"],
  "recommendations": [
    {{
      "title": "string",
      "author": "string",
      "genre": "string",
      "reason": "why it matches",
      "match": 97
    }}
  ]
}}

Do not write anything outside the JSON.
"""

    result = ai._openai_chat_completion(
        [
            {
                "role": "system",
                "content": "You are BookMindAI, an AI librarian. Always return valid JSON only.",
            },
            {
                "role": "user",
                "content": prompt,
            },
        ],
        temperature=0.6,
    )

    parsed = _safe_json_loads(
        result,
        {
            "message": "I found some ideas for you.",
            "mood_detected": "Unknown",
            "reasoning": [],
            "recommendations": [],
        },
    )

    excluded = _collect_excluded_titles(reader_profile)
    parsed["recommendations"] = _filter_books(parsed.get("recommendations", []), excluded)

    from app.cover_service import enrich_books_in_list

    parsed["recommendations"] = enrich_books_in_list(parsed.get("recommendations"))

    parsed["engine"] = ai.engine_name()
    return parsed


def generate_reading_paths(
    reader_profile: dict | None = None,
    library: dict | None = None,
    today_mood: str | None = None,
    today_goal: str | None = None,
) -> dict:
    excluded_books = []

    if isinstance(reader_profile, dict):
        excluded_books = reader_profile.get("excluded_books", [])

    prompt = f"""
You are BookMindAI, an AI librarian and reading guide.

Create personalized reading paths for this user.

Full Reader Context:
{reader_profile}

User Library:
{library}

Today's Mood:
{today_mood}

Today's Goal:
{today_goal}

Books to exclude:
{excluded_books}

Rules:
- Do NOT recommend books listed in excluded_books.
- Do NOT recommend books already in the user's read, reading, want, or not interested shelves.
- Base paths on Reader DNA, favorite genres, disliked genres, reading level, mood, goal, extra discovery answers, and library.
- Create 3 personalized reading paths.
- Each path should help the user grow as a reader.
- Each path should have 5 books from easier to more advanced.
- Keep it book-focused, not therapy-focused.

Respond ONLY in valid JSON.

Use this exact structure:

{{
  "message": "short explanation",
  "paths": [
    {{
      "path_name": "string",
      "path_icon": "emoji",
      "why_this_path": "string",
      "difficulty_progression": "Beginner to Advanced",
      "books": [
        {{
          "title": "string",
          "author": "string",
          "level": "Beginner",
          "reason": "why this book belongs in this step"
        }}
      ]
    }}
  ]
}}
"""

    result = ai._openai_chat_completion(
        [
            {
                "role": "system",
                "content": "You are BookMindAI. Always return valid JSON only.",
            },
            {
                "role": "user",
                "content": prompt,
            },
        ],
        temperature=0.7,
    )

    parsed = _safe_json_loads(result, {"message": "Here are your paths.", "paths": []})

    excluded = _collect_excluded_titles(reader_profile, library)
    for path in parsed.get("paths", []) or []:
        if isinstance(path, dict):
            path["books"] = _filter_books(path.get("books", []), excluded)

    from app.cover_service import enrich_books_in_list

    for path in parsed.get("paths", []) or []:
        if isinstance(path, dict):
            path["books"] = enrich_books_in_list(path.get("books"), cache_only=True)

    parsed["engine"] = ai.engine_name()

    return parsed


_GENRE_STARTER_BOOKS: dict[str, list[dict[str, str]]] = {
    "literary fiction": [
        {"title": "Normal People", "author": "Sally Rooney", "level": "Beginner", "difficulty": "Accessible", "reason": "A contemporary entry point with emotional depth and clean prose."},
        {"title": "The Remains of the Day", "author": "Kazuo Ishiguro", "level": "Intermediate", "difficulty": "Moderate", "reason": "Quiet, layered storytelling that rewards close reading."},
        {"title": "A Little Life", "author": "Hanya Yanagihara", "level": "Advanced", "difficulty": "Demanding", "reason": "An intense character study for readers ready for emotional complexity."},
        {"title": "Beloved", "author": "Toni Morrison", "level": "Advanced", "difficulty": "Challenging", "reason": "Lyrical, historical literary fiction with mythic resonance."},
        {"title": "The Goldfinch", "author": "Donna Tartt", "level": "Intermediate", "difficulty": "Moderate", "reason": "Plot-driven literary fiction with rich atmosphere."},
    ],
    "contemporary fiction": [
        {"title": "Tomorrow, and Tomorrow, and Tomorrow", "author": "Gabrielle Zevin", "level": "Beginner", "difficulty": "Accessible", "reason": "Warm, modern storytelling about friendship and creativity."},
        {"title": "Such a Fun Age", "author": "Kiley Reid", "level": "Beginner", "difficulty": "Accessible", "reason": "Sharp social insight in an engaging contemporary voice."},
        {"title": "Little Fires Everywhere", "author": "Celeste Ng", "level": "Intermediate", "difficulty": "Moderate", "reason": "Suburban drama with moral tension and strong characters."},
        {"title": "The Seven Husbands of Evelyn Hugo", "author": "Taylor Jenkins Reid", "level": "Beginner", "difficulty": "Light", "reason": "A propulsive celebrity saga with heart."},
        {"title": "Cloud Cuckoo Land", "author": "Anthony Doerr", "level": "Advanced", "difficulty": "Ambitious", "reason": "A sweeping, interconnected novel for adventurous readers."},
    ],
    "historical mystery": [
        {"title": "The Alienist", "author": "Caleb Carr", "level": "Beginner", "difficulty": "Accessible", "reason": "Gilded Age mystery with vivid historical atmosphere."},
        {"title": "The Name of the Rose", "author": "Umberto Eco", "level": "Advanced", "difficulty": "Challenging", "reason": "Medieval monastery mystery dense with ideas and symbols."},
        {"title": "The Daughter of Time", "author": "Josephine Tey", "level": "Intermediate", "difficulty": "Moderate", "reason": "A classic historical investigation with a clever hook."},
        {"title": "The Devotion of Suspect X", "author": "Keigo Higashino", "level": "Intermediate", "difficulty": "Moderate", "reason": "Elegant puzzle mystery with emotional stakes."},
        {"title": "The Essex Serpent", "author": "Sarah Perry", "level": "Intermediate", "difficulty": "Moderate", "reason": "Victorian mystery threaded with folklore and science."},
        {"title": "The Widow of Rose House", "author": "Diana Biller", "level": "Beginner", "difficulty": "Light", "reason": "Romantic historical mystery with charm and momentum."},
    ],
}


def _genre_key(genre: str) -> str:
    return re.sub(r"\s+", " ", (genre or "").strip().lower())


def _offline_genre_path(genre: str, reader_profile: dict | None) -> dict:
    key = _genre_key(genre)
    books = _GENRE_STARTER_BOOKS.get(key)
    if not books:
        for catalog_key, catalog_books in _GENRE_STARTER_BOOKS.items():
            if catalog_key in key or key in catalog_key:
                books = catalog_books
                break
    if not books:
        books = _GENRE_STARTER_BOOKS["literary fiction"]

    reader_type = ""
    if isinstance(reader_profile, dict):
        reader_type = reader_profile.get("reader_type") or ""

    why = (
        f"This path introduces you to {genre} with books matched to your Reader DNA"
        + (f" as a {reader_type}." if reader_type else ".")
    )

    return {
        "path_name": f"{genre} Starter Path",
        "path_icon": "🧭",
        "why_this_path": why,
        "difficulty_progression": "Beginner to Advanced",
        "genre": genre,
        "books": books[:7],
    }


def generate_genre_reading_path(
    genre: str,
    reader_profile: dict | None = None,
    library: dict | None = None,
    today_mood: str | None = None,
    today_goal: str | None = None,
) -> dict:
    """Create a single genre-focused reading path with 5–7 books."""
    excluded = _collect_excluded_titles(reader_profile, library)
    reader_type = ""
    favorite_genres: list[str] = []
    if isinstance(reader_profile, dict):
        reader_type = reader_profile.get("reader_type") or ""
        favorite_genres = reader_profile.get("favorite_genres") or []

    prompt = f"""
You are BookMindAI, an AI librarian creating a personalized genre starter path.

Target genre: {genre}

Reader type: {reader_type}
Favorite genres: {favorite_genres}
Full Reader Context:
{reader_profile}

User Library:
{library}

Today's Mood: {today_mood}
Today's Goal: {today_goal}

Books to exclude:
{sorted(excluded)}

Rules:
- Create ONE reading path focused on the genre "{genre}".
- Path name must be exactly: "{genre} Starter Path"
- Include 5 to 7 books ordered from beginner to advanced.
- Each book needs: title, author, level (Beginner|Intermediate|Advanced), difficulty (Light|Accessible|Moderate|Demanding|Challenging), reason (1-2 sentences).
- Explain in why_this_path why this genre fits the reader's Reader DNA.
- Do NOT recommend excluded books or books already in the user's library.
- Keep recommendations book-focused and practical.

Respond ONLY in valid JSON:

{{
  "path_name": "{genre} Starter Path",
  "path_icon": "emoji",
  "why_this_path": "why this genre fits their Reader DNA",
  "difficulty_progression": "Beginner to Advanced",
  "genre": "{genre}",
  "books": [
    {{
      "title": "string",
      "author": "string",
      "level": "Beginner",
      "difficulty": "Accessible",
      "reason": "short explanation"
    }}
  ]
}}
"""

    parsed: dict
    if ai.using_openai():
        try:
            result = ai._openai_chat_completion(
                [
                    {"role": "system", "content": "You are BookMindAI. Always return valid JSON only."},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.7,
            )
            parsed = _safe_json_loads(result, _offline_genre_path(genre, reader_profile))
        except Exception:
            parsed = _offline_genre_path(genre, reader_profile)
    else:
        parsed = _offline_genre_path(genre, reader_profile)

    if not isinstance(parsed, dict):
        parsed = _offline_genre_path(genre, reader_profile)

    parsed.setdefault("path_name", f"{genre} Starter Path")
    parsed.setdefault("genre", genre)
    parsed["books"] = _filter_books(parsed.get("books", []), excluded)

    if len(parsed["books"]) < 5:
        fallback = _offline_genre_path(genre, reader_profile)
        seen = {_normalize_title(b.get("title")) for b in parsed["books"]}
        for book in fallback.get("books", []):
            title_key = _normalize_title(book.get("title"))
            if title_key and title_key not in excluded and title_key not in seen:
                parsed["books"].append(book)
                seen.add(title_key)
            if len(parsed["books"]) >= 7:
                break

    from app.cover_service import enrich_books_in_list

    parsed["books"] = enrich_books_in_list(parsed.get("books", []), cache_only=True)[:7]
    parsed["engine"] = ai.engine_name()
    return parsed


def generate_reader_intelligence(
    reader_profile: dict | None = None,
    library: dict | None = None,
    today_mood: str | None = None,
    today_goal: str | None = None,
) -> dict:
    excluded_books = []

    if isinstance(reader_profile, dict):
        excluded_books = reader_profile.get("excluded_books", [])

    prompt = f"""
You are BookMindAI's central Reader Intelligence engine.

Create one unified intelligence report for this reader.

Full Reader Context:
{reader_profile}

User Library:
{library}

Today's Mood:
{today_mood}

Today's Goal:
{today_goal}

Books to exclude from recommendations:
{excluded_books}

Rules:
- Do NOT recommend any book listed in excluded_books.
- Do NOT recommend books the user already read, is reading, wants to read, or marked not interested.
- Use discovery answers and extra discovery answers (the reader's Reader DNA).
- Use the reader's star ratings and written reviews (field: reviews): recommend more books like the ones they rated 4-5 stars or reviewed positively, and steer away from the style of books they rated 1-2 stars.
- Use favorite genres to guide recommendations and disliked genres to avoid poor recommendations.
- Use today's mood and goal to personalize today's pick and mission.
- Keep everything focused on books, reading preferences, reading growth, and discovery.
- Do NOT give therapy, mental health advice, or emotional counseling.

Respond ONLY in valid JSON.

Use this exact structure:

{{
  "dashboard": {{
    "greeting_subtitle": "short personalized line",
    "today_mission": "short mission for today's reading",
    "top_pick": {{
      "title": "string",
      "author": "string",
      "genre": "string",
      "reason": "string",
      "match": 95
    }}
  }},
  "discover": {{
    "sections": [
      {{
        "title": "Because of your Reader DNA",
        "description": "short description",
        "books": [
          {{
            "title": "string",
            "author": "string",
            "genre": "string",
            "reason": "string",
            "match": 95
          }}
        ]
      }},
      {{
        "title": "For today's mood",
        "description": "short description",
        "books": [
          {{
            "title": "string",
            "author": "string",
            "genre": "string",
            "reason": "string",
            "match": 92
          }}
        ]
      }},
      {{
        "title": "Expand your taste",
        "description": "short description",
        "books": [
          {{
            "title": "string",
            "author": "string",
            "genre": "string",
            "reason": "string",
            "match": 88
          }}
        ]
      }}
    ]
  }},
  "journey": {{
    "reader_identity": "string",
    "insights": ["string", "string", "string"],
    "growth_suggestions": ["string", "string", "string"]
  }},
  "achievements": [
    {{
      "title": "string",
      "icon": "emoji",
      "description": "string",
      "unlocked": true
    }}
  ],
  "stats": {{
    "read_count": 0,
    "reading_count": 0,
    "want_count": 0,
    "not_interested_count": 0,
    "favorite_genre": "string"
  }}
}}
"""

    result = ai._openai_chat_completion(
        [
            {
                "role": "system",
                "content": "You are BookMindAI's central intelligence engine. Always return valid JSON only.",
            },
            {
                "role": "user",
                "content": prompt,
            },
        ],
        temperature=0.65,
    )

    parsed = _safe_json_loads(
        result,
        {
            "dashboard": {},
            "discover": {"sections": []},
            "journey": {"insights": [], "growth_suggestions": []},
            "achievements": [],
            "stats": {},
        },
    )

    excluded = _collect_excluded_titles(reader_profile, library)
    _apply_intelligence_exclusions(parsed, excluded)

    from app.cover_service import enrich_book_entry

    dashboard = parsed.get("dashboard") or {}
    top_pick = dashboard.get("top_pick")
    if isinstance(top_pick, dict):
        dashboard["top_pick"] = enrich_book_entry(top_pick)

    parsed["engine"] = ai.engine_name()
    return parsed


def generate_path_reflection(
    path: dict,
    reader_profile: dict | None = None,
    library: dict | None = None,
    days_taken: int | None = None,
) -> dict:
    """Personalized AI reflection after completing a reading path."""
    path_name = path.get("path_name") or "Reading Path"
    books = path.get("books") or []
    book_list = [
        f"- {b.get('title', 'Unknown')} by {b.get('author', 'Unknown')}"
        for b in books
        if isinstance(b, dict)
    ]

    prompt = f"""
You are BookMindAI, a warm and insightful reading companion.

The user just completed the reading path "{path_name}".

Path details:
- Genre / theme: {path.get("genre") or path.get("why_this_path") or "General"}
- Difficulty: {path.get("difficulty_progression") or "Personalized"}
- Days taken: {days_taken or "unknown"}
- Books completed:
{chr(10).join(book_list) or "- (none listed)"}

Reader profile:
{reader_profile}

Library snapshot:
{library}

Write a personalized reflection (2–3 short paragraphs) that:
1. Summarizes what themes, styles, or ideas they explored on this journey
2. Notes how their Reader DNA may be evolving based on this path
3. Suggests ONE specific next genre or path to explore (be concrete, e.g. "Magical Realism")

Also suggest a next_path_name (short, evocative title for a follow-up journey).

Respond ONLY in valid JSON:
{{
  "reflection": "string — 2-3 paragraphs, use 'you' voice, literary but accessible",
  "next_path_suggestion": "string — one sentence recommendation",
  "next_path_name": "string — e.g. Magical Realism Journey"
}}
"""

    result = ai._openai_chat_completion(
        [
            {
                "role": "system",
                "content": "You are BookMindAI. Always return valid JSON only. Be personal, never generic.",
            },
            {"role": "user", "content": prompt},
        ],
        temperature=0.75,
    )

    parsed = _safe_json_loads(
        result,
        {
            "reflection": (
                f"Over your journey through {path_name}, you explored new voices and ideas. "
                "Your reading is deepening — keep following what surprises you."
            ),
            "next_path_suggestion": "Try a path in an adjacent genre to stretch your comfort zone.",
            "next_path_name": "Your Next Chapter",
        },
    )
    parsed["engine"] = ai.engine_name()
    return parsed