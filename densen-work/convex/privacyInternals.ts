/**
 * DENSEN — Privacy decision cores (pure, unit-tested).
 * =====================================================
 * Every Privacy Center mutation re-decides its input SERVER-side from the
 * caller's age band. The client's toggles are UX previews only — these
 * functions are the enforcement (mirrors `youthDefaultsFor` + the clamps in
 * `validateProfileEdit`). Unknown keys are rejected; nothing is trusted.
 */

export type MessagesFrom = "everyone" | "followers" | "none";
export type AgeBand = "child_u13" | "teen13_15" | "teen16_17" | "adult";
/** Coarse category (never the raw DOB): CHILD / TEEN / ADULT. */
export type AgeCategory = "child" | "teen" | "adult";

export function ageCategoryFromBand(band: AgeBand): AgeCategory {
  if (band === "adult") return "adult";
  if (band === "child_u13") return "child";
  return "teen";
}

const MESSAGES_FROM: readonly MessagesFrom[] = ["everyone", "followers", "none"];

export interface PrivacyPatch {
  privateAccount?: boolean;
  messagesFrom?: MessagesFrom;
  commentFilter?: boolean;
  discoverableByHandle?: boolean;
  showCity?: boolean;
  personalization?: boolean;
  mentionsFrom?: MessagesFrom;
  tagsFrom?: MessagesFrom;
  notificationsEnabled?: boolean;
}

export type PrivacyUpdateError = "empty" | "invalid_audience";

/**
 * Band-aware clamp. Minors can never LOOSEN a protection:
 *  - private/account stays private, city stays hidden, comment filter stays on;
 *  - "everyone" audiences clamp down (messagesFrom/mentions/tags);
 *  - under-13 additionally loses handle discoverability;
 *  - personalization is always off for minors (no profiling of children).
 */
export function decidePrivacyUpdate(
  patch: PrivacyPatch,
  band: AgeBand
): { ok: true; cleaned: PrivacyPatch } | { ok: false; error: PrivacyUpdateError } {
  const keys = Object.keys(patch) as (keyof PrivacyPatch)[];
  if (keys.length === 0) return { ok: false, error: "empty" };

  const clampAudience = (v: MessagesFrom | undefined, key: keyof PrivacyPatch): MessagesFrom | undefined => {
    if (v === undefined) return undefined;
    if (!MESSAGES_FROM.includes(v)) throw new TypeError(key as string);
    return band === "adult" ? v : v === "everyone" ? "followers" : v;
  };

  try {
    const cleaned: PrivacyPatch = {};
    if (patch.privateAccount !== undefined) cleaned.privateAccount = band === "adult" ? patch.privateAccount : true;
    const messagesFrom = clampAudience(patch.messagesFrom, "messagesFrom");
    if (messagesFrom !== undefined) cleaned.messagesFrom = messagesFrom;
    if (patch.commentFilter !== undefined) cleaned.commentFilter = band === "adult" ? patch.commentFilter : true;
    if (patch.discoverableByHandle !== undefined)
      cleaned.discoverableByHandle = band === "adult" || band === "teen16_17" ? patch.discoverableByHandle : false;
    if (patch.showCity !== undefined) cleaned.showCity = band === "adult" ? patch.showCity : false;
    if (patch.personalization !== undefined) cleaned.personalization = band === "adult" ? patch.personalization : false;
    const mentionsFrom = clampAudience(patch.mentionsFrom, "mentionsFrom");
    if (mentionsFrom !== undefined) cleaned.mentionsFrom = mentionsFrom;
    const tagsFrom = clampAudience(patch.tagsFrom, "tagsFrom");
    if (tagsFrom !== undefined) cleaned.tagsFrom = tagsFrom;
    if (patch.notificationsEnabled !== undefined) cleaned.notificationsEnabled = patch.notificationsEnabled;
    return { ok: true, cleaned };
  } catch {
    return { ok: false, error: "invalid_audience" };
  }
}

/* ------------------------------ consents ------------------------------ */

/** Consent vocabulary — superset of the client's `ConsentType` mock vocabulary. */
export const CONSENT_TYPES = [
  "terms",
  "privacy",
  "guidelines",
  "marketing_email",
  "personalization",
  "content_license",
  "music_rights",
  "cookies",
  "purchase_terms",
] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

/** Optional consents a MINOR can never grant (no profiling / no licensing by children). */
const MINOR_DENIED: readonly ConsentType[] = ["marketing_email", "personalization", "content_license", "music_rights"];

export type ConsentError = "unknown_type" | "minor_denied";

export function decideConsentRecord(
  type: string,
  granted: boolean,
  band: AgeBand
): { ok: true } | { ok: false; error: ConsentError } {
  if (!(CONSENT_TYPES as readonly string[]).includes(type)) return { ok: false, error: "unknown_type" };
  if (!granted) return { ok: true }; // withdrawal is always allowed
  if (band !== "adult" && MINOR_DENIED.includes(type as ConsentType)) return { ok: false, error: "minor_denied" };
  return { ok: true };
}

/**
 * Required legal acceptances captured at signup — versions resolved through
 * the Day 19 legal document registry (single source of truth). Import is
 * lazy-typed: the registry is a pure const with zero Convex dependencies, so
 * this import stays dependency-free for unit tests.
 */
import { consentDocVersion } from "./legal";

export const SIGNUP_CONSENT_VERSIONS: Record<"terms" | "privacy" | "guidelines", string> = {
  get terms() { return consentDocVersion("terms"); },
  get privacy() { return consentDocVersion("privacy"); },
  get guidelines() { return consentDocVersion("guidelines"); },
};

/** Server-pinned policy version per consent type — the client never picks it.
 *  Day 19: resolves through the legal document registry (single truth). */
export function consentVersionFor(type: ConsentType): string {
  switch (type) {
    case "terms":
      return SIGNUP_CONSENT_VERSIONS.terms;
    case "privacy":
    case "marketing_email":
    case "personalization":
    case "content_license":
      return SIGNUP_CONSENT_VERSIONS.privacy;
    case "guidelines":
      return SIGNUP_CONSENT_VERSIONS.guidelines;
    case "cookies":
      return consentDocVersion("cookies");
    case "purchase_terms":
      return consentDocVersion("refunds");
    case "music_rights":
      return consentDocVersion("copyright");
  }
}

/* --------------------------- device permissions --------------------------- */

export const DEVICE_PERMISSIONS = ["camera", "microphone", "photos", "location", "notifications"] as const;
export type DevicePermission = (typeof DEVICE_PERMISSIONS)[number];
export type DevicePermissionState = "unknown" | "granted" | "denied" | "blocked";

export function decidePermissionRecord(
  permission: string,
  state: string
): { ok: true } | { ok: false; error: "unknown_permission" | "unknown_state" } {
  if (!(DEVICE_PERMISSIONS as readonly string[]).includes(permission)) return { ok: false, error: "unknown_permission" };
  if (!["unknown", "granted", "denied", "blocked"].includes(state)) return { ok: false, error: "unknown_state" };
  return { ok: true };
}
