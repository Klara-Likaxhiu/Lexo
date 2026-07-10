"""User library persistence in Supabase Postgres."""

from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime, timezone
from typing import Any

import httpx

from app.http_client import get_http_client
from app.supabase_client import supabase_anon_key, supabase_service_role_key, supabase_url

TABLE = "user_library"
VALID_STATUSES = {"want", "reading", "read", "not_interested"}
LIBRARY_LIST_COLUMNS = (
    "id,book_id,title,author,genre,cover_url,description,status,progress,"
    "current_page,total_pages,started_at,finished_at,last_opened_at,favorite,"
    "date_added,updated_at,metadata"
)
LIBRARY_ROW_COLUMNS = LIBRARY_LIST_COLUMNS

logger = logging.getLogger(__name__)


def extract_cover_url_from_book(book: dict[str, Any]) -> str | None:
    """Normalize cover URL from any common book payload field."""
    from app.cover_service import normalize_cover_url

    image_links = book.get("imageLinks") if isinstance(book.get("imageLinks"), dict) else {}
    volume_info = book.get("volumeInfo") if isinstance(book.get("volumeInfo"), dict) else {}
    volume_links = (
        volume_info.get("imageLinks") if isinstance(volume_info.get("imageLinks"), dict) else {}
    )
    book_data = book.get("book_data") if isinstance(book.get("book_data"), dict) else {}
    ai = book.get("ai_recommendation") if isinstance(book.get("ai_recommendation"), dict) else {}

    for candidate in (
        book.get("cover_url"),
        book.get("coverUrl"),
        book.get("image"),
        book.get("thumbnail"),
        image_links.get("thumbnail"),
        volume_links.get("thumbnail"),
        book_data.get("cover_url"),
        book_data.get("coverUrl"),
        ai.get("cover_url"),
    ):
        normalized = normalize_cover_url(candidate if isinstance(candidate, str) else None)
        if normalized:
            return normalized
    return None


class LibraryStoreError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def require_service_role() -> str:
    key = supabase_service_role_key()
    if not key:
        raise LibraryStoreError(
            "Library storage requires SUPABASE_SERVICE_ROLE_KEY in .env.",
            status_code=503,
        )
    return key


def normalize_title(title: str | None) -> str:
    return (title or "").lower().strip()


def make_book_id(book: dict[str, Any]) -> str:
    for key in ("book_id", "id", "open_library_key"):
        value = book.get(key)
        if value:
            return str(value)

    title = normalize_title(book.get("title"))
    author = normalize_title(book.get("author") or "unknown")
    digest = hashlib.sha256(f"{title}|{author}".encode()).hexdigest()
    return f"local_{digest[:24]}"


def _rest_url(path: str = "") -> str:
    return f"{supabase_url()}/rest/v1/{path.lstrip('/')}"


