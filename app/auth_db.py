"""User profiles in Supabase Postgres (no passwords or sessions)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.supabase_rest import SupabaseRestError, request

TABLE = "profiles"
PROFILE_COLUMNS = "id,username,email,auth_provider,provider_subject,created_at"


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def init_db() -> None:
    """No-op — schema is managed in supabase/schema.sql."""


def _row_to_profile(row: dict) -> dict:
    return {
        "id": row["id"],
        "username": row["username"],
        "email": row["email"],
        "auth_provider": row.get("auth_provider") or "local",
        "provider_subject": row.get("provider_subject"),
        "created_at": row.get("created_at"),
    }


def upsert_profile(
    user_id: str,
    username: str,
    email: str,
    *,
    auth_provider: str = "local",
    provider_subject: str | None = None,
) -> dict:
    existing = get_profile_by_id(user_id)
    payload = {
        "id": user_id,
        "username": username.strip(),
        "email": email.strip().lower(),
        "auth_provider": auth_provider,
        "provider_subject": provider_subject,
    }
    if not existing:
        payload["created_at"] = _utcnow_iso()

    rows = request(
        "POST",
        TABLE,
        params={"on_conflict": "id"},
        json=payload,
        prefer="resolution=merge-duplicates,return=representation",
    )
    if isinstance(rows, list) and rows:
        return _row_to_profile(rows[0])
    return get_profile_by_id(user_id) or payload


def get_profile_by_id(user_id: str) -> dict | None:
    rows = request(
        "GET",
        TABLE,
        params={"id": f"eq.{user_id}", "select": PROFILE_COLUMNS, "limit": "1"},
    )
    if isinstance(rows, list) and rows:
        return _row_to_profile(rows[0])
    return None


def get_profile_by_username(username: str) -> dict | None:
    rows = request(
        "GET",
        TABLE,
        params={"username": f"ilike.{username.strip()}", "select": PROFILE_COLUMNS, "limit": "1"},
    )
    if isinstance(rows, list) and rows:
        return _row_to_profile(rows[0])
    return None


def get_profile_by_email(email: str) -> dict | None:
    rows = request(
        "GET",
        TABLE,
        params={"email": f"eq.{email.strip().lower()}", "select": PROFILE_COLUMNS, "limit": "1"},
    )
    if isinstance(rows, list) and rows:
        return _row_to_profile(rows[0])
    return None


def get_profile_by_provider(auth_provider: str, provider_subject: str) -> dict | None:
    rows = request(
        "GET",
        TABLE,
        params={
            "auth_provider": f"eq.{auth_provider}",
            "provider_subject": f"eq.{provider_subject}",
            "select": PROFILE_COLUMNS,
            "limit": "1",
        },
    )
    if isinstance(rows, list) and rows:
        return _row_to_profile(rows[0])
    return None


def unique_username(base: str) -> str:
    base = base.strip()[:30] or "reader"
    if not get_profile_by_username(base):
        return base
    for i in range(2, 1000):
        candidate = f"{base[:26]}_{i}"
        if not get_profile_by_username(candidate):
            return candidate
    return f"reader_{uuid.uuid4().hex[:6]}"


def delete_profile(user_id: str) -> None:
    try:
        request("DELETE", TABLE, params={"id": f"eq.{user_id}"})
    except SupabaseRestError:
        pass
