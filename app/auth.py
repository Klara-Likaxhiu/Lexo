"""Auth helpers — validation and public user shaping. Passwords live in Supabase Auth."""

from __future__ import annotations

import os
import re


USERNAME_RE = re.compile(r"^[^\s]{3,30}$")
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def validate_username(username: str) -> str | None:
    username = username.strip()
    if not USERNAME_RE.match(username):
        return "Username must be 3–30 characters (letters, numbers, and symbols allowed; no spaces)."
    return None


def validate_email(email: str) -> str | None:
    email = email.strip()
    if not EMAIL_RE.match(email):
        return "Please enter a valid email address (e.g. name+tag@example.com)."
    return None


def validate_password(password: str) -> str | None:
    if len(password) < 8:
        return "Password must be at least 8 characters."
    if len(password) > 128:
        return "Password is too long."
    return None


def email_verification_required() -> bool:
    from app.supabase_client import email_verification_enabled, supabase_configured

    if supabase_configured():
        return email_verification_enabled()
    return os.getenv("EMAIL_VERIFICATION_REQUIRED", "false").lower() == "true"


def email_features_enabled() -> bool:
    from app.supabase_client import supabase_configured

    if supabase_configured():
        return True
    from app import email_service

    return email_service.smtp_configured()
