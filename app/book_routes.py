import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Literal

import httpx
from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field, HttpUrl

from app.cover_proxy import resolve_hosted_cover, resolve_hosted_covers_batch
from app.cover_service import make_book_id, normalize_cover_url
from app.cover_store import get_cover_row, upsert_manual_cover

router = APIRouter(prefix="/api/books", tags=["Books"])
logger = logging.getLogger(__name__)

SearchMode = Literal["all", "title", "author", "genre"]


class CoverResolveRequest(BaseModel):
    title: str = Field(min_length=1)
    author: str | None = None
    isbn: str | None = None
    book_id: str | None = Field(default=None, alias="bookId")
    google_id: str | None = None
    open_library_key: str | None = None
    force: bool = False

    model_config = {"populate_by_name": True}


class CoverBatchRequest(BaseModel):
    books: list[CoverResolveRequest] = Field(default_factory=list, max_length=24)


class ManualCoverRequest(BaseModel):
    title: str = Field(min_length=1)
    author: str | None = None
    isbn: str | None = None
    book_id: str | None = None
    manual_cover_url: HttpUrl


def _require_cover_admin(x_cover_admin_key: str | None) -> None:
    expected = os.getenv("BOOKMIND_COVER_ADMIN_KEY", "").strip()
    if not expected:
        raise HTTPException(
            status_code=503,
            detail="Manual cover admin key is not configured on the server.",
        )
    if not x_cover_admin_key or x_cover_admin_key.strip() != expected:
        raise HTTPException(status_code=403, detail="Invalid cover admin key.")


@router.post("/resolve-cover")
def resolve_cover_endpoint(data: CoverResolveRequest) -> dict:
    """Resolve, download, and host a cover image on Supabase Storage."""
    return resolve_hosted_cover(**data.model_dump(by_alias=False))


@router.post("/resolve-covers")
def resolve_covers_endpoint(data: CoverBatchRequest) -> dict:
    """Resolve and host covers for multiple books in one request."""
    try:
        books = resolve_hosted_covers_batch([book.model_dump(by_alias=False) for book in data.books])
    except Exception as exc:
        logger.warning("resolve-covers degraded: %s", exc)
        books = [
            {
                **book.model_dump(by_alias=False),
                "cover_url": None,
                "cover_source": "unavailable",
                "cover_status": "failed",
            }
            for book in data.books
        ]
    return {"results": books}


@router.get("/covers/record")
def get_cover_record(
    title: str = Query(..., min_length=1),
    author: str | None = Query(default=None),
    isbn: str | None = Query(default=None),
    x_cover_admin_key: str | None = Header(default=None, alias="X-Cover-Admin-Key"),
) -> dict:
    """Admin: inspect cached auto cover, manual override, and lookup failure state."""
    _require_cover_admin(x_cover_admin_key)
    book_id = make_book_id(title, author, isbn)
    row = get_cover_row(book_id=book_id, isbn=isbn, title=title, author=author)
    return {
        "book_id": book_id,
        "record": row,
        "resolved": resolve_hosted_cover(title=title, author=author, isbn=isbn),
    }


@router.put("/covers/manual")
def set_manual_cover(
    data: ManualCoverRequest,
    x_cover_admin_key: str | None = Header(default=None, alias="X-Cover-Admin-Key"),
) -> dict:
    """Admin: set a manual cover URL for books automatic lookup cannot find."""
    _require_cover_admin(x_cover_admin_key)

    manual_url = normalize_cover_url(str(data.manual_cover_url))
    if not manual_url:
        raise HTTPException(status_code=400, detail="manual_cover_url is required.")

    book_id = (data.book_id or "").strip() or make_book_id(data.title, data.author, data.isbn)
    row = upsert_manual_cover(
        book_id=book_id,
        title=data.title.strip(),
        author=(data.author or "").strip() or None,
        isbn=data.isbn,
        manual_cover_url=manual_url,
    )

    resolved = resolve_hosted_cover(
        title=data.title.strip(),
        author=data.author,
        isbn=data.isbn,
    )

    return {
        "book_id": book_id,
        "manual_cover_url": manual_url,
        "record": row,
        "resolved": resolved,
    }


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").strip()


