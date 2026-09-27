/**
 * DENSEN — Day 19 LEGAL + PRIVACY CENTER (pure decision core).
 * ============================================================
 * Zero Convex imports — every function is a pure function of its inputs so
 * unit tests cover the full behavior without a backend.
 *
 * What this core owns:
 *   1. LEGAL_DOC_REGISTRY — every legal document with Version / Effective date /
 *      Updated date / Published status. Consent records reference the version
 *      they accepted, resolved through this registry — never hardcoded.
 *   2. Deletion state machine — REQUESTED → PROCESSING → COMPLETED with a
 *      cooling-off window; COMPLETED is terminal and the erasure only happens
 *      after the window (the wire enforces the sequencing).
 *   3. Marketing email preferences — opt-in by default, transactional email can
 *      never be disabled, one canonical "marketing allowed" derivation, and
 *      unsubscribe tokens that can only unsubscribe (never subscribe).
 *   4. Data export — the shape and field-level privacy rules for "Download my
 *      data" (own data only; DOB/credentials are NEVER in the export).
 *   5. Business information — operator-configurable fields ONLY. No company
 *      number, VAT number, legal address or registered entity is invented;
 *      defaults are empty and the UI honestly shows "to be published" until an
 *      operator fills real, verified values.
 *
 * NOT LEGAL ADVICE: these systems are risk-reduction tooling. They do NOT make
 * DENSEN legally compliant. The final legal texts must be reviewed by qualified
 * lawyers for every jurisdiction DENSEN operates in before launch.
 */

// ---------------------------------------------------------------------------
// 1. Legal document registry
// ---------------------------------------------------------------------------

export type LegalDocId = "terms" | "privacy" | "refunds" | "cookies" | "community" | "copyright";
export type PublishStatus = "draft" | "published" | "retired";

export interface LegalDocRecord {
  docId: LegalDocId;
  /** Semver-ish policy version ("2.0"). Consent rows pin this exact string. */
  version: string;
  /** ISO date ("2026-09-18") — when this version takes effect. */
  effectiveDate: string;
  /** ISO date — when this version was last edited (may differ from effective). */
  updatedDate: string;
  /** Only "published" documents are shown as current and consentable. */
  published: PublishStatus;
  /** Human summary of what changed (bilingual surfaces add translations). */
  changeSummary?: string;
}

/**
 * The registry. Version/effective/updated/published are CONFIGURATION here —
 * an operator edits this table (and the rendered text) per release; consent
 * records always resolve their version through it. No fictional entity data
 * lives in the documents themselves: contact/business fields come from the
 * operator-configured BusinessInfo (empty until filled).
 */
export const LEGAL_DOC_REGISTRY: Record<LegalDocId, LegalDocRecord> = {
  terms: { docId: "terms", version: "2.1", effectiveDate: "2026-09-26", updatedDate: "2026-09-26", published: "published", changeSummary: "Day 19 restructure — operator-filled business info referenced instead of placeholder entity data." },
  privacy: { docId: "privacy", version: "2.1", effectiveDate: "2026-09-26", updatedDate: "2026-09-26", published: "published", changeSummary: "Day 19 restructure — deletion states, data export and unsubscribe flows documented." },
  refunds: { docId: "refunds", version: "1.1", effectiveDate: "2026-09-26", updatedDate: "2026-09-26", published: "published" },
  cookies: { docId: "cookies", version: "1.1", effectiveDate: "2026-09-26", updatedDate: "2026-09-26", published: "published" },
  community: { docId: "community", version: "1.1", effectiveDate: "2026-09-18", updatedDate: "2026-09-18", published: "published" },
  copyright: { docId: "copyright", version: "1.0", effectiveDate: "2026-09-18", updatedDate: "2026-09-18", published: "published" },
};

export const LEGAL_DOC_IDS: LegalDocId[] = ["terms", "privacy", "refunds", "cookies", "community", "copyright"];

/** The version a consent of this type must reference (server-pinned). */
export function activeDocVersion(docId: LegalDocId): string {
  return LEGAL_DOC_REGISTRY[docId].version;
}

export interface DocProjection {
  docId: LegalDocId;
  version: string;
  effectiveDate: string;
  updatedDate: string;
  published: PublishStatus;
  /** True when guests/consent flows may rely on this document. */
  isCurrent: boolean;
  changeSummary?: string;
}

/** Public projection of the registry (guest-safe — no draft internals). */
export function projectLegalDocs(): DocProjection[] {
  return LEGAL_DOC_IDS.map((id) => {
    const r = LEGAL_DOC_REGISTRY[id];
    return {
      docId: id,
      version: r.version,
      effectiveDate: r.effectiveDate,
      updatedDate: r.updatedDate,
      published: r.published,
      isCurrent: r.published === "published",
      changeSummary: r.changeSummary,
    };
  });
}

