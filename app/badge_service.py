"""Personalized reading badge generation for the challenges system."""

from __future__ import annotations

import json
import re
from typing import Any

from app import ai


def _slug(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")
    return cleaned[:48] or "badge"


def rule_based_badges(stats: dict[str, Any], library: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Deterministic personalized badges from reading stats."""
    badges: list[dict[str, Any]] = []
    read = (library or {}).get("read") or []
    top_genre = stats.get("top_genre") or ""
    top_author = stats.get("top_author") or ""
    finished = int(stats.get("total_finished") or 0)
    pages = int(stats.get("total_pages") or 0)
    streak = int(stats.get("streak") or 0)
    reviews = int(stats.get("review_count") or 0)

    if top_genre and finished >= 2:
        label = top_genre.replace("_", " ").title()
        badges.append(
            {
                "id": f"ai-server-genre-{_slug(top_genre)}",
                "title": f"{label} Specialist",
                "description": f"Your reading history centers on {label.lower()} stories.",
                "icon": "sparkles",
                "rarity": "rare" if finished < 8 else "epic",
                "metric": "totalFinished",
                "goal": max(2, min(finished, 5)),
            }
        )

    if top_author and len(read) >= 2:
        badges.append(
            {
                "id": f"ai-server-author-{_slug(top_author)}",
                "title": f"Fan of {top_author}",
                "description": f"You keep returning to books by {top_author}.",
                "icon": "book",
                "rarity": "rare",
                "metric": "totalFinished",
                "goal": 2,
            }
        )

    if pages >= 1500:
        badges.append(
            {
                "id": "ai-server-page-voyager",
                "title": "Page Voyager",
                "description": "Your page count shows serious reading stamina.",
                "icon": "pages",
                "rarity": "epic",
                "metric": "totalPagesRead",
                "goal": 1500,
            }
        )

    if streak >= 7:
        badges.append(
            {
                "id": "ai-server-streak-master",
                "title": "Streak Master",
                "description": "You show up for your reading habit week after week.",
                "icon": "flame",
                "rarity": "epic",
                "metric": "streak",
                "goal": 7,
            }
        )

    if reviews >= 3:
        badges.append(
            {
                "id": "ai-server-critic",
                "title": "Thoughtful Critic",
                "description": "You reflect on books and share your perspective.",
                "icon": "message",
                "rarity": "rare",
                "metric": "reviewCount",
                "goal": 3,
            }
        )

    return badges[:6]


def ai_enhanced_badges(
    stats: dict[str, Any],
    reader_profile: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Optional OpenAI-generated badge titles when the engine is available."""
    if not ai.using_openai():
        return []

    profile = reader_profile or {}
    prompt = f"""Generate 2 unique personalized reading achievement badges for this reader.
Return JSON only: {{"badges":[{{"title":"...","description":"...","icon":"star|heart|book|flame|brain|sparkles","rarity":"common|rare|epic|legendary","goal":1}}]}}

Reader type: {profile.get("reader_type", "Unknown")}
Favorite genres: {profile.get("favorite_genres", [])}
Books finished: {stats.get("total_finished", 0)}
Pages read: {stats.get("total_pages", 0)}
Streak: {stats.get("streak", 0)}
Top genre: {stats.get("top_genre", "")}
"""

    try:
        raw = ai._openai_chat_completion(
            [
                {"role": "system", "content": "Return valid JSON only."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
        )
        parsed = json.loads(raw)
        items = parsed.get("badges") if isinstance(parsed, dict) else []
        result = []
        for item in items[:2]:
            if not isinstance(item, dict) or not item.get("title"):
                continue
            title = str(item["title"]).strip()
            result.append(
                {
                    "id": f"ai-openai-{_slug(title)}",
                    "title": title,
                    "description": str(item.get("description") or "A badge shaped by your reading journey."),
                    "icon": str(item.get("icon") or "robot"),
                    "rarity": str(item.get("rarity") or "legendary"),
                    "goal": 1,
                }
            )
        return result
    except Exception:
        return []


def generate_personalized_badges(
    *,
    stats: dict[str, Any],
    library: dict[str, Any] | None = None,
    reader_profile: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    badges = rule_based_badges(stats, library)
    seen = {b["title"] for b in badges}
    for extra in ai_enhanced_badges(stats, reader_profile):
        if extra["title"] not in seen:
            badges.append(extra)
            seen.add(extra["title"])
    return badges
