/**
 * DENSEN — Music rights decision core (Day 13).
 * ============================================
 * Pure, unit-tested rules for the copyright + music-rights architecture.
 * The wire module (`musicRightsWire.ts`) applies these inside Convex
 * transactions. Nothing here touches the database.
 *
 * WHAT THIS MODEL IS:
 *   A record of real licensing/permission facts per track (musicRecords),
 *   a claim workflow (musicClaims), and a dispute workflow (musicDisputes).
 *
 * WHAT THIS MODEL IS NOT (deliberate, load-bearing rules):
 *   - There is NO safe-second rule. Nothing anywhere computes "N seconds of
 *     a song is automatically legal". `evaluateMusicUse` takes the use's
 *     duration and compares it against the track's OWN license cap only.
 *   - No automatic legal determinations. Claims are queued for staff; the
 *     system may restrict/replace/remove as containment, never adjudicate.
 *   - Displayed rights are always the record's real fields — no invented
 *     license text, no optimistic "probably fine" statuses.
 *
 * Fingerprinting: the provider contract lives in `fingerprinting.ts`
 * (mirrors media.ts: fail loudly when unconfigured, no fake matches).
 */

/* ------------------------------ statuses ------------------------------ */

export type MusicLicensingStatus =
  | "densen_licensed"
  | "platform_licensed"
  | "user_owned"
  | "user_licensed"
  | "restricted"
  | "copyright_detected"
  | "removed"
  | "disputed";

export const MUSIC_STATUSES: readonly MusicLicensingStatus[] = [
  "densen_licensed",
  "platform_licensed",
  "user_owned",
  "user_licensed",
  "restricted",
  "copyright_detected",
  "removed",
  "disputed",
] as const;

export function isMusicStatus(x: unknown): x is MusicLicensingStatus {
  return typeof x === "string" && (MUSIC_STATUSES as readonly string[]).includes(x);
}

/* ------------------------------ permitted use vocabulary ------------------------------ */

export type PermittedUse =
  | "personal_post"
  | "commercial_post"
  | "course_content"
  | "challenge_content"
  | "monetized_post";

export const PERMITTED_USES: readonly PermittedUse[] = [
  "personal_post",
  "commercial_post",
  "course_content",
  "challenge_content",
  "monetized_post",
] as const;

export type UseKind = PermittedUse;

/* ------------------------------ the music record ------------------------------ */

/** The rights facts a track carries. Mirrors the musicRecords table 1:1. */
export interface MusicRecord {
  title: string;
  artist: string;
  album?: string;
  audioId: string;
  rightsHolder: string;
  licensingStatus: MusicLicensingStatus;
  /** ISO-3166 alpha-2 codes; empty array = worldwide per the record. */
  territories: string[];
  permittedUse: PermittedUse[];
  commercialUse: boolean;
  maxDurationSec?: number;
  licenseExpiresAt?: number;
  fingerprintRef?: string;
  restrictions?: string;
}

/* ------------------------------ usage evaluation ------------------------------ */

export type UseDecision =
  | {
      action: "allow";
      /** The record that permits this use — displayed verbatim in the composer. */
      record: MusicRecord;
    }
  | {
      action: "deny";
      error:
        | "no_record" // no music record exists — we cannot claim any permission
        | "status_not_licensable" // restricted / copyright_detected / removed / disputed
        | "use_not_permitted"
        | "territory_not_covered"
        | "duration_exceeds_license"
        | "license_expired"
        | "commercial_use_not_permitted";
      /** The record when one exists (so the UI can show WHY it was denied). */
      record?: MusicRecord;
      /** Human-readable restriction text when the record has one. */
      restrictions?: string;
    };

/** Statuses that can ever permit a post. Fail-closed list — anything else denies. */
const LICENSABLE: ReadonlySet<MusicLicensingStatus> = new Set([
  "densen_licensed",
  "platform_licensed",
  "user_owned",
  "user_licensed",
  "restricted", // allowed ONLY inside its own restrictions — the checks below enforce that
]);

/**
 * Evaluate a planned use against a track's REAL permission record.
 * Order matters: status → expiry → territory → permitted use → commercial →
 * duration cap. Every deny carries the record so the UI can show the actual
 * restriction, never a generic message.
 *
 * NO SAFE-SECOND RULE: duration is checked against the track's own
 * maxDurationSec when the license sets one. There is no default allowance.
 */
