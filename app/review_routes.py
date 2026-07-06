"""Community reviews stored in Supabase."""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.deps import get_verified_user
from app.supabase_rest import SupabaseRestError, request

router = APIRouter(prefix="/api/reviews", tags=["Reviews"])

TABLE = "community_reviews"


class CommunityReview(BaseModel):
    id: str
    user: str = "Reader"
    book_title: str
    author: str = ""
    genre: str = ""
    cover_url: str | None = None
    rating: int = Field(default=0, ge=0, le=5)
    review_title: str = ""
    review_text: str = ""
    recommend: str = ""
    created: str = ""


class UnpublishRequest(BaseModel):
    id: str


def _timestamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _normalize(title: str | None) -> str:
    return (title or "").strip().lower()


def _row_to_review(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "user": row.get("username") or "Reader",
        "book_title": row["book_title"],
        "author": row.get("author") or "",
        "genre": row.get("genre") or "",
        "cover_url": row.get("cover_url"),
        "rating": int(row.get("rating") or 0),
        "review_title": row.get("review_title") or "",
        "review_text": row.get("review_text") or "",
        "recommend": row.get("recommend") or "",
        "created": row.get("created_at") or row.get("updated_at") or "",
        "updated": row.get("updated_at") or "",
    }


def _handle_error(exc: SupabaseRestError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post("/publish")
def publish_review(review: CommunityReview, user: dict = Depends(get_verified_user)) -> dict:
    if not review.id or not review.book_title.strip():
        raise HTTPException(status_code=400, detail="Review id and book title are required.")

    now = _timestamp()
    payload = {
        "id": review.id,
        "user_id": user["id"],
        "username": review.user or user.get("username") or "Reader",
        "book_title": review.book_title.strip(),
        "author": review.author,
        "genre": review.genre,
        "cover_url": review.cover_url,
        "rating": review.rating,
        "review_title": review.review_title,
        "review_text": review.review_text,
        "recommend": review.recommend,
        "updated_at": now,
    }
    if review.created:
        payload["created_at"] = review.created
    else:
        payload["created_at"] = now

    try:
        request(
            "POST",
            TABLE,
            params={"on_conflict": "id"},
            json=payload,
            prefer="resolution=merge-duplicates,return=representation",
        )
    except SupabaseRestError as exc:
        _handle_error(exc)

    return {"status": "published", "id": review.id}


@router.post("/unpublish")
def unpublish_review(data: UnpublishRequest, user: dict = Depends(get_verified_user)) -> dict:
    if not data.id:
        raise HTTPException(status_code=400, detail="Review id is required.")

    try:
        request(
            "DELETE",
            TABLE,
            params={"id": f"eq.{data.id}", "user_id": f"eq.{user['id']}"},
        )
    except SupabaseRestError as exc:
        _handle_error(exc)

    return {"status": "removed", "id": data.id}


@router.get("/community")
def community_feed(book: str | None = None, limit: int = 50) -> dict:
    params: dict[str, str] = {
        "select": "*",
        "order": "updated_at.desc",
        "limit": str(max(1, min(limit, 100))),
    }
    if book:
        params["book_title"] = f"ilike.{book.strip()}"

    try:
        rows = request("GET", TABLE, params=params)
    except SupabaseRestError as exc:
        _handle_error(exc)

    reviews = [_row_to_review(row) for row in rows] if isinstance(rows, list) else []

    if book:
        target = _normalize(book)
        reviews = [r for r in reviews if _normalize(r.get("book_title")) == target]

    ratings = [r.get("rating", 0) for r in reviews if r.get("rating")]
    average = round(sum(ratings) / len(ratings), 1) if ratings else 0

    return {
        "reviews": reviews,
        "count": len(reviews),
        "average_rating": average,
        "rating_count": len(ratings),
    }
