#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

export PYTHONPATH="$BACKEND_ROOT/src${PYTHONPATH:+:$PYTHONPATH}"
PYTHON_BIN="${BACKEND_ROOT}/.venv/bin/python"
if [ ! -x "$PYTHON_BIN" ]; then
  PYTHON_BIN="python3"
fi

exec "$PYTHON_BIN" -m uvicorn \
  celluniverse_backend.main:app \
  --host 127.0.0.1 \
  --port 8765 \
  --reload
