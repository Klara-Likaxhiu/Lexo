"""Centralized book cover resolution with multi-source lookup and Supabase caching."""

from __future__ import annotations

import logging
import re
from difflib import SequenceMatcher

import httpx

from app.cover_store import (
    format_source,
    get_cover_row,
    is_lookup_blocked,
    record_lookup_failure,
    upsert_cover,
)

logger = logging.getLogger(__name__)


def normalize_cover_url(url: str | None) -> str | None:
    if not url or not str(url).strip():
        return None

    normalized = str(url).strip().replace("http://", "https://")

    if "books.google" in normalized or "googleusercontent.com" in normalized:
        normalized = re.sub(r"zoom=\d+", "zoom=0", normalized)
        normalized = normalized.replace("&edge=curl", "")
        normalized = re.sub(r"w=\d+-h\d+", "w=800-h1200", normalized)

    if "openlibrary.org/b/" in normalized:
        normalized = (
            normalized.replace("-S.jpg", "-L.jpg")
            .replace("-M.jpg", "-L.jpg")
            .replace("-S.webp", "-L.jpg")
            .replace("-M.webp", "-L.jpg")
        )

    return normalized


def make_book_id(title: str | None, author: str | None, isbn: str | None = None) -> str:
    clean_isbn = re.sub(r"[^0-9Xx]", "", isbn or "")
    if clean_isbn:
        return f"isbn:{clean_isbn.lower()}"

    t = re.sub(r"\s+", " ", (title or "").lower().strip())
    a = re.sub(r"\s+", " ", (author or "unknown").lower().strip())
    return f"{t}|{a}"


def make_cache_key(title: str | None, author: str | None, isbn: str | None = None) -> str:
    """Alias for make_book_id (API / frontend compatibility)."""
    return make_book_id(title, author, isbn)


def _similarity(a: str | None, b: str | None) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()


_KNOWN_AUTHOR_ALIASES: dict[str, list[str]] = {
    "v.e. schwab": ["VE Schwab", "Victoria Schwab", "V E Schwab", "Schwab"],
    "v e schwab": ["VE Schwab", "Victoria Schwab", "V.E. Schwab", "Schwab"],
    "ve schwab": ["Victoria Schwab", "V.E. Schwab", "V E Schwab", "Schwab"],
}


def _normalize_author_key(author: str) -> str:
    return re.sub(r"\s+", " ", author.lower().strip())


def _author_search_variants(author: str | None) -> list[str]:
    """Generate author query variants (handles initials like V.E. Schwab)."""
    if not author or not author.strip():
        return []

    base = author.strip()
    variants: list[str] = [base]

    no_dots = re.sub(r"\.+", " ", base)
    no_dots = re.sub(r"\s+", " ", no_dots).strip()
    if no_dots and no_dots not in variants:
        variants.append(no_dots)

    compact = re.sub(r"[\.\s]+", "", base)
    if compact:
        last = base.split()[-1] if base.split() else ""
        if last and last.lower() != compact.lower():
            spaced_compact = f"{compact[: len(compact) - len(last)]} {last}".strip()
            spaced_compact = re.sub(r"\s+", " ", spaced_compact)
            if spaced_compact and spaced_compact not in variants:
                variants.append(spaced_compact)

    if base.split():
        last_name = base.split()[-1]
        if last_name and last_name not in variants and len(last_name) > 2:
            variants.append(last_name)

    aliases = _KNOWN_AUTHOR_ALIASES.get(_normalize_author_key(base), [])
    for alias in aliases:
        if alias not in variants:
            variants.append(alias)

    return variants


def _google_queries(title: str, author: str | None) -> list[str]:
    """Build aggressive Google Books queries, quoted intitle/inauthor first."""
    queries: list[str] = []
    safe_title = title.replace('"', "")

    for author_variant in _author_search_variants(author) or [None]:
        if author_variant:
            safe_author = author_variant.replace('"', "")
            queries.append(f'intitle:"{safe_title}" inauthor:"{safe_author}"')
            queries.append(f"intitle:{safe_title} inauthor:{safe_author}")
            queries.append(f"{safe_title} {safe_author}")
        else:
            queries.append(f'intitle:"{safe_title}"')
            queries.append(f"intitle:{safe_title}")
            queries.append(safe_title)

    seen: set[str] = set()
    unique: list[str] = []
    for query in queries:
        if query not in seen:
            seen.add(query)
            unique.append(query)
    return unique