def _headers(*, prefer: str | None = None) -> dict[str, str]:
    service = require_service_role()
    headers = {
        "apikey": supabase_anon_key(),
        "Authorization": f"Bearer {service}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def _parse_error(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return response.text or "Supabase request failed."

    if isinstance(payload, dict):
        for key in ("message", "msg", "hint", "details", "error"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value
    if isinstance(payload, list) and payload:
        first = payload[0]
        if isinstance(first, dict):
            return first.get("message") or str(first)
    return "Supabase request failed."


def _request(
    method: str,
    path: str,
    *,
    params: dict | None = None,
    json: dict | list | None = None,
    prefer: str | None = None,
) -> Any:
    if not supabase_url():
        raise LibraryStoreError("Supabase is not configured.", status_code=503)

    client = get_http_client()
    response = client.request(
            method,
            _rest_url(path),
            headers=_headers(prefer=prefer),
            params=params,
            json=json,
        )

    if response.status_code >= 400:
        message = _parse_error(response)
        if response.status_code == 404 and "user_library" in message.lower():
            message = (
                "Library table not found. Run supabase/schema.sql in your Supabase project."
            )
        raise LibraryStoreError(message, status_code=response.status_code)

    if not response.content:
        return []
    return response.json()


def _compute_progress(current_page: int, total_pages: int) -> int:
    if total_pages <= 0:
        return 0
    return max(0, min(100, round((current_page / total_pages) * 100)))


def _validate_pages(current_page: int, total_pages: int) -> None:
    if total_pages <= 0:
        raise LibraryStoreError("Total pages must be greater than zero.")
    if current_page < 0:
        raise LibraryStoreError("Current page cannot be negative.")
    if current_page > total_pages:
        raise LibraryStoreError("Current page cannot be greater than total pages.")


def _resolve_page_fields(row: dict[str, Any], metadata: dict[str, Any]) -> tuple[int, int | None]:
    total = row.get("total_pages")
    if total is None:
        meta_total = metadata.get("total_pages")
        total = int(meta_total) if meta_total else None
    else:
        total = int(total)

    current = row.get("current_page")
    if current is None:
        meta_current = metadata.get("current_page")
        current = int(meta_current) if meta_current is not None else 0
    else:
        current = int(current)

    progress = int(row.get("progress") or 0)
    if current == 0 and progress > 0 and total and total > 0:
        current = round((progress / 100) * total)

    return current, total


def _row_to_book(row: dict[str, Any]) -> dict[str, Any]:
    metadata = row.get("metadata") or {}
    current_page, total_pages = _resolve_page_fields(row, metadata)
    return {
        "library_id": row["id"],
        "book_id": row["book_id"],
        "title": row["title"],
        "author": row.get("author") or "Unknown Author",
        "genre": row.get("genre") or metadata.get("genre") or "Book",
        "cover_url": row.get("cover_url"),
        "description": row.get("description"),
        "status": row["status"],
        "progress": int(row.get("progress") or 0),
        "current_page": current_page,
        "total_pages": total_pages,
        "started_at": row.get("started_at"),
        "finished_at": row.get("finished_at"),
        "last_opened_at": row.get("last_opened_at"),
        "favorite": bool(row.get("favorite")),
        "date_added": row.get("date_added"),
        "updated_at": row.get("updated_at"),
        "metadata": metadata,
    }


def _book_payload(user_id: str, book: dict[str, Any], status: str) -> dict[str, Any]:
    book_id = make_book_id(book)
    metadata = dict(book.get("metadata") or {})
    if book.get("source"):
        metadata["source"] = book["source"]
    if book.get("total_pages") is not None:
        metadata["total_pages"] = book["total_pages"]
    if book.get("current_page") is not None:
        metadata["current_page"] = book["current_page"]

    for key in (
        "publisher",
        "published_date",
        "categories",
        "average_rating",
        "ratings_count",
        "first_publish_year",
        "isbn",
        "open_library_key",
        "authors",
    ):
        value = book.get(key)
        if value is not None and value != "" and value != []:
            metadata[key] = value

    now = _utcnow_iso()
    current_page = book.get("current_page")
    total_pages = book.get("total_pages")
    progress = book.get("progress")
    if current_page is not None and total_pages:
        progress = _compute_progress(int(current_page), int(total_pages))
    elif progress is None:
        progress = 0

    payload: dict[str, Any] = {
        "user_id": user_id,
        "book_id": book_id,
        "title": (book.get("title") or "Untitled").strip(),
        "author": (book.get("author") or "Unknown Author").strip(),
        "genre": book.get("genre") or metadata.get("genre") or "Book",
        "cover_url": extract_cover_url_from_book(book),
        "description": book.get("description"),
        "status": status,
        "progress": max(0, min(100, int(progress))),
        "favorite": bool(book.get("favorite")),
        "metadata": metadata,
        "updated_at": now,
    }

    if current_page is not None:
        payload["current_page"] = max(0, int(current_page))
    if total_pages is not None:
        total_int = int(total_pages)
        if total_int > 0:
            payload["total_pages"] = total_int

    if status == "read":
        payload["finished_at"] = book.get("finished_at") or now
    if status == "reading" and int(progress) > 0:
        payload["started_at"] = book.get("started_at") or now

    if book.get("started_at"):
        payload["started_at"] = book["started_at"]
    if book.get("finished_at"):
        payload["finished_at"] = book["finished_at"]
    if book.get("last_opened_at"):
        payload["last_opened_at"] = book["last_opened_at"]

    return payload


def list_user_books(user_id: str) -> list[dict[str, Any]]:
    rows = _request(
        "GET",
        TABLE,
        params={
            "user_id": f"eq.{user_id}",
            "order": "updated_at.desc",
            "select": LIBRARY_LIST_COLUMNS,
        },
    )
    if not isinstance(rows, list):
        return []
    return [_row_to_book(row) for row in rows]


def group_by_status(books: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped = {status: [] for status in VALID_STATUSES}
    for book in books:
        status = book.get("status")
        if status in grouped:
            grouped[status].append(book)
    return grouped


def find_book_by_title(user_id: str, title: str) -> dict[str, Any] | None:
    key = normalize_title(title)
    if not key:
        return None

    trimmed = (title or "").strip()
    params: dict[str, str] = {
        "user_id": f"eq.{user_id}",
        "select": LIBRARY_ROW_COLUMNS,
        "limit": "8",
    }
    if trimmed:
        params["title"] = f"ilike.{trimmed}"

    rows = _request("GET", TABLE, params=params)
    if not isinstance(rows, list):
        return None

    for row in rows:
        book = _row_to_book(row)
        if normalize_title(book.get("title")) == key:
            return book
    return None


def is_book_finished(book: dict[str, Any]) -> bool:
    """True when the user has completed this library entry."""
    status = (book.get("status") or "").strip().lower()
    progress = int(book.get("progress") or 0)
    return status == "read" or progress >= 100


def user_has_finished_book(user_id: str, *, title: str) -> bool:
    """Check whether the user finished the given book in their library."""
    book = find_book_by_title(user_id, title)
    if not book:
        return False
    return is_book_finished(book)


def upsert_book(user_id: str, book: dict[str, Any], status: str) -> dict[str, Any]:
    if status not in VALID_STATUSES:
        raise LibraryStoreError(f"Invalid status: {status}")

    payload = _book_payload(user_id, book, status)
    logger.info(
        "[LibraryStore] upsert_book title=%r author=%r cover_url=%r book_id=%r status=%s",
        payload.get("title"),
        payload.get("author"),
        payload.get("cover_url"),
        payload.get("book_id"),
        status,
    )
    existing = _request(
        "GET",
        TABLE,
        params={
            "user_id": f"eq.{user_id}",
            "book_id": f"eq.{payload['book_id']}",
            "select": "id,date_added,started_at,finished_at,current_page,total_pages,progress,status",
            "limit": "1",
        },
    )

    is_new = not (isinstance(existing, list) and existing)
    if is_new:
        payload["date_added"] = _utcnow_iso()
    elif isinstance(existing, list) and existing:
        row = existing[0]
        if row.get("started_at"):
            payload["started_at"] = row["started_at"]
        if row.get("finished_at") and payload.get("status") != "read" and payload.get("progress", 0) < 100:
            payload["finished_at"] = None
        elif row.get("finished_at") and payload.get("status") == "read":
            payload["finished_at"] = row["finished_at"]
        elif payload.get("status") == "read" and not payload.get("finished_at"):
            payload["finished_at"] = _utcnow_iso()

    rows = _request(
        "POST",
        TABLE,
        params={"on_conflict": "user_id,book_id"},
        json=payload,
        prefer="resolution=merge-duplicates,return=representation",
    )
    if isinstance(rows, list) and rows:
        saved = _row_to_book(rows[0])
        saved["_created"] = is_new
        return saved
    saved = _row_to_book({**payload, "id": payload["book_id"]})
    saved["_created"] = is_new
    return saved


def delete_book(user_id: str, *, library_id: str | None = None, book_id: str | None = None) -> None:
    if library_id:
        _request(
            "DELETE",
            TABLE,
            params={"id": f"eq.{library_id}", "user_id": f"eq.{user_id}"},
        )
        return
    if book_id:
        _request(
            "DELETE",
            TABLE,
            params={"book_id": f"eq.{book_id}", "user_id": f"eq.{user_id}"},
        )
        return
    raise LibraryStoreError("library_id or book_id is required.")


def update_book(
    user_id: str,
    *,
    library_id: str | None = None,
    book_id: str | None = None,
    status: str | None = None,
    progress: int | None = None,
    favorite: bool | None = None,
) -> dict[str, Any]:
    params: dict[str, str] = {"user_id": f"eq.{user_id}", "select": LIBRARY_ROW_COLUMNS}
    if library_id:
        params["id"] = f"eq.{library_id}"
    elif book_id:
        params["book_id"] = f"eq.{book_id}"
    else:
        raise LibraryStoreError("library_id or book_id is required.")

    patch: dict[str, Any] = {"updated_at": _utcnow_iso()}
    if status is not None:
        if status not in VALID_STATUSES:
            raise LibraryStoreError(f"Invalid status: {status}")
        patch["status"] = status
        if status == "read":
            patch["finished_at"] = _utcnow_iso()
        else:
            patch["finished_at"] = None
    if progress is not None:
        patch["progress"] = max(0, min(100, int(progress)))
        if int(progress) >= 100:
            patch["status"] = "read"
            patch["finished_at"] = _utcnow_iso()
    if favorite is not None:
        patch["favorite"] = bool(favorite)

    rows = _request(
        "PATCH",
        TABLE,
        params=params,
        json=patch,
        prefer="return=representation",
    )
    if not isinstance(rows, list) or not rows:
        raise LibraryStoreError("Book not found.", status_code=404)
    return _row_to_book(rows[0])


def update_book_cover(
    user_id: str,
    *,
    cover_url: str,
    library_id: str | None = None,
    title: str | None = None,
    author: str | None = None,
) -> dict[str, Any] | None:
    """Persist a resolved cover URL onto a user's library book when possible."""
    from app.cover_service import normalize_cover_url

    normalized = normalize_cover_url(cover_url)
    if not normalized:
        return None

    params: dict[str, str] = {"user_id": f"eq.{user_id}", "select": LIBRARY_ROW_COLUMNS, "limit": "1"}
    if library_id:
        params["id"] = f"eq.{library_id}"
    elif title:
        params["title"] = f"eq.{title.strip()}"
        if author:
            params["author"] = f"eq.{author.strip()}"
    else:
        return None

    rows = _request("GET", TABLE, params=params)
    if not isinstance(rows, list) or not rows:
        return None

    row = rows[0]
    if row.get("cover_url") == normalized:
        return _row_to_book(row)

    patched = _request(
        "PATCH",
        TABLE,
        params={"id": f"eq.{row['id']}", "user_id": f"eq.{user_id}", "select": LIBRARY_ROW_COLUMNS},
        json={"cover_url": normalized, "updated_at": _utcnow_iso()},
        prefer="return=representation",
    )
    if not isinstance(patched, list) or not patched:
        return None
    return _row_to_book(patched[0])


def _get_book_row(user_id: str, *, library_id: str) -> dict[str, Any]:
    rows = _request(
        "GET",
        TABLE,
        params={
            "id": f"eq.{library_id}",
            "user_id": f"eq.{user_id}",
            "select": LIBRARY_LIST_COLUMNS,
            "limit": "1",
        },
    )
    if not isinstance(rows, list) or not rows:
        raise LibraryStoreError("Book not found.", status_code=404)
    return rows[0]


def update_reading_progress(
    user_id: str,
    *,
    library_id: str,
    current_page: int,
    total_pages: int,
) -> dict[str, Any]:
    _validate_pages(current_page, total_pages)

    row = _get_book_row(user_id, library_id=library_id)
    now = _utcnow_iso()
    progress = _compute_progress(current_page, total_pages)

    patch: dict[str, Any] = {
        "current_page": current_page,
        "total_pages": total_pages,
        "progress": progress,
        "updated_at": now,
        "last_opened_at": now,
    }

    metadata = dict(row.get("metadata") or {})
    metadata["current_page"] = current_page
    metadata["total_pages"] = total_pages
    patch["metadata"] = metadata

    if progress > 0 and not row.get("started_at"):
        patch["started_at"] = now

    if progress >= 100:
        patch["status"] = "read"
        if not row.get("finished_at"):
            patch["finished_at"] = now
    elif row.get("status") == "read":
        patch["status"] = "reading"
        patch["finished_at"] = None
    elif progress > 0 and row.get("status") == "want":
        patch["status"] = "reading"
        if not row.get("started_at"):
            patch["started_at"] = now

    rows = _request(
        "PATCH",
        TABLE,
        params={"id": f"eq.{library_id}", "user_id": f"eq.{user_id}", "select": LIBRARY_ROW_COLUMNS},
        json=patch,
        prefer="return=representation",
    )
    if not isinstance(rows, list) or not rows:
        raise LibraryStoreError("Book not found.", status_code=404)

    saved = _row_to_book(rows[0])
    saved["_finished"] = progress >= 100
    return saved


def touch_last_opened(user_id: str, *, library_id: str) -> dict[str, Any]:
    now = _utcnow_iso()
    rows = _request(
        "PATCH",
        TABLE,
        params={"id": f"eq.{library_id}", "user_id": f"eq.{user_id}", "select": LIBRARY_ROW_COLUMNS},
        json={"last_opened_at": now, "updated_at": now},
        prefer="return=representation",
    )
    if not isinstance(rows, list) or not rows:
        raise LibraryStoreError("Book not found.", status_code=404)
    return _row_to_book(rows[0])
