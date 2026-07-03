"""Local profile metadata keyed by Supabase user id (no passwords or sessions)."""

from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data"
DB_PATH = DATA_DIR / "bookmind.db"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def get_connection() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with get_connection() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS profiles (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL COLLATE NOCASE UNIQUE,
                email TEXT NOT NULL COLLATE NOCASE,
                auth_provider TEXT NOT NULL DEFAULT 'local',
                provider_subject TEXT,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
            CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);
            """
        )


def upsert_profile(
    user_id: str,
    username: str,
    email: str,
    *,
    auth_provider: str = "local",
    provider_subject: str | None = None,
) -> dict:
    created_at = _iso(_utcnow())
    with get_connection() as conn:
        existing = conn.execute("SELECT created_at FROM profiles WHERE id = ?", (user_id,)).fetchone()
        if existing:
            created_at = existing["created_at"]
        conn.execute(
            """
            INSERT INTO profiles (id, username, email, auth_provider, provider_subject, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                username = excluded.username,
                email = excluded.email,
                auth_provider = excluded.auth_provider,
                provider_subject = excluded.provider_subject
            """,
            (
                user_id,
                username.strip(),
                email.strip().lower(),
                auth_provider,
                provider_subject,
                created_at,
            ),
        )
    return get_profile_by_id(user_id)


def get_profile_by_id(user_id: str) -> dict | None:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM profiles WHERE id = ?", (user_id,)).fetchone()
    return dict(row) if row else None


def get_profile_by_username(username: str) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM profiles WHERE username = ? COLLATE NOCASE",
            (username.strip(),),
        ).fetchone()
    return dict(row) if row else None


def get_profile_by_email(email: str) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM profiles WHERE email = ? COLLATE NOCASE",
            (email.strip().lower(),),
        ).fetchone()
    return dict(row) if row else None


def get_profile_by_provider(auth_provider: str, provider_subject: str) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT * FROM profiles
            WHERE auth_provider = ? AND provider_subject = ?
            """,
            (auth_provider, provider_subject),
        ).fetchone()
    return dict(row) if row else None


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
    with get_connection() as conn:
        conn.execute("DELETE FROM profiles WHERE id = ?", (user_id,))


# Backward-compatible aliases used during migration
get_user_by_id = get_profile_by_id
get_user_by_username = get_profile_by_username
get_user_by_email = get_profile_by_email
get_user_by_provider = get_profile_by_provider
get_user_by_login = lambda login: (
    get_profile_by_email(login) if "@" in login.strip() else get_profile_by_username(login)
)
delete_user = delete_profile
