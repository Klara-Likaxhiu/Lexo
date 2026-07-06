"""Shared Supabase PostgREST client (service role)."""

from __future__ import annotations

from typing import Any

import httpx

from app.supabase_client import supabase_anon_key, supabase_service_role_key, supabase_url


class SupabaseRestError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def require_service_role() -> str:
    key = supabase_service_role_key()
    if not key:
        raise SupabaseRestError(
            "SUPABASE_SERVICE_ROLE_KEY is required.",
            status_code=503,
        )
    return key


def rest_url(table: str) -> str:
    return f"{supabase_url().rstrip('/')}/rest/v1/{table.lstrip('/')}"


def headers(*, prefer: str | None = None) -> dict[str, str]:
    service = require_service_role()
    result = {
        "apikey": supabase_anon_key(),
        "Authorization": f"Bearer {service}",
        "Content-Type": "application/json",
    }
    if prefer:
        result["Prefer"] = prefer
    return result


def parse_error(response: httpx.Response) -> str:
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


def request(
    method: str,
    table: str,
    *,
    params: dict | None = None,
    json: dict | list | None = None,
    prefer: str | None = None,
) -> Any:
    if not supabase_url():
        raise SupabaseRestError("SUPABASE_URL is not configured.", status_code=503)

    with httpx.Client(timeout=20.0) as client:
        response = client.request(
            method,
            rest_url(table),
            headers=headers(prefer=prefer),
            params=params,
            json=json,
        )

    if response.status_code >= 400:
        raise SupabaseRestError(parse_error(response), status_code=response.status_code)

    if not response.content:
        return []
    return response.json()