/** Consent-type → which document's version the consent must pin. */
export type ConsentDocType = "terms" | "privacy" | "guidelines" | "cookies" | "refunds" | "copyright";
export const CONSENT_TO_DOC: Record<ConsentDocType, LegalDocId> = {
  terms: "terms",
  privacy: "privacy",
  guidelines: "community",
  cookies: "cookies",
  refunds: "refunds",
  copyright: "copyright",
};

/**
 * FULL consent-type → document mapping (superset of CONSENT_TO_DOC): every
 * consent type in the platform resolves its version through the registry —
 * purchase consents pin the refunds doc, music consents pin the copyright doc,
 * profiling/licensing consents pin the privacy doc, and so on.
 */
export const CONSENT_TYPE_TO_DOC: Record<string, LegalDocId> = {
  terms: "terms",
  privacy: "privacy",
  guidelines: "community",
  cookies: "cookies",
  refunds: "refunds",
  copyright: "copyright",
  purchase_terms: "refunds",
  music_rights: "copyright",
  marketing_email: "privacy",
  personalization: "privacy",
  content_license: "privacy",
  account_deletion: "privacy",
};

/** Registry-resolved version for a consent type (falls back to privacy doc). */
export function consentDocVersion(consentType: string): string {
  const doc = CONSENT_TYPE_TO_DOC[consentType];
  return activeDocVersion(doc ?? "privacy");
}

// ---------------------------------------------------------------------------
// 2. Deletion state machine — REQUESTED → PROCESSING → COMPLETED
// ---------------------------------------------------------------------------

export type DeletionState = "requested" | "processing" | "completed";

/** Cooling-off window: erasure executes only after it elapses. */
export const DELETION_COOLING_OFF_MS = 14 * 864e5;

export interface DeletionRequestRow {
  userId: string;
  status: DeletionState;
  /** When the current state was entered (ms epoch). */
  stateChangedAt: number;
  requestedAt: number;
  /** When erasure may execute (only meaningful once processing completes the window). */
  eligibleAt: number;
  /** Operator/system note appended on state changes (last note wins in lists). */
  note?: string;
  /** Set only when the state reaches completed. */
  completedAt?: number;
}

export type DeletionAdvanceError =
  | "no_request"
  | "invalid_transition"
  | "cooling_off_active";

/**
 * REQUESTED → PROCESSING: allowed anytime (staff/system marks processing).
 * PROCESSING → COMPLETED: allowed only once `now >= eligibleAt` (cooling-off).
 * COMPLETED is terminal — no transitions out (delete the row's history rule:
 * a fresh signup may open a NEW request, never mutate a completed one).
 */
export function decideDeletionAdvance(
  row: DeletionRequestRow | null,
  now: number
): { ok: true; next: DeletionState } | { ok: false; error: DeletionAdvanceError } {
  if (!row) return { ok: false, error: "no_request" };
  switch (row.status) {
    case "requested":
      return { ok: true, next: "processing" };
    case "processing":
      if (now < row.eligibleAt) return { ok: false, error: "cooling_off_active" };
      return { ok: true, next: "completed" };
    case "completed":
      return { ok: false, error: "invalid_transition" };
  }
}

/** The projection the user sees in the Privacy Center (own data). */
export interface DeletionProjection {
  status: DeletionState;
  requestedAt: number;
  /** ISO-ish countdown target for PROCESSING (null when not applicable). */
  eligibleAt: number | null;
  coolingOffRemainingMs: number | null;
  completedAt: number | null;
}

export function projectDeletion(row: DeletionRequestRow | null, now: number): DeletionProjection | null {
  if (!row) return null;
  // The eligibility horizon is fixed at REQUEST time (request + cooling-off);
  // it is meaningful from the moment the request exists. The countdown shows
  // while the request is open (requested/processing) and clears on completion.
  const remaining =
    row.status === "completed" ? null : Math.max(0, row.eligibleAt - now);
  return {
    status: row.status,
    requestedAt: row.requestedAt,
    eligibleAt: row.eligibleAt,
    coolingOffRemainingMs: remaining,
    completedAt: row.completedAt ?? null,
  };
}

/**
 * Data-erasure scope — what COMPLETED erasure removes per surface (informs the
 * UI copy and the wire's purge list; receipts/consent proofs may be retained
 * where accounting/consent law requires — flagged with `retain`).
 */