def _open_library_queries(title: str, author: str | None) -> list[str]:
    """Build Open Library queries — title first, then title + author variants."""
    queries: list[str] = [title, f"title:{title}"]

    for author_variant in _author_search_variants(author):
        queries.append(f"{title} {author_variant}")
        queries.append(f"title:{title} author:{author_variant}")

    seen: set[str] = set()
    unique: list[str] = []
    for query in queries:
        if query not in seen:
            seen.add(query)
            unique.append(query)
    return unique


def _log_cover_result(title: str, author: str | None, result: dict) -> None:
    logger.debug(
        "[BookMindCover] %r by %s -> cover_url=%r source=%s cached=%s",
        title,
        author or "Unknown",
        result.get("cover_url"),
        result.get("source"),
        result.get("cached"),
    )


_JUNK_TITLE_RE = re.compile(
    r"\b(summary|study guide|trivia|cliffnotes|sparknotes|analysis|workbook|"
    r"companion guide|book review|digest|notes on)\b",
    re.I,
)

_TRUSTED_COVER_HOSTS = (
    "covers.openlibrary.org",
    "books.google.com",
    "books.googleusercontent.com",
    "googleusercontent.com",
)


def _normalize_title(title: str | None) -> str:
    if not title:
        return ""
    cleaned = re.sub(r"[^\w\s]", " ", title.lower())
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if cleaned.startswith("the "):
        cleaned = cleaned[4:]
    return cleaned


def _title_matches(candidate: str | None, target: str | None) -> bool:
    if not candidate or not target:
        return False

    cand = _normalize_title(candidate)
    tgt = _normalize_title(target)
    if not cand or not tgt:
        return False

    if cand == tgt or cand.startswith(tgt) or tgt.startswith(cand):
        return True

    return _similarity(cand, tgt) >= 0.68


def _title_match_score(candidate: str | None, target: str | None) -> float:
    if not candidate or not target:
        return 0.0
    cand = _normalize_title(candidate)
    tgt = _normalize_title(target)
    if cand == tgt:
        return 1.0
    if cand.startswith(tgt) or tgt.startswith(cand):
        return 0.95
    return _similarity(cand, tgt)


def _is_junk_title(title: str | None) -> bool:
    return bool(title and _JUNK_TITLE_RE.search(title))


def _is_trusted_cover_url(url: str) -> bool:
    lowered = url.lower()
    return any(host in lowered for host in _TRUSTED_COVER_HOSTS)


def _cover_url_is_usable(url: str | None) -> bool:
    if not url:
        return False

    normalized = normalize_cover_url(url)
    if not normalized:
        return False

    if _is_trusted_cover_url(normalized):
        return True

    return _url_exists(normalized)


def _url_exists(url: str) -> bool:
    try:
        response = httpx.head(url, timeout=6.0, follow_redirects=True)
        if 200 <= response.status_code < 400:
            return True
        if response.status_code in {403, 405}:
            response = httpx.get(
                url,
                timeout=6.0,
                follow_redirects=True,
                headers={"Range": "bytes=0-0"},
            )
            return 200 <= response.status_code < 400
    except httpx.HTTPError:
        return False
    return False


def _cache_and_return(
    *,
    book_id: str,
    title: str,
    author: str | None,
    isbn: str | None,
    cover_url: str,
    cover_source: str,
    cached: bool = False,
) -> dict:
    upsert_cover(
        book_id=book_id,
        title=title,
        author=author,
        isbn=isbn,
        cover_url=cover_url,
        source=cover_source,
    )
    return {
        "cover_url": cover_url,
        "cover_source": cover_source,
        "source": format_source(cover_source),
        "cached": cached,
        "book_id": book_id,
        "cache_key": book_id,
    }


def _from_google(
    title: str,
    author: str | None,
    google_id: str | None = None,
) -> tuple[str | None, dict | None]:
    from app.book_routes import fetch_google_volume, search_google_books

    if google_id:
        book = fetch_google_volume(google_id)
        if book and book.get("cover_url"):
            url = normalize_cover_url(book["cover_url"])
            if url and _cover_url_is_usable(url):
                return url, book

    queries = _google_queries(title, author)

    seen_ids: set[str] = set()
    candidates: list[tuple[float, dict]] = []

    for query in queries:
        for book in search_google_books(query, limit=5):
            book_id = book.get("id") or book.get("title")
            if book_id in seen_ids:
                continue
            seen_ids.add(book_id)
            if _is_junk_title(book.get("title")):
                continue
            score = _title_match_score(book.get("title"), title)
            if score < 0.68:
                continue
            url = normalize_cover_url(book.get("cover_url"))
            if url and _cover_url_is_usable(url):
                candidates.append((score, book))

    if candidates:
        candidates.sort(key=lambda item: item[0], reverse=True)
        best = candidates[0][1]
        return normalize_cover_url(best.get("cover_url")), best

    return None, None


