"""Shared FastAPI dependencies."""

from __future__ import annotations

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app import auth_db
from app.supabase_client import SupabaseAuthError, get_user, merge_public_user

bearer = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> dict:
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated.")

    try:
        supabase_user = get_user(credentials.credentials)
    except SupabaseAuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    profile = auth_db.get_profile_by_id(supabase_user["id"])
    public = merge_public_user(supabase_user, profile)
    return {
        **public,
        "_access_token": credentials.credentials,
        "_supabase_user": supabase_user,
    }
