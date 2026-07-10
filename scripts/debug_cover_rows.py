#!/usr/bin/env python3
"""Inspect library/cover rows and test resolver for specific books."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

EXAMPLES = [
    ("Madame Bovary", "Gustave Flaubert"),
    ("A Gentleman in Moscow", "Amor Towles"),
]


def _print_row(label: str, payload: dict) -> None:
    print(f"\n--- {label} ---")
    print(json.dumps(payload, indent=2))


def main() -> None:
    from app.book_routes import search_open_library_by_title_author
    from app.cover_proxy import find_external_cover_url, resolve_hosted_cover
    from app.cover_service import make_book_id
    from app.cover_store import _select_fields, get_cover_row, get_cover_rows_batch
    from app.cover_storage import is_hosted_cover_url
    from app.supabase_rest import request as supabase_request

    print("=== Schema ===")
    print("cover select fields:", _select_fields())

    print("\n=== book_covers (public read) ===")
    for title, author in EXAMPLES:
        rows = supabase_request(
            "GET",
            "book_covers",
            params={
                "title": f"eq.{title}",
                "select": _select_fields(),
                "limit": "5",
            },
        )
        _print_row(f"book_covers {title}", {"count": len(rows or []), "rows": rows or []})

    print("\n=== user_library (service role) ===")
    for title, author in EXAMPLES:
        try:
            rows = supabase_request(
                "GET",
                "user_library",
                params={
                    "title": f"ilike.*{title}*",
                    "select": "id,book_id,title,author,cover_url,status,date_added,updated_at,metadata",
                    "limit": "5",
                },
            )
        except Exception as exc:
            rows = {"error": str(exc)}

        if isinstance(rows, list):
            for row in rows:
                meta = row.get("metadata") or {}
                _print_row(
                    f"user_library {row.get('title')}",
                    {
                        "table": "user_library",
                        "id": row.get("id"),
                        "book_id": row.get("book_id"),
                        "title": row.get("title"),
                        "author": row.get("author"),
                        "isbn": meta.get("isbn"),
                        "cover_url": row.get("cover_url"),
                        "hosted": is_hosted_cover_url(row.get("cover_url")),
                        "external_id": row.get("book_id"),
                        "created_at": row.get("date_added"),
                    },
                )
        else:
            _print_row(f"user_library {title}", rows)

    print("\n=== cache lookup keys ===")
    for title, author in EXAMPLES:
        bid = make_book_id(title, author, None)
        batch = get_cover_rows_batch([bid, f"isbn:0517385880", f"isbn:9780099558781"])
        row = get_cover_row(book_id=bid, title=title, author=author)
        _print_row(
            f"cache {title}",
            {
                "book_id": bid,
                "batch_hits": list(batch.keys()),
                "get_cover_row": row,
            },
        )

    print("\n=== find_external_cover_url ===")
    for title, author in EXAMPLES:
        url, source = find_external_cover_url(title=title, author=author)
        _print_row(title, {"external_url": url, "source": source})

    print("\n=== search_open_library_by_title_author ===")
    for title, author in EXAMPLES:
        url, book = search_open_library_by_title_author(title, author)
        _print_row(title, {"cover_url": url, "selected": book})

    print("\n=== resolve_hosted_cover (force) ===")
    for title, author in EXAMPLES:
        result = resolve_hosted_cover(title=title, author=author, force=True)
        _print_row(
            title,
            {
                "cover_url": result.get("cover_url"),
                "hosted": is_hosted_cover_url(result.get("cover_url")),
                "cover_status": result.get("cover_status"),
                "cover_source": result.get("cover_source"),
            },
        )


if __name__ == "__main__":
    main()
