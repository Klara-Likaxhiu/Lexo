"""User settings, reader profiles, and reading goals in Supabase."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.supabase_rest import request

SETTINGS_TABLE = "user_settings"
READER_TABLE = "reader_profiles"
GOALS_TABLE = "reading_goals"


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def get_settings(user_id: str) -> dict[str, Any]:
    rows = request(
        "GET",
        SETTINGS_TABLE,
        params={"user_id": f"eq.{user_id}", "select": "settings", "limit": "1"},
    )
    if isinstance(rows, list) and rows:
        return rows[0].get("settings") or {}
    return {}


def upsert_settings(user_id: str, settings: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "user_id": user_id,
        "settings": settings,
        "updated_at": _utcnow_iso(),
    }
    rows = request(
        "POST",
        SETTINGS_TABLE,
        params={"on_conflict": "user_id"},
        json=payload,
        prefer="resolution=merge-duplicates,return=representation",
    )
    if isinstance(rows, list) and rows:
        return rows[0].get("settings") or {}
    return settings


def get_reader_profile(user_id: str) -> dict[str, Any] | None:
    rows = request(
        "GET",
        READER_TABLE,
        params={"user_id": f"eq.{user_id}", "select": "*", "limit": "1"},
    )
    if isinstance(rows, list) and rows:
        row = rows[0]
        return {
            "quiz_answers": row.get("quiz_answers") or "",
            "books_read": row.get("books_read") or "",
            "reading_level": row.get("reading_level") or "",
            "profile_data": row.get("profile_data") or {},
            "updated_at": row.get("updated_at"),
        }
    return None


def upsert_reader_profile(user_id: str, profile: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "user_id": user_id,
        "quiz_answers": profile.get("quiz_answers", ""),
        "books_read": profile.get("books_read", ""),
        "reading_level": profile.get("reading_level", ""),
        "profile_data": profile.get("profile_data") or profile,
        "updated_at": _utcnow_iso(),
    }
    rows = request(
        "POST",
        READER_TABLE,
        params={"on_conflict": "user_id"},
        json=payload,
        prefer="resolution=merge-duplicates,return=representation",
    )
    if isinstance(rows, list) and rows:
        row = rows[0]
        return {
            "quiz_answers": row.get("quiz_answers") or "",
            "books_read": row.get("books_read") or "",
            "reading_level": row.get("reading_level") or "",
            "profile_data": row.get("profile_data") or {},
        }
    return profile


def get_reading_goals(user_id: str) -> dict[str, Any]:
    rows = request(
        "GET",
        GOALS_TABLE,
        params={"user_id": f"eq.{user_id}", "select": "goals,stats", "limit": "1"},
    )
    if isinstance(rows, list) and rows:
        return {
            "goals": rows[0].get("goals") or {},
            "stats": rows[0].get("stats") or {},
        }
    return {"goals": {}, "stats": {}}


def upsert_reading_goals(user_id: str, *, goals: dict | None = None, stats: dict | None = None) -> dict[str, Any]:
    existing = get_reading_goals(user_id)
    payload = {
        "user_id": user_id,
        "goals": goals if goals is not None else existing["goals"],
        "stats": stats if stats is not None else existing["stats"],
        "updated_at": _utcnow_iso(),
    }
    rows = request(
        "POST",
        GOALS_TABLE,
        params={"on_conflict": "user_id"},
        json=payload,
        prefer="resolution=merge-duplicates,return=representation",
    )
    if isinstance(rows, list) and rows:
        return {
            "goals": rows[0].get("goals") or {},
            "stats": rows[0].get("stats") or {},
        }
    return {"goals": payload["goals"], "stats": payload["stats"]}
