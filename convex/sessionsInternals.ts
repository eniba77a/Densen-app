/**
 * DENSEN — Sessions & credential-flow decision core (pure, unit-testable).
 * =========================================================================
 * Day 2 half of AUTH-PLAN.md §3: everything that must be RIGHT about sessions
 * and password flows, decided here as pure functions; `convex/auth.ts` wires
 * it. No Convex/DB types leak in — runs in Node/vitest for unit tests.
 */
import {
  isLockedOut,
  checkPassword,
} from "./authInternals";

/* ---------------- session windows ---------------- */

/** Sliding 30-day session; renewed only after 5 days of inactivity. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_RENEW_AFTER_MS = 5 * 24 * 60 * 60 * 1000;

/** A session is usable only while unrevoked and unexpired. */
export function sessionValid(row: { expiresAt: number; revokedAt?: number }, now: number): boolean {
  return row.revokedAt === undefined && row.expiresAt > now;
}

/** Renewal is best-effort: sessions older than the renew threshold get extended. */
export function sessionRenewFrom(row: { issuedAt: number }, now: number): number | undefined {
  return now - row.issuedAt > SESSION_RENEW_AFTER_MS ? now + SESSION_TTL_MS : undefined;
}

/* ---------------- credential verification decisions ---------------- */

export interface CredentialRow {
  secretHash: string;
  emailVerified: boolean;
  userStatus: "active" | "restricted" | "suspended" | "deleted";
  emailVerifiedAt?: number;
  userPasswordUpdatedAt: number;
}

/**
 * The single decision point for sign-in. Order matters: lockout → account
 * state → credential. Unknown-email and bad-password produce the SAME
 * latency shape; the returned outcome distinguishes them only internally —
 * the wire layer records the precise reason in `loginAttempts` (server-side
 * data, never returned to the client) and replies with one generic error.
 */
export type SignInDenyReason =
  | "locked"
  | "no_account"
  | "bad_password"
  | "account_suspended"
  | "account_deleted";

/**
 * The single decision point for sign-in. Order matters: lockout → account
 * state → credential. Unknown-email and bad-password produce the SAME latency
 * shape; the precise reason is recorded server-side in `loginAttempts` and is
 * never returned to the client (one generic error for both).
 */
export function decideSignIn(
  passwordOk: boolean,
  cred: CredentialRow | null,
  lock: { failures: number; lastFailureAt?: number },
  now: number
): { ok: true; renewTo?: number } | { ok: false; reason: SignInDenyReason } {
  if (isLockedOut(lock.failures, now, lock.lastFailureAt)) return { ok: false, reason: "locked" };
  if (!cred) return { ok: false, reason: "no_account" };
  if (cred.userStatus === "suspended") return { ok: false, reason: "account_suspended" };
  if (cred.userStatus === "deleted") return { ok: false, reason: "account_deleted" };
  if (!passwordOk) return { ok: false, reason: "bad_password" };
  return { ok: true };
}

/* ---------------- one-time token consumption ---------------- */

export interface TokenRow {
  tokenHash: string;
  expiresAt: number;
  consumedAt?: number;
}

/** Single-consume: a token is usable only while unexpired and unconsumed. */
export function tokenConsumable(row: TokenRow | undefined, now: number): boolean {
  return row !== undefined && row.consumedAt === undefined && row.expiresAt > now;
}

/* ---------------- password change ---------------- */

export type ChangePasswordDecision =
  | { ok: true }
  | { ok: false; error: "wrong_current" | "same_password" | "policy" };

/** Must know the current password; the new one must differ and meet policy. */
export function decideChangePassword(
  currentOk: boolean,
  newPassword: string,
  currentPassword: string
): ChangePasswordDecision {
  if (!currentOk) return { ok: false, error: "wrong_current" };
  if (newPassword === currentPassword) return { ok: false, error: "same_password" };
  if (!checkPassword(newPassword).ok) return { ok: false, error: "policy" };
  return { ok: true };
}

