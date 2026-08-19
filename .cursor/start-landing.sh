#!/usr/bin/env bash
# Start (or reuse) the static landing-page server and wait until it answers.
set -euo pipefail

PORT=5173
LOG=/tmp/elevated-landing.log
URL="http://127.0.0.1:${PORT}/"

if ! curl -sf -o /dev/null "$URL"; then
  nohup python3 -m http.server "$PORT" --bind 0.0.0.0 >"$LOG" 2>&1 &
fi

n=0
until curl -sf -o /dev/null "$URL"; do
  n=$((n + 1))
  if [ "$n" -gt 50 ]; then
    echo "Landing page failed to start on :${PORT}" >&2
    if [ -f "$LOG" ]; then
      tail -n 50 "$LOG" >&2
    fi
    exit 1
  fi
  sleep 0.1
done

echo "Landing page ready at ${URL}"
