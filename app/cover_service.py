"""Centralized book cover resolution with multi-source lookup and Supabase caching."""

from __future__ import annotations

import re
from difflib import SequenceMatcher

import httpx

from app.cover_store import format_source, get_cached_cover, get_cached_cover_by_isbn, upsert_cover


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

    queries = [title]
    if author:
        queries.append(f"{title} {author}")
        queries.append(f"intitle:{title} inauthor:{author.split()[-1]}")

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

    queries = [title, f"title:{title}"]
    if author:
        queries.append(f"{title} {author}")

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


def resolve_cover(
    *,
    title: str,
    author: str | None = None,
    isbn: str | None = None,
    cover_url: str | None = None,
    google_id: str | None = None,
    open_library_key: str | None = None,
) -> dict:
    """Resolve a cover URL using cache → provided URL → Google → Open Library → ISBN."""
    title = (title or "").strip()
    if not title:
        return {"cover_url": None, "cover_source": None, "cached": False, "cache_key": ""}

    author = (author or "").strip() or None
    book_id = make_book_id(title, author, isbn)

    cached = get_cached_cover(book_id) or get_cached_cover_by_isbn(isbn)
    if cached and cached.get("cover_url"):
        url = normalize_cover_url(cached["cover_url"])
        if url:
            return {
                "cover_url": url,
                "cover_source": "cache",
                "source": cached.get("source") or "Cache",
                "cached": True,
                "book_id": cached.get("book_id") or book_id,
                "cache_key": cached.get("book_id") or book_id,
            }

    if cover_url:
        normalized = normalize_cover_url(cover_url)
        if normalized and _cover_url_is_usable(normalized):
            return _cache_and_return(
                book_id=book_id,
                title=title,
                author=author,
                isbn=isbn,
                cover_url=normalized,
                cover_source="provided",
            )

    google_url, google_book = _from_google(title, author, google_id)
    resolved_isbn = isbn or (google_book or {}).get("isbn")
    save_id = make_book_id(title, author, resolved_isbn)

    if google_url:
        return _cache_and_return(
            book_id=save_id,
            title=title,
            author=author,
            isbn=resolved_isbn,
            cover_url=google_url,
            cover_source="google_books",
        )

    ol_url, ol_book = _from_open_library(title, author, open_library_key)
    resolved_isbn = resolved_isbn or (ol_book or {}).get("isbn")
    save_id = make_book_id(title, author, resolved_isbn)

    if ol_url:
        return _cache_and_return(
            book_id=save_id,
            title=title,
            author=author,
            isbn=resolved_isbn,
            cover_url=ol_url,
            cover_source="open_library",
        )

    isbn_url = _from_isbn(resolved_isbn)
    if isbn_url:
        save_id = make_book_id(title, author, resolved_isbn)
        return _cache_and_return(
            book_id=save_id,
            title=title,
            author=author,
            isbn=resolved_isbn,
            cover_url=isbn_url,
            cover_source="isbn",
        )

    return {
        "cover_url": None,
        "cover_source": None,
        "source": None,
        "cached": False,
        "book_id": book_id,
        "cache_key": book_id,
    }


def resolve_covers_batch(books: list[dict]) -> list[dict]:
    results = []
    for book in books:
        resolved = resolve_cover(
            title=book.get("title") or "",
            author=book.get("author"),
            isbn=book.get("isbn"),
            cover_url=book.get("cover_url"),
            google_id=book.get("google_id") or book.get("id"),
            open_library_key=book.get("open_library_key"),
        )
        results.append({**book, **resolved})
    return results


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
        if normalized and _cover_url_is_usable(normalized):
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
    return [enrich_book_entry(book) for book in books if isinstance(book, dict)]
