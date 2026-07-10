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

_MISSING_COVER_VALUES = frozenset({"null", "undefined", "none", "n/a", "false", "0", ""})


def is_missing_cover_url(url: str | None) -> bool:
    """Treat empty, junk strings, and falsy values as missing covers."""
    if url is None:
        return True
    value = str(url).strip()
    if not value:
        return True
    return value.lower() in _MISSING_COVER_VALUES


def normalize_cover_url(url: str | None) -> str | None:
    if is_missing_cover_url(url):
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
    "victoria schwab": ["V.E. Schwab", "VE Schwab", "V E Schwab"],
    "neil gaiman": ["Gaiman"],
    "markus zusak": ["Zusak"],
    "jane austen": ["Austen"],
    "matt haig": ["Haig"],
}

_SUBTITLE_SEPARATORS = (":", " – ", " — ", " - ")
_HIGH_CONFIDENCE_SCORE = 0.88
_MAX_GOOGLE_QUERIES = 8
_MAX_OPEN_LIBRARY_QUERIES = 10


def _normalize_author_key(author: str) -> str:
    cleaned = re.sub(r"[^\w\s]", " ", author.lower())
    return re.sub(r"\s+", " ", cleaned).strip()


def _title_search_variants(title: str) -> list[str]:
    """Build title variants: strip subtitles, parentheticals, and extra punctuation."""
    base = (title or "").strip()
    if not base:
        return []

    variants: list[str] = []

    def add(value: str) -> None:
        cleaned = re.sub(r"\s+", " ", (value or "").strip())
        if cleaned and cleaned not in variants:
            variants.append(cleaned)

    add(base)

    for sep in _SUBTITLE_SEPARATORS:
        if sep in base:
            add(base.split(sep, 1)[0])

    no_paren = re.sub(r"\([^)]*\)", "", base)
    no_paren = re.sub(r"\s+", " ", no_paren).strip()
    add(no_paren)
    for sep in _SUBTITLE_SEPARATORS:
        if sep in no_paren:
            add(no_paren.split(sep, 1)[0])

    plain = re.sub(r"[^\w\s']", " ", base)
    plain = re.sub(r"\s+", " ", plain).strip()
    add(plain)

    return variants


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

    spaced_initials = re.sub(
        r"\b([A-Za-z])\.(?=[A-Za-z])",
        r"\1. ",
        base,
    )
    spaced_initials = re.sub(r"\s+", " ", spaced_initials).strip()
    if spaced_initials and spaced_initials not in variants:
        variants.append(spaced_initials)

    parts = base.split()
    if len(parts) >= 2:
        last_name = parts[-1]
        initials = "".join(part.replace(".", "") for part in parts[:-1] if part)
        if initials and last_name:
            compact = f"{initials} {last_name}".strip()
            if compact not in variants:
                variants.append(compact)
            spaced = f"{' '.join(part.replace('.', '') for part in parts[:-1])} {last_name}".strip()
            spaced = re.sub(r"\s+", " ", spaced)
            if spaced and spaced not in variants:
                variants.append(spaced)

        if last_name and last_name not in variants and len(last_name) > 2:
            variants.append(last_name)

    aliases = _KNOWN_AUTHOR_ALIASES.get(_normalize_author_key(base), [])
    for alias in aliases:
        if alias not in variants:
            variants.append(alias)

    return variants


def _author_match_score(candidate: str | None, target: str | None) -> float:
    if not target:
        return 0.5
    if not candidate:
        return 0.0

    target_variants = {_normalize_author_key(v) for v in _author_search_variants(target)}
    target_variants.add(_normalize_author_key(target))
    candidate_key = _normalize_author_key(candidate)

    if candidate_key in target_variants:
        return 1.0

    target_last = _normalize_author_key(target).split()[-1]
    candidate_last = candidate_key.split()[-1]
    if target_last and candidate_last == target_last:
        return 0.85

    best = max(_similarity(candidate_key, variant) for variant in target_variants)
    return best * 0.75


def _combined_match_score(
    candidate_title: str | None,
    candidate_author: str | None,
    target_title: str,
    target_author: str | None,
) -> float:
    title_score = _title_match_score(candidate_title, target_title)
    author_score = _author_match_score(candidate_author, target_author)
    return title_score * 0.72 + author_score * 0.28


def _google_queries(title: str, author: str | None) -> list[str]:
    """Build Google Books queries — primary title + author variants first."""
    queries: list[str] = []
    titles = _title_search_variants(title) or [title]
    authors = _author_search_variants(author) or [None]

    for title_variant in titles[:3]:
        safe_title = title_variant.replace('"', "")
        for author_variant in authors[:4]:
            if author_variant:
                safe_author = author_variant.replace('"', "")
                queries.append(f'intitle:"{safe_title}" inauthor:"{safe_author}"')
                queries.append(f"intitle:{safe_title} inauthor:{safe_author}")
            else:
                queries.append(f'intitle:"{safe_title}"')
                queries.append(f"intitle:{safe_title}")

    if author:
        safe_title = titles[0].replace('"', "")
        safe_author = author.replace('"', "")
        queries.append(f"{safe_title} {safe_author}")

    seen: set[str] = set()
    unique: list[str] = []
    for query in queries:
        if query not in seen:
            seen.add(query)
            unique.append(query)
    return unique[:_MAX_GOOGLE_QUERIES]


