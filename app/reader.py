import hashlib
import json
import re

from app import ai
from app.book_routes import search_open_library
from app.reader_models import ReaderProfileRequest


def _safe_json_loads(result: str, fallback: dict) -> dict:
    text = (result or "").strip()
    if not text:
        return dict(fallback)

    candidates = [text]
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
    if fenced:
        candidates.insert(0, fenced.group(1).strip())
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        candidates.append(text[start : end + 1])

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
        except (json.JSONDecodeError, TypeError):
            continue

    out = dict(fallback)
    out["raw_result"] = result
    return out


# ---------------------------------------------------------------------------
# Recommendation exclusion — deterministic safety net
#
# LLM prompts ask the model to skip books the reader has already engaged with,
# but models are unreliable at this. These helpers guarantee it server-side by
# stripping any recommended title that appears in the reader's library
# (finished, reading, want-to-read, not interested) or explicit excluded list.
# ---------------------------------------------------------------------------

_SHELVES = ("read", "reading", "want", "not_interested")


def _quiz_inputs_hash(data: ReaderProfileRequest) -> str:
    payload = {
        "quiz_answers": data.quiz_answers,
        "books_read": data.books_read,
        "reading_level": data.reading_level,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def _compact_library_signature(library: dict | None) -> str:
    if not isinstance(library, dict):
        return ""
    parts: list[str] = []
    for shelf in _SHELVES:
        books = library.get(shelf) or []
        if not isinstance(books, list):
            continue
        parts.append(f"{shelf}:{len(books)}")
        for book in books[:40]:
            if isinstance(book, dict):
                parts.append(_normalize_title(book.get("title")))
    return "|".join(parts)


def build_intelligence_cache_key(
    reader_profile: dict | None,
    library: dict | None,
    today_mood: str | None,
    today_goal: str | None,
) -> str:
    profile = reader_profile if isinstance(reader_profile, dict) else {}
    payload = {
        "mood": today_mood or "",
        "goal": today_goal or "",
        "library": _compact_library_signature(library),
        "profile_completion": str(profile.get("profile_completion") or ""),
        "quiz_hash": hashlib.sha256(
            json.dumps(profile.get("quiz_answers") or "", sort_keys=True).encode()
        ).hexdigest()[:16],
        "excluded_count": len(profile.get("excluded_books") or []),
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


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
    normalized = _normalize_recommendations(books)
    return [
        book
        for book in normalized
        if _normalize_title(book.get("title")) not in excluded
    ]


def _unwrap_recommendation_book(item) -> dict | None:
    """Normalize nested recommendation wrappers into a flat book dict."""
    if not isinstance(item, dict):
        return None
    book = item
    nested = item.get("ai_recommendation")
    if isinstance(nested, dict):
        book = {**nested, **{k: v for k, v in item.items() if k != "ai_recommendation"}}
    title = str(book.get("title") or "").strip()
    if not title:
        return None
    book = dict(book)
    book["title"] = title
    if book.get("page_count") is None and book.get("pages") is not None:
        book["page_count"] = book.get("pages")
    if book.get("pages") is None and book.get("page_count") is not None:
        book["pages"] = book.get("page_count")
    return book


def _normalize_recommendations(raw) -> list[dict]:
    """Coerce AI output into a list of book dicts (handles a single object)."""
    if isinstance(raw, dict):
        books = [raw]
    elif isinstance(raw, list):
        books = raw
    else:
        return []
    normalized: list[dict] = []
    for item in books:
        book = _unwrap_recommendation_book(item)
        if book:
            normalized.append(book)
    return normalized


def _dedupe_recommendations_by_title(books: list[dict]) -> list[dict]:
    seen: set[str] = set()
    unique: list[dict] = []
    for book in books:
        key = _normalize_title(book.get("title"))
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(book)
    return unique


def _companion_book_example() -> str:
    return """{
      "title": "string",
      "author": "string",
      "genre": "string",
      "pages": 320,
      "page_count": 320,
      "reason": "why it matches",
      "match": 97
    }"""


def _compact_reader_profile_for_prompt(reader_profile: dict | None) -> dict:
    """Send only preference signal + exclusions — not the full library payload."""
    if not isinstance(reader_profile, dict):
        return {"excluded_books": []}

    nested = reader_profile.get("profile")
    profile = nested if isinstance(nested, dict) else reader_profile

    excluded = sorted(_collect_excluded_titles(reader_profile))
    reviews = reader_profile.get("reviews") or []
    if not isinstance(reviews, list):
        reviews = []
    compact_reviews = []
    for review in reviews[:8]:
        if not isinstance(review, dict):
            continue
        compact_reviews.append(
            {
                "title": review.get("title") or review.get("book_title"),
                "rating": review.get("rating"),
                "text": (str(review.get("text") or review.get("review") or "")[:160] or None),
            }
        )

    quiz = (
        reader_profile.get("quiz_answers")
        or reader_profile.get("discovery_answers")
        or profile.get("quiz_answers")
        or []
    )
    if isinstance(quiz, list):
        quiz = quiz[:24]
    else:
        quiz = []

    favorite = profile.get("favorite_genres") or reader_profile.get("favorite_genres") or []
    if isinstance(favorite, list):
        favorite = favorite[:12]

    return {
        "reader_type": profile.get("reader_type") or reader_profile.get("reader_type"),
        "favorite_genres": favorite,
        "confirmed_reading_level": profile.get("confirmed_reading_level")
        or reader_profile.get("confirmed_reading_level"),
        "book_preferences": profile.get("book_preferences")
        or reader_profile.get("book_preferences"),
        "today_mood": reader_profile.get("today_mood"),
        "today_goal": reader_profile.get("today_goal"),
        "quiz_answers": quiz,
        "reviews": compact_reviews,
        "excluded_books": excluded[:100],
        "excluded_count": len(excluded),
    }


def _build_companion_prompt(
    question: str,
    reader_profile: dict | None,
    *,
    recommendation_count: int | None = None,
    already_recommended: list[str] | None = None,
) -> str:
    compact = _compact_reader_profile_for_prompt(reader_profile)
    count_rules = ""
    if recommendation_count and recommendation_count > 0:
        examples = ",\n    ".join([_companion_book_example()] * recommendation_count)
        recommendations_schema = f"[\n    {examples}\n  ]"
        count_rules = f"""
- You MUST return EXACTLY {recommendation_count} books in the recommendations array.
- recommendations must be a JSON array of {recommendation_count} objects, never a single object.
- Every book must be unique and must not appear in excluded_books."""
    else:
        recommendations_schema = f"[\n    {_companion_book_example()}\n  ]"

    supplement = ""
    if already_recommended:
        need = (
            max(0, recommendation_count - len(already_recommended))
            if recommendation_count and recommendation_count > 0
            else max(1, 3 - len(already_recommended))
        )
        supplement = f"""
Already recommended (do NOT repeat):
{json.dumps(already_recommended, ensure_ascii=False)}
Provide exactly {need} additional unique book(s)."""

    return f"""
You are Lexo, an AI librarian. Return JSON only.

Question: {question}
{supplement}
Reader preferences:
{json.dumps(compact, ensure_ascii=False)}

Rules:
- Never recommend titles in excluded_books.
- Favor favorite_genres, Reader DNA signals, high-rated reviews; avoid disliked styles.
- Keep reasons short (1 sentence).
- Include pages/page_count when known.
{count_rules}

{{
  "message": "short friendly introduction",
  "mood_detected": "string",
  "reasoning": ["short reason 1", "short reason 2"],
  "recommendations": {recommendations_schema}
}}
"""


def _call_companion_ai(
    question: str,
    reader_profile: dict | None,
    *,
    recommendation_count: int | None = None,
    already_recommended: list[str] | None = None,
) -> dict:
    prompt = _build_companion_prompt(
        question,
        reader_profile,
        recommendation_count=recommendation_count,
        already_recommended=already_recommended,
    )
    result = ai._openai_chat_completion(
        [
            {
                "role": "system",
                "content": "You are Lexo, an AI librarian. Always return valid JSON only.",
            },
            {
                "role": "user",
                "content": prompt,
            },
        ],
        temperature=0.6,
    )
    return _safe_json_loads(
        result,
        {
            "message": "I found some ideas for you.",
            "mood_detected": "Unknown",
            "reasoning": [],
            "recommendations": [],
        },
    )


def _collect_companion_recommendations(
    question: str,
    reader_profile: dict | None,
    *,
    count: int,
    max_attempts: int = 2,
    extra_excluded: set[str] | None = None,
) -> tuple[list[dict], dict]:
    excluded = _collect_excluded_titles(reader_profile)
    if extra_excluded:
        excluded |= {t for t in extra_excluded if t}

    collected: list[dict] = []
    seen_titles: set[str] = set()
    last_parsed: dict = {}

    for _attempt in range(max_attempts):
        if len(collected) >= count:
            break

        already = [book.get("title") for book in collected if book.get("title")]
        # First attempt asks for the full count; follow-ups only fill gaps.
        request_count = count if not already else count
        parsed = _call_companion_ai(
            question,
            reader_profile,
            recommendation_count=request_count,
            already_recommended=already or None,
        )
        last_parsed = parsed

        batch = _dedupe_recommendations_by_title(
            _filter_books(parsed.get("recommendations"), excluded | seen_titles)
        )
        for book in batch:
            key = _normalize_title(book.get("title"))
            if not key or key in seen_titles:
                continue
            seen_titles.add(key)
            collected.append(book)
            if len(collected) >= count:
                break

    return collected[:count], last_parsed


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
You are Lexo, an AI book recommendation assistant.

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


def recommend_with_book_data(data: ReaderProfileRequest, *, user_id: str | None = None) -> dict:
    from app.cover_service import enrich_profile_recommendations
    from app.user_store import get_cached_quiz_recommendations, save_quiz_recommendations_cache

    quiz_hash = _quiz_inputs_hash(data)
    if user_id:
        cached = get_cached_quiz_recommendations(user_id, quiz_hash)
        if cached:
            return cached

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
    enrich_profile_recommendations(profile_payload, cache_only=True)

    result = {
        "reader_type": profile_payload.get("reader_type"),
        "favorite_genres": profile_payload.get("favorite_genres"),
        "confirmed_reading_level": profile_payload.get("confirmed_reading_level"),
        "book_preferences": profile_payload.get("book_preferences"),
        "recommendations": profile_payload.get("recommendations", []),
        "engine": reader_result.get("engine"),
    }

    if user_id:
        save_quiz_recommendations_cache(
            user_id,
            quiz_hash=quiz_hash,
            payload={
                **result,
                "quiz_answers": data.quiz_answers,
                "books_read": data.books_read,
            },
        )

    return result


def reading_companion(
    question: str,
    reader_profile: dict | None = None,
    recommendation_count: int | None = None,
    *,
    extra_excluded: set[str] | None = None,
    max_attempts: int = 2,
) -> dict:
    from app.cover_service import enrich_books_in_list

    if recommendation_count and recommendation_count > 0:
        collected, last_parsed = _collect_companion_recommendations(
            question,
            reader_profile,
            count=recommendation_count,
            max_attempts=max_attempts,
            extra_excluded=extra_excluded,
        )
        # cache_only: return immediately; client hydrates missing covers async
        enriched = enrich_books_in_list(collected, cache_only=True)
        message = last_parsed.get("message", "I found some ideas for you.")
        reasoning = last_parsed.get("reasoning", [])
        if not enriched:
            message = (
                "I couldn't find a new book that isn't already in your library. "
                "Try a different genre, page length, or mood."
            )
            reasoning = []
        return {
            "message": message,
            "mood_detected": last_parsed.get("mood_detected", "Unknown"),
            "reasoning": reasoning if isinstance(reasoning, list) else [],
            "recommendations": enriched,
            "engine": ai.engine_name(),
            "requested_count": recommendation_count,
            "returned_count": len(enriched),
        }

    # Companion chat defaults to returning 1–3 usable, non-shelved books.
    # When the model claims a match then we filter it away, retry once.
    excluded = _collect_excluded_titles(reader_profile)
    if extra_excluded:
        excluded |= {t for t in extra_excluded if t}
    parsed = _call_companion_ai(question, reader_profile)
    raw_books = _normalize_recommendations(parsed.get("recommendations"))
    filtered = _filter_books(raw_books, excluded)

    if not filtered and raw_books:
        retry = _call_companion_ai(
            question,
            reader_profile,
            already_recommended=[b.get("title") for b in raw_books if b.get("title")],
        )
        parsed = retry
        filtered = _filter_books(parsed.get("recommendations"), excluded)

    if not filtered:
        collected, last_parsed = _collect_companion_recommendations(
            question,
            reader_profile,
            count=3,
            max_attempts=2,
            extra_excluded=extra_excluded,
        )
        if collected:
            parsed = last_parsed
            filtered = collected

    enriched = enrich_books_in_list(filtered, cache_only=True)
    message = parsed.get("message", "I found some ideas for you.")
    reasoning = parsed.get("reasoning", [])
    if not enriched:
        message = (
            "I couldn't find a new book that isn't already in your library. "
            "Try a different genre, page length, or mood."
        )
        reasoning = []

    return {
        "message": message,
        "mood_detected": parsed.get("mood_detected", "Unknown"),
        "reasoning": reasoning if isinstance(reasoning, list) else [],
        "recommendations": enriched,
        "engine": ai.engine_name(),
        "returned_count": len(enriched),
    }


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
You are Lexo, an AI librarian and reading guide.

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
                "content": "You are Lexo. Always return valid JSON only.",
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

    paths = [path for path in (parsed.get("paths") or []) if isinstance(path, dict)]
    all_books: list[dict] = []
    for path in paths:
        books = path.get("books") or []
        if isinstance(books, list):
            all_books.extend(book for book in books if isinstance(book, dict))

    if all_books:
        enriched = enrich_books_in_list(all_books, cache_only=True)
        enriched_by_title = {
            _normalize_title(book.get("title")): book for book in enriched if book.get("title")
        }
        for path in paths:
            books = path.get("books") or []
            if not isinstance(books, list):
                continue
            path["books"] = [
                enriched_by_title.get(_normalize_title(book.get("title")), book)
                if isinstance(book, dict)
                else book
                for book in books
            ]

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
You are Lexo, an AI librarian creating a personalized genre starter path.

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
                    {"role": "system", "content": "You are Lexo. Always return valid JSON only."},
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


def local_fallback_intelligence(
    reader_profile: dict | None = None,
    library: dict | None = None,
    today_mood: str | None = None,
    today_goal: str | None = None,
) -> dict:
    """Instant dashboard payload when OpenAI is unavailable or times out."""
    mood = (today_mood or "").strip()
    goal = (today_goal or "").strip()
    mission_bits = []
    if mood:
        mission_bits.append(f"match your {mood} mood")
    if goal:
        mission_bits.append(f"work toward {goal}")
    today_mission = (
        f"{mission_bits[0].capitalize()}" + (f" and {mission_bits[1]}" if len(mission_bits) > 1 else "") + " with a focused reading session."
        if mission_bits
        else "Choose a book that matches your current mood."
    )

    top_pick = {
        "title": "Ask Lexo for a recommendation",
        "author": "",
        "genre": "",
        "reason": "Generate recommendations or choose a mood to refresh today's AI pick.",
        "match": 80,
    }

    if isinstance(reader_profile, dict):
        recs = reader_profile.get("recommendations") or []
        if isinstance(recs, list) and recs:
            first = recs[0] if isinstance(recs[0], dict) else {}
            ai = first.get("ai_recommendation") if isinstance(first.get("ai_recommendation"), dict) else first
            if isinstance(ai, dict) and ai.get("title"):
                top_pick = {
                    "title": ai.get("title"),
                    "author": ai.get("author") or "",
                    "genre": ai.get("genre") or "",
                    "reason": ai.get("reason") or "From your saved Lexo recommendations.",
                    "match": int(ai.get("match") or 90),
                    "cover_url": (first.get("book_data") or {}).get("cover_url") or ai.get("cover_url"),
                }

    lib = library if isinstance(library, dict) else {}
    return {
        "dashboard": {
            "greeting_subtitle": "Your personalized reading world is ready.",
            "today_mission": today_mission,
            "top_pick": top_pick,
        },
        "discover": {"sections": []},
        "journey": {"reader_identity": "", "insights": [], "growth_suggestions": []},
        "achievements": [],
        "stats": {
            "read_count": len(lib.get("read") or []),
            "reading_count": len(lib.get("reading") or []),
            "want_count": len(lib.get("want") or []),
            "not_interested_count": len(lib.get("not_interested") or []),
            "favorite_genre": "",
        },
        "fallback": True,
        "engine": "local-fallback",
    }


def generate_reader_intelligence(
    reader_profile: dict | None = None,
    library: dict | None = None,
    today_mood: str | None = None,
    today_goal: str | None = None,
) -> dict:
    excluded_books = []

    if isinstance(reader_profile, dict):
        excluded_books = reader_profile.get("excluded_books", [])

    fallback = local_fallback_intelligence(reader_profile, library, today_mood, today_goal)

    if not ai.using_openai():
        logger.warning("Generating AI Pick… skipped (no OpenAI key) — using local fallback")
        return fallback

    prompt = f"""
You are Lexo's central Reader Intelligence engine.

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

    logger.info("Generating AI Pick…")
    try:
        result = ai._openai_chat_completion(
            [
                {
                    "role": "system",
                    "content": "You are Lexo's central intelligence engine. Always return valid JSON only.",
                },
                {
                    "role": "user",
                    "content": prompt,
                },
            ],
            temperature=0.65,
            timeout=20.0,
        )
    except Exception as exc:  # noqa: BLE001 — never hang the dashboard
        logger.exception("AI Pick generation failed: %s", exc)
        return fallback

    parsed = _safe_json_loads(
        result,
        fallback,
    )

    excluded = _collect_excluded_titles(reader_profile, library)
    _apply_intelligence_exclusions(parsed, excluded)

    from app.cover_service import enrich_book_entry

    dashboard = parsed.get("dashboard") or {}
    top_pick = dashboard.get("top_pick")
    if isinstance(top_pick, dict):
        try:
            dashboard["top_pick"] = enrich_book_entry(top_pick, cache_only=True)
        except Exception as exc:  # noqa: BLE001
            logger.warning("AI Pick cover enrich failed: %s", exc)
            dashboard["top_pick"] = top_pick
    parsed["dashboard"] = dashboard

    parsed["engine"] = ai.engine_name()
    logger.info("Mission created")
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
You are Lexo, a warm and insightful reading companion.

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
                "content": "You are Lexo. Always return valid JSON only. Be personal, never generic.",
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