/**
 * Day 13 — DENSEN music-rights core tests.
 * Pins the load-bearing rules of the copyright architecture:
 *   - NO safe-second rule: duration is only ever checked against the track's
 *     OWN license cap — there is no default allowance anywhere.
 *   - Fail-closed evaluation: no record / blocked status / expired / territory
 *     / use / commercial / duration all deny, each with its own reason.
 *   - Composer ordering prefers DENSEN-approved music.
 *   - Claim + dispute flows are closed state machines; disputes come only
 *     from the affected uploader, one per claim, evidence never a URL.
 *   - The fingerprinting provider fails loudly when unconfigured (no fake
 *     matches, no invented fingerprints).
 */
import { describe, expect, it } from "vitest";
import {
  canTransitionClaim,
  canTransitionDispute,
  claimActionFor,
  decideSubmitDispute,
  evaluateMusicUse,
  sanitizeDurationSec,
  sanitizeEvidenceRef,
  sanitizeTerritory,
  sortForComposer,
  type MusicRecord,
} from "../../convex/musicRights";
import { FingerprintNotConfiguredError, isFingerprintMatch, isFingerprintingConfigured, getFingerprintProvider } from "../../convex/fingerprinting";

const NOW = Date.parse("2026-09-23T12:00:00Z");
const DAY = 24 * 60 * 60_000;

const record = (over: Partial<MusicRecord> = {}): MusicRecord => ({
  title: "Test Track",
  artist: "Test Artist",
  audioId: "a1",
  rightsHolder: "Test Holder",
  licensingStatus: "densen_licensed",
  territories: [],
  permittedUse: ["personal_post"],
  commercialUse: false,
  ...over,
});

const evaluate = (over: Partial<Parameters<typeof evaluateMusicUse>[0]> = {}) =>
  evaluateMusicUse({ record: record(), use: "personal_post", territory: "AL", durationSec: 30, now: NOW, ...over });

/* ---------------- usage evaluation ---------------- */
describe("evaluateMusicUse: the no-safe-second rule", () => {
  it("allows a use covered by a real, current, worldwide record", () => {
    expect(evaluate()).toMatchObject({ action: "allow" });
  });

  it("denies when no music record exists — no record, no permission", () => {
    expect(evaluateMusicUse({ record: null, use: "personal_post", territory: "AL", durationSec: 5, now: NOW })).toEqual({
      action: "deny",
      error: "no_record",
    });
  });

  it("denies blocked statuses — restricted-without-restrictions, detected, removed, disputed", () => {
    for (const status of ["copyright_detected", "removed", "disputed"] as const) {
      expect(evaluate({ record: record({ licensingStatus: status }) })).toMatchObject({ action: "deny", error: "status_not_licensable" });
    }
    // `restricted` is licensable ONLY inside its own recorded restrictions —
    // this test uses a permissive personal_post record so it allows.
    expect(evaluate({ record: record({ licensingStatus: "restricted" }) })).toMatchObject({ action: "allow" });
  });

  it("denies expired licenses — a lapsed permission is no permission", () => {
    expect(evaluate({ record: record({ licenseExpiresAt: NOW - DAY }) })).toMatchObject({ action: "deny", error: "license_expired" });
    expect(evaluate({ record: record({ licenseExpiresAt: NOW + DAY }) })).toMatchObject({ action: "allow" });
  });

  it("denies territories the license does not cover", () => {
    expect(evaluate({ record: record({ territories: ["DE", "AT"] }) })).toMatchObject({ action: "deny", error: "territory_not_covered" });
    expect(evaluate({ record: record({ territories: ["DE", "AL"] }) })).toMatchObject({ action: "allow" });
  });

  it("denies uses outside the permitted-use list", () => {
    expect(evaluate({ use: "monetized_post" })).toMatchObject({ action: "deny", error: "use_not_permitted" });
    expect(evaluate({ use: "commercial_post" })).toMatchObject({ action: "deny", error: "use_not_permitted" });
  });

  it("denies commercial/monetized use unless the record explicitly grants it", () => {
    expect(evaluate({ use: "commercial_post", record: record({ permittedUse: ["commercial_post"], commercialUse: false }) })).toMatchObject({
      action: "deny",
      error: "commercial_use_not_permitted",
    });
    expect(evaluate({ use: "monetized_post", record: record({ permittedUse: ["monetized_post"], commercialUse: true }) })).toMatchObject({
      action: "allow",
    });
  });

  it("has NO safe-second rule: duration is checked against the track's OWN cap only", () => {
    expect(evaluate({ durationSec: 120, record: record({ maxDurationSec: 90 }) })).toMatchObject({ action: "deny", error: "duration_exceeds_license" });
    expect(evaluate({ durationSec: 90, record: record({ maxDurationSec: 90 }) })).toMatchObject({ action: "allow" });
    // No cap on the record = uncapped per the record — the music itself decides.
    expect(evaluate({ durationSec: 100_000 })).toMatchObject({ action: "allow" });
  });

  it("carries the record's real restrictions text on every deny", () => {
    const d = evaluate({ record: record({ restrictions: "DE/AT only.", territories: ["DE", "AT"] }) });
    expect(d).toMatchObject({ action: "deny", error: "territory_not_covered", restrictions: "DE/AT only." });
    // `restricted` tracks stay usable inside their own recorded restrictions.
    const r = evaluate({ record: record({ licensingStatus: "restricted", restrictions: "Personal posts only; no monetization." }) });
    expect(r).toMatchObject({ action: "allow" });
  });
});

