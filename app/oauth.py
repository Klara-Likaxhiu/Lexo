"""Verify Google and Apple identity tokens."""

from __future__ import annotations

import json
import os
import time
from typing import Any

import httpx
import jwt
from jwt import PyJWKClient

GOOGLE_TOKENINFO = "https://oauth2.googleapis.com/tokeninfo"
APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"
APPLE_ISSUER = "https://appleid.apple.com"


def verify_google_id_token(id_token: str) -> dict[str, Any]:
    client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    if not client_id:
        raise ValueError("Google Sign-In is not configured on this server.")

    response = httpx.get(GOOGLE_TOKENINFO, params={"id_token": id_token}, timeout=15.0)
    if response.status_code != 200:
        raise ValueError("Invalid Google token.")

    payload = response.json()
    aud = payload.get("aud") or payload.get("azp")
    if aud != client_id:
        raise ValueError("Google token audience mismatch.")

    if not payload.get("email_verified") in (True, "true"):
        raise ValueError("Google email is not verified.")

    return {
        "sub": payload["sub"],
        "email": payload.get("email", "").lower(),
        "name": payload.get("name") or payload.get("given_name") or "",
    }


def verify_apple_identity_token(id_token: str) -> dict[str, Any]:
    client_id = os.getenv("APPLE_CLIENT_ID", "").strip()
    if not client_id:
        raise ValueError("Apple Sign-In is not configured on this server.")

    jwks_client = PyJWKClient(APPLE_JWKS_URL)
    signing_key = jwks_client.get_signing_key_from_jwt(id_token)

    payload = jwt.decode(
        id_token,
        signing_key.key,
        algorithms=["RS256"],
        audience=client_id,
        issuer=APPLE_ISSUER,
        options={"require": ["exp", "iss", "aud", "sub"]},
    )

    if payload.get("exp", 0) < time.time():
        raise ValueError("Apple token expired.")

    return {
        "sub": payload["sub"],
        "email": (payload.get("email") or "").lower(),
    }
