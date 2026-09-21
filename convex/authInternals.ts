/**
 * DENSEN — Auth decision core (pure, unit-testable)
 * =================================================
 * All registration logic that must be RIGHT lives here as pure functions:
 * validation, normalization, server-side age assurance, age-aware defaults,
 * and the fail-closed signup decision. The wire module (`auth.ts`) validates
 * at the boundary, resolves uniqueness server-side, then applies the decision
 * inside one transaction — client input is never trusted for any of it.
 *
 * Rules mirrored from the client (`src/data/governance.ts`): the age-band
 * thresholds and youth defaults MUST match — enforced by parity tests in
 * src/__tests__/auth.test.ts so the two can never silently diverge.
 */

/* ------------------------------------------------------------------ */
/*                        Input validation                             */
/* ------------------------------------------------------------------ */

/** RFC-5322-lite: local@domain.tld with sane character classes. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;
/** First/display name: letters (any script), spaces, hyphen, apostrophe; 1–40 chars. */
export const NAME_PATTERN = /^[\p{L}][\p{L}\s'.-]{0,39}$/u;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

/** Small embedded deny-list of breached/trivial passwords (fast, dependency-free). */
const PASSWORD_DENYLIST = new Set([
  "password", "password1", "password!", "passw0rd", "1234567890", "123456789",
  "qwertyuiop", "qwerty123", "letmein123", "iloveyou123", "admin123456",
  "welcome123", "football123", "abc123456", "dancer123", "densen123",
  "danceteacher", "superman123", "trustno1", "sunshine123",
]);

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export type PasswordCheck = { ok: true } | { ok: false; error: PasswordError };
export type PasswordError =
  | "too_short"
  | "too_long"
  | "no_letter"
  | "no_digit"
  | "breached";

/** Boundary password check. Policy: ≥10 chars, has a letter + digit, not trivially breached. */
export function checkPassword(pw: string): PasswordCheck {
  if (typeof pw !== "string") return { ok: false, error: "too_short" };
  if (pw.length < PASSWORD_MIN) return { ok: false, error: "too_short" };
  if (pw.length > PASSWORD_MAX) return { ok: false, error: "too_long" };
  if (!/\p{L}/u.test(pw)) return { ok: false, error: "no_letter" };
  if (!/\d/.test(pw)) return { ok: false, error: "no_digit" };
  if (PASSWORD_DENYLIST.has(pw.toLowerCase())) return { ok: false, error: "breached" };
  return { ok: true };
}

/** Never weak enough to accept: uppercase map of policy errors for the wire layer. */
export function assertPassword(pw: string): void {
  const c = checkPassword(pw);
  if (!c.ok) throw new Error(`INVALID_PASSWORD:${c.error}`);
}

/* ------------------------------------------------------------------ */
/*        Age assurance — server-side derivation from DOB              */
/* ------------------------------------------------------------------ */

/** Schema enum: closed union on `users.ageBand`. */
export type ServerAgeBand = "child_u13" | "teen13_15" | "teen16_17" | "adult";

/**
 * Exact port of the client `ageBand()` (`src/data/governance.ts`), mapped to
 * the schema's band vocabulary. DOB is ISO "YYYY-MM-DD" (validated upstream).
 * A malformed/unreasonable DOB fails closed to a deny — never silently "adult".
 */
export function ageBandFromDob(dob: string, now: Date): { band: ServerAgeBand; ageYears: number } | { error: "invalid_dob" } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return { error: "invalid_dob" };
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const day = new Date(Date.UTC(y, mo - 1, d));
  // Full validation: must be a real calendar date.
  if (day.getUTCFullYear() !== y || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) return { error: "invalid_dob" };
  // Calendar age — EXACT port of the client `ageBand()` arithmetic so the
  // bands can never diverge (a day-difference approximation mislabels the
  // exact birthday; parity is enforced by tests in src/__tests__/auth.test.ts).
  let ageYears = now.getFullYear() - y;
  const monthDelta = now.getMonth() - (mo - 1);
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < d)) ageYears--;
  if (ageYears < 0) return { error: "invalid_dob" }; // future DOB
  if (ageYears > 120) return { error: "invalid_dob" }; // unreasonable
  // Client parity: `age < 13 → under13`, `< 16 → teen13_15`, `< 18 → teen16_17`.
  if (ageYears < 13) return { band: "child_u13", ageYears };
  if (ageYears < 16) return { band: "teen13_15", ageYears };
  if (ageYears < 18) return { band: "teen16_17", ageYears };
  return { band: "adult", ageYears };
}

/* ------------------------------------------------------------------ */
/*          Age-aware defaults (server-authoritative port)             */
/* ------------------------------------------------------------------ */

/**
 * Maps the client `ageAwareDefaults` to the schema's `privacySettings` +
 * `profiles` reuse-control fields. Youth safety is applied SERVER-side at
 * creation — a crafted client can never register an under-16 public account.
 */
export interface YouthDefaults {
  privateAccount: boolean;
  messagesFrom: "everyone" | "followers" | "none";
  showCity: boolean;
  discoverableByHandle: boolean;
  commentFilter: boolean;
  allowDuet: boolean;
  allowRemix: boolean;
  allowDownloads: boolean;
}