def _description_preview(text: str | None, max_len: int = 160) -> str | None:
    if not text:
        return None
    clean = _strip_html(text)
    if len(clean) <= max_len:
        return clean
    trimmed = clean[: max_len - 1].rsplit(" ", 1)[0]
    return f"{trimmed}…"


def _normalize_book_key(title: str | None, author: str | None) -> str:
    t = re.sub(r"\s+", " ", (title or "").lower().strip())
    a = re.sub(r"\s+", " ", (author or "unknown").lower().strip())
    return f"{t}|{a}"


def _book_result_score(book: dict) -> int:
    score = 0
    if book.get("cover_url"):
        score += 4
    if book.get("source") == "google_books":
        score += 12
    if book.get("description"):
        score += 2
    if book.get("description_preview"):
        score += 1
    if book.get("total_pages"):
        score += 1
    if book.get("published_date") or book.get("first_publish_year"):
        score += 1
    if book.get("publisher"):
        score += 1
    if book.get("average_rating"):
        score += 2
    if book.get("categories"):
        score += 1
    return score


def dedupe_books(books: list[dict]) -> list[dict]:
    """Keep one result per title + author, preferring richer metadata and a cover."""
    seen: dict[str, dict] = {}
    order: list[str] = []

    for book in books:
        if not book.get("title"):
            continue
        key = _normalize_book_key(book.get("title"), book.get("author"))
        if key not in seen:
            seen[key] = book
            order.append(key)
            continue
        if _book_result_score(book) > _book_result_score(seen[key]):
            seen[key] = book

    return [seen[key] for key in order]


def _build_google_query(q: str, mode: SearchMode) -> str:
    query = q.strip()
    if mode == "title":
        return f"intitle:{query}"
    if mode == "author":
        return f"inauthor:{query}"
    if mode == "genre":
        return f"subject:{query}"
    return query


def _build_open_library_query(q: str, mode: SearchMode) -> str:
    query = q.strip()
    if mode == "title":
        return f"title:{query}"
    if mode == "author":
        return f"author:{query}"
    if mode == "genre":
        return f"subject:{query}"
    return query


def _parse_google_volume(item: dict) -> dict | None:
    info = item.get("volumeInfo", {})
    title = info.get("title")
    if not title:
        return None

    images = info.get("imageLinks", {})
    cover = (
        images.get("extraLarge")
        or images.get("large")
        or images.get("medium")
        or images.get("small")
        or images.get("thumbnail")
        or images.get("smallThumbnail")
    )
    if cover:
        cover = cover.replace("http://", "https://")
        cover = re.sub(r"zoom=\d+", "zoom=0", cover)
        cover = cover.replace("&edge=curl", "")
        cover = re.sub(r"w=\d+-h\d+", "w=800-h1200", cover)

    published = (info.get("publishedDate") or "").strip()
    year = int(published[:4]) if published[:4].isdigit() else None

    description = info.get("description")
    categories = info.get("categories") or []
    authors = info.get("authors") or ["Unknown"]

    return {
        "id": item.get("id"),
        "book_id": item.get("id"),
        "title": title,
        "author": authors[0],
        "authors": authors,
        "genre": categories[0] if categories else None,
        "categories": categories,
        "description": _strip_html(description) if description else None,
        "description_preview": _description_preview(description),
        "total_pages": info.get("pageCount"),
        "cover_url": cover,
        "published_date": published or None,
        "first_publish_year": year,
        "publisher": info.get("publisher"),
        "average_rating": info.get("averageRating"),
        "ratings_count": info.get("ratingsCount"),
        "isbn": _first_isbn(info.get("industryIdentifiers")),
        "source": "google_books",
    }


