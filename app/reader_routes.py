from fastapi import APIRouter, Depends, HTTPException

from app.reader import (
    analyze_reader_profile,
    recommend_with_book_data,
    reading_companion,
    generate_reading_paths,
    generate_genre_reading_path,
    generate_reader_intelligence,
    generate_path_reflection,
    build_intelligence_cache_key,
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

router = APIRouter(prefix="/api/reader", tags=["Reader"])


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
        return {**cached, "cached": True}

    result = generate_reader_intelligence(
        reader_profile=data.reader_profile,
        library=data.library,
        today_mood=data.today_mood,
        today_goal=data.today_goal,
    )
    set_intelligence_cache(user["id"], cache_key, result)
    return result


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