from pydantic import BaseModel, Field


class ReaderProfileRequest(BaseModel):
    quiz_answers: list[str] = Field(
        ..., description="Answers from the reader personality quiz."
    )
    books_read: list[str] = Field(
        default_factory=list, description="Books the user has already read."
    )
    reading_level: str = Field(
        default="Not sure", description="Beginner, Intermediate, Advanced, or Not sure."
    )


class ReaderProfileResponse(BaseModel):
    result: str
    engine: str


class ReadingCompanionRequest(BaseModel):
    question: str
    reader_profile: dict | None = None


class ReadingPathsRequest(BaseModel):
    reader_profile: dict | None = None
    library: dict | None = None
    today_mood: str | None = None
    today_goal: str | None = None


class DiscoverRequest(BaseModel):
    reader_profile: dict | None = None
    library: dict | None = None
    today_mood: str | None = None
    today_goal: str | None = None


class ReaderIntelligenceRequest(BaseModel):
    reader_profile: dict | None = None
    library: dict | None = None
    today_mood: str | None = None
    today_goal: str | None = None


class ReaderBadgesRequest(BaseModel):
    reader_profile: dict | None = None
    library: dict | None = None
    stats: dict | None = None