def _first_isbn(identifiers: list | None) -> str | None:
    if not identifiers:
        return None
    for preferred in ("ISBN_13", "ISBN_10"):
        for item in identifiers:
            if item.get("type") == preferred:
                return item.get("identifier")
    return identifiers[0].get("identifier")


def _parse_open_library_doc(item: dict) -> dict | None:
    title = item.get("title")
    if not title:
        return None

    cover_id = item.get("cover_i")
    subjects = item.get("subject") or []
    subtitle = item.get("subtitle")
    first_sentence = (item.get("first_sentence") or [None])[0]
    description = subtitle or first_sentence
    ol_key = item.get("key")

    rating = item.get("ratings_average")
    if rating is not None:
        try:
            rating = round(float(rating), 1)
        except (TypeError, ValueError):
            rating = None

    return {
        "id": ol_key,
        "book_id": ol_key,
        "title": title,
        "author": (item.get("author_name") or ["Unknown"])[0],
        "authors": item.get("author_name") or ["Unknown"],
        "genre": subjects[0] if subjects else None,
        "categories": subjects[:8] if subjects else [],
        "description": description,
        "description_preview": _description_preview(description),
        "first_publish_year": item.get("first_publish_year"),
        "published_date": str(item["first_publish_year"]) if item.get("first_publish_year") else None,
        "total_pages": item.get("number_of_pages_median"),
        "publisher": (item.get("publisher") or [None])[0],
        "isbn": (item.get("isbn") or [None])[0],
        "cover_url": (
            f"https://covers.openlibrary.org/b/id/{cover_id}-L.jpg" if cover_id else None
        ),
        "open_library_key": ol_key,
        "average_rating": rating,
        "ratings_count": item.get("ratings_count"),
        "source": "open_library",
    }


def _dual_book_search(q: str, fetch_limit: int, mode: SearchMode) -> tuple[list, list]:
    with ThreadPoolExecutor(max_workers=2) as pool:
        google_future = pool.submit(search_google_books, q, limit=fetch_limit, mode=mode)
        ol_future = pool.submit(search_open_library, q, limit=fetch_limit, mode=mode)
        return google_future.result(), ol_future.result()


@router.get("/search")
def search_books(
    q: str,
    limit: int = Query(default=12, ge=1, le=20),
    mode: SearchMode = Query(default="all"),
) -> dict:
    """Search books by title, author, or genre via Google Books and Open Library."""
    if not q.strip():
        raise HTTPException(status_code=400, detail="Search query is required.")

    fetch_limit = min(limit * 3, 36)
    google, open_lib = _dual_book_search(q, fetch_limit, mode)

    books = dedupe_books(google + open_lib)[:limit]
    return {"query": q, "mode": mode, "results": books}


@router.get("/google-search")
def google_search_books(
    q: str,
    limit: int = Query(default=6, ge=1, le=20),
    mode: SearchMode = Query(default="all"),
) -> dict:
    """Search for books to import (library import modal)."""
    if not q.strip():
        raise HTTPException(status_code=400, detail="Search query is required.")

    fetch_limit = min(limit * 2, 20)
    google, open_lib = _dual_book_search(q, fetch_limit, mode)
    results = dedupe_books(google + open_lib)[:limit]
    return {"query": q, "mode": mode, "results": results}


@router.get("/detail")
def book_detail(
    id: str = Query(..., min_length=1),
    source: str = Query(default="google_books"),
) -> dict:
    """Fetch full book metadata for the discovery detail modal."""
    if source == "open_library":
        book = fetch_open_library_detail(id)
    else:
        book = fetch_google_volume(id)

    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")
    return {"book": book}


def fetch_google_volume(volume_id: str) -> dict | None:
    url = f"https://www.googleapis.com/books/v1/volumes/{volume_id}"
    try:
        response = httpx.get(url, timeout=5.0)
    except httpx.HTTPError:
        return None
    if response.status_code != 200:
        return None
    data = response.json()
    return _parse_google_volume(data)


