"""Supabase cache for resolved book cover URLs."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

from app.supabase_rest import SupabaseRestError, request

COVERS_TABLE = "book_covers"
LOOKUP_FAILED_TTL = timedelta(hours=24)

SOURCE_LABELS = {
    "google_books": "Google Books",
    "google_books_isbn": "Google Books",
    "open_library": "Open Library",
    "open_library_isbn": "Open Library",
    "open_library_provided": "Open Library",
    "open_library_cache": "Open Library",
    "isbn": "ISBN",
    "provided": "Database",
    "manual": "Manual",
    "cache": "Cache",
    "placeholder": "Placeholder",
    "failed": "Failed",
    "resolving": "Resolving",
    "unknown": "Unknown",
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _utcnow_iso() -> str:
    return _utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except ValueError:
        return None


def format_source(source: str | None) -> str:
    if not source:
        return SOURCE_LABELS["unknown"]
    key = source.strip().lower().replace(" ", "_")
    return SOURCE_LABELS.get(key, source)


def _normalize_isbn(isbn: str | None) -> str:
    return re.sub(r"[^0-9Xx]", "", isbn or "")


def _row_to_cached(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "book_id": row.get("book_id"),
        "cover_url": row.get("cover_url"),
        "manual_cover_url": row.get("manual_cover_url"),
        "lookup_failed_at": row.get("lookup_failed_at"),
        "source": row.get("source"),
        "cover_status": row.get("cover_status"),
        "external_source_url": row.get("external_source_url"),
        "isbn": row.get("isbn"),
        "title": row.get("title"),
        "author": row.get("author"),
    }


def _select_fields() -> str:
    return (
        "book_id,cover_url,manual_cover_url,lookup_failed_at,source,"
        "cover_status,external_source_url,isbn,title,author"
    )


def is_lookup_blocked(cached: dict[str, Any] | None) -> bool:
    """True when automatic lookup recently failed and should not be retried yet."""
    if not cached:
        return False
    failed_at = _parse_timestamp(cached.get("lookup_failed_at"))
    if not failed_at:
        return False
    return _utcnow() - failed_at < LOOKUP_FAILED_TTL


def get_cached_cover(book_id: str) -> dict[str, Any] | None:
    """Look up a cached cover row by book_id (ISBN key or title|author key)."""
    try:
        rows = request(
            "GET",
            COVERS_TABLE,
            params={
                "book_id": f"eq.{book_id}",
                "select": _select_fields(),
                "limit": "1",
            },
        )
    except Exception:
        return None

    if isinstance(rows, list) and rows:
        return _row_to_cached(rows[0])
    return None


def get_cached_cover_by_isbn(isbn: str | None) -> dict[str, Any] | None:
    """Look up a cached cover by ISBN when the caller only has an ISBN."""
    clean = _normalize_isbn(isbn)
    if not clean:
        return None

    by_id = get_cached_cover(f"isbn:{clean.lower()}")
    if by_id:
        return by_id

    try:
        rows = request(
            "GET",
            COVERS_TABLE,
            params={
                "isbn": f"eq.{clean}",
                "select": _select_fields(),
                "limit": "1",
            },
        )
    except Exception:
        return None

    if isinstance(rows, list) and rows:
        return _row_to_cached(rows[0])
    return None


def get_cached_cover_by_title_author(title: str | None, author: str | None) -> dict[str, Any] | None:
    """Look up a cached cover by title and author when book_id keys differ."""
    clean_title = (title or "").strip()
    if not clean_title:
        return None

    clean_author = (author or "").strip()
    params: dict[str, str] = {
        "title": f"eq.{clean_title}",
        "select": _select_fields(),
        "limit": "1",
    }
    if clean_author:
        params["author"] = f"eq.{clean_author}"

    try:
        rows = request("GET", COVERS_TABLE, params=params)
    except Exception:
        return None

    if isinstance(rows, list) and rows:
        return _row_to_cached(rows[0])
    return None


def get_cover_row(
    *,
    book_id: str,
    isbn: str | None = None,
    title: str | None = None,
    author: str | None = None,
) -> dict[str, Any] | None:
    return (
        get_cached_cover(book_id)
        or get_cached_cover_by_isbn(isbn)
        or get_cached_cover_by_title_author(title, author)
    )


def upsert_hosted_cover(
    *,
    book_id: str,
    title: str,
    author: str | None,
    isbn: str | None,
    cover_url: str | None,
    source: str,
    cover_status: str,
    external_source_url: str | None = None,
) -> None:
    clean_isbn = _normalize_isbn(isbn) or None
    payload: dict[str, Any] = {
        "book_id": book_id,
        "title": title,
        "author": author or "",
        "isbn": clean_isbn,
        "cover_url": cover_url,
        "source": format_source(source),
        "cover_status": cover_status,
        "external_source_url": external_source_url,
        "lookup_failed_at": None if cover_status == "ready" else None,
        "updated_at": _utcnow_iso(),
    }
    try:
        request(
            "POST",
            COVERS_TABLE,
            params={"on_conflict": "book_id"},
            json=payload,
            prefer="resolution=merge-duplicates,return=minimal",
        )
    except SupabaseRestError:
        pass


def upsert_cover(
    *,
    book_id: str,
    title: str,
    author: str | None,
    isbn: str | None,
    cover_url: str,
    source: str,
) -> None:
    """Persist an auto-resolved cover URL for future lookups."""
    clean_isbn = _normalize_isbn(isbn) or None
    payload = {
        "book_id": book_id,
        "title": title,
        "author": author or "",
        "isbn": clean_isbn,
        "cover_url": cover_url,
        "source": format_source(source),
        "lookup_failed_at": None,
        "updated_at": _utcnow_iso(),
    }
    try:
        request(
            "POST",
            COVERS_TABLE,
            params={"on_conflict": "book_id"},
            json=payload,
            prefer="resolution=merge-duplicates,return=minimal",
        )
    except SupabaseRestError:
        pass


def upsert_manual_cover(
    *,
    book_id: str,
    title: str,
    author: str | None,
    isbn: str | None,
    manual_cover_url: str,
) -> dict[str, Any] | None:
    """Set or update an admin manual cover override for a book."""
    clean_isbn = _normalize_isbn(isbn) or None
    payload = {
        "book_id": book_id,
        "title": title,
        "author": author or "",
        "isbn": clean_isbn,
        "manual_cover_url": manual_cover_url,
        "updated_at": _utcnow_iso(),
    }
    try:
        rows = request(
            "POST",
            COVERS_TABLE,
            params={"on_conflict": "book_id"},
            json=payload,
            prefer="resolution=merge-duplicates,return=representation",
        )
    except Exception:
        return None

    if isinstance(rows, list) and rows:
        return _row_to_cached(rows[0])
    return get_cached_cover(book_id)


def record_lookup_failure(
    *,
    book_id: str,
    title: str,
    author: str | None,
    isbn: str | None,
) -> None:
    """Record that automatic lookup failed so external APIs are not hammered."""
    clean_isbn = _normalize_isbn(isbn) or None
    payload = {
        "book_id": book_id,
        "title": title,
        "author": author or "",
        "isbn": clean_isbn,
        "lookup_failed_at": _utcnow_iso(),
        "updated_at": _utcnow_iso(),
    }
    try:
        request(
            "POST",
            COVERS_TABLE,
            params={"on_conflict": "book_id"},
            json=payload,
            prefer="resolution=merge-duplicates,return=minimal",
        )
    except SupabaseRestError:
        pass
