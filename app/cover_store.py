"""Supabase cache for resolved book cover URLs."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

from app.supabase_rest import SupabaseRestError, request

COVERS_TABLE = "book_covers"
LOOKUP_FAILED_TTL = timedelta(hours=24)
RESOLVING_STALE_TTL = timedelta(minutes=10)

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
    from app.cover_storage import is_hosted_cover_url

    cover_url = row.get("cover_url")
    cover_status = row.get("cover_status")
    if not cover_status and cover_url:
        cover_status = "ready" if is_hosted_cover_url(cover_url) else "legacy_external"
    return {
        "book_id": row.get("book_id"),
        "cover_url": cover_url,
        "manual_cover_url": row.get("manual_cover_url"),
        "lookup_failed_at": row.get("lookup_failed_at"),
        "source": row.get("source"),
        "cover_status": cover_status,
        "external_source_url": row.get("external_source_url"),
        "isbn": row.get("isbn"),
        "title": row.get("title"),
        "author": row.get("author"),
        "updated_at": row.get("updated_at"),
    }


_SELECT_FIELDS_FULL = (
    "book_id,cover_url,manual_cover_url,lookup_failed_at,source,"
    "cover_status,external_source_url,isbn,title,author,updated_at"
)
_SELECT_FIELDS_LEGACY = (
    "book_id,cover_url,manual_cover_url,lookup_failed_at,source,isbn,title,author,updated_at"
)
_SELECT_FIELDS_MINIMAL = "book_id,cover_url,source,isbn,title,author,updated_at"
_cached_select_fields: str | None = None


def _probe_select_fields() -> str:
    for candidate in (_SELECT_FIELDS_FULL, _SELECT_FIELDS_LEGACY, _SELECT_FIELDS_MINIMAL):
        try:
            request(
                "GET",
                COVERS_TABLE,
                params={"select": candidate, "limit": "1"},
            )
            return candidate
        except SupabaseRestError:
            continue
    return _SELECT_FIELDS_MINIMAL


def _select_fields() -> str:
    global _cached_select_fields
    if _cached_select_fields:
        return _cached_select_fields
    _cached_select_fields = _probe_select_fields()
    return _cached_select_fields


def _supports_proxy_columns() -> bool:
    return _select_fields() == _SELECT_FIELDS_FULL


def is_resolving_stale(cached: dict[str, Any] | None) -> bool:
    """True when a resolving row is old enough to reclaim."""
    if not cached:
        return True
    status = (cached.get("cover_status") or "missing").lower()
    if status != "resolving":
        return False
    updated = _parse_timestamp(cached.get("updated_at"))
    if not updated:
        return True
    return _utcnow() - updated >= RESOLVING_STALE_TTL


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


def _postgrest_in_filter(values: list[str]) -> str:
    parts: list[str] = []
    for value in values:
        cleaned = (value or "").strip()
        if not cleaned:
            continue
        if any(char in cleaned for char in ',()"'):
            escaped = cleaned.replace('"', '""')
            parts.append(f'"{escaped}"')
        else:
            parts.append(cleaned)
    return f"in.({','.join(parts)})"


def get_cover_rows_batch(book_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Fetch many cover rows in one query keyed by book_id."""
    unique_ids = list(dict.fromkeys(bid.strip() for bid in book_ids if bid and bid.strip()))
    if not unique_ids:
        return {}

    try:
        rows = request(
            "GET",
            COVERS_TABLE,
            params={
                "book_id": _postgrest_in_filter(unique_ids),
                "select": _select_fields(),
            },
        )
    except Exception:
        return {}

    if not isinstance(rows, list):
        return {}

    return {
        str(row.get("book_id")): _row_to_cached(row)
        for row in rows
        if isinstance(row, dict) and row.get("book_id")
    }


def try_claim_cover_resolution(
    *,
    book_id: str,
    title: str,
    author: str | None,
    isbn: str | None,
) -> bool:
    """Atomically claim cover resolution. True when this worker should resolve."""
    clean_isbn = _normalize_isbn(isbn) or None
    base_payload = {
        "book_id": book_id,
        "title": title,
        "author": author or "",
        "isbn": clean_isbn,
        "source": format_source("resolving"),
        "updated_at": _utcnow_iso(),
    }
    if _supports_proxy_columns():
        base_payload["cover_status"] = "resolving"

    row = get_cached_cover(book_id)
    if row and not _supports_proxy_columns():
        from app.cover_storage import is_hosted_cover_url

        existing = row.get("cover_url")
        if existing and is_hosted_cover_url(existing):
            return False
        return True
    if row:
        status = (row.get("cover_status") or "missing").lower()
        if status == "ready":
            return False
        if status == "resolving" and not is_resolving_stale(row):
            return False

    try:
        rows = request(
            "PATCH",
            COVERS_TABLE,
            params={
                "book_id": f"eq.{book_id}",
                "cover_status": "in.(missing,failed)",
            },
            json=base_payload,
            prefer="return=representation",
        )
        if isinstance(rows, list) and rows:
            return True
    except Exception:
        pass

    if row and (row.get("cover_status") or "").lower() == "resolving" and is_resolving_stale(row):
        try:
            rows = request(
                "PATCH",
                COVERS_TABLE,
                params={
                    "book_id": f"eq.{book_id}",
                    "cover_status": "eq.resolving",
                },
                json=base_payload,
                prefer="return=representation",
            )
            if isinstance(rows, list) and rows:
                return True
        except Exception:
            return False

    if row:
        return False

    try:
        rows = request(
            "POST",
            COVERS_TABLE,
            params={"on_conflict": "book_id"},
            json={**base_payload, "cover_url": ""},
            prefer="resolution=ignore-duplicates,return=representation",
        )
        if isinstance(rows, list) and rows:
            if _supports_proxy_columns():
                return (rows[0].get("cover_status") or "").lower() == "resolving"
            return True
    except SupabaseRestError:
        pass

    return False


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
        "lookup_failed_at": None,
        "updated_at": _utcnow_iso(),
    }
    if _supports_proxy_columns():
        payload["cover_status"] = cover_status
        payload["external_source_url"] = external_source_url
    try:
        request(
            "POST",
            COVERS_TABLE,
            params={"on_conflict": "book_id"},
            json=payload,
            prefer="resolution=merge-duplicates,return=minimal",
        )
    except SupabaseRestError:
        upsert_cover(
            book_id=book_id,
            title=title,
            author=author,
            isbn=isbn,
            cover_url=cover_url or "",
            source=source,
        )


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
    payload: dict[str, Any] = {
        "book_id": book_id,
        "title": title,
        "author": author or "",
        "isbn": clean_isbn,
        "cover_url": cover_url,
        "source": format_source(source),
        "updated_at": _utcnow_iso(),
    }
    if "lookup_failed_at" in _select_fields():
        payload["lookup_failed_at"] = None
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