def fetch_open_library_detail(work_key: str) -> dict | None:
    key = work_key if work_key.startswith("/") else f"/works/{work_key}"
    if key.startswith("/works/"):
        url = f"https://openlibrary.org{key}.json"
    elif key.startswith("/books/"):
        url = f"https://openlibrary.org{key}.json"
    else:
        url = f"https://openlibrary.org/works/{work_key}.json"

    try:
        response = httpx.get(url, timeout=5.0)
    except httpx.HTTPError:
        return None
    if response.status_code != 200:
        return None

    data = response.json()
    title = data.get("title")
    if not title:
        return None

    description = data.get("description")
    if isinstance(description, dict):
        description = description.get("value")
    if not description:
        description = (data.get("first_sentence") or {}).get("value") if isinstance(
            data.get("first_sentence"), dict
        ) else data.get("first_sentence")

    subjects = data.get("subjects") or []
    covers = data.get("covers") or []
    cover_id = covers[0] if covers else None

    publish_date = data.get("publish_date") or data.get("created", {}).get("value", "")[:10]
    year = None
    if publish_date and str(publish_date)[:4].isdigit():
        year = int(str(publish_date)[:4])

    authors = []
    for link in data.get("authors") or []:
        author_key = link.get("author", {}).get("key") or link.get("key")
        if author_key:
            name = _fetch_open_library_author_name(author_key)
            if name:
                authors.append(name)
    if not authors:
        authors = ["Unknown"]

    return {
        "id": key,
        "book_id": key,
        "title": title,
        "author": authors[0],
        "authors": authors,
        "genre": subjects[0] if subjects else None,
        "categories": subjects[:12],
        "description": _strip_html(str(description)) if description else None,
        "description_preview": _description_preview(str(description) if description else None),
        "total_pages": data.get("number_of_pages"),
        "cover_url": (
            f"https://covers.openlibrary.org/b/id/{cover_id}-L.jpg" if cover_id else None
        ),
        "published_date": str(publish_date) if publish_date else None,
        "first_publish_year": year,
        "publisher": None,
        "open_library_key": key,
        "source": "open_library",
    }


def _fetch_open_library_author_name(author_key: str) -> str | None:
    if not author_key.startswith("/"):
        author_key = f"/authors/{author_key}"
    try:
        response = httpx.get(f"https://openlibrary.org{author_key}.json", timeout=5.0)
    except httpx.HTTPError:
        return None
    if response.status_code != 200:
        return None
    data = response.json()
    return data.get("name") or data.get("personal_name")


_GOOGLE_BOOKS_COOLDOWN_UNTIL = 0.0
_GOOGLE_BOOKS_COOLDOWN_SECONDS = 30 * 60
_LAST_GOOGLE_SEARCH_DEBUG: dict = {}


def get_last_google_search_debug() -> dict:
    return dict(_LAST_GOOGLE_SEARCH_DEBUG)


def google_books_available() -> bool:
    """False while Google Books API is in a rate-limit cooldown."""
    return time.time() >= _GOOGLE_BOOKS_COOLDOWN_UNTIL


def _mark_google_books_rate_limited() -> None:
    global _GOOGLE_BOOKS_COOLDOWN_UNTIL
    _GOOGLE_BOOKS_COOLDOWN_UNTIL = time.time() + _GOOGLE_BOOKS_COOLDOWN_SECONDS


