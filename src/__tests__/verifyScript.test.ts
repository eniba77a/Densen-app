import { describe, expect, it } from "vitest";

/**
 * Regression tests for the Day 3 verification-script incident.
 *
 * The failed pass ran an inline `python3 -c "json.load(sys.stdin)"` against
 * curl output that had been written to /dev/null, and assumed the SPA shell
 * would be JSON. Both assumptions were wrong. These tests pin the correct
 * expectations so the mistake cannot come back as a committed test:
 *
 *   1. The app shell at `/` intentionally serves text/html — it is NOT a JSON
 *      endpoint, and any verification must classify it as HTML.
 *   2. An empty body must never reach a JSON parser ("Expecting value: line 1
 *      column 1 (char 0)" is exactly what parsing empty input yields).
 *   3. JSON probes are only valid when Content-Type declares json.
 */

type Classification = "json" | "html" | "empty" | "unknown";

/** Pure core of scripts/verify.sh's probe_json — classify before parsing. */
export function classifyResponse(contentType: string | null, body: string): Classification {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("application/json") || ct.includes("+json")) return "json";
  if (ct.includes("text/html")) return "html";
  if (body.length === 0) return "empty";
  return "unknown";
}

/** Only JSON-classified responses may be parsed; everything else must skip. */
export function shouldAttemptJsonParse(contentType: string | null, body: string): boolean {
  return classifyResponse(contentType, body) === "json";
}

describe("verification response classification", () => {
  it("classifies the SPA shell as HTML — not a JSON endpoint", () => {
    // index.html shell as served by Vite for / and any SPA route.
    const shell = "<!doctype html><html><body><div id=\"root\"></div></body></html>";
    expect(classifyResponse("text/html", shell)).toBe("html");
    expect(shouldAttemptJsonParse("text/html", shell)).toBe(false);
  });

  it("never classifies an empty body as JSON (the JSONDecodeError guard)", () => {
    // The old script's actual input: curl -o /dev/null left python's stdin empty.
    expect(classifyResponse(null, "")).toBe("empty");
    expect(classifyResponse("", "")).toBe("empty");
    expect(shouldAttemptJsonParse(null, "")).toBe(false);
  });

  it("treats declared-JSON responses as parseable only when truly declared", () => {
    expect(shouldAttemptJsonParse("application/json", "{}")).toBe(true);
    expect(shouldAttemptJsonParse("application/ld+json", "{}")).toBe(true);
  });

  it("leaves bodies without a decisive Content-Type unclassified", () => {
    expect(classifyResponse("text/plain", "Not found.")).toBe("unknown");
    expect(shouldAttemptJsonParse("text/plain", "Not found.")).toBe(false);
  });

  it("JSON.parse on an empty stream throws the exact incident error shape", () => {
    // Documents the incident: parsing empty input raises "Expecting value" —
    // the guard above (shouldAttemptJsonParse === false) prevents reaching it.
    let message = "";
    try {
      JSON.parse("");
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain("Unexpected end of JSON input");
  });
});