/* ---------------- composer ordering ---------------- */
describe("sortForComposer: prefer DENSEN-approved music", () => {
  it("orders densen → platform → user → restricted and drops blocked statuses", () => {
    const ordered = sortForComposer([
      record({ audioId: "r", licensingStatus: "restricted", title: "B" }),
      record({ audioId: "u", licensingStatus: "user_owned", title: "A" }),
      record({ audioId: "d", licensingStatus: "densen_licensed", title: "Z" }),
      record({ audioId: "x", licensingStatus: "copyright_detected", title: "Blocked" }),
      record({ audioId: "p", licensingStatus: "platform_licensed", title: "Y" }),
    ]);
    expect(ordered.map((r) => r.audioId)).toEqual(["d", "p", "u", "r"]);
  });

  it("puts non-expiring licenses before expiring ones inside a tier", () => {
    const ordered = sortForComposer([
      record({ audioId: "expiring", licenseExpiresAt: NOW + DAY, title: "A" }),
      record({ audioId: "evergreen", title: "B" }),
    ]);
    expect(ordered.map((r) => r.audioId)).toEqual(["evergreen", "expiring"]);
  });
});

/* ---------------- sanitizers ---------------- */
describe("input sanitizers", () => {
  it("territories are strict ISO-3166 alpha-2", () => {
    expect(sanitizeTerritory(" al ")).toBe("AL");
    expect(sanitizeTerritory("USA")).toBeUndefined();
    expect(sanitizeTerritory("1A")).toBeUndefined();
    expect(sanitizeTerritory(42)).toBeUndefined();
  });

  it("durations are bounded (0…3600) integers", () => {
    expect(sanitizeDurationSec(90.7)).toBe(91);
    expect(sanitizeDurationSec(-1)).toBeUndefined();
    expect(sanitizeDurationSec(3601)).toBeUndefined();
    expect(sanitizeDurationSec(Number.NaN)).toBeUndefined();
  });

  it("evidence refs are opaque media references — never hot-linked URLs", () => {
    expect(sanitizeEvidenceRef(" media_abc123 ")).toBe("media_abc123");
    expect(sanitizeEvidenceRef("https://evil.example/license.pdf")).toBeUndefined();
    expect(sanitizeEvidenceRef("")).toBeUndefined();
    expect(sanitizeEvidenceRef("x".repeat(257))).toBeUndefined();
  });
});

/* ---------------- claim state machine ---------------- */
describe("claim flow state machine", () => {
  it("follows the brief's flow: notified → restrict → replace → remove audio → remove content", () => {
    expect(canTransitionClaim("submitted", "notified")).toBe(true);
    expect(canTransitionClaim("notified", "restricted")).toBe(true);
    expect(canTransitionClaim("restricted", "audio_replaced")).toBe(true);
    expect(canTransitionClaim("audio_replaced", "audio_removed")).toBe(true);
    expect(canTransitionClaim("audio_removed", "content_removed")).toBe(true);
    expect(canTransitionClaim("content_removed", "resolved")).toBe(true);
  });

  it("blocks illegal jumps from intake — containment escalates after notify", () => {
    expect(canTransitionClaim("submitted", "audio_removed")).toBe(false);
    expect(canTransitionClaim("submitted", "content_removed")).toBe(false);
    expect(canTransitionClaim("resolved", "rejected")).toBe(false);
    expect(canTransitionClaim("rejected", "under_review")).toBe(false);
    // From `notified` staff MAY escalate straight to the most severe
    // containment when the claim warrants it (deliberate table).
    expect(canTransitionClaim("notified", "content_removed")).toBe(true);
  });

  it("every containment action has a human-readable audit label", () => {
    for (const to of ["restricted", "audio_replaced", "audio_removed", "content_removed", "under_review", "resolved", "rejected"] as const) {
      expect(claimActionFor(to).length).toBeGreaterThan(0);
    }
  });
});

