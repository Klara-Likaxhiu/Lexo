"""AI engine for BookMindAI.

Provides summarization, key-takeaway extraction, and chat Q&A.

Two backends are supported transparently:
  * OpenAI (used automatically when OPENAI_API_KEY is set)
  * A dependency-free, offline "mock" engine that uses classic extractive
    summarization so the app is fully functional without any API key.
"""

from __future__ import annotations

import os
import re
import math
from collections import Counter
from typing import Iterable

import httpx

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").strip().rstrip("/")

# A modest stopword list — enough for decent extractive summaries offline.
_STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "if", "while", "of", "at", "by",
    "for", "with", "about", "against", "between", "into", "through", "during",
    "before", "after", "above", "below", "to", "from", "up", "down", "in",
    "out", "on", "off", "over", "under", "again", "further", "then", "once",
    "here", "there", "when", "where", "why", "how", "all", "any", "both",
    "each", "few", "more", "most", "other", "some", "such", "no", "nor",
    "not", "only", "own", "same", "so", "than", "too", "very", "can", "will",
    "just", "is", "are", "was", "were", "be", "been", "being", "have", "has",
    "had", "do", "does", "did", "this", "that", "these", "those", "i", "you",
    "he", "she", "it", "we", "they", "them", "his", "her", "its", "their",
    "what", "which", "who", "whom", "as", "because", "until", "of", "his",
    "would", "could", "should", "may", "might", "must", "shall", "him", "me",
    "my", "your", "our", "us", "also",
}


def using_openai() -> bool:
    """Return True when a real OpenAI key is configured."""
    return bool(OPENAI_API_KEY)


def engine_name() -> str:
    return f"OpenAI ({OPENAI_MODEL})" if using_openai() else "Offline extractive engine"


# ---------------------------------------------------------------------------
# Text utilities (shared by the offline engine)
# ---------------------------------------------------------------------------

def _split_sentences(text: str) -> list[str]:
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return []
    # Split on sentence-ending punctuation followed by whitespace.
    parts = re.split(r"(?<=[.!?])\s+", text)
    return [p.strip() for p in parts if len(p.strip()) > 0]


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[a-zA-Z']+", text.lower())


def _word_frequencies(words: Iterable[str]) -> Counter:
    freq: Counter = Counter(w for w in words if w not in _STOPWORDS and len(w) > 2)
    return freq


# ---------------------------------------------------------------------------
# Offline extractive engine
# ---------------------------------------------------------------------------

def _rank_sentences(text: str) -> list[tuple[float, int, str]]:
    """Score sentences by normalized term frequency. Returns (score, index, sentence)."""
    sentences = _split_sentences(text)
    if not sentences:
        return []

    freq = _word_frequencies(_tokenize(text))
    if not freq:
        return [(1.0, i, s) for i, s in enumerate(sentences)]

    max_freq = max(freq.values())
    scored: list[tuple[float, int, str]] = []
    for idx, sentence in enumerate(sentences):
        words = [w for w in _tokenize(sentence) if w in freq]
        if not words:
            continue
        score = sum(freq[w] / max_freq for w in words) / math.sqrt(len(words))
        # Gentle bias toward earlier sentences (intros often set context).
        score *= 1.0 + (0.15 * (1.0 - idx / max(len(sentences) - 1, 1)))
        scored.append((score, idx, sentence))
    return scored


def _offline_summary(text: str, max_sentences: int = 5) -> str:
    scored = _rank_sentences(text)
    if not scored:
        return "There was not enough text to summarize."
    top = sorted(scored, key=lambda x: x[0], reverse=True)[:max_sentences]
    top_in_order = sorted(top, key=lambda x: x[1])
    return " ".join(s for _, _, s in top_in_order)


def _offline_takeaways(text: str, count: int = 5) -> list[str]:
    scored = _rank_sentences(text)
    if not scored:
        return ["Not enough text to extract takeaways."]
    top = sorted(scored, key=lambda x: x[0], reverse=True)[:count]
    top_in_order = sorted(top, key=lambda x: x[1])
    takeaways = []
    for _, _, sentence in top_in_order:
        clean = sentence.strip()
        if len(clean) > 220:
            clean = clean[:217].rsplit(" ", 1)[0] + "..."
        takeaways.append(clean)
    return takeaways


def _offline_keywords(text: str, count: int = 8) -> list[str]:
    freq = _word_frequencies(_tokenize(text))
    return [w for w, _ in freq.most_common(count)]


def _offline_chat(question: str, context: str) -> str:
    """Answer a question by retrieving the most relevant sentences from context."""
    sentences = _split_sentences(context)
    if not sentences:
        return "I don't have any book text loaded yet. Please add some text first."

    q_words = {w for w in _tokenize(question) if w not in _STOPWORDS and len(w) > 2}
    if not q_words:
        return _offline_summary(context, max_sentences=2)

    ranked: list[tuple[int, int, str]] = []
    for idx, sentence in enumerate(sentences):
        s_words = set(_tokenize(sentence))
        overlap = len(q_words & s_words)
        if overlap:
            ranked.append((overlap, idx, sentence))

    if not ranked:
        return (
            "I couldn't find that in the text. The document mainly covers: "
            + ", ".join(_offline_keywords(context, 6))
            + "."
        )

    ranked.sort(key=lambda x: x[0], reverse=True)
    best = sorted(ranked[:3], key=lambda x: x[1])
    answer = " ".join(s for _, _, s in best)
    return f"Based on the text: {answer}"


# ---------------------------------------------------------------------------
# OpenAI engine
# ---------------------------------------------------------------------------

def _truncate_for_model(text: str, max_chars: int = 24000) -> str:
    """Keep prompts within a sane size for the model context window."""
    if len(text) <= max_chars:
        return text
    head = text[: int(max_chars * 0.7)]
    tail = text[-int(max_chars * 0.25):]
    return f"{head}\n\n[...content truncated for length...]\n\n{tail}"


def _openai_chat_completion(messages: list[dict], temperature: float = 0.3) -> str:
    url = f"{OPENAI_BASE_URL}/chat/completions"
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": OPENAI_MODEL,
        "messages": messages,
        "temperature": temperature,
    }
    with httpx.Client(timeout=60.0) as client:
        resp = client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
    return data["choices"][0]["message"]["content"].strip()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def analyze(text: str) -> dict:
    """Return a summary, key takeaways, and keywords for the given text."""
    text = (text or "").strip()
    if not text:
        return {
            "summary": "No text was provided.",
            "takeaways": [],
            "keywords": [],
            "engine": engine_name(),
        }

    if using_openai():
        try:
            content = _truncate_for_model(text)
            system = (
                "You are BookMindAI, an expert literary analyst. Given book or "
                "article text, produce a concise, faithful summary and the most "
                "important takeaways. Never invent facts that are not supported "
                "by the text."
            )
            user = (
                "Analyze the following text. Respond in EXACTLY this format:\n\n"
                "SUMMARY:\n<a clear 4-6 sentence summary>\n\n"
                "TAKEAWAYS:\n- <takeaway 1>\n- <takeaway 2>\n- <takeaway 3>\n"
                "- <takeaway 4>\n- <takeaway 5>\n\n"
                "KEYWORDS:\n<comma-separated list of 6-8 key terms>\n\n"
                f"TEXT:\n{content}"
            )
            raw = _openai_chat_completion(
                [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ]
            )
            return _parse_analysis(raw)
        except Exception as exc:  # noqa: BLE001 — fall back gracefully
            return {
                "summary": _offline_summary(text),
                "takeaways": _offline_takeaways(text),
                "keywords": _offline_keywords(text),
                "engine": f"Offline fallback (OpenAI error: {exc})",
            }

    return {
        "summary": _offline_summary(text),
        "takeaways": _offline_takeaways(text),
        "keywords": _offline_keywords(text),
        "engine": engine_name(),
    }


