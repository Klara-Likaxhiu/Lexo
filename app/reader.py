import json

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
    from app.cover_service import enrich_recommendation

    reader_result = analyze_reader_profile(data)
    enriched_books = []

    for book in reader_result.get("recommendations", []):
        title = book.get("title")

        if not title:
            continue

        enriched_books.append(
            {
                "ai_recommendation": book,
                "book_data": enrich_recommendation(
                    title,
                    author=book.get("author"),
                    genre=book.get("genre"),
                ),
            }
        )

    return {
        "reader_type": reader_result.get("reader_type"),
        "favorite_genres": reader_result.get("favorite_genres"),
        "confirmed_reading_level": reader_result.get("confirmed_reading_level"),
        "book_preferences": reader_result.get("book_preferences"),
        "recommendations": enriched_books,
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
            path["books"] = enrich_books_in_list(path.get("books"))

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

    from app.cover_service import enrich_book_entry, enrich_books_in_list

    dashboard = parsed.get("dashboard") or {}
    top_pick = dashboard.get("top_pick")
    if isinstance(top_pick, dict):
        dashboard["top_pick"] = enrich_book_entry(top_pick)

    discover = parsed.get("discover") or {}
    for section in discover.get("sections", []) or []:
        if isinstance(section, dict):
            section["books"] = enrich_books_in_list(section.get("books"))

    parsed["engine"] = ai.engine_name()
    return parsed