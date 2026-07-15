from fastapi import APIRouter, Depends, HTTPException
import logging

from app.reader import (
    analyze_reader_profile,
    recommend_with_book_data,
    reading_companion,
    generate_reading_paths,
    generate_genre_reading_path,
    generate_reader_intelligence,
    generate_path_reflection,
    build_intelligence_cache_key,
    local_fallback_intelligence,
)

from app.reader_models import (
    ReaderProfileRequest,
    ReadingCompanionRequest,
    ReadingPathsRequest,
    ReaderIntelligenceRequest,
    ReaderBadgesRequest,
    GenrePathRequest,
    PathReflectionRequest,
)
from app.badge_service import generate_personalized_badges
from app.reading_paths_store import (
    ReadingPathsStoreError,
    get_path_by_genre_slug,
    normalize_genre_slug,
    upsert_path,
)
from app.deps import get_verified_user
from app.user_store import get_intelligence_cache, set_intelligence_cache
from app.recommendations_store import (
    books_to_profile_items,
    get_latest_recommendation_batch,
    get_recent_recommendation_titles,
    save_recommendation_batch,
)
from app.supabase_rest import SupabaseRestError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reader", tags=["Reader"])


DEFAULT_HOME_RECOMMENDATION_QUESTION = (
    "Recommend exactly 3 books I haven't read yet, based on my Reader DNA, "
    "favorite genres, ratings, and reviews. Only suggest books that are not "
    "already in my library."
)


@router.get("/recommendations")
def get_saved_recommendations(user: dict = Depends(get_verified_user)) -> dict:
    """Return the user's latest saved recommendation batch (no AI call)."""
    try:
        batch = get_latest_recommendation_batch(user["id"])
    except SupabaseRestError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    if not batch:
        return {
            "recommendations": [],
            "items": [],
            "count": 0,
            "batch_id": None,
            "generated_at": None,
            "expires_at": None,
            "stale": False,
        }

    books = batch.get("recommendations") or []
    return {
        **batch,
        "items": books_to_profile_items(books),
    }


@router.post("/recommendations/generate")
def generate_saved_recommendations(
    data: ReadingCompanionRequest,
    user: dict = Depends(get_verified_user),
) -> dict:
    """Explicitly generate a new batch of 3 books and persist it."""
    question = (data.question or "").strip() or DEFAULT_HOME_RECOMMENDATION_QUESTION
    count = data.recommendation_count or 3
    if count < 1 or count > 10:
        raise HTTPException(status_code=400, detail="recommendation_count must be 1–10.")

    try:
        recent_titles = get_recent_recommendation_titles(user["id"], limit_batches=2)
    except SupabaseRestError:
        recent_titles = set()

    result = reading_companion(
        question=question,
        reader_profile=data.reader_profile,
        recommendation_count=count,
        extra_excluded=recent_titles,
        max_attempts=2,
    )
    books = result.get("recommendations") or []
    if len(books) < count:
        raise HTTPException(
            status_code=502,
            detail=f"Only generated {len(books)} of {count} recommendations. Please try again.",
        )

    try:
        saved = save_recommendation_batch(
            user["id"],
            books,
            source="home",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SupabaseRestError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    return {
        **result,
        **saved,
        "items": books_to_profile_items(saved.get("recommendations") or []),
        "recommendations": saved.get("recommendations") or books,
    }


@router.post("/analyze")
def analyze_reader(data: ReaderProfileRequest) -> dict:
    if not data.quiz_answers:
        raise HTTPException(status_code=400, detail="Quiz answers are required.")

    return analyze_reader_profile(data)


@router.post("/recommend-with-data")
def recommend_reader_with_data(
    data: ReaderProfileRequest,
    user: dict = Depends(get_verified_user),
) -> dict:
    if not data.quiz_answers:
        raise HTTPException(status_code=400, detail="Quiz answers are required.")

    return recommend_with_book_data(data, user_id=user["id"])


@router.post("/companion")
def companion(data: ReadingCompanionRequest) -> dict:
    if not data.question.strip():
        raise HTTPException(status_code=400, detail="Question is required.")

    return reading_companion(
        question=data.question,
        reader_profile=data.reader_profile,
        recommendation_count=data.recommendation_count,
    )


@router.post("/paths")
def reading_paths(data: ReadingPathsRequest) -> dict:
    return generate_reading_paths(
        reader_profile=data.reader_profile,
        library=data.library,
        today_mood=data.today_mood,
        today_goal=data.today_goal,
    )


@router.post("/intelligence")
def reader_intelligence(
    data: ReaderIntelligenceRequest,
    user: dict = Depends(get_verified_user),
) -> dict:
    cache_key = build_intelligence_cache_key(
        data.reader_profile,
        data.library,
        data.today_mood,
        data.today_goal,
    )
    cached = get_intelligence_cache(user["id"], cache_key)
    if cached:
        logger.info("AI Pick cache hit for user=%s", user.get("id"))
        return {**cached, "cached": True}

    logger.info("Generating AI Pick for user=%s", user.get("id"))
    try:
        result = generate_reader_intelligence(
            reader_profile=data.reader_profile,
            library=data.library,
            today_mood=data.today_mood,
            today_goal=data.today_goal,
        )
        logger.info("Mission created for user=%s engine=%s", user.get("id"), result.get("engine"))
        set_intelligence_cache(user["id"], cache_key, result)
        return result
    except Exception as exc:  # noqa: BLE001 — dashboard must never hang
        logger.exception("Intelligence endpoint failed: %s", exc)
        return local_fallback_intelligence(
            data.reader_profile,
            data.library,
            data.today_mood,
            data.today_goal,
        )


@router.post("/badges")
def reader_badges(data: ReaderBadgesRequest) -> dict:
    badges = generate_personalized_badges(
        stats=data.stats or {},
        library=data.library,
        reader_profile=data.reader_profile,
    )
    return {"badges": badges}


@router.post("/genre-path")
def reader_genre_path(
    data: GenrePathRequest,
    user: dict = Depends(get_verified_user),
) -> dict:
    genre = data.genre.strip()
    slug = normalize_genre_slug(genre)

    try:
        existing = get_path_by_genre_slug(user["id"], slug)
        if existing:
            return {
                "created": False,
                "path_id": existing["id"],
                "path": existing,
                "message": f'Opened your existing "{existing.get("path_name") or genre} Starter Path".',
            }

        generated = generate_genre_reading_path(
            genre=genre,
            reader_profile=data.reader_profile,
            library=data.library,
            today_mood=data.today_mood,
            today_goal=data.today_goal,
        )
        generated["genre_slug"] = slug
        generated["genre"] = genre

        saved = upsert_path(
            user["id"],
            generated,
            genre_slug=slug,
            genre_label=genre,
        )
    except ReadingPathsStoreError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    return {
        "created": True,
        "path_id": saved["id"],
        "path": saved,
        "message": f'Created your "{saved.get("path_name") or genre} Starter Path".',
    }


@router.post("/path-reflection")
def path_reflection(data: PathReflectionRequest) -> dict:
    return generate_path_reflection(
        path=data.path,
        reader_profile=data.reader_profile,
        library=data.library,
        days_taken=data.days_taken,
    )