def _parse_analysis(raw: str) -> dict:
    summary, takeaways, keywords = "", [], []
    section = None
    for line in raw.splitlines():
        stripped = line.strip()
        upper = stripped.upper()
        if upper.startswith("SUMMARY"):
            section = "summary"
            continue
        if upper.startswith("TAKEAWAYS"):
            section = "takeaways"
            continue
        if upper.startswith("KEYWORDS"):
            section = "keywords"
            continue
        if not stripped:
            continue
        if section == "summary":
            summary += (" " if summary else "") + stripped
        elif section == "takeaways":
            item = re.sub(r"^[-*\d.)\s]+", "", stripped).strip()
            if item:
                takeaways.append(item)
        elif section == "keywords":
            keywords.extend([k.strip() for k in stripped.split(",") if k.strip()])

    if not summary:
        summary = raw.strip()
    return {
        "summary": summary,
        "takeaways": takeaways,
        "keywords": keywords,
        "engine": engine_name(),
    }


def chat(question: str, context: str, history: list[dict] | None = None) -> str:
    """Answer a question grounded in the provided book context."""
    question = (question or "").strip()
    if not question:
        return "Please ask a question."

    context = (context or "").strip()

    if using_openai():
        try:
            system = (
                "You are BookMindAI, a helpful reading companion. Answer the "
                "user's questions using ONLY the provided book context. If the "
                "answer is not in the context, say so honestly. Be concise and "
                "cite relevant details from the text."
            )
            messages = [{"role": "system", "content": system}]
            if context:
                messages.append(
                    {
                        "role": "system",
                        "content": f"BOOK CONTEXT:\n{_truncate_for_model(context, 18000)}",
                    }
                )
            for turn in (history or [])[-6:]:
                role = turn.get("role")
                content = turn.get("content")
                if role in {"user", "assistant"} and content:
                    messages.append({"role": role, "content": content})
            messages.append({"role": "user", "content": question})
            return _openai_chat_completion(messages, temperature=0.4)
        except Exception as exc:  # noqa: BLE001
            return f"{_offline_chat(question, context)}\n\n(Note: OpenAI error, used offline mode: {exc})"

    return _offline_chat(question, context)
    analyze_reader_profile()
