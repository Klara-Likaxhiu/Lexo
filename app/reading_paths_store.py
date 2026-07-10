"""User reading paths persistence in Supabase Postgres."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx

from app.http_client import get_http_client
from app.supabase_client import supabase_anon_key, supabase_service_role_key, supabase_url

TABLE = "user_reading_paths"
PATH_LIST_COLUMNS = (
    "id,user_id,path_name,genre_slug,genre_label,path_data,updated_at,created_at"
)


class ReadingPathsStoreError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def normalize_genre_slug(genre: str | None) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", (genre or "").lower()).strip("-")
    return cleaned[:80] or "genre"


def require_service_role() -> str:
    key = supabase_service_role_key()
    if not key:
        raise ReadingPathsStoreError(
            "Reading path storage requires SUPABASE_SERVICE_ROLE_KEY in .env.",
            status_code=503,
        )
    return key


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
        raise ReadingPathsStoreError("Supabase is not configured.", status_code=503)

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
        if response.status_code == 404 and TABLE in message.lower():
            message = (
                "Reading paths table not found. Run supabase/schema.sql in your Supabase project."
            )
        raise ReadingPathsStoreError(message, status_code=response.status_code)

    if not response.content:
        return []
    return response.json()


def _row_to_path(row: dict[str, Any]) -> dict[str, Any]:
    data = row.get("path_data") or {}
    path = {
        "id": row["id"],
        "path_name": row.get("path_name") or data.get("path_name") or "Reading Path",
        "path_icon": data.get("path_icon") or "📚",
        "why_this_path": data.get("why_this_path") or "",
        "difficulty_progression": data.get("difficulty_progression") or "Beginner to Advanced",
        "genre": row.get("genre_label") or data.get("genre"),
        "genre_slug": row.get("genre_slug"),
        "books": data.get("books") or [],
    }
    for key, value in data.items():
        if key not in path:
            path[key] = value
    return path


def list_user_paths(user_id: str) -> list[dict[str, Any]]:
    rows = _request(
        "GET",
        TABLE,
        params={
            "user_id": f"eq.{user_id}",
            "select": PATH_LIST_COLUMNS,
            "order": "updated_at.desc",
        },
    )
    if not isinstance(rows, list):
        return []
    return [_row_to_path(row) for row in rows]


def get_path_by_id(user_id: str, path_id: str) -> dict[str, Any] | None:
    rows = _request(
        "GET",
        TABLE,
        params={
            "user_id": f"eq.{user_id}",
            "id": f"eq.{path_id}",
            "select": PATH_LIST_COLUMNS,
            "limit": "1",
        },
    )
    if not rows:
        return None
    return _row_to_path(rows[0])


def get_path_by_genre_slug(user_id: str, genre_slug: str) -> dict[str, Any] | None:
    rows = _request(
        "GET",
        TABLE,
        params={
            "user_id": f"eq.{user_id}",
            "genre_slug": f"eq.{genre_slug}",
            "select": PATH_LIST_COLUMNS,
            "limit": "1",
        },
    )
    if not rows:
        return None
    return _row_to_path(rows[0])


def upsert_path(
    user_id: str,
    path: dict[str, Any],
    *,
    genre_slug: str | None = None,
    genre_label: str | None = None,
) -> dict[str, Any]:
    path_id = path.get("id")
    valid_uuid = False
    if path_id:
        try:
            uuid.UUID(str(path_id))
            valid_uuid = True
        except ValueError:
            path_id = None
            valid_uuid = False

    if genre_slug:
        existing = get_path_by_genre_slug(user_id, genre_slug)
        if existing:
            path_id = existing["id"]
            valid_uuid = True

    path_name = (path.get("path_name") or genre_label or "Reading Path").strip()
    path_data = {
        key: value
        for key, value in path.items()
        if key not in {"id", "genre_slug", "genre"}
    }
    path_data.setdefault("path_name", path_name)
    if genre_label:
        path_data.setdefault("genre", genre_label)

    now = _utcnow_iso()
    payload: dict[str, Any] = {
        "user_id": user_id,
        "path_name": path_name,
        "path_data": path_data,
        "updated_at": now,
    }
    if genre_slug:
        payload["genre_slug"] = genre_slug
    if genre_label:
        payload["genre_label"] = genre_label

    if valid_uuid and path_id:
        rows = _request(
            "PATCH",
            TABLE,
            params={"id": f"eq.{path_id}", "user_id": f"eq.{user_id}"},
            json=payload,
            prefer="return=representation",
        )
        if rows:
            return _row_to_path(rows[0])

    payload.setdefault("created_at", now)
    rows = _request("POST", TABLE, json=payload, prefer="return=representation")
    if isinstance(rows, list) and rows:
        return _row_to_path(rows[0])
    raise ReadingPathsStoreError("Could not save reading path.", status_code=500)


def sync_user_paths(user_id: str, paths: list[dict[str, Any]]) -> list[dict[str, Any]]:
    saved: list[dict[str, Any]] = []
    for path in paths:
        if not isinstance(path, dict):
            continue
        genre_slug = path.get("genre_slug")
        genre_label = path.get("genre") or path.get("genre_label")
        saved.append(
            upsert_path(
                user_id,
                path,
                genre_slug=genre_slug,
                genre_label=genre_label,
            )
        )
    return saved
