#!/bin/sh
# DENSEN preview verification (Day 3 fix pass).
#
# Root cause this script replaces: a throwaway `curl | python3 -c "json.load(sys.stdin)"`
# pipeline that (1) fetched with `-o /dev/null`, so python's stdin was EMPTY, and
# (2) expected the SPA shell at `/` to be JSON, when it intentionally serves text/html.
# That produced: json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0).
#
# Rules here:
#   - Never pipe a response body into a JSON parser blindly.
#   - Classify each response (status + Content-Type) and decide expectations per route.
#   - JSON probes are opt-in via VERIFY_JSON_PROBE=1 and only for routes that
#     actually declare application/json.
#
# Usage:
#   sh scripts/verify.sh [BASE_URL]
#   BASE_URL defaults to $PREVIEW_URL, then http://127.0.0.1:$PORT, then :5173.
# Exit code 0 = all checks passed.

set -u

BASE="${1:-${PREVIEW_URL:-}}"
if [ -z "$BASE" ]; then
  if [ -n "${PORT:-}" ]; then BASE="http://127.0.0.1:${PORT}"; else BASE="http://127.0.0.1:5173"; fi
fi
BASE="${BASE%/}"

PASS=0
FAIL=0

# classify <url> -> prints "<status> <content-type>"; body goes to /dev/null.
# (Bodies are deliberately not captured or printed: this is a smoke check, and
#  the previous incident showed what happens when bodies are fed to parsers.)
classify() {
  curl -sS -m 15 -o /dev/null -w '%{http_code} %{content_type}' "$1" 2>/dev/null
}

# assert_route <url> <expect-status> <expect-ct-substring> <label>
assert_route() {
  url="$1"; want_status="$2"; want_ct="$3"; label="$4"
  got=$(classify "$url")
  status=${got%% *}
  ct=$(printf '%s' "$got" | cut -d' ' -f2-)
  if [ "$status" = "$want_status" ] && printf '%s' "$ct" | grep -qi "$want_ct"; then
    echo "PASS  $label -> $status ($ct)"
    PASS=$((PASS + 1))
  else
    echo "FAIL  $label -> got [$got], wanted [$want_status $want_ct]"
    FAIL=$((FAIL + 1))
  fi
}

# probe_json <url> <label>
# Only treats a response as JSON if the Content-Type says so. Empty or non-JSON
# responses are reported as such instead of being handed to a parser.
probe_json() {
  url="$1"; label="$2"
  ct=$(curl -sS -m 15 -o /dev/null -w '%{content_type}' "$url" 2>/dev/null)
  case "$ct" in
    application/json*|*"+json")
      body=$(curl -sS -m 15 "$url" 2>/dev/null | tr -d ' \t\r\n')
      case "$body" in
        "{"*|"["*)
          echo "PASS  $label -> JSON object/array with $ct"
          PASS=$((PASS + 1));;
        "") echo "FAIL  $label -> declared $ct but body is EMPTY"; FAIL=$((FAIL + 1));;
        *)  echo "FAIL  $label -> declared $ct but body is not JSON-shaped"; FAIL=$((FAIL + 1));;
      esac;;
    "")
      echo "SKIP  $label -> no Content-Type (not a JSON endpoint)";;
    *)
      echo "SKIP  $label -> serves $ct (not a JSON endpoint; no JSON parsing attempted)";;
  esac
}

echo "== DENSEN preview verification =="
echo "base: $BASE"
echo

echo "-- SPA shell routes (expected: 200, text/html; an SPA route is NOT JSON) --"
assert_route "$BASE/" 200 text/html "GET / (SPA shell)"
assert_route "$BASE/#/create" 200 text/html "GET /#/create (SPA hash route)"
assert_route "$BASE/#/settings" 200 text/html "GET /#/settings (Privacy Center entry)"
assert_route "$BASE/#/safety" 200 text/html "GET /#/safety (Safety Center)"
assert_route "$BASE/#/auth" 200 text/html "GET /#/auth (sign in / sign up)"
echo

echo "-- static assets --"
asset=$(curl -sS -m 15 "$BASE/" 2>/dev/null | sed -n 's/.*src="\(\/src\/[^"]*\)".*/\1/p' | head -n 1)
# Production builds ship hashed bundles under /assets/ instead of /src/.
[ -z "$asset" ] && asset=$(curl -sS -m 15 "$BASE/" 2>/dev/null | sed -n 's/.*src="\([^"]*\.js\)".*/\1/p' | head -n 1)
if [ -n "$asset" ]; then
  assert_route "$BASE$asset" 200 "javascript\|video\|text\|octet" "GET $asset (app entry module)"
else
  echo "SKIP  app entry module (could not parse index markup)"
fi
echo

# The repo's CSP ships as a <meta http-equiv> tag in index.html (meta-CSP; a header
# is only added if hosting config allows it later) — accept either delivery.
echo "-- CSP (Day 3 security surface; meta tag or header) --"
csp_meta=$(curl -sS -m 15 "$BASE/" 2>/dev/null | grep -ic 'http-equiv="Content-Security-Policy"')
csp_header=$(curl -sS -m 15 -o /dev/null -D- "$BASE/" 2>/dev/null | grep -ci '^content-security-policy:')
if [ "${csp_meta:-0}" -ge 1 ] || [ "${csp_header:-0}" -ge 1 ]; then
  echo "PASS  CSP present (meta tag: $csp_meta, header: $csp_header)"
  PASS=$((PASS + 1))
else
  echo "FAIL  CSP missing from both HTML meta tag and response headers"
  FAIL=$((FAIL + 1))
fi
echo

if [ "${VERIFY_JSON_PROBE:-0}" = "1" ]; then
  echo "-- opt-in JSON probes (only routes that declare application/json) --"
  probe_json "$BASE/" "GET /"
  echo
fi

echo "== result: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
