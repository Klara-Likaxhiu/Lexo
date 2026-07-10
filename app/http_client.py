"""Shared HTTP client for Supabase REST and storage requests."""

from __future__ import annotations

import httpx

_CLIENT: httpx.Client | None = None


def get_http_client() -> httpx.Client:
    global _CLIENT
    if _CLIENT is None or _CLIENT.is_closed:
        _CLIENT = httpx.Client(
            timeout=20.0,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
    return _CLIENT