/* ---------------- profile edit (owner-only fields) ---------------- */

export const BIO_MAX = 280;
export const DISPLAY_NAME_MAX = 40;
export const CITY_MAX = 60;
export const STYLE_MAX_COUNT = 12;
export const STYLE_MAX_LEN = 24;
export const LEVELS = ["beginner", "intermediate", "advanced", "pro"] as const;

export type ProfileEditInput = {
  displayName?: string;
  bio?: string;
  city?: string;
  level?: string;
  styles?: string[];
  isPrivate?: boolean;
  allowRemix?: boolean;
  allowDuet?: boolean;
  allowDownloads?: boolean;
};

export type ProfileEditError =
  | "empty"
  | "display_name"
  | "bio"
  | "city"
  | "level"
  | "styles";

/**
 * Validates owner-editable profile fields and CLAMPS age-unsafe values:
 * minors can never loosen privacy/reuse defaults (youth safety is not
 * client-optional). Unknown fields never reach here — the boundary vObject
 * rejects them (mass-assignment protection).
 */
export function validateProfileEdit(
  input: ProfileEditInput,
  isMinor: boolean
): { ok: true; cleaned: ProfileEditInput } | { ok: false; error: ProfileEditError } {
  const keys = Object.keys(input) as (keyof ProfileEditInput)[];
  if (keys.length === 0) return { ok: false, error: "empty" };
  const cleaned: ProfileEditInput = {};

  if (input.displayName !== undefined) {
    const name = input.displayName.trim();
    if (name.length < 1 || name.length > DISPLAY_NAME_MAX) return { ok: false, error: "display_name" };
    cleaned.displayName = name;
  }
  if (input.bio !== undefined) {
    const bio = input.bio.trim();
    if (bio.length > BIO_MAX) return { ok: false, error: "bio" };
    cleaned.bio = bio; // empty string clears the bio
  }
  if (input.city !== undefined) {
    // Data minimization for minors: approximate city is collected only from adults.
    if (isMinor) return { ok: false, error: "city" };
    const city = input.city.trim();
    if (city.length === 0) cleaned.city = ""; // clears
    else if (city.length < 2 || city.length > CITY_MAX) return { ok: false, error: "city" };
    else cleaned.city = city;
  }
  if (input.level !== undefined) {
    const level = input.level.trim();
    if (level.length === 0) cleaned.level = ""; // clears
    else if (!(LEVELS as readonly string[]).includes(level)) return { ok: false, error: "level" };
    else cleaned.level = level;
  }
  if (input.styles !== undefined) {
    const styles = input.styles.map((s) => s.trim()).filter((s) => s.length > 0);
    if (styles.length > STYLE_MAX_COUNT) return { ok: false, error: "styles" };
    for (const s of styles) if (s.length > STYLE_MAX_LEN) return { ok: false, error: "styles" };
    cleaned.styles = styles;
  }
  if (input.isPrivate !== undefined) cleaned.isPrivate = isMinor ? true : input.isPrivate;
  if (input.allowRemix !== undefined) cleaned.allowRemix = isMinor ? false : input.allowRemix;
  if (input.allowDuet !== undefined) cleaned.allowDuet = isMinor ? false : input.allowDuet;
  if (input.allowDownloads !== undefined) cleaned.allowDownloads = isMinor ? false : input.allowDownloads;

  return { ok: true, cleaned };
}

/* ---------------- teacher verification state machine ---------------- */

export type VerificationDecision = "approve" | "reject";

/**
 * PENDING → VERIFIED | REJECTED only, only by admin decision. Any other
 * transition is invalid — users can never self-verify, and rejected/revoked
 * rows must re-apply through a fresh pending row.
 */
export function decideVerification(
  currentStatus: string,
  decision: VerificationDecision
): { ok: true; next: "verified" | "rejected" } | { ok: false; error: "invalid_state" } {
  if (currentStatus !== "pending") return { ok: false, error: "invalid_state" };
  return { ok: true, next: decision === "approve" ? "verified" : "rejected" };
}
