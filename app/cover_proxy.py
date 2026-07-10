"""Hosted cover proxy: resolve external sources, download, upload to Supabase Storage."""

from __future__ import annotations

import logging
from typing import Any

from app.cover_service import (
    _from_google,
    _from_google_isbn,
    _from_isbn,
    _from_open_library,
    make_book_id,
)
from app.cover_storage import (
    host_cover_from_url,
    host_placeholder,
    is_hosted_cover_url,
)
from app.cover_store import format_source, get_cover_row, upsert_hosted_cover
from app.supabase_rest import SupabaseRestError

logger = logging.getLogger(__name__)


def find_external_cover_url(
    *,
    title: str,
    author: str | None,
    isbn: str | None = None,
    google_id: str | None = None,
    open_library_key: str | None = None,
) -> tuple[str | None, str | None]:
    """Return (external_url, source) with Google Books before Open Library."""
    google_url, _ = _from_google_isbn(isbn)
    if google_url:
        return google_url, "google_books_isbn"

    google_url, _ = _from_google(title, author, google_id)
    if google_url:
        return google_url, "google_books"

    ol_isbn_url = _from_isbn(isbn)
    if ol_isbn_url:
        return ol_isbn_url, "open_library_isbn"

    ol_url, _ = _from_open_library(title, author, open_library_key)
    if ol_url:
        return ol_url, "open_library"

    return None, None


def _ready_response(
    *,
    book_id: str,
    title: str,
    author: str | None,
    cover_url: str,
    cover_source: str,
    cover_status: str,
    cached: bool,
    external_source_url: str | None = None,
) -> dict[str, Any]:
    return {
        "book_id": book_id,
        "bookId": book_id,
        "cache_key": book_id,
        "title": title,
        "author": author,
        "cover_url": cover_url,
        "cover_source": cover_source,
        "cover_status": cover_status,
        "source": format_source(cover_source),
        "cached": cached,
        "external_source_url": external_source_url,
        "hosted": True,
    }


def resolve_hosted_cover(
    *,
    title: str,
    author: str | None = None,
    isbn: str | None = None,
    book_id: str | None = None,
    google_id: str | None = None,
    open_library_key: str | None = None,
    force: bool = False,
) -> dict[str, Any]:
    """Resolve, download, and host a cover image. Returns a Supabase Storage public URL."""
    title = (title or "").strip()
    if not title:
        return {
            "cover_url": None,
            "cover_status": "missing",
            "cover_source": None,
            "cached": False,
            "book_id": "",
            "hosted": False,
        }

    author = (author or "").strip() or None
    bid = (book_id or "").strip() or make_book_id(title, author, isbn)
    row = get_cover_row(book_id=bid, isbn=isbn, title=title, author=author)

    if not force and row:
        existing_url = row.get("cover_url")
        status = (row.get("cover_status") or "missing").lower()
        if existing_url and is_hosted_cover_url(existing_url) and status == "ready":
            return _ready_response(
                book_id=bid,
                title=title,
                author=author,
                cover_url=existing_url,
                cover_source=row.get("source") or "cache",
                cover_status="ready",
                cached=True,
                external_source_url=row.get("external_source_url"),
            )

    upsert_hosted_cover(
        book_id=bid,
        title=title,
        author=author,
        isbn=isbn,
        cover_url=(row or {}).get("cover_url"),
        source=(row or {}).get("source") or "resolving",
        cover_status="resolving",
        external_source_url=(row or {}).get("external_source_url"),
    )

    external_url, external_source = find_external_cover_url(
        title=title,
        author=author,
        isbn=isbn,
        google_id=google_id,
        open_library_key=open_library_key,
    )

    if external_url:
        try:
            hosted = host_cover_from_url(bid, external_url)
            upsert_hosted_cover(
                book_id=bid,
                title=title,
                author=author,
                isbn=isbn,
                cover_url=hosted["cover_url"],
                source=external_source or "google_books",
                cover_status="ready",
                external_source_url=external_url,
            )
            logger.info(
                "[CoverProxy] hosted %r from %s -> %s",
                title,
                external_source,
                hosted["cover_url"],
            )
            return _ready_response(
                book_id=bid,
                title=title,
                author=author,
                cover_url=hosted["cover_url"],
                cover_source=external_source or "google_books",
                cover_status="ready",
                cached=False,
                external_source_url=external_url,
            )
        except SupabaseRestError as exc:
            logger.warning("[CoverProxy] external host failed for %r: %s", title, exc.message)

    try:
        placeholder = host_placeholder(bid, title, author)
        upsert_hosted_cover(
            book_id=bid,
            title=title,
            author=author,
            isbn=isbn,
            cover_url=placeholder["cover_url"],
            source="placeholder",
            cover_status="ready",
            external_source_url=external_url,
        )
        return _ready_response(
            book_id=bid,
            title=title,
            author=author,
            cover_url=placeholder["cover_url"],
            cover_source="placeholder",
            cover_status="ready",
            cached=False,
            external_source_url=external_url,
        )
    except SupabaseRestError as exc:
        logger.error("[CoverProxy] placeholder failed for %r: %s", title, exc.message)
        upsert_hosted_cover(
            book_id=bid,
            title=title,
            author=author,
            isbn=isbn,
            cover_url=None,
            source="failed",
            cover_status="failed",
            external_source_url=external_url,
        )
        return {
            "book_id": bid,
            "bookId": bid,
            "cache_key": bid,
            "title": title,
            "author": author,
            "cover_url": None,
            "cover_source": "failed",
            "cover_status": "failed",
            "source": format_source("failed"),
            "cached": False,
            "hosted": False,
            "external_source_url": external_url,
        }


def resolve_hosted_covers_batch(books: list[dict]) -> list[dict]:
    if not books:
        return []

    if len(books) == 1:
        book = books[0]
        return [
            resolve_hosted_cover(
                title=book.get("title") or "",
                author=book.get("author"),
                isbn=book.get("isbn"),
                book_id=book.get("book_id") or book.get("bookId"),
                google_id=book.get("google_id") or book.get("id"),
                open_library_key=book.get("open_library_key"),
                force=bool(book.get("force")),
            )
        ]

    from concurrent.futures import ThreadPoolExecutor, as_completed

    results: list[dict | None] = [None] * len(books)

    def _resolve_one(index: int, book: dict) -> tuple[int, dict]:
        return index, resolve_hosted_cover(
            title=book.get("title") or "",
            author=book.get("author"),
            isbn=book.get("isbn"),
            book_id=book.get("book_id") or book.get("bookId"),
            google_id=book.get("google_id") or book.get("id"),
            open_library_key=book.get("open_library_key"),
            force=bool(book.get("force")),
        )

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(_resolve_one, i, book) for i, book in enumerate(books)]
        for future in as_completed(futures):
            index, result = future.result()
            results[index] = result

    return [r for r in results if r is not None]