export function evaluateMusicUse(input: {
  record: MusicRecord | undefined | null;
  use: UseKind;
  /** ISO-3166 alpha-2 where the content will be available. */
  territory: string;
  /** Planned audio duration in seconds (the uploaded clip's length). */
  durationSec: number;
  now: number;
}): UseDecision {
  const rec = input.record;
  if (!rec) return { action: "deny", error: "no_record" };

  if (!LICENSABLE.has(rec.licensingStatus)) {
    return { action: "deny", error: "status_not_licensable", record: rec, restrictions: rec.restrictions };
  }

  if (rec.licenseExpiresAt !== undefined && input.now >= rec.licenseExpiresAt) {
    return { action: "deny", error: "license_expired", record: rec, restrictions: rec.restrictions };
  }

  if (rec.territories.length > 0 && !rec.territories.includes(input.territory)) {
    return { action: "deny", error: "territory_not_covered", record: rec, restrictions: rec.restrictions };
  }

  if (!rec.permittedUse.includes(input.use)) {
    return { action: "deny", error: "use_not_permitted", record: rec, restrictions: rec.restrictions };
  }

  if (input.use === "commercial_post" || input.use === "monetized_post") {
    if (!rec.commercialUse) {
      return { action: "deny", error: "commercial_use_not_permitted", record: rec, restrictions: rec.restrictions };
    }
  }

  if (rec.maxDurationSec !== undefined && input.durationSec > rec.maxDurationSec) {
    return { action: "deny", error: "duration_exceeds_license", record: rec, restrictions: rec.restrictions };
  }

  return { action: "allow", record: rec };
}

/* ------------------------------ composer sorting ------------------------------ */

/**
 * Composer audio list order: DENSEN-approved first (densen/platform licensed),
 * then user-owned/licensed, then restricted, never the blocked statuses.
 * Within a group: no-expiry before expiring, then by title. This is the
 * "prefer DENSEN-approved music" rule as a pure, tested function.
 */
export function sortForComposer<T extends MusicRecord>(records: T[]): T[] {
  const tier = (r: MusicRecord): number => {
    if (r.licensingStatus === "densen_licensed") return 0;
    if (r.licensingStatus === "platform_licensed") return 1;
    if (r.licensingStatus === "user_owned" || r.licensingStatus === "user_licensed") return 2;
    return 3; // restricted
  };
  return records
    .filter((r) => LICENSABLE.has(r.licensingStatus))
    .slice()
    .sort((a, b) => {
      const ta = tier(a);
      const tb = tier(b);
      if (ta !== tb) return ta - tb;
      // No-expiry (MAX) before expiring; within expiring, longer-lived first.
      const ea = a.licenseExpiresAt ?? Number.MAX_SAFE_INTEGER;
      const eb = b.licenseExpiresAt ?? Number.MAX_SAFE_INTEGER;
      if (ea !== eb) return eb - ea;
      return a.title.localeCompare(b.title);
    });
}

/* ------------------------------ claim state machine ------------------------------ */

export type ClaimStatus =
  | "submitted"
  | "notified"
  | "restricted"
  | "audio_replaced"
  | "audio_removed"
  | "content_removed"
  | "under_review"
  | "resolved"
  | "rejected";

/**
 * The claim flow the brief requires, as a closed transition table.
 * Detect/receive → notify → restrict if appropriate → replace audio →
 * remove audio → remove content → dispute. `under_review` is the staff
 * engagement step; resolved/rejected are terminal.
 *
 * NOTE: these are CONTAINMENT actions (protect rights holders while humans
 * review). None of them is a legal determination — only staff can move a
 * claim to resolved/rejected, and the wire layer audits every transition.
 */
const CLAIM_TRANSITIONS: Readonly<Record<ClaimStatus, readonly ClaimStatus[]>> = {
  submitted: ["notified", "under_review", "rejected"],
  notified: ["restricted", "audio_replaced", "audio_removed", "content_removed", "under_review", "resolved"],
  restricted: ["audio_replaced", "audio_removed", "content_removed", "under_review", "resolved"],
  audio_replaced: ["audio_removed", "content_removed", "under_review", "resolved"],
  audio_removed: ["content_removed", "under_review", "resolved"],
  content_removed: ["under_review", "resolved"],
  under_review: ["resolved", "rejected", "notified"], // staff may loop back to notify (more info)
  resolved: [],
  rejected: [],
};

export function canTransitionClaim(from: ClaimStatus, to: ClaimStatus): boolean {
  return CLAIM_TRANSITIONS[from]?.includes(to) ?? false;
}

