"""Library API — user books stored in Supabase."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.deps import get_verified_user
from app.cover_backfill import backfill_user_library_covers
from app.cover_service import enrich_books_in_list, normalize_cover_url
from app.library_store import (
    LibraryStoreError,
    delete_book,
    extract_cover_url_from_book,
    group_by_status,
    list_user_books,
    upsert_book,
    update_book,
    update_book_cover,
    update_reading_progress,
    touch_last_opened,
    VALID_STATUSES,
)

router = APIRouter(prefix="/api/library", tags=["Library"])


class LibraryBookRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    author: str | None = "Unknown Author"
    genre: str | None = "Book"
    cover_url: str | None = None
    description: str | None = None
    book_id: str | None = None
    id: str | None = None
    status: str = Field(..., description="want | reading | read | not_interested")
    progress: int = Field(default=0, ge=0, le=100)
    favorite: bool = False
    source: str | None = None
    total_pages: int | None = Field(default=None, gt=0)


class LibraryUpdateRequest(BaseModel):
    status: str | None = None
    progress: int | None = Field(default=None, ge=0, le=100)
    favorite: bool | None = None
    current_page: int | None = Field(default=None, ge=0)
    total_pages: int | None = Field(default=None, gt=0)


class ReadingProgressRequest(BaseModel):
    current_page: int = Field(..., ge=0)
    total_pages: int = Field(..., gt=0)


class LibraryCoverRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    author: str | None = None
    cover_url: str = Field(..., min_length=8, max_length=2000)
    library_id: str | None = None
    isbn: str | None = None


class LibraryBackfillRequest(BaseModel):
    limit: int = Field(default=100, ge=1, le=200)
    force: bool = True


def _raise_store_error(exc: LibraryStoreError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


def _request_to_book(data: LibraryBookRequest) -> dict[str, Any]:
    raw = data.model_dump()
    book: dict[str, Any] = {
        "title": data.title.strip(),
        "author": (data.author or "Unknown Author").strip(),
        "genre": data.genre or "Book",
        "cover_url": extract_cover_url_from_book(raw) or data.cover_url,
        "description": data.description,
        "progress": data.progress,
        "favorite": data.favorite,
    }
    if data.book_id:
        book["book_id"] = data.book_id
    elif data.id:
        book["id"] = data.id
    if data.source:
        book["source"] = data.source
    if data.total_pages is not None:
        book["total_pages"] = data.total_pages
    return book


@router.get("")
def get_library(user: dict = Depends(get_verified_user)) -> dict:
    try:
        books = list_user_books(user["id"])
    except LibraryStoreError as exc:
        _raise_store_error(exc)

    books = enrich_books_in_list(books, cache_only=True)

    grouped = group_by_status(books)
    return {
        "library": grouped,
        "books": books,
        "stats": {status: len(grouped.get(status, [])) for status in VALID_STATUSES},
    }


@router.post("/cover")
def save_resolved_cover(data: LibraryCoverRequest, user: dict = Depends(get_verified_user)) -> dict:
    """Save a Google Books (or other) cover URL back to the user's library book."""
    normalized = normalize_cover_url(data.cover_url)
    if not normalized:
        raise HTTPException(status_code=400, detail="Invalid cover_url.")

    try:
        saved = update_book_cover(
            user["id"],
            cover_url=normalized,
            library_id=data.library_id,
            title=data.title,
            author=data.author,
        )
    except LibraryStoreError as exc:
        _raise_store_error(exc)

    if not saved:
        return {"book": None, "message": "Cover cached; no matching library book to update."}

    return {"book": saved, "message": "Cover saved to library."}


@router.post("/backfill-covers")
def backfill_library_covers(
    data: LibraryBackfillRequest,
    user: dict = Depends(get_verified_user),
) -> dict:
    """Resolve and persist hosted covers for existing library books missing cover_url."""
    result = backfill_user_library_covers(
        user["id"],
        limit=data.limit,
        force=data.force,
    )
    return {
        **result,
        "message": f"Repaired {result['repaired']} of {result['targets']} books needing covers.",
    }


@router.post("")
def save_book(data: LibraryBookRequest, user: dict = Depends(get_verified_user)) -> dict:
    if data.status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid shelf status.")

    book_input = _request_to_book(data)
    try:
        saved = upsert_book(user["id"], book_input, data.status)
    except LibraryStoreError as exc:
        _raise_store_error(exc)

    created = saved.pop("_created", False)
    return {
        "book": saved,
        "created": created,
        "message": f"Book {'added to' if created else 'updated on'} {data.status} shelf.",
    }


@router.patch("/{library_id}")
def patch_book(
    library_id: str,
    data: LibraryUpdateRequest,
    user: dict = Depends(get_verified_user),
) -> dict:
    if data.current_page is not None and data.total_pages is not None:
        try:
            saved = update_reading_progress(
                user["id"],
                library_id=library_id,
                current_page=data.current_page,
                total_pages=data.total_pages,
            )
        except LibraryStoreError as exc:
            _raise_store_error(exc)
        finished = saved.pop("_finished", False)
        return {
            "book": saved,
            "message": "Progress saved — marked as Finished!" if finished else "Reading progress saved.",
        }

    try:
        saved = update_book(
            user["id"],
            library_id=library_id,
            status=data.status,
            progress=data.progress,
            favorite=data.favorite,
        )
    except LibraryStoreError as exc:
        _raise_store_error(exc)

    return {"book": saved, "message": "Book updated."}


@router.put("/{library_id}/progress")
def save_reading_progress(
    library_id: str,
    data: ReadingProgressRequest,
    user: dict = Depends(get_verified_user),
) -> dict:
    if data.current_page > data.total_pages:
        raise HTTPException(
            status_code=400,
            detail="Current page cannot be greater than total pages.",
        )

    try:
        saved = update_reading_progress(
            user["id"],
            library_id=library_id,
            current_page=data.current_page,
            total_pages=data.total_pages,
        )
    except LibraryStoreError as exc:
        _raise_store_error(exc)

    finished = saved.pop("_finished", False)
    return {
        "book": saved,
        "finished": finished,
        "message": "Progress saved — marked as Finished!" if finished else "Reading progress saved.",
    }


@router.post("/{library_id}/open")
def record_book_opened(library_id: str, user: dict = Depends(get_verified_user)) -> dict:
    try:
        saved = touch_last_opened(user["id"], library_id=library_id)
    except LibraryStoreError as exc:
        _raise_store_error(exc)
    return {"book": saved, "message": "Last opened updated."}


@router.delete("/{library_id}")
def remove_book(library_id: str, user: dict = Depends(get_verified_user)) -> dict:
    try:
        delete_book(user["id"], library_id=library_id)
    except LibraryStoreError as exc:
        _raise_store_error(exc)
    return {"message": "Book removed from your library."}
