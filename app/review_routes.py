"""Community reviews.

Public reviews are stored in a small JSON file so they can be shared across
sessions and users. This is an interim persistence layer that is intentionally
isolated so it can later be swapped for Supabase without touching the frontend.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from threading import Lock

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/reviews", tags=["Reviews"])

DATA_DIR = Path(__file__).resolve().parent / "data"
STORE_PATH = DATA_DIR / "community_reviews.json"

_lock = Lock()


class CommunityReview(BaseModel):
    id: str
    user: str = "Anonymous Reader"
    book_title: str
    author: str = ""
    genre: str = ""
    cover_url: str | None = None
    rating: int = 0
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


def _load() -> list[dict]:
    if not STORE_PATH.exists():
        return []
    try:
        with STORE_PATH.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def _save(reviews: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with STORE_PATH.open("w", encoding="utf-8") as handle:
        json.dump(reviews, handle, ensure_ascii=False, indent=2)


@router.post("/publish")
def publish_review(review: CommunityReview) -> dict:
    if not review.id or not review.book_title.strip():
        raise HTTPException(status_code=400, detail="Review id and book title are required.")

    payload = review.model_dump()
    payload["updated"] = _timestamp()
    if not payload.get("created"):
        payload["created"] = payload["updated"]

    with _lock:
        reviews = [r for r in _load() if r.get("id") != review.id]
        reviews.append(payload)
        _save(reviews)

    return {"status": "published", "id": review.id}


@router.post("/unpublish")
def unpublish_review(data: UnpublishRequest) -> dict:
    if not data.id:
        raise HTTPException(status_code=400, detail="Review id is required.")

    with _lock:
        existing = _load()
        remaining = [r for r in existing if r.get("id") != data.id]
        _save(remaining)

    return {"status": "removed", "id": data.id, "removed": len(existing) - len(remaining)}


@router.get("/community")
def community_feed(book: str | None = None, limit: int = 50) -> dict:
    reviews = _load()

    if book:
        target = _normalize(book)
        reviews = [r for r in reviews if _normalize(r.get("book_title")) == target]

    reviews.sort(
        key=lambda r: r.get("updated") or r.get("created") or "",
        reverse=True,
    )

    ratings = [r.get("rating", 0) for r in reviews if r.get("rating")]
    average = round(sum(ratings) / len(ratings), 1) if ratings else 0

    return {
        "reviews": reviews[: max(1, limit)],
        "count": len(reviews),
        "average_rating": average,
        "rating_count": len(ratings),
    }