def _from_open_library(
    title: str,
    author: str | None,
    open_library_key: str | None = None,
) -> tuple[str | None, dict | None]:
    from app.book_routes import fetch_open_library_detail, search_open_library

    if open_library_key:
        book = fetch_open_library_detail(open_library_key)
        if book and book.get("cover_url"):
            url = normalize_cover_url(book["cover_url"])
            if url and _cover_url_is_usable(url):
                return url, book

    queries = _open_library_queries(title, author)

    seen_keys: set[str] = set()
    candidates: list[tuple[float, dict]] = []

    for query in queries:
        for book in search_open_library(query, limit=8):
            key = book.get("open_library_key") or book.get("title")
            if key in seen_keys:
                continue
            seen_keys.add(key)
            if _is_junk_title(book.get("title")):
                continue
            score = _title_match_score(book.get("title"), title)
            if score < 0.68:
                continue
            url = normalize_cover_url(book.get("cover_url"))
            if url and _cover_url_is_usable(url):
                candidates.append((score, book))

    if candidates:
        candidates.sort(key=lambda item: item[0], reverse=True)
        best = candidates[0][1]
        return normalize_cover_url(best.get("cover_url")), best

    return None, None


def _from_isbn(isbn: str | None) -> str | None:
    clean = re.sub(r"[^0-9Xx]", "", isbn or "")
    if not clean:
        return None

    url = normalize_cover_url(f"https://covers.openlibrary.org/b/isbn/{clean}-L.jpg")
    if url and _cover_url_is_usable(url):
        return url
    return None


def _result_from_row(
    cached: dict,
    *,
    cover_url: str,
    cover_source: str,
    cached_flag: bool = True,
) -> dict:
    return {
        "cover_url": cover_url,
        "cover_source": cover_source,
        "source": format_source(cover_source),
        "cached": cached_flag,
        "book_id": cached.get("book_id"),
        "cache_key": cached.get("book_id"),
        "manual_cover_url": cached.get("manual_cover_url"),
    }


def _manual_cover_from_row(cached: dict | None) -> str | None:
    if not cached:
        return None
    return normalize_cover_url(cached.get("manual_cover_url"))


