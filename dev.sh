#!/usr/bin/env bash
# Starts the whole EquiCrew product for development:
#   - the contact API (FastAPI/uvicorn) from backend/ on API_PORT (default 8000)
#   - the static website from frontend/ on WEB_PORT (default 5500)
# The website's API base is written by frontend/scripts/write-config.mjs first.
# SMTP_* variables are taken from your shell; without them the contact form answers 503.
# Stop both with Ctrl+C.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_PORT="${API_PORT:-8000}"
WEB_PORT="${WEB_PORT:-5500}"
API_ORIGIN="http://localhost:${API_PORT}"
WEB_ORIGIN="http://localhost:${WEB_PORT}"

if command -v python3 >/dev/null 2>&1; then
  PYTHON="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON="python"
else
  echo "dev.sh: Python 3 was not found (python3 or python)." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "dev.sh: Node.js was not found (needed for frontend/scripts/write-config.mjs)." >&2
  exit 1
fi

CONFIG_SCRIPT="${ROOT}/frontend/scripts/write-config.mjs"
if [ ! -f "${CONFIG_SCRIPT}" ]; then
  echo "dev.sh: ${CONFIG_SCRIPT} is missing; the website cannot learn the API address." >&2
  exit 1
fi

echo "Writing the website configuration (API at ${API_ORIGIN}) ..."
(cd "${ROOT}/frontend" && API_BASE_URL="${API_ORIGIN}" API_BASE="${API_ORIGIN}" node scripts/write-config.mjs)

PIDS=()
cleanup() {
  trap - EXIT INT TERM
  for pid in "${PIDS[@]}"; do
    kill "${pid}" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting the contact API on ${API_ORIGIN} ..."
(
  cd "${ROOT}/backend"
  CORS_ORIGIN="${WEB_ORIGIN}" \
    exec "${PYTHON}" -m uvicorn app.main:app --host 127.0.0.1 --port "${API_PORT}"
) &
PIDS+=("$!")

echo "Serving the website on ${WEB_ORIGIN} ..."
"${PYTHON}" -m http.server "${WEB_PORT}" --bind 127.0.0.1 --directory "${ROOT}/frontend" &
PIDS+=("$!")

echo
echo "Website: ${WEB_ORIGIN}/"
echo "API:     ${API_ORIGIN}/api/health"
echo "Stop with Ctrl+C."

wait -n "${PIDS[@]}"