export function youthDefaultsFor(band: ServerAgeBand): YouthDefaults {
  // Mirrors ageAwareDefaults(): adults get social defaults; 16–17 private but
  // discoverable; under 16 private + non-discoverable + no stranger messaging.
  if (band === "adult") {
    return { privateAccount: false, messagesFrom: "followers", showCity: false, discoverableByHandle: true, commentFilter: false, allowDuet: true, allowRemix: true, allowDownloads: true };
  }
  if (band === "teen16_17") {
    return { privateAccount: true, messagesFrom: "followers", showCity: false, discoverableByHandle: true, commentFilter: true, allowDuet: false, allowRemix: false, allowDownloads: false };
  }
  return { privateAccount: true, messagesFrom: "none", showCity: false, discoverableByHandle: false, commentFilter: true, allowDuet: false, allowRemix: false, allowDownloads: false };
}

/* ------------------------------------------------------------------ */
/*                    The signup decision (fail-closed)                */
/* ------------------------------------------------------------------ */

export interface SignUpInput {
  firstName: string;
  handle: string;
  email: string;
  password: string;
  dob: string;
  /** Teacher INTENT only — creates a `pending` teacherProfiles row. It grants
   *  zero teacher privileges: the role flips only via admin verification. */
  wantsTeacher: boolean;
  /** Guardian of record for child accounts (youth-safety governance). */
  guardianName?: string;
  city?: string;
}

export interface Uniqueness {
  emailTaken: boolean;
  handleTaken: boolean;
}

export type SignUpDecision =
  | {
      ok: true;
      /** Exact rows the wire layer inserts in ONE transaction. */
      rows: {
        user: { email: string; dob: string; ageBand: ServerAgeBand; ageAssurance: "self_declared" | "parental_consent"; role: "user" | "teacher"; isMinor: boolean; status: "active"; emailVerifiedAt?: number; passwordUpdatedAt: number; createdAt: number; updatedAt: number };
        profile: { handle: string; displayName: string; styles: never[]; city?: string; isPrivate: boolean; allowRemix: boolean; allowDuet: boolean; allowDownloads: boolean; followerCount: 0; followingCount: 0; creditBalance: 0; createdAt: number; updatedAt: number };
        privacy: { privateAccount: boolean; messagesFrom: "everyone" | "followers" | "none"; showCity: boolean; discoverableByHandle: boolean; commentFilter: boolean; personalization: false; updatedAt: number };
        account: { provider: "password"; providerAccountId: string; emailVerified: false; createdAt: number; updatedAt: number };
      };
      isMinor: boolean;
      /** Teacher intent recorded as pending — only for adults; never a granted role. */
      teacherIntent: boolean;
    }
  | { ok: false; error: SignUpError };

export type SignUpError =
  | "invalid_first_name"
  | "invalid_handle"
  | "invalid_email"
  | "email_taken"
  | "handle_taken"
  | "invalid_password"
  | "password_breach"
  | "invalid_dob"
  | "guardian_required"
  | "guardian_invalid"
  | "teacher_intent_minor"
  | "invalid_city";

/** Reserved handles: impersonation and confusion prevention. */
const RESERVED_HANDLES = new Set(["admin", "administrator", "moderator", "densen", "densenacademy", "support", "help", "security", "safety", "teacher", "official", "root", "system"]);

/** Shared with the client (`src/pages/Auth.tsx`) so both ends enforce one rule. */
export const HANDLE_PATTERN = /^[a-z0-9_.]{3,24}$/;

/**
 * The single source of truth for what signup accepts. Unknown field shapes are
 * rejected before this is called (wire-layer `vObject`); THIS function decides
 * whether the account may be created and computes every stored row.
 */
