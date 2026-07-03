#!/usr/bin/env bash
# BookMindAI launcher: sets up a virtual env, installs deps, and runs the server.
set -euo pipefail

cd "$(dirname "$0")"

PY="${PYTHON:-python3}"

if [ ! -d ".venv" ]; then
  echo "→ Creating virtual environment (.venv)…"
  "$PY" -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

echo "→ Installing dependencies…"
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

if [ ! -f ".env" ] && [ -f ".env.example" ]; then
  cp .env.example .env
  echo "→ Created .env (offline mode by default; add an OpenAI key to enable full AI)."
fi

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"

echo "→ BookMindAI running at http://${HOST}:${PORT}"
exec uvicorn app.main:app --host "$HOST" --port "$PORT" --reload