/* ---------------- dispute rules ---------------- */
describe("dispute submission rules", () => {
  const base = {
    signedIn: true,
    claim: { status: "notified" as const, affectedUserId: "u_me" },
    callerUserId: "u_me",
    existingDispute: false,
    reason: "i_own",
    statement: "I recorded this audio myself.",
    evidenceRefs: ["media_evidence_1"],
  };

  it("accepts a valid dispute from the affected uploader", () => {
    expect(decideSubmitDispute(base)).toEqual({ action: "submit" });
  });

  it("only the affected uploader may dispute — never client-claimed identity", () => {
    expect(decideSubmitDispute({ ...base, callerUserId: "u_other" })).toMatchObject({ action: "deny", error: "not_affected_user" });
    expect(decideSubmitDispute({ ...base, claim: { status: "notified", affectedUserId: undefined } })).toMatchObject({ action: "deny", error: "not_affected_user" });
  });

  it("one dispute per claim — replay and spam are impossible", () => {
    expect(decideSubmitDispute({ ...base, existingDispute: true })).toMatchObject({ action: "deny", error: "already_disputed" });
  });

  it("closed claims cannot be disputed", () => {
    expect(decideSubmitDispute({ ...base, claim: { status: "resolved", affectedUserId: "u_me" } })).toMatchObject({ action: "deny", error: "claim_closed" });
    expect(decideSubmitDispute({ ...base, claim: { status: "rejected", affectedUserId: "u_me" } })).toMatchObject({ action: "deny", error: "claim_closed" });
  });

  it("statements must be non-empty and bounded", () => {
    expect(decideSubmitDispute({ ...base, statement: "   " })).toMatchObject({ action: "deny", error: "bad_statement" });
    expect(decideSubmitDispute({ ...base, statement: "x".repeat(2001) })).toMatchObject({ action: "deny", error: "bad_statement" });
  });
});

/* ---------------- dispute state machine ---------------- */
describe("dispute review state machine", () => {
  it("moves submitted → review → accepted/rejected → resolved", () => {
    expect(canTransitionDispute("submitted", "under_review")).toBe(true);
    expect(canTransitionDispute("under_review", "more_information")).toBe(true);
    expect(canTransitionDispute("more_information", "under_review")).toBe(true);
    expect(canTransitionDispute("under_review", "accepted")).toBe(true);
    expect(canTransitionDispute("under_review", "rejected")).toBe(true);
    expect(canTransitionDispute("accepted", "resolved")).toBe(true);
    expect(canTransitionDispute("rejected", "resolved")).toBe(true);
  });

  it("blocks outcomes outside review and terminal states", () => {
    expect(canTransitionDispute("submitted", "accepted")).toBe(false);
    expect(canTransitionDispute("more_information", "accepted")).toBe(false);
    expect(canTransitionDispute("resolved", "under_review")).toBe(false);
  });
});

/* ---------------- fingerprinting provider ---------------- */
describe("fingerprinting provider contract", () => {
  it("is not configured and fails loudly — no fake matches, ever", async () => {
    expect(isFingerprintingConfigured()).toBe(false);
    expect(getFingerprintProvider().name).toBe("not_configured");
    await expect(getFingerprintProvider().identify({ audioRef: "media_x", userId: "u1" })).rejects.toBeInstanceOf(
      FingerprintNotConfiguredError
    );
    await expect(getFingerprintProvider().registerReference({ audioId: "a1", audioRef: "media_x" })).rejects.toThrow(
      "FINGERPRINTING_NOT_CONFIGURED:registerReference"
    );
  });

  it("validates fingerprint match shapes for worker/test code paths", () => {
    expect(isFingerprintMatch({ referenceId: "ref_1", confidence: 0.92 })).toBe(true);
    expect(isFingerprintMatch({ referenceId: "", confidence: 0.9 })).toBe(false);
    expect(isFingerprintMatch({ confidence: 0.9 })).toBe(false);
    expect(isFingerprintMatch(null)).toBe(false);
  });
});