def _open_library_queries(title: str, author: str | None) -> list[str]:
    """Build Open Library queries — normalized title + author variants."""
    queries: list[str] = []
    titles = _title_search_variants(title) or [title]
    authors = _author_search_variants(author)

    for title_variant in titles[:3]:
        queries.append(title_variant)
        queries.append(f"title:{title_variant}")
        for author_variant in authors[:4]:
            queries.append(f"{title_variant} {author_variant}")
            queries.append(f"title:{title_variant} author:{author_variant}")

    seen: set[str] = set()
    unique: list[str] = []
    for query in queries:
        if query not in seen:
            seen.add(query)
            unique.append(query)
    return unique[:_MAX_OPEN_LIBRARY_QUERIES]


def _log_cover_result(title: str, author: str | None, result: dict) -> None:
    debug = result.get("cover_debug") or {}
    logger.info(
        "[BookCover] title=%r saved=%r google=%r ol_isbn=%r ol_search=%r final=%s url=%r",
        title,
        debug.get("saved_cover_url"),
        debug.get("google_books"),
        debug.get("open_library_isbn"),
        debug.get("open_library_search"),
        debug.get("final_source") or result.get("cover_source") or "placeholder",
        result.get("cover_url"),
    )


def _attach_cover_debug(
    result: dict,
    *,
    title: str,
    saved_cover_url: str | None,
    google_books: str | None = None,
    open_library_isbn: str | None = None,
    open_library_search: str | None = None,
) -> dict:
    final_source = result.get("cover_source") or (
        "placeholder" if not result.get("cover_url") else "unknown"
    )
    result["cover_debug"] = {
        "title": title,
        "saved_cover_url": saved_cover_url,
        "google_books": google_books,
        "open_library_isbn": open_library_isbn,
        "open_library_search": open_library_search,
        "final_source": final_source,
    }
    _log_cover_result(title, result.get("author"), result)
    return result


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
    cover_debug: dict | None = None,
) -> dict:
    upsert_cover(
        book_id=book_id,
        title=title,
        author=author,
        isbn=isbn,
        cover_url=cover_url,
        source=cover_source,
    )
    payload = {
        "cover_url": cover_url,
        "cover_source": cover_source,
        "source": format_source(cover_source),
        "cached": cached,
        "book_id": book_id,
        "cache_key": book_id,
        "author": author,
    }
    if cover_debug:
        payload["cover_debug"] = cover_debug
    return payload


def _pick_best_cover_candidate(
    candidates: list[tuple[float, dict]],
    *,
    target_title: str,
    target_author: str | None,
) -> dict | None:
    if not candidates:
        return None
    rescored: list[tuple[float, dict]] = []
    for _, book in candidates:
        score = _combined_match_score(
            book.get("title"),
            book.get("author"),
            target_title,
            target_author,
        )
        rescored.append((score, book))
    rescored.sort(key=lambda item: item[0], reverse=True)
    best_score, best_book = rescored[0]
    if best_score < 0.68:
        return None
    return best_book


