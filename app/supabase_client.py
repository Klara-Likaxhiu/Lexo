"""Supabase Auth client — passwords, sessions, email, and password reset live in Supabase."""

from __future__ import annotations

import os
from typing import Any

import httpx

from app import auth as auth_utils


class SupabaseAuthError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _env(name: str, *fallback_names: str) -> str:
    for key in (name, *fallback_names):
        value = os.getenv(key, "").strip()
        if value:
            return value
    return ""


def supabase_url() -> str:
    return _env("SUPABASE_URL").rstrip("/")


def supabase_anon_key() -> str:
    return _env("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY")


def supabase_service_role_key() -> str:
    return _env("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY")


def supabase_configured() -> bool:
    return bool(supabase_url() and supabase_anon_key())


def require_supabase() -> None:
    if not supabase_url():
        raise SupabaseAuthError("SUPABASE_URL missing", status_code=503)
    if not supabase_anon_key():
        raise SupabaseAuthError("SUPABASE_ANON_KEY missing", status_code=503)


def ping_auth() -> None:
    """Verify Supabase Auth API is reachable."""
    require_supabase()
    _request("GET", "/settings")


def _auth_url(path: str) -> str:
    return f"{supabase_url()}/auth/v1{path}"


def _headers(api_key: str | None = None, access_token: str | None = None) -> dict[str, str]:
    key = access_token or api_key or supabase_anon_key()
    return {
        "apikey": supabase_anon_key(),
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def _parse_error(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return response.text or "Supabase request failed."

    if isinstance(payload, dict):
        for key in ("msg", "message", "error_description", "error"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value
    return "Supabase request failed."


def _request(
    method: str,
    path: str,
    *,
    json: dict | None = None,
    params: dict | None = None,
    access_token: str | None = None,
    api_key: str | None = None,
) -> dict[str, Any]:
    require_supabase()
    with httpx.Client(timeout=20.0) as client:
        response = client.request(
            method,
            _auth_url(path),
            headers=_headers(api_key=api_key, access_token=access_token),
            json=json,
            params=params,
        )

    if response.status_code >= 400:
        raise SupabaseAuthError(_parse_error(response), status_code=response.status_code)

    if not response.content:
        return {}
    return response.json()


def sign_up(
    email: str,
    password: str,
    *,
    username: str,
    email_redirect_to: str | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "email": email,
        "password": password,
        "data": {"username": username},
    }
    if email_redirect_to:
        body["options"] = {"email_redirect_to": email_redirect_to}
    return _request("POST", "/signup", json=body)


def sign_in_with_password(email: str, password: str) -> dict[str, Any]:
    return _request(
        "POST",
        "/token",
        params={"grant_type": "password"},
        json={"email": email, "password": password},
    )


def sign_in_with_id_token(provider: str, id_token: str) -> dict[str, Any]:
    return _request(
        "POST",
        "/token",
        params={"grant_type": "id_token"},
        json={"provider": provider, "id_token": id_token},
    )


def refresh_session(refresh_token: str) -> dict[str, Any]:
    return _request(
        "POST",
        "/token",
        params={"grant_type": "refresh_token"},
        json={"refresh_token": refresh_token},
    )


def sign_out(access_token: str) -> None:
    _request("POST", "/logout", access_token=access_token)


def get_user(access_token: str) -> dict[str, Any]:
    payload = _request("GET", "/user", access_token=access_token)
    return payload.get("user") or payload


def update_user(access_token: str, *, password: str | None = None, data: dict | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {}
    if password is not None:
        body["password"] = password
    if data is not None:
        body["data"] = data
    payload = _request("PUT", "/user", json=body, access_token=access_token)
    return payload.get("user") or payload


def verify_otp(token_hash: str, otp_type: str) -> dict[str, Any]:
    return _request(
        "POST",
        "/verify",
        json={"token_hash": token_hash, "type": otp_type},
    )


def resend_signup(email: str, email_redirect_to: str | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"email": email, "type": "signup"}
    if email_redirect_to:
        body["options"] = {"email_redirect_to": email_redirect_to}
    return _request("POST", "/resend", json=body)


def reset_password_for_email(email: str, redirect_to: str | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"email": email}
    if redirect_to:
        body["redirect_to"] = redirect_to
    return _request("POST", "/recover", json=body)


def admin_generate_link(
    email: str,
    *,
    link_type: str = "magiclink",
    password: str | None = None,
    redirect_to: str | None = None,
) -> dict[str, Any]:
    """Generate a Supabase verification/magic link (requires service role key)."""
    service_key = supabase_service_role_key()
    if not service_key:
        raise SupabaseAuthError(
            "SUPABASE_SERVICE_ROLE_KEY is required to generate verification links.",
            status_code=503,
        )

    body: dict[str, Any] = {"type": link_type, "email": email}
    if password:
        body["password"] = password
    if redirect_to:
        body["options"] = {"redirect_to": redirect_to}

    return _request("POST", "/admin/generate_link", json=body, api_key=service_key)


def admin_delete_user(user_id: str) -> None:
    service_key = supabase_service_role_key()
    if not service_key:
        raise SupabaseAuthError(
            "Account deletion requires SUPABASE_SERVICE_ROLE_KEY in .env.",
            status_code=503,
        )
    _request(
        "DELETE",
        f"/admin/users/{user_id}",
        api_key=service_key,
    )


def session_response(
    session: dict[str, Any],
    *,
    remember_me: bool,
    profile: dict | None = None,
) -> dict[str, Any]:
    user = session.get("user") or {}
    merged = merge_public_user(user, profile)
    return {
        "access_token": session.get("access_token"),
        "refresh_token": session.get("refresh_token"),
        "token_type": session.get("token_type", "bearer"),
        "expires_in": session.get("expires_in"),
        "remember_me": remember_me,
        "user": merged,
    }


def merge_public_user(supabase_user: dict[str, Any], profile: dict | None = None) -> dict[str, Any]:
    metadata = supabase_user.get("user_metadata") or {}
    app_metadata = supabase_user.get("app_metadata") or {}
    provider = (app_metadata.get("provider") or "email").replace("email", "local")

    username = (profile or {}).get("username") or metadata.get("username") or _username_from_email(
        supabase_user.get("email") or "reader"
    )
    email = supabase_user.get("email") or (profile or {}).get("email") or ""
    created_at = supabase_user.get("created_at") or (profile or {}).get("created_at")

    email_confirmed = supabase_user.get("email_confirmed_at") or supabase_user.get("confirmed_at")

    return {
        "id": supabase_user.get("id"),
        "username": username,
        "email": email,
        "created_at": created_at,
        "email_verified": bool(email_confirmed),
        "auth_provider": provider if provider != "email" else "local",
    }


def _username_from_email(email: str) -> str:
    import re

    local = email.split("@")[0]
    cleaned = re.sub(r"[^a-zA-Z0-9_]", "_", local)[:30]
    return cleaned or "reader"


def email_redirect(path: str = "verify-email.html") -> str:
    """Build absolute redirect URL for Supabase auth emails from APP_BASE_URL."""
    base = os.getenv("APP_BASE_URL", "").strip().rstrip("/")
    if not base:
        raise SupabaseAuthError(
            "APP_BASE_URL is not set. Configure it to your public app URL "
            "(e.g. https://bookmindai-0a6u.onrender.com).",
            status_code=503,
        )

    path = path.lstrip("/")
    if path in ("verify-email", "verify-email.html"):
        path = "verify-email.html"
    elif path in ("reset-password", "reset-password.html"):
        path = "reset-password.html"
    elif not path.endswith(".html") and not path.startswith("http"):
        path = f"{path}.html" if "." not in path.split("/")[-1] else path
    return f"{base}/{path}"


def verification_redirect_url() -> str:
    """Canonical Supabase emailRedirectTo target for signup verification."""
    return email_redirect("verify-email.html")


def get_user_by_id(user_id: str) -> dict[str, Any] | None:
    """Fetch an auth user by UUID (service role)."""
    service_key = supabase_service_role_key()
    if not service_key or not user_id:
        return None
    try:
        payload = _request("GET", f"/admin/users/{user_id}", api_key=service_key)
    except SupabaseAuthError:
        return None
    if isinstance(payload, dict) and payload.get("id"):
        return payload
    return None


def lookup_auth_user(email: str, profile: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """Resolve the Supabase auth user for an email (prefer profile id)."""
    if profile and profile.get("id"):
        user = get_user_by_id(profile["id"])
        if user:
            return user
    return get_user_by_email(email)


def get_user_by_email(email: str) -> dict[str, Any] | None:
    """Look up an auth user by email (service role)."""
    service_key = supabase_service_role_key()
    if not service_key:
        return None

    needle = email.strip().lower()
    page = 1
    try:
        while page <= 50:
            payload = _request(
                "GET",
                "/admin/users",
                params={"page": str(page), "per_page": "100"},
                api_key=service_key,
            )
            users = payload.get("users") if isinstance(payload, dict) else None
            if not isinstance(users, list) or not users:
                return None

            for user in users:
                if (user.get("email") or "").lower() == needle:
                    return user

            if len(users) < 100:
                return None
            page += 1
    except SupabaseAuthError:
        return None
    return None


def is_email_verified(user: dict[str, Any]) -> bool:
    return bool(user.get("email_confirmed_at") or user.get("confirmed_at"))


def email_verification_enabled() -> bool:
    if not supabase_configured():
        return auth_utils.email_verification_required()
    explicit = os.getenv("EMAIL_VERIFICATION_REQUIRED", "").strip().lower()
    if explicit in ("true", "false"):
        return explicit == "true"
    return True
