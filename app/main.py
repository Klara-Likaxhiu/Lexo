"""BookMindAI — FastAPI application entry point."""

from __future__ import annotations

import logging
from pathlib import Path

from dotenv import load_dotenv

# Load .env before importing modules that read environment variables.
load_dotenv()

from fastapi import FastAPI, File, HTTPException, UploadFile  # noqa: E402
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from app import __version__, ai  # noqa: E402
from app.reader_routes import router as reader_router
from app.book_routes import router as book_router
from app.review_routes import router as review_router
from app.auth_routes import router as auth_router
from app.library_routes import router as library_router
from app.user_routes import router as user_router
from app.auth_db import init_db
from app.extract import UnsupportedFileType, extract_text  # noqa: E402
from app.supabase_rest import SupabaseRestError

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"

# Clean URL routes → HTML files in static/ (no server-side auth redirects).
# /login and /signup redirect to .html paths so auth.js always sees canonical page names.
AUTH_PAGE_REDIRECTS: dict[str, str] = {
    "/login": "/login.html",
    "/signup": "/signup.html",
}

FRONTEND_PAGES: dict[str, str] = {
    "/": "landing.html",
    "/landing.html": "landing.html",
    "/home": "home.html",
    "/login.html": "login.html",
    "/signup.html": "signup.html",
    "/discovery": "discovery.html",
    "/library": "library.html",
    "/settings": "settings.html",
    "/reader-dna": "reader-journey.html",
    "/profile": "profile.html",
    "/reader-journey": "reader-journey.html",
    "/reader-quiz": "reader-quiz.html",
    "/ai-companion": "ai-companion.html",
    "/reading-paths": "reading-paths.html",
    "/community": "community.html",
    "/challenges": "challenges.html",
    "/forgot-password": "forgot-password.html",
    "/reset-password": "reset-password.html",
    "/reset-password.html": "reset-password.html",
    "/verify-email": "verify-email.html",
    "/verify-email.html": "verify-email.html",
    "/verify-email-pending": "verify-email-pending.html",
    "/verify-email-pending.html": "verify-email-pending.html",
}

app = FastAPI(
    title="BookMindAI",
    description="AI-powered reading companion with personalized discovery and library tracking.",
    version=__version__,
)

init_db()

app.include_router(auth_router)
app.include_router(user_router)
app.include_router(reader_router)
app.include_router(book_router)
app.include_router(review_router)
app.include_router(library_router)


class AnalyzeRequest(BaseModel):
    text: str = Field(..., description="Raw book or article text to analyze.")


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    question: str
    context: str = ""
    history: list[ChatMessage] = Field(default_factory=list)


class ReaderProfileRequest(BaseModel):
    quiz_answers: str = Field(..., description="Answers from the reader personality quiz.")
    books_read: str = Field(..., description="Books the user has already read.")
    reading_level: str = Field(..., description="Reader's current reading level.")


def _static_page(filename: str) -> FileResponse:
    path = STATIC_DIR / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Page not found.")
    return FileResponse(path)


def _register_frontend_routes() -> None:
    for route, target in AUTH_PAGE_REDIRECTS.items():

        def auth_redirect(url: str = target) -> RedirectResponse:
            return RedirectResponse(url=url, status_code=302)

        app.add_api_route(
            route,
            auth_redirect,
            methods=["GET"],
            include_in_schema=False,
        )

    for route, filename in FRONTEND_PAGES.items():

        def page_handler(page_file: str = filename) -> FileResponse:
            return _static_page(page_file)

        app.add_api_route(
            route,
            page_handler,
            methods=["GET"],
            include_in_schema=False,
        )


_register_frontend_routes()


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "version": __version__,
        "engine": ai.engine_name(),
        "using_openai": ai.using_openai(),
    }


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest) -> dict:
    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="No text provided.")
    return ai.analyze(req.text)


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)) -> dict:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    try:
        text = extract_text(file.filename or "", data)
    except UnsupportedFileType as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc

    if not text.strip():
        raise HTTPException(
            status_code=422,
            detail="Could not extract any text from the file.",
        )

    result = ai.analyze(text)
    result["text"] = text
    result["filename"] = file.filename
    result["char_count"] = len(text)
    return result


@app.post("/api/chat")
def chat(req: ChatRequest) -> dict:
    if not req.question or not req.question.strip():
        raise HTTPException(status_code=400, detail="No question provided.")
    history = [m.model_dump() for m in req.history]
    answer = ai.chat(req.question, req.context, history)
    return {"answer": answer, "engine": ai.engine_name()}


@app.get("/summarizer", include_in_schema=False)
def legacy_summarizer() -> FileResponse:
    """Legacy upload/analyze tool (kept for reference)."""
    return _static_page("legacy/summarizer.html")


# Static assets (CSS, JS, images, legacy .html files) — registered after explicit routes.
app.mount("/", StaticFiles(directory=STATIC_DIR), name="static")


@app.exception_handler(SupabaseRestError)
async def supabase_rest_exception_handler(request, exc: SupabaseRestError):  # noqa: ANN001
    code = exc.status_code if exc.status_code >= 400 else 503
    logger.warning("Supabase REST error on %s: %s", request.url.path, exc.message)
    return JSONResponse(
        status_code=code,
        content={"detail": exc.message, "source": "supabase_rest"},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc: Exception):  # noqa: ANN001
    if isinstance(exc, HTTPException):
        raise exc
    if not request.url.path.startswith("/api/"):
        raise exc
    logger.exception("Unhandled API error on %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc) or "Internal server error.", "source": "server"},
    )


@app.exception_handler(404)
async def not_found(request, _exc):  # noqa: ANN001
    if request.url.path.startswith("/api/"):
        return JSONResponse(status_code=404, content={"detail": "Not found"})
    return JSONResponse(status_code=404, content={"detail": "Not found"})
