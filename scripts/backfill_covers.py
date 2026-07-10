#!/usr/bin/env python3
"""Backfill hosted cover URLs for all users' library rows (service role required)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")


def main() -> None:
    from app.cover_backfill import backfill_user_library_covers
    from app.supabase_rest import request as supabase_request

    users = supabase_request(
        "GET",
        "user_library",
        params={"select": "user_id", "limit": "500"},
    )
    if not isinstance(users, list):
        print("No library rows found.")
        return

    user_ids = list(dict.fromkeys(row.get("user_id") for row in users if row.get("user_id")))
    print(f"Backfilling covers for {len(user_ids)} users...")

    total_repaired = 0
    for user_id in user_ids:
        result = backfill_user_library_covers(user_id, limit=200, force=True)
        total_repaired += result.get("repaired", 0)
        if result.get("books"):
            print(json.dumps(result, indent=2))

    print(f"Done. Total repaired: {total_repaired}")


if __name__ == "__main__":
    main()