/** The containment action a status represents, for audit summaries. */
export function claimActionFor(status: ClaimStatus): string {
  switch (status) {
    case "submitted":
      return "claim_received";
    case "notified":
      return "uploader_notified";
    case "restricted":
      return "content_restricted_pending_review";
    case "audio_replaced":
      return "audio_replaced_with_approved_track";
    case "audio_removed":
      return "audio_removed";
    case "content_removed":
      return "content_removed";
    case "under_review":
      return "staff_review_started";
    case "resolved":
      return "claim_resolved";
    case "rejected":
      return "claim_rejected";
  }
}

/* ------------------------------ dispute state machine ------------------------------ */

export type DisputeReason = "i_own" | "i_have_license" | "original_audio" | "incorrect_claim" | "other";

export const DISPUTE_REASONS: readonly DisputeReason[] = [
  "i_own",
  "i_have_license",
  "original_audio",
  "incorrect_claim",
  "other",
] as const;

export type DisputeStatus =
  | "submitted"
  | "under_review"
  | "more_information"
  | "accepted"
  | "rejected"
  | "resolved";

const DISPUTE_TRANSITIONS: Readonly<Record<DisputeStatus, readonly DisputeStatus[]>> = {
  submitted: ["under_review", "more_information", "rejected"],
  under_review: ["more_information", "accepted", "rejected", "resolved"],
  more_information: ["under_review", "rejected"],
  accepted: ["resolved"],
  rejected: ["resolved"],
  resolved: [],
};

export function canTransitionDispute(from: DisputeStatus, to: DisputeStatus): boolean {
  return DISPUTE_TRANSITIONS[from]?.includes(to) ?? false;
}

/* ------------------------------ dispute submission rules ------------------------------ */

export type SubmitDisputeDecision =
  | { action: "submit" }
  | { action: "deny"; error: "unauthenticated" | "claim_not_found" | "not_affected_user" | "claim_closed" | "already_disputed" | "bad_reason" | "bad_statement" | "evidence_ref_invalid" };

/**
 * Who may dispute, and when:
 *   - only the affected uploader (server-resolved, never client-claimed),
 *   - while the claim is open (before resolved/rejected),
 *   - one dispute per claim (uniqueness enforced by the wire probe too),
 *   - evidence is media-module REFERENCES only — the client can never pass
 *     arbitrary URLs (sanitizeEvidenceRef mirrors practice.sanitizeRef).
 */
export function decideSubmitDispute(input: {
  signedIn: boolean;
  claim: { status: ClaimStatus; affectedUserId?: string } | null;
  callerUserId: string;
  existingDispute: boolean;
  reason: unknown;
  statement: string;
  evidenceRefs: unknown[];
}): SubmitDisputeDecision {
  if (!input.signedIn) return { action: "deny", error: "unauthenticated" };
  const claim = input.claim;
  if (!claim) return { action: "deny", error: "claim_not_found" };
  if (!claim.affectedUserId || claim.affectedUserId !== input.callerUserId) {
    return { action: "deny", error: "not_affected_user" };
  }
  if (claim.status === "resolved" || claim.status === "rejected") {
    return { action: "deny", error: "claim_closed" };
  }
  if (input.existingDispute) return { action: "deny", error: "already_disputed" };
  if (typeof input.reason !== "string" || !(DISPUTE_REASONS as readonly string[]).includes(input.reason)) {
    return { action: "deny", error: "bad_reason" };
  }
  const st = input.statement.trim();
  if (st.length === 0 || st.length > 2000) return { action: "deny", error: "bad_statement" };
  for (const r of input.evidenceRefs) {
    if (sanitizeEvidenceRef(r) === undefined) return { action: "deny", error: "evidence_ref_invalid" };
  }
  return { action: "submit" };
}

/** Evidence refs are opaque media-module references, capped at 256 chars. */
export function sanitizeEvidenceRef(ref: unknown): string | undefined {
  if (typeof ref !== "string") return undefined;
  const t = ref.trim();
  if (t.length === 0 || t.length > 256) return undefined;
  // A URL is not a media-module reference — evidence must be uploaded through
  // the media pipeline, not hot-linked.
  if (/^https?:\/\//i.test(t)) return undefined;
  return t;
}

/* ------------------------------ sanitizers ------------------------------ */

export function sanitizeTerritory(x: unknown): string | undefined {
  if (typeof x !== "string") return undefined;
  const t = x.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(t) ? t : undefined;
}

/** Duration sanity for evaluateMusicUse inputs (0 … 1h). */
export function sanitizeDurationSec(x: unknown): number | undefined {
  if (typeof x !== "number" || !Number.isFinite(x)) return undefined;
  const n = Math.round(x);
  if (n < 0 || n > 3600) return undefined;
  return n;
}
