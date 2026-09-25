#!/bin/sh
# DENSEN — Day 15 e2e runner (self-contained, self-cleaning).
#
# The e2e script (e2e-day15.cjs) needs a live local Convex backend on :3210.
# This runner:
#   1. starts `bun convex dev` (the local backend) in the background,
#   2. waits until :3210 accepts TCP connections (bounded),
#   3. runs the e2e against it,
#   4. ALWAYS tears the backend down again (trap on exit) so nothing lingers.
#
# The project's Vite preview server is NOT touched — it is managed by the
# platform and keeps running; this only brackets the backend for the test.
# The local backend stores data under .convex — it persists across runs.
set -u

cd "$(dirname "$0")/.."

BACKEND_PID=""
cleanup() {
  if [ -n "$BACKEND_PID" ]; then
    kill "$BACKEND_PID" 2>/dev/null
    wait "$BACKEND_PID" 2>/dev/null
  fi
}
trap cleanup EXIT INT TERM

# Already listening? Reuse the running backend instead of starting one.
if curl -s -m 2 -o /dev/null http://127.0.0.1:3210/ 2>/dev/null; then
  echo "backend already running on :3210 — reusing"
else
  echo "starting local Convex backend…"
  bun convex dev >/tmp/d15-backend.log 2>&1 &
  BACKEND_PID=$!
  ok=0
  i=0
  while [ $i -lt 60 ]; do
    if curl -s -m 2 -o /dev/null http://127.0.0.1:3210/ 2>/dev/null; then ok=1; break; fi
    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then break; fi
    sleep 1
    i=$((i + 1))
  done
  if [ $ok -ne 1 ]; then
    echo "backend did not become ready — last log lines:"
    tail -n 20 /tmp/d15-backend.log 2>/dev/null
    exit 2
  fi
  echo "backend ready on :3210"
fi

node scripts/e2e-day15.cjs
status=$?
exit $status
