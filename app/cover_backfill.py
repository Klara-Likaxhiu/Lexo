"""Backfill hosted cover URLs for existing user_library rows."""

from __future__ import annotations

import logging
from typing import Any

from app.cover_proxy import resolve_hosted_cover
from app.cover_service import _book_isbn, make_book_id
from app.cover_storage import is_hosted_cover_url
from app.library_store import list_user_books, update_book_cover

logger = logging.getLogger(__name__)


def _needs_cover_backfill(book: dict[str, Any]) -> bool:
    url = book.get("cover_url")
    if not url:
        return True
    return not is_hosted_cover_url(url)


def backfill_user_library_covers(
    user_id: str,
    *,
    limit: int = 100,
    force: bool = True,
) -> dict[str, Any]:
    """Resolve and persist hosted covers for library books missing a hosted cover_url."""
    books = list_user_books(user_id)
    targets = [book for book in books if _needs_cover_backfill(book)][:limit]

    repaired: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    for book in targets:
        title = book.get("title") or ""
        author = book.get("author")
        isbn = _book_isbn(book)
        library_id = book.get("library_id")

        before = {
            "table": "user_library",
            "id": library_id,
            "title": title,
            "author": author,
            "isbn": isbn,
            "cover_url": book.get("cover_url"),
            "external_id": book.get("book_id"),
        }

        result = resolve_hosted_cover(
            title=title,
            author=author,
            isbn=isbn,
            book_id=make_book_id(title, author, isbn),
            google_id=book.get("google_id"),
            open_library_key=book.get("open_library_key"),
            force=force,
        )

        hosted_url = result.get("cover_url")
        if not hosted_url or not is_hosted_cover_url(hosted_url):
            failures.append(
                {
                    **before,
                    "cover_status": result.get("cover_status"),
                    "cover_source": result.get("cover_source"),
                }
            )
            continue

        saved = update_book_cover(
            user_id,
            cover_url=hosted_url,
            library_id=library_id,
            title=title,
            author=author,
        )

        after = {
            **before,
            "cover_url": hosted_url,
            "cover_status": result.get("cover_status"),
            "cover_source": result.get("cover_source"),
            "saved": bool(saved),
        }
        repaired.append(after)
        logger.info(
            "[CoverBackfill] repaired title=%r before=%r after=%r",
            title,
            before.get("cover_url"),
            hosted_url,
        )

    return {
        "scanned": len(books),
        "targets": len(targets),
        "repaired": len(repaired),
        "failed": len(failures),
        "books": repaired,
        "failures": failures,
    }
