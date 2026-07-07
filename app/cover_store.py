"""Supabase cache for resolved book cover URLs."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from app.supabase_rest import SupabaseRestError, request

COVERS_TABLE = "book_covers"

SOURCE_LABELS = {
    "google_books": "Google Books",
    "open_library": "Open Library",
    "isbn": "ISBN",
    "provided": "Database",
    "cache": "Cache",
    "unknown": "Unknown",
}


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


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
        "source": row.get("source"),
        "isbn": row.get("isbn"),
        "title": row.get("title"),
        "author": row.get("author"),
    }


def get_cached_cover(book_id: str) -> dict[str, Any] | None:
    """Look up a cached cover by book_id (ISBN key or title|author key)."""
    try:
        rows = request(
            "GET",
            COVERS_TABLE,
            params={
                "book_id": f"eq.{book_id}",
                "select": "book_id,cover_url,source,isbn,title,author",
                "limit": "1",
            },
        )
    except SupabaseRestError:
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
                "select": "book_id,cover_url,source,isbn,title,author",
                "limit": "1",
            },
        )
    except SupabaseRestError:
        return None

    if isinstance(rows, list) and rows:
        return _row_to_cached(rows[0])
    return None


def upsert_cover(
    *,
    book_id: str,
    title: str,
    author: str | None,
    isbn: str | None,
    cover_url: str,
    source: str,
) -> None:
    """Persist a resolved cover URL for future lookups."""
    clean_isbn = _normalize_isbn(isbn) or None
    payload = {
        "book_id": book_id,
        "title": title,
        "author": author or "",
        "isbn": clean_isbn,
        "cover_url": cover_url,
        "source": format_source(source),
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