def resolve_cover(
    *,
    title: str,
    author: str | None = None,
    isbn: str | None = None,
    cover_url: str | None = None,
    google_id: str | None = None,
    open_library_key: str | None = None,
) -> dict:
    """Hybrid cover resolution.

    Priority:
      1. Existing cover_url on the book payload
      2. Cached auto success in Supabase (prior Google / Open Library / ISBN)
      3. Google Books (skipped when lookup_failed_at is within TTL)
      4. Open Library (+ ISBN CDN)
      5. Supabase manual_cover_url admin override
      6. None → frontend shows placeholder

    Every successful auto result is cached in Supabase. Failed auto lookups are
    recorded with lookup_failed_at to avoid hammering external APIs.
    """
    title = (title or "").strip()
    if not title:
        result = {"cover_url": None, "cover_source": None, "cached": False, "cache_key": ""}
        _log_cover_result(title, author, result)
        return result

    author = (author or "").strip() or None
    book_id = make_book_id(title, author, isbn)
    row = get_cover_row(book_id=book_id, isbn=isbn, title=title, author=author)

    # 1. Existing cover_url on the book.
    if cover_url:
        normalized = normalize_cover_url(cover_url)
        if normalized and _cover_url_is_usable(normalized):
            result = _cache_and_return(
                book_id=book_id,
                title=title,
                author=author,
                isbn=isbn,
                cover_url=normalized,
                cover_source="provided",
            )
            _log_cover_result(title, author, result)
            return result

    # Cached auto success from a previous lookup (fast path — no external APIs).
    if row and row.get("cover_url"):
        cached_url = normalize_cover_url(row["cover_url"])
        if cached_url and _cover_url_is_usable(cached_url):
            result = _result_from_row(
                row,
                cover_url=cached_url,
                cover_source=row.get("source") or "cache",
            )
            _log_cover_result(title, author, result)
            return result

    resolved_isbn = isbn
    save_id = book_id

    # Skip Google / Open Library when a recent automatic lookup already failed.
    if not is_lookup_blocked(row):
        google_url, google_book = _from_google(title, author, google_id)
        resolved_isbn = resolved_isbn or (google_book or {}).get("isbn")
        save_id = make_book_id(title, author, resolved_isbn)

        if google_url:
            result = _cache_and_return(
                book_id=save_id,
                title=title,
                author=author,
                isbn=resolved_isbn,
                cover_url=google_url,
                cover_source="google_books",
            )
            _log_cover_result(title, author, result)
            return result

        ol_url, ol_book = _from_open_library(title, author, open_library_key)
        resolved_isbn = resolved_isbn or (ol_book or {}).get("isbn")
        save_id = make_book_id(title, author, resolved_isbn)

        if ol_url:
            result = _cache_and_return(
                book_id=save_id,
                title=title,
                author=author,
                isbn=resolved_isbn,
                cover_url=ol_url,
                cover_source="open_library",
            )
            _log_cover_result(title, author, result)
            return result

        isbn_url = _from_isbn(resolved_isbn)
        if isbn_url:
            save_id = make_book_id(title, author, resolved_isbn)
            result = _cache_and_return(
                book_id=save_id,
                title=title,
                author=author,
                isbn=resolved_isbn,
                cover_url=isbn_url,
                cover_source="isbn",
            )
            _log_cover_result(title, author, result)
            return result

    # 5. Admin manual override stored in Supabase.
    manual_url = _manual_cover_from_row(row)
    if manual_url:
        result = {
            "cover_url": manual_url,
            "cover_source": "manual",
            "source": format_source("manual"),
            "cached": True,
            "book_id": (row or {}).get("book_id") or book_id,
            "cache_key": (row or {}).get("book_id") or book_id,
            "manual_cover_url": manual_url,
        }
        _log_cover_result(title, author, result)
        return result

    record_lookup_failure(
        book_id=book_id,
        title=title,
        author=author,
        isbn=isbn,
    )

    result = {
        "cover_url": None,
        "cover_source": None,
        "source": None,
        "cached": False,
        "book_id": book_id,
        "cache_key": book_id,
        "lookup_failed": True,
    }
    _log_cover_result(title, author, result)
    return result


def resolve_covers_batch(books: list[dict]) -> list[dict]:
    if not books:
        return []

    if len(books) == 1:
        book = books[0]
        resolved = resolve_cover(
            title=book.get("title") or "",
            author=book.get("author"),
            isbn=book.get("isbn"),
            cover_url=book.get("cover_url"),
            google_id=book.get("google_id") or book.get("id"),
            open_library_key=book.get("open_library_key"),
        )
        return [{**book, **resolved}]

    from concurrent.futures import ThreadPoolExecutor

    def _resolve_one(book: dict) -> dict:
        resolved = resolve_cover(
            title=book.get("title") or "",
            author=book.get("author"),
            isbn=book.get("isbn"),
            cover_url=book.get("cover_url"),
            google_id=book.get("google_id") or book.get("id"),
            open_library_key=book.get("open_library_key"),
        )
        return {**book, **resolved}

    workers = min(8, len(books))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(_resolve_one, books))


def enrich_recommendation(title: str, author: str | None = None, genre: str | None = None) -> dict | None:
    """Resolve cover and return minimal book_data for AI recommendations."""
    from app.book_routes import search_open_library

    resolved = resolve_cover(title=title, author=author)
    if resolved.get("cover_url"):
        return {
            "title": title,
            "author": author or "Unknown Author",
            "genre": genre,
            "cover_url": resolved["cover_url"],
            "source": resolved.get("cover_source"),
        }

    query = f"{title} {author}".strip() if author else title
    open_library_results = search_open_library(query, limit=3)
    for book in open_library_results:
        if _title_matches(book.get("title"), title):
            if not book.get("cover_url"):
                retry = resolve_cover(
                    title=book.get("title") or title,
                    author=book.get("author") or author,
                    isbn=book.get("isbn"),
                    open_library_key=book.get("open_library_key"),
                )
                if retry.get("cover_url"):
                    book["cover_url"] = retry["cover_url"]
            return book

    return None


