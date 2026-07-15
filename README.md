# 📖 Lexo

> Read smarter. Understand deeper.

Lexo is an AI-powered reading companion. Paste an excerpt or upload a
document, and it instantly produces a **summary**, **key takeaways**, and a
**chat** you can ask anything about the text.

It works **out of the box with zero configuration** thanks to a built-in,
dependency-free extractive summarizer — and it automatically upgrades to
full LLM quality when you provide an **OpenAI API key**.

---

## ✨ Features

- **Smart summaries** — concise, faithful summaries of any passage.
- **Key takeaways** — the most important points pulled out as bullets.
- **Keyword extraction** — quickly see what a text is about.
- **Ask Lexo** — a grounded chat that answers questions using your text.
- **File upload** — supports `.txt`, `.md`, and `.pdf`.
- **Dual engine** — OpenAI when a key is set, smart offline fallback otherwise.
- **Modern UI** — responsive, animated, dark-mode interface. No build step.

---

## 🚀 Quick start

### Option A — one command (recommended)

```bash
./run.sh
```

This creates a virtual environment, installs dependencies, copies `.env`,
and starts the server at <http://127.0.0.1:8000>.

### Option B — manual

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # optional
uvicorn app.main:app --reload
```

Then open <http://127.0.0.1:8000>.

---

## 🔑 Enabling full AI (optional)

By default Lexo runs **offline** using a classic extractive summarizer —
no key required. To unlock LLM-quality summaries and chat, add your key to
`.env`:

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

Restart the server. The engine badge in the top-right will switch from
"Offline extractive engine" to "OpenAI (…)".

You can also point at any OpenAI-compatible endpoint (Azure, local LLMs, etc.)
via `OPENAI_BASE_URL`.

---

## 🧱 Project structure

```
Lexo/
├── app/
│   ├── __init__.py      # package metadata
│   ├── main.py          # FastAPI app + routes + static hosting
│   ├── ai.py            # AI engine (OpenAI + offline fallback)
│   └── extract.py       # text extraction (.txt/.md/.pdf)
├── static/
│   ├── index.html       # single-page UI
│   ├── styles.css       # styling
│   └── app.js           # frontend logic
├── requirements.txt
├── .env.example
├── run.sh
└── README.md
```

---

## 🔌 API reference

| Method | Endpoint        | Description                                    |
| ------ | --------------- | ---------------------------------------------- |
| GET    | `/api/health`   | Status + which AI engine is active             |
| POST   | `/api/analyze`  | `{ "text": "..." }` → summary, takeaways, keywords |
| POST   | `/api/upload`   | multipart file → extracted text + analysis     |
| POST   | `/api/chat`     | `{ "question", "context", "history" }` → answer |

Example:

```bash
curl -s http://127.0.0.1:8000/api/analyze \
  -H 'Content-Type: application/json' \
  -d '{"text":"It was the best of times, it was the worst of times..."}'
```

---

## 🛠️ How the offline engine works

When no API key is present, Lexo uses term-frequency sentence scoring
(a lightweight TextRank-style approach) to select the most important
sentences for summaries and takeaways, and keyword overlap retrieval to
answer chat questions from your text. It's fast, private, and requires no
network access.

---

## 📄 License

MIT — do whatever you like.