export const ERASURE_SCOPE: { surface: string; outcome: "erase" | "retain"; why?: string }[] = [
  { surface: "profile", outcome: "erase" },
  { surface: "videos_and_media", outcome: "erase" },
  { surface: "posts_and_comments", outcome: "erase" },
  { surface: "messages", outcome: "erase", why: "removed from the deleted account's side; copies on recipients' devices are outside platform control" },
  { surface: "practice_and_progress", outcome: "erase" },
  { surface: "notifications", outcome: "erase" },
  { surface: "consent_history", outcome: "retain", why: "proof-of-consent retention where the law requires it (minimal fields only)" },
  { surface: "purchase_receipts", outcome: "retain", why: "accounting-law retention; amounts and refs only, no behavioral data" },
];

// ---------------------------------------------------------------------------
// 3. Marketing email preferences + unsubscribe
// ---------------------------------------------------------------------------

export interface MarketingPrefs {
  productUpdates: boolean;
  classes: boolean;
  challenges: boolean;
  events: boolean;
  promotions: boolean;
  teacherUpdates: boolean;
}

/** Opt-in by default — marketing is a choice, never a preset. */
export const DEFAULT_MARKETING_PREFS: MarketingPrefs = {
  productUpdates: false,
  classes: false,
  challenges: false,
  events: false,
  promotions: false,
  teacherUpdates: false,
};

/** Consent gate for granting marketing email (minors can never opt in). */
export function decideMarketingGrant(band: "child_u13" | "teen13_15" | "teen16_17" | "adult", granted: boolean):
  | { ok: true }
  | { ok: false; error: "minor_denied" } {
  if (granted && band !== "adult") return { ok: false, error: "minor_denied" };
  return { ok: true };
}

/**
 * Transactional email is service-essential and can NEVER be disabled by
 * marketing prefs or an unsubscribe token.
 */
export const TRANSACTIONAL_EMAILS = [
  "purchase_confirmation",
  "password_reset",
  "security_alert",
  "account_deletion_confirmation",
] as const;
export type TransactionalEmail = (typeof TRANSACTIONAL_EMAILS)[number];

export function isTransactionalEmail(kind: string): boolean {
  return (TRANSACTIONAL_EMAILS as readonly string[]).includes(kind);
}

/**
 * The ONLY send gate for marketing email. Transactional kinds bypass it
 * (their own delivery rules apply); marketing kinds require BOTH the
 * category pref AND at least one general consent grant on file.
 */
export function decideMarketingSend(
  kind: string,
  prefs: MarketingPrefs,
  marketingConsentGranted: boolean
): { allowed: true } | { allowed: false; reason: "transactional_bypasses_gate" | "pref_off" | "no_marketing_consent" } {
  if (isTransactionalEmail(kind)) return { allowed: false, reason: "transactional_bypasses_gate" };
  if (!marketingConsentGranted) return { allowed: false, reason: "no_marketing_consent" };
  const on = prefs[kind as keyof MarketingPrefs];
  if (!on) return { allowed: false, reason: "pref_off" };
  return { allowed: true };
}

/** "Marketing allowed" = consent grant AND any category on. */
export function anyMarketingEmail(prefs: MarketingPrefs, marketingConsentGranted: boolean): boolean {
  return marketingConsentGranted && Object.values(prefs).some(Boolean);
}

/** Unsubscribe tokens: 43 chars of URL-safe entropy, stored as sha-256 hex. */
export function generateUnsubscribeToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 43);
}

export type UnsubscribeScope = "all" | "promotions" | "productUpdates" | "classes" | "challenges" | "events" | "teacherUpdates";

/**
 * Apply an unsubscribe click. Tokens can only UNSUBSCRIBE — a leaked link can
 * never grant marketing consent back (that requires a signed-in consent flow).
 */
export function applyUnsubscribe(prefs: MarketingPrefs, scope: UnsubscribeScope): MarketingPrefs {
  if (scope === "all") return { ...DEFAULT_MARKETING_PREFS };
  return { ...prefs, [scope]: false };
}

// ---------------------------------------------------------------------------
// 4. Data export ("Download my data")
// ---------------------------------------------------------------------------

export interface ExportFieldRule {
  field: string;
  included: boolean;
  /** Why an excluded field stays out (transparency in the export manifest). */
  reason?: string;
}

/**
 * Field-level privacy rules for the export. Own data only; the DOB is never
 * in the export (age band is, as the non-reversible minimization), and
 * credential/session material is structurally excluded.
 */
