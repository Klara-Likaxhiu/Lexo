"""User data API — settings, reader profile, reading goals."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.deps import get_verified_user
from app.supabase_rest import SupabaseRestError
from app.user_store import (
    get_reader_profile,
    get_reading_goals,
    get_settings,
    upsert_reader_profile,
    upsert_reading_goals,
    upsert_settings,
)

router = APIRouter(prefix="/api/user", tags=["User"])


class SettingsPayload(BaseModel):
    settings: dict[str, Any] = Field(default_factory=dict)


class ReaderProfilePayload(BaseModel):
    quiz_answers: str = ""
    books_read: str = ""
    reading_level: str = ""
    profile_data: dict[str, Any] = Field(default_factory=dict)


class ReadingGoalsPayload(BaseModel):
    goals: dict[str, Any] | None = None
    stats: dict[str, Any] | None = None


def _handle_store_error(exc: SupabaseRestError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get("/settings")
def read_settings(user: dict = Depends(get_verified_user)) -> dict:
    try:
        return {"settings": get_settings(user["id"])}
    except SupabaseRestError as exc:
        _handle_store_error(exc)


@router.put("/settings")
def save_settings(data: SettingsPayload, user: dict = Depends(get_verified_user)) -> dict:
    try:
        saved = upsert_settings(user["id"], data.settings)
        return {"settings": saved}
    except SupabaseRestError as exc:
        _handle_store_error(exc)


@router.get("/reader-profile")
def read_reader_profile(user: dict = Depends(get_verified_user)) -> dict:
    try:
        profile = get_reader_profile(user["id"])
        return {"profile": profile}
    except SupabaseRestError as exc:
        _handle_store_error(exc)


@router.put("/reader-profile")
def save_reader_profile(data: ReaderProfilePayload, user: dict = Depends(get_verified_user)) -> dict:
    try:
        saved = upsert_reader_profile(user["id"], data.model_dump())
        return {"profile": saved}
    except SupabaseRestError as exc:
        _handle_store_error(exc)


@router.get("/reading-goals")
def read_reading_goals(user: dict = Depends(get_verified_user)) -> dict:
    try:
        return get_reading_goals(user["id"])
    except SupabaseRestError as exc:
        _handle_store_error(exc)


@router.put("/reading-goals")
def save_reading_goals(data: ReadingGoalsPayload, user: dict = Depends(get_verified_user)) -> dict:
    try:
        return upsert_reading_goals(user["id"], goals=data.goals, stats=data.stats)
    except SupabaseRestError as exc:
        _handle_store_error(exc)
