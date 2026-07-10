"""User settings, reader profiles, and reading goals in Supabase."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from app.supabase_rest import request

SETTINGS_TABLE = "user_settings"
READER_TABLE = "reader_profiles"
READER_PROFILE_COLUMNS = (
    "quiz_answers,books_read,reading_level,profile_data,updated_at"
)
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
        params={"user_id": f"eq.{user_id}", "select": READER_PROFILE_COLUMNS, "limit": "1"},
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


INTELLIGENCE_CACHE_TTL = timedelta(minutes=30)
RECOMMENDATIONS_CACHE_TTL = timedelta(days=7)


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


def get_intelligence_cache(user_id: str, cache_key: str) -> dict[str, Any] | None:
    settings = get_settings(user_id)
    entry = settings.get("intelligence_cache")
    if not isinstance(entry, dict) or entry.get("key") != cache_key:
        return None
    cached_at = _parse_timestamp(entry.get("cached_at"))
    if not cached_at or datetime.now(timezone.utc) - cached_at > INTELLIGENCE_CACHE_TTL:
        return None
    data = entry.get("data")
    return data if isinstance(data, dict) else None


def set_intelligence_cache(user_id: str, cache_key: str, data: dict[str, Any]) -> None:
    settings = get_settings(user_id)
    settings["intelligence_cache"] = {
        "key": cache_key,
        "cached_at": _utcnow_iso(),
        "data": data,
    }
    upsert_settings(user_id, settings)


def get_cached_quiz_recommendations(user_id: str, quiz_hash: str) -> dict[str, Any] | None:
    profile = get_reader_profile(user_id)
    if not profile:
        return None
    pdata = profile.get("profile_data") or {}
    if pdata.get("_quiz_hash") != quiz_hash:
        return None
    cached_at = _parse_timestamp(pdata.get("_recommendations_cached_at"))
    if not cached_at or datetime.now(timezone.utc) - cached_at > RECOMMENDATIONS_CACHE_TTL:
        return None
    recommendations = pdata.get("recommendations")
    if not isinstance(recommendations, list) or not recommendations:
        return None
    return {
        "reader_type": pdata.get("reader_type"),
        "favorite_genres": pdata.get("favorite_genres") or [],
        "confirmed_reading_level": pdata.get("confirmed_reading_level") or profile.get("reading_level"),
        "book_preferences": pdata.get("book_preferences") or [],
        "recommendations": recommendations,
        "cached": True,
    }


def save_quiz_recommendations_cache(
    user_id: str,
    *,
    quiz_hash: str,
    payload: dict[str, Any],
) -> None:
    existing = get_reader_profile(user_id) or {}
    profile_data = dict(existing.get("profile_data") or {})
    profile_data.update(
        {
            "reader_type": payload.get("reader_type"),
            "favorite_genres": payload.get("favorite_genres") or [],
            "confirmed_reading_level": payload.get("confirmed_reading_level"),
            "book_preferences": payload.get("book_preferences") or [],
            "recommendations": payload.get("recommendations") or [],
            "_quiz_hash": quiz_hash,
            "_recommendations_cached_at": _utcnow_iso(),
        }
    )
    upsert_reader_profile(
        user_id,
        {
            "quiz_answers": existing.get("quiz_answers") or payload.get("quiz_answers") or "",
            "books_read": existing.get("books_read") or payload.get("books_read") or "",
            "reading_level": existing.get("reading_level") or payload.get("confirmed_reading_level") or "",
            "profile_data": profile_data,
        },
    )