export function decideSignUp(input: SignUpInput, uniqueness: Uniqueness, now: Date): SignUpDecision {
  const firstName = typeof input.firstName === "string" ? input.firstName.trim() : "";
  const handle = typeof input.handle === "string" ? input.handle.trim().toLowerCase() : "";
  const email = typeof input.email === "string" ? normalizeEmail(input.email) : "";
  const city = input.city ? String(input.city).trim() : undefined;

  if (!NAME_PATTERN.test(firstName)) return { ok: false, error: "invalid_first_name" };
  if (!HANDLE_PATTERN.test(handle) || RESERVED_HANDLES.has(handle)) return { ok: false, error: "invalid_handle" };
  if (!EMAIL_PATTERN.test(email) || email.length > 254) return { ok: false, error: "invalid_email" };
  if (uniqueness.emailTaken) return { ok: false, error: "email_taken" };
  if (uniqueness.handleTaken) return { ok: false, error: "handle_taken" };

  const pw = checkPassword(input.password);
  if (!pw.ok) {
    return { ok: false, error: pw.error === "breached" ? "password_breach" : "invalid_password" };
  }

  const band = ageBandFromDob(input.dob, now);
  if ("error" in band) return { ok: false, error: "invalid_dob" };
  const defaults = youthDefaultsFor(band.band);

  const isMinor = band.band !== "adult";

  // Guardian of record is required for child accounts (youth-safety rule).
  if (band.band === "child_u13") {
    const g = (input.guardianName ?? "").trim();
    if (!g) return { ok: false, error: "guardian_required" };
    if (!NAME_PATTERN.test(g)) return { ok: false, error: "guardian_invalid" };
  }

  // A minor cannot even APPLY to become a teacher at registration.
  if (input.wantsTeacher && isMinor) return { ok: false, error: "teacher_intent_minor" };

  // Approximate city only, user-chosen; minors' city is hidden by the privacy
  // defaults above regardless (showCity: false).
  if (city !== undefined && (city.length < 2 || city.length > 60)) return { ok: false, error: "invalid_city" };

  const ts = now.getTime();
  return {
    ok: true,
    isMinor,
    teacherIntent: input.wantsTeacher,
    rows: {
      user: {
        email,
        dob: input.dob,
        ageBand: band.band,
        ageAssurance: band.band === "child_u13" ? "parental_consent" : "self_declared",
        role: "user", // NEVER "teacher" from signup — verification grants that
        isMinor,
        status: "active",
        passwordUpdatedAt: ts,
        createdAt: ts,
        updatedAt: ts,
      },
      profile: {
        handle,
        displayName: firstName,
        styles: [],
        city: city !== undefined && city.length > 0 ? city : undefined,
        isPrivate: defaults.privateAccount,
        allowRemix: defaults.allowRemix,
        allowDuet: defaults.allowDuet,
        allowDownloads: defaults.allowDownloads,
        followerCount: 0,
        followingCount: 0,
        creditBalance: 0,
        createdAt: ts,
        updatedAt: ts,
      },
      privacy: {
        privateAccount: defaults.privateAccount,
        messagesFrom: defaults.messagesFrom,
        showCity: defaults.showCity,
        discoverableByHandle: defaults.discoverableByHandle,
        commentFilter: defaults.commentFilter,
        personalization: false,
        updatedAt: ts,
      },
      account: {
        provider: "password",
        providerAccountId: email,
        emailVerified: false,
        createdAt: ts,
        updatedAt: ts,
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/*      Password hashing — PBKDF2-SHA256 via Web Crypto (server)       */
/* ------------------------------------------------------------------ */

export const PBKDF2_ITERATIONS = 100_000; // OWASP-floor for PBKDF2-HMAC-SHA256

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function subtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) throw new Error("CRYPTO_UNAVAILABLE");
  return c.subtle;
}

/**
 * Hash a password server-side. Format: `pbkdf2-sha256$<iters>$<saltB64>$<hashB64>`
 * (self-describing, upgradeable). Runs inside Convex mutations via Web Crypto —
 * the plaintext password never leaves the function and is never stored or logged.
 */
export async function hashPassword(password: string, iterations: number = PBKDF2_ITERATIONS): Promise<string> {
  const enc = new TextEncoder();
  const salt = new Uint8Array(16);
  (globalThis as { crypto: Crypto }).crypto.getRandomValues(salt);
  const key = await subtle().importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as unknown as BufferSource, iterations }, key, 256);
  return `pbkdf2-sha256$${iterations}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

/** Constant-time byte comparison (no early exit on mismatch). */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Verify a password against a stored hash. Never throws on bad format — returns false. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [algo, iters, saltB64, hashB64] = stored.split("$");
    if (algo !== "pbkdf2-sha256") return false;
    const iterations = Number(iters);
    if (!Number.isInteger(iterations) || iterations < 1) return false;
    const enc = new TextEncoder();
    const key = await subtle().importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await subtle().deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: unb64(saltB64) as unknown as BufferSource, iterations },
      key,
      256
    );
    return timingSafeEqual(new Uint8Array(bits), unb64(hashB64));
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*                    One-time verification tokens                     */
/* ------------------------------------------------------------------ */

/** 32 random bytes → URL-safe token. The raw token exists only in memory/email. */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  (globalThis as { crypto: Crypto }).crypto.getRandomValues(bytes);
  return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 hex of a token — the ONLY form ever persisted. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await subtle().digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Token TTLs. Reset tokens are deliberately shorter-lived than verify tokens. */
export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 60m

/**
 * Single-consume check. A token is usable only if unexpired AND unconsumed —
 * the wire layer sets `consumedAt` in the same transaction it consumes it.
 */
export function tokenUsable(row: { tokenHash: string; expiresAt: number; consumedAt?: number }, now: number): boolean {
  return row.consumedAt === undefined && row.expiresAt > now;
}

/* ------------------------------------------------------------------ */
/*                 Login attempt throttling (pure core)                */
/* ------------------------------------------------------------------ */

/** 5 failed attempts within 15 minutes locks the identifier for 15 more. */
export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

export function isLockedOut(recentFailures: number, now: number, lastFailureAt?: number): boolean {
  if (recentFailures < LOCKOUT_THRESHOLD) return false;
  if (lastFailureAt === undefined) return true;
  return now - lastFailureAt < LOCKOUT_WINDOW_MS;
}

export const __internals = { RESERVED_HANDLES, HANDLE_PATTERN, b64, unb64 };
