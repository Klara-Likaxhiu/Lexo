"""Library API — user books stored in Supabase."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.deps import get_verified_user
from app.library_store import (
    LibraryStoreError,
    delete_book,
    group_by_status,
    list_user_books,
    upsert_book,
    update_book,
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
    total_pages: int | None = Field(default=None, ge=0)


class LibraryUpdateRequest(BaseModel):
    status: str | None = None
    progress: int | None = Field(default=None, ge=0, le=100)
    favorite: bool | None = None
    current_page: int | None = Field(default=None, ge=0)
    total_pages: int | None = Field(default=None, gt=0)


class ReadingProgressRequest(BaseModel):
    current_page: int = Field(..., ge=0)
    total_pages: int = Field(..., gt=0)


def _raise_store_error(exc: LibraryStoreError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


def _request_to_book(data: LibraryBookRequest) -> dict[str, Any]:
    book: dict[str, Any] = {
        "title": data.title.strip(),
        "author": (data.author or "Unknown Author").strip(),
        "genre": data.genre or "Book",
        "cover_url": data.cover_url,
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

    return {
        "library": group_by_status(books),
        "books": books,
        "stats": {
            status: len(group_by_status(books).get(status, []))
            for status in VALID_STATUSES
        },
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