export const EXPORT_FIELD_RULES: Record<string, ExportFieldRule> = {
  email: { field: "email", included: true },
  handle: { field: "handle", included: true },
  display_name: { field: "display_name", included: true },
  bio: { field: "bio", included: true },
  styles: { field: "styles", included: true },
  city: { field: "city", included: true },
  age_band: { field: "age_band", included: true, reason: "age minimization — DOB itself is never exported" },
  dob: { field: "dob", included: false, reason: "age minimization — the export carries the derived age band only" },
  secret_hash: { field: "secret_hash", included: false, reason: "credential material is never exportable" },
  session_tokens: { field: "session_tokens", included: false, reason: "session secrets are never exportable" },
  verification_docs: { field: "verification_docs", included: false, reason: "teacher verification document refs stay staff-only" },
};

export interface ExportSectionRule {
  section: string;
  included: boolean;
}

/** Top-level sections of the export bundle. */
export const EXPORT_SECTIONS: ExportSectionRule[] = [
  { section: "account", included: true },
  { section: "profile", included: true },
  { section: "privacy_settings", included: true },
  { section: "consent_history", included: true },
  { section: "marketing_prefs", included: true },
  { section: "device_permissions", included: true },
  { section: "posts", included: true },
  { section: "messages_sent", included: true },
  { section: "practice_progress", included: true },
  { section: "purchases_receipts", included: true },
  { section: "blocked_muted", included: true },
  { section: "deletion_requests", included: true },
  { section: "other_users_data", included: false },
  { section: "audit_logs_about_me", included: true },
];

/** Every included field must be included in an included section (manifest rule). */
export function exportManifest(): { sections: string[]; excludedFields: { field: string; reason: string }[] } {
  return {
    sections: EXPORT_SECTIONS.filter((s) => s.included).map((s) => s.section),
    excludedFields: Object.values(EXPORT_FIELD_RULES)
      .filter((f) => !f.included)
      .map((f) => ({ field: f.field, reason: f.reason ?? "excluded" })),
  };
}

/** Shape of the export bundle (wire fills the data; core pins the envelope). */
export interface DataExport {
  generatedAt: number;
  formatVersion: 1;
  sections: Record<string, unknown>;
  manifest: { sections: string[]; excludedFields: { field: string; reason: string }[] };
}

export function buildExportEnvelope(sections: Record<string, unknown>, now: number): DataExport {
  return { generatedAt: now, formatVersion: 1, sections, manifest: exportManifest() };
}

// ---------------------------------------------------------------------------
// 5. Business information (operator-configured — never invented)
// ---------------------------------------------------------------------------

export interface BusinessInfo {
  /** Registered legal entity name — operator fills; empty until verified. */
  legalName: string;
  /** Registered address — operator fills; empty until verified. */
  legalAddress: string;
  /** Company/registration number — operator fills; empty until verified. */
  companyNumber: string;
  /** VAT number — operator fills; empty until verified. */
  vatNumber: string;
  /** Public contact email. */
  contactEmail: string;
  /** Support email. */
  supportEmail: string;
  /** Privacy contact. */
  privacyEmail: string;
}

/** ALL empty by default — no company number, VAT, address or entity is invented. */
export const EMPTY_BUSINESS_INFO: BusinessInfo = {
  legalName: "",
  legalAddress: "",
  companyNumber: "",
  vatNumber: "",
  contactEmail: "",
  supportEmail: "",
  privacyEmail: "",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type BusinessUpdateError = "bad_email" | "field_too_long";

/** Operator-only update validation (emails must look like emails; lengths capped). */
export function decideBusinessUpdate(
  patch: Partial<BusinessInfo>
): { ok: true; cleaned: Partial<BusinessInfo> } | { ok: false; error: BusinessUpdateError } {
  const cleaned: Partial<BusinessInfo> = {};
  for (const [key, raw] of Object.entries(patch)) {
    if (raw === undefined) continue;
    const value = String(raw).trim();
    if (value.length > 300) return { ok: false, error: "field_too_long" };
    if (key.endsWith("Email") && value.length > 0 && !EMAIL_RE.test(value)) return { ok: false, error: "bad_email" };
    (cleaned as Record<string, unknown>)[key] = value;
  }
  return { ok: true, cleaned };
}

/** The public page may only render fields the operator actually verified. */
export function businessIsComplete(b: BusinessInfo): boolean {
  return Boolean(b.legalName.trim() && b.contactEmail.trim() && b.supportEmail.trim());
}

/** Legal-document contact paragraph: shows placeholders honestly until filled. */
export function docContactLine(b: BusinessInfo, defaultContact: string): string {
  return b.contactEmail || defaultContact;
}

/** A doc version is consentable only when published. */
export function docIsConsentable(docId: LegalDocId): boolean {
  return LEGAL_DOC_REGISTRY[docId].published === "published";
}
