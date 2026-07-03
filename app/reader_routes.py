from fastapi import APIRouter, HTTPException

from app.reader import (
    analyze_reader_profile,
    recommend_with_book_data,
    reading_companion,
    generate_reading_paths,
    generate_reader_intelligence,
)

from app.reader_models import (
    ReaderProfileRequest,
    ReadingCompanionRequest,
    ReadingPathsRequest,
    ReaderIntelligenceRequest,
)

router = APIRouter(prefix="/api/reader", tags=["Reader"])


@router.post("/analyze")
def analyze_reader(data: ReaderProfileRequest) -> dict:
    if not data.quiz_answers:
        raise HTTPException(status_code=400, detail="Quiz answers are required.")

    return analyze_reader_profile(data)


@router.post("/recommend-with-data")
def recommend_reader_with_data(data: ReaderProfileRequest) -> dict:
    if not data.quiz_answers:
        raise HTTPException(status_code=400, detail="Quiz answers are required.")

    return recommend_with_book_data(data)


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
def reader_intelligence(data: ReaderIntelligenceRequest) -> dict:
    return generate_reader_intelligence(
        reader_profile=data.reader_profile,
        library=data.library,
        today_mood=data.today_mood,
        today_goal=data.today_goal,
    )