def enrich_book_entry(book: dict) -> dict:
    """Attach a resolved cover_url to a book dict when possible."""
    if not isinstance(book, dict):
        return book

    title = book.get("title")
    if not title:
        return book

    if book.get("cover_url"):
        normalized = normalize_cover_url(book["cover_url"])
        if normalized and (_is_trusted_cover_url(normalized) or _cover_url_is_usable(normalized)):
            book["cover_url"] = normalized
            return book

    resolved = resolve_cover(
        title=title,
        author=book.get("author"),
        isbn=book.get("isbn"),
        cover_url=book.get("cover_url"),
        google_id=book.get("google_id"),
        open_library_key=book.get("open_library_key"),
    )
    if resolved.get("cover_url"):
        book["cover_url"] = resolved["cover_url"]
        book["cover_source"] = resolved.get("cover_source")

    return book


def enrich_books_in_list(books: list | None) -> list:
    if not isinstance(books, list):
        return []

    valid = [book for book in books if isinstance(book, dict)]
    if not valid:
        return []

    needs_resolve: list[dict] = []
    for book in valid:
        if book.get("cover_url"):
            normalized = normalize_cover_url(book["cover_url"])
            if normalized and (_is_trusted_cover_url(normalized) or _cover_url_is_usable(normalized)):
                book["cover_url"] = normalized
                continue
        needs_resolve.append(book)

    if not needs_resolve:
        return valid

    batch_payload = [
        {
            "title": book.get("title") or "",
            "author": book.get("author"),
            "isbn": book.get("isbn"),
            "cover_url": book.get("cover_url"),
            "google_id": book.get("google_id"),
            "open_library_key": book.get("open_library_key"),
        }
        for book in needs_resolve
    ]
    resolved = resolve_covers_batch(batch_payload)
    for book, result in zip(needs_resolve, resolved):
        if result.get("cover_url"):
            book["cover_url"] = result["cover_url"]
            book["cover_source"] = result.get("cover_source")

    return valid


def enrich_profile_recommendations(profile_data: dict | None, *, cache_only: bool = False) -> dict | None:
    """Attach cover URLs to stored quiz recommendations (cache-first batch)."""
    if not isinstance(profile_data, dict):
        return profile_data

    recommendations = profile_data.get("recommendations")
    if not isinstance(recommendations, list) or not recommendations:
        return profile_data

    batch_input: list[dict] = []
    targets: list[dict] = []

    for item in recommendations:
        if not isinstance(item, dict):
            continue
        ai = item.get("ai_recommendation") if isinstance(item.get("ai_recommendation"), dict) else item
        book_data = item.get("book_data") if isinstance(item.get("book_data"), dict) else {}

        existing = book_data.get("cover_url") or ai.get("cover_url")
        if existing:
            url = normalize_cover_url(existing)
            if url:
                if not book_data:
                    item["book_data"] = {}
                    book_data = item["book_data"]
                book_data["cover_url"] = url
                ai["cover_url"] = url
            continue

        title = ai.get("title") if isinstance(ai, dict) else None
        if not title:
            continue

        author = ai.get("author") if isinstance(ai, dict) else None
        isbn = ai.get("isbn") if isinstance(ai, dict) else None

        if cache_only:
            book_id = make_book_id(title, author, isbn)
            cached = get_cover_row(book_id=book_id, isbn=isbn, title=title, author=author)
            auto_url = normalize_cover_url((cached or {}).get("cover_url"))
            manual_url = normalize_cover_url((cached or {}).get("manual_cover_url"))
            url = auto_url or manual_url
            if url:
                if not isinstance(item.get("book_data"), dict):
                    item["book_data"] = {}
                item["book_data"]["cover_url"] = url
                item["book_data"]["title"] = title
                item["book_data"]["author"] = author
                item["book_data"]["genre"] = ai.get("genre") if isinstance(ai, dict) else None
                if isinstance(ai, dict):
                    ai["cover_url"] = url
            continue

        batch_input.append({"title": title, "author": author, "isbn": isbn})
        targets.append(item)

    if cache_only or not batch_input:
        return profile_data

    resolved = resolve_covers_batch(batch_input)
    for item, result in zip(targets, resolved):
        url = result.get("cover_url")
        if not url:
            continue
        ai = item.get("ai_recommendation") if isinstance(item.get("ai_recommendation"), dict) else item
        if not isinstance(item.get("book_data"), dict):
            item["book_data"] = {}
        item["book_data"]["cover_url"] = url
        item["book_data"]["title"] = ai.get("title")
        item["book_data"]["author"] = ai.get("author")
        item["book_data"]["genre"] = ai.get("genre")
        if isinstance(ai, dict):
            ai["cover_url"] = url

    return profile_data