def search_google_books(q: str, limit: int = 6, mode: SearchMode = "all") -> list[dict]:
    global _LAST_GOOGLE_SEARCH_DEBUG
    _LAST_GOOGLE_SEARCH_DEBUG = {
        "query": None,
        "requestUrl": None,
        "status": None,
        "ok": False,
        "itemCount": 0,
        "available": google_books_available(),
    }

    if not google_books_available():
        return []

    url = "https://www.googleapis.com/books/v1/volumes"
    params = {
        "q": _build_google_query(q, mode),
        "maxResults": min(limit, 40),
        "printType": "books",
        "orderBy": "relevance",
    }
    _LAST_GOOGLE_SEARCH_DEBUG["query"] = params["q"]

    try:
        response = httpx.get(url, params=params, timeout=5.0)
    except httpx.HTTPError as exc:
        _LAST_GOOGLE_SEARCH_DEBUG["status"] = "http_error"
        _LAST_GOOGLE_SEARCH_DEBUG["error"] = str(exc)
        return []

    _LAST_GOOGLE_SEARCH_DEBUG["requestUrl"] = str(response.request.url)
    _LAST_GOOGLE_SEARCH_DEBUG["status"] = response.status_code
    _LAST_GOOGLE_SEARCH_DEBUG["ok"] = response.status_code == 200

    if response.status_code == 429:
        _mark_google_books_rate_limited()
        return []

    if response.status_code != 200:
        return []

    payload = response.json()
    items = payload.get("items", [])
    _LAST_GOOGLE_SEARCH_DEBUG["itemCount"] = len(items)

    books = []
    for item in items:
        parsed = _parse_google_volume(item)
        if parsed:
            books.append(parsed)
    return books


def search_open_library_by_title_author(
    title: str,
    author: str | None,
) -> tuple[str | None, dict | None]:
    """Search Open Library by explicit title + author fields and return cover_i URL."""
    from urllib.parse import urlencode

    from app.cover_service import _combined_match_score, _pick_best_cover_candidate

    clean_title = (title or "").strip()
    if not clean_title:
        return None, None

    params = {
        "title": clean_title,
        "limit": "8",
        "fields": "key,title,subtitle,author_name,cover_i,isbn,first_publish_year",
    }
    clean_author = (author or "").strip()
    if clean_author:
        params["author"] = clean_author

    url = f"https://openlibrary.org/search.json?{urlencode(params)}"
    logger.info(
        "[CoverLookup] open_library title_author url=%s title=%r author=%r",
        url,
        clean_title,
        clean_author,
    )

    try:
        response = httpx.get(url, timeout=8.0)
    except httpx.HTTPError as exc:
        logger.warning("[CoverLookup] open_library title_author failed: %s", exc)
        return None, None

    logger.info(
        "[CoverLookup] open_library title_author status=%s title=%r",
        response.status_code,
        clean_title,
    )
    if response.status_code != 200:
        return None, None

    candidates: list[tuple[float, dict]] = []
    for item in response.json().get("docs", []):
        cover_id = item.get("cover_i")
        if not cover_id:
            continue
        parsed = _parse_open_library_doc(item)
        if not parsed:
            continue
        score = _combined_match_score(
            parsed.get("title"),
            parsed.get("author"),
            clean_title,
            clean_author or None,
        )
        if score < 0.68:
            continue
        cover_url = f"https://covers.openlibrary.org/b/id/{cover_id}-M.jpg"
        parsed["cover_url"] = cover_url
        candidates.append((score, parsed))

    best = _pick_best_cover_candidate(
        candidates,
        target_title=clean_title,
        target_author=clean_author or None,
    )
    if not best:
        return None, None

    selected_url = best.get("cover_url")
    logger.info(
        "[CoverLookup] open_library title_author selected title=%r cover_url=%r",
        best.get("title"),
        selected_url,
    )
    return selected_url, best


def search_open_library(q: str, limit: int = 12, mode: SearchMode = "all") -> list[dict]:
    url = "https://openlibrary.org/search.json"
    params = {
        "q": _build_open_library_query(q, mode),
        "limit": min(limit, 40),
        "fields": (
            "key,title,subtitle,author_name,subject,first_publish_year,"
            "cover_i,isbn,publisher,number_of_pages_median,ratings_average,"
            "ratings_count,first_sentence"
        ),
    }

    try:
        response = httpx.get(url, params=params, timeout=5.0)
    except httpx.HTTPError:
        return []

    if response.status_code != 200:
        return []

    books = []
    for item in response.json().get("docs", []):
        parsed = _parse_open_library_doc(item)
        if parsed:
            books.append(parsed)
    return books