def _from_google(
    title: str,
    author: str | None,
    google_id: str | None = None,
) -> tuple[str | None, dict | None]:
    from app.book_routes import fetch_google_volume, google_books_available, search_google_books

    if google_id:
        book = fetch_google_volume(google_id)
        if book and book.get("cover_url"):
            url = normalize_cover_url(book["cover_url"])
            if url and _cover_url_is_usable(url):
                return url, book

    if not google_books_available():
        return None, None

    queries = _google_queries(title, author)

    seen_ids: set[str] = set()
    candidates: list[tuple[float, dict]] = []

    for query in queries:
        for book in search_google_books(query, limit=5):
            if not google_books_available():
                break

            book_id = book.get("id") or book.get("title")
            if book_id in seen_ids:
                continue
            seen_ids.add(book_id)
            if _is_junk_title(book.get("title")):
                continue

            score = _combined_match_score(
                book.get("title"),
                book.get("author"),
                title,
                author,
            )
            if score < 0.68:
                continue

            url = normalize_cover_url(book.get("cover_url"))
            if not url:
                continue
            if url and _cover_url_is_usable(url):
                if score >= _HIGH_CONFIDENCE_SCORE:
                    return url, book
                candidates.append((score, book))

        if candidates:
            break

    best = _pick_best_cover_candidate(candidates, target_title=title, target_author=author)
    if best:
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

            score = _combined_match_score(
                book.get("title"),
                book.get("author"),
                title,
                author,
            )
            if score < 0.68:
                continue

            url = normalize_cover_url(book.get("cover_url"))
            if not url and book.get("open_library_key"):
                continue
            if url and _cover_url_is_usable(url):
                if score >= _HIGH_CONFIDENCE_SCORE:
                    return url, book
                candidates.append((score, book))

        if candidates:
            break

    best = _pick_best_cover_candidate(candidates, target_title=title, target_author=author)
    if best:
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
    saved_input = cover_url
    if not title:
        result = {"cover_url": None, "cover_source": None, "cached": False, "cache_key": ""}
        return _attach_cover_debug(result, title=title, saved_cover_url=saved_input)

    author = (author or "").strip() or None
    book_id = make_book_id(title, author, isbn)
    row = get_cover_row(book_id=book_id, isbn=isbn, title=title, author=author)

    google_attempt: str | None = None
    ol_isbn_attempt: str | None = None
    ol_search_attempt: str | None = None

    # 1. Existing cover_url on the book.
    if not is_missing_cover_url(cover_url):
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
            return _attach_cover_debug(
                result,
                title=title,
                saved_cover_url=saved_input,
                google_books=None,
                open_library_isbn=None,
                open_library_search=None,
            )

    # Cached auto success from a previous lookup (fast path — no external APIs).
    if row and row.get("cover_url"):
        cached_url = normalize_cover_url(row["cover_url"])
        if cached_url:
            result = _result_from_row(
                row,
                cover_url=cached_url,
                cover_source=row.get("source") or "cache",
            )
            result["author"] = author
            return _attach_cover_debug(
                result,
                title=title,
                saved_cover_url=saved_input,
            )

    resolved_isbn = isbn
    save_id = book_id

    # Skip Google / Open Library when a recent automatic lookup already failed.
    if not is_lookup_blocked(row):
        # 2. Google Books (title + author, with normalized variants).
        google_url, google_book = _from_google(title, author, google_id)
        google_attempt = google_url
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
            return _attach_cover_debug(
                result,
                title=title,
                saved_cover_url=saved_input,
                google_books=google_attempt,
            )

        # 3. Open Library ISBN CDN when an ISBN is known.
        isbn_url = _from_isbn(resolved_isbn or isbn)
        ol_isbn_attempt = isbn_url
        if isbn_url:
            save_id = make_book_id(title, author, resolved_isbn)
            result = _cache_and_return(
                book_id=save_id,
                title=title,
                author=author,
                isbn=resolved_isbn,
                cover_url=isbn_url,
                cover_source="open_library_isbn",
            )
            return _attach_cover_debug(
                result,
                title=title,
                saved_cover_url=saved_input,
                google_books=google_attempt,
                open_library_isbn=ol_isbn_attempt,
            )

        # 4. Open Library search (title + author variants).
        ol_url, ol_book = _from_open_library(title, author, open_library_key)
        ol_search_attempt = ol_url
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
            return _attach_cover_debug(
                result,
                title=title,
                saved_cover_url=saved_input,
                google_books=google_attempt,
                open_library_isbn=ol_isbn_attempt,
                open_library_search=ol_search_attempt,
            )

    # 5. Manual override — only when automatic sources fail.
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
            "author": author,
        }
        return _attach_cover_debug(
            result,
            title=title,
            saved_cover_url=saved_input,
            google_books=google_attempt,
            open_library_isbn=ol_isbn_attempt,
            open_library_search=ol_search_attempt,
        )

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
        "author": author,
    }
    return _attach_cover_debug(
        result,
        title=title,
        saved_cover_url=saved_input,
        google_books=google_attempt,
        open_library_isbn=ol_isbn_attempt,
        open_library_search=ol_search_attempt,
    )


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


def enrich_books_in_list(books: list | None, *, cache_only: bool = False) -> list:
    if not isinstance(books, list):
        return []

    valid = [book for book in books if isinstance(book, dict)]
    if not valid:
        return []

    needs_resolve: list[dict] = []
    for book in valid:
        if book.get("cover_url"):
            normalized = normalize_cover_url(book["cover_url"])
            if normalized:
                if _is_trusted_cover_url(normalized):
                    book["cover_url"] = normalized
                    continue
                if not cache_only and _cover_url_is_usable(normalized):
                    book["cover_url"] = normalized
                    continue

        if cache_only:
            book_id = make_book_id(book.get("title"), book.get("author"), book.get("isbn"))
            cached = get_cover_row(
                book_id=book_id,
                isbn=book.get("isbn"),
                title=book.get("title"),
                author=book.get("author"),
            )
            auto_url = normalize_cover_url((cached or {}).get("cover_url"))
            manual_url = normalize_cover_url((cached or {}).get("manual_cover_url"))
            url = auto_url or manual_url
            if url:
                book["cover_url"] = url
            continue

        needs_resolve.append(book)

    if cache_only or not needs_resolve:
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
