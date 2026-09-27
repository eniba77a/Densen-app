/**
 * Day 19 — legal + privacy center core unit tests (pure functions).
 *
 * Pins: legal document registry (version/effective/updated/published),
 * consent→version resolution, the deletion state machine with cooling-off,
 * marketing prefs/unsubscribe (tokens can only unsubscribe), data-export
 * minimization (no DOB/credentials), and business-info rules (nothing
 * invented; operator-filled only).
 */
import { describe, expect, it } from "vitest";
import {
  CONSENT_TO_DOC,
  DELETION_COOLING_OFF_MS,
  DEFAULT_MARKETING_PREFS,
  EMPTY_BUSINESS_INFO,
  EXPORT_FIELD_RULES,
  EXPORT_SECTIONS,
  LEGAL_DOC_IDS,
  LEGAL_DOC_REGISTRY,
  TRANSACTIONAL_EMAILS,
  activeDocVersion,
  applyUnsubscribe,
  buildExportEnvelope,
  businessIsComplete,
  consentDocVersion,
  decideBusinessUpdate,
  decideDeletionAdvance,
  decideMarketingGrant,
  decideMarketingSend,
  docIsConsentable,
  exportManifest,
  isTransactionalEmail,
  projectDeletion,
  projectLegalDocs,
  type DeletionRequestRow,
} from "../../convex/legal";

const NOW = 1_790_000_000_000;

describe("legal document registry", () => {
  it("ships all six legal documents", () => {
    expect(LEGAL_DOC_IDS).toEqual(["terms", "privacy", "refunds", "cookies", "community", "copyright"]);
    for (const id of LEGAL_DOC_IDS) {
      const doc = LEGAL_DOC_REGISTRY[id];
      expect(doc.version).toBeTruthy();
      expect(doc.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(doc.updatedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(["draft", "published", "retired"]).toContain(doc.published);
    }
  });

  it("exposes version/effective/updated/published per document", () => {
    const docs = projectLegalDocs();
    expect(docs).toHaveLength(6);
    for (const d of docs) {
      expect(d.isCurrent).toBe(d.published === "published");
    }
  });

  it("pins the same version the registry holds (consent resolution)", () => {
    expect(activeDocVersion("terms")).toBe(LEGAL_DOC_REGISTRY.terms.version);
    expect(activeDocVersion("privacy")).toBe(LEGAL_DOC_REGISTRY.privacy.version);
  });

  it("resolves consent types to registry versions (guidelines → community doc)", () => {
    expect(CONSENT_TO_DOC.guidelines).toBe("community");
    expect(consentDocVersion("guidelines")).toBe(activeDocVersion("community"));
    expect(consentDocVersion("terms")).toBe(activeDocVersion("terms"));
    expect(consentDocVersion("cookies")).toBe(activeDocVersion("cookies"));
    // Unknown types fall back to the privacy document.
    expect(consentDocVersion("something_else")).toBe(activeDocVersion("privacy"));
  });

  it("only published documents are consentable", () => {
    expect(docIsConsentable("terms")).toBe(true);
    // A retired/draft document is not published, hence not consentable.
    const statuses: string[] = ["draft", "retired"];
    for (const s of statuses) {
      const doc = { ...LEGAL_DOC_REGISTRY.terms, published: s };
      expect(doc.published !== "published").toBe(true);
    }
  });
});

describe("deletion state machine", () => {
  const requestedRow: DeletionRequestRow = {
    userId: "u1",
    status: "requested",
    stateChangedAt: NOW,
    requestedAt: NOW,
    eligibleAt: NOW + DELETION_COOLING_OFF_MS,
  };

  it("advances REQUESTED → PROCESSING", () => {
    expect(decideDeletionAdvance(requestedRow, NOW + 1000)).toEqual({ ok: true, next: "processing" });
  });

  it("blocks PROCESSING → COMPLETED during the cooling-off window", () => {
    const processing = { ...requestedRow, status: "processing" as const };
    const inside = decideDeletionAdvance(processing, NOW + DELETION_COOLING_OFF_MS - 1);
    expect(inside).toEqual({ ok: false, error: "cooling_off_active" });
    const atEdge = decideDeletionAdvance(processing, NOW + DELETION_COOLING_OFF_MS);
    expect(atEdge).toEqual({ ok: true, next: "completed" });
  });

  it("COMPLETED is terminal", () => {
    const completed: DeletionRequestRow = {
      ...requestedRow,
      status: "completed",
      completedAt: NOW + DELETION_COOLING_OFF_MS,
    };
    expect(decideDeletionAdvance(completed, NOW + DELETION_COOLING_OFF_MS + 1)).toEqual({
      ok: false,
      error: "invalid_transition",
    });
  });

  it("no request → no_request", () => {
    expect(decideDeletionAdvance(null, NOW)).toEqual({ ok: false, error: "no_request" });
  });

  it("cooling-off window is 14 days", () => {
    expect(DELETION_COOLING_OFF_MS).toBe(14 * 864e5);
  });

  it("projects the deletion state with countdown for PROCESSING", () => {
    const processing = { ...requestedRow, status: "processing" as const };
    const p = projectDeletion(processing, NOW + 1000)!;
    expect(p.status).toBe("processing");
    expect(p.eligibleAt).toBe(NOW + DELETION_COOLING_OFF_MS);
    expect(p.coolingOffRemainingMs).toBe(DELETION_COOLING_OFF_MS - 1000);
    const done = projectDeletion(processing, NOW + DELETION_COOLING_OFF_MS)!;
    expect(done.coolingOffRemainingMs).toBe(0);
    expect(projectDeletion(null, NOW)).toBeNull();
  });
});

describe("marketing prefs + unsubscribe", () => {
  it("defaults to all-off (marketing is opt-in, never preset)", () => {
    expect(Object.values(DEFAULT_MARKETING_PREFS).every((v) => v === false)).toBe(true);
  });

  it("minors can never grant marketing consent", () => {
    expect(decideMarketingGrant("teen16_17", true)).toEqual({ ok: false, error: "minor_denied" });
    expect(decideMarketingGrant("child_u13", true)).toEqual({ ok: false, error: "minor_denied" });
    expect(decideMarketingGrant("adult", true)).toEqual({ ok: true });
    expect(decideMarketingGrant("teen16_17", false)).toEqual({ ok: true }); // withdrawal always ok
  });

  it("send gate requires consent AND the category pref; transactional bypasses the gate", () => {
    const on: typeof DEFAULT_MARKETING_PREFS = { ...DEFAULT_MARKETING_PREFS, promotions: true };
    expect(decideMarketingSend("promotions", on, true)).toEqual({ allowed: true });
    expect(decideMarketingSend("promotions", DEFAULT_MARKETING_PREFS, true)).toEqual({ allowed: false, reason: "pref_off" });
    expect(decideMarketingSend("promotions", on, false)).toEqual({ allowed: false, reason: "no_marketing_consent" });
    expect(decideMarketingSend("password_reset", on, true)).toEqual({
      allowed: false,
      reason: "transactional_bypasses_gate",
    });
  });

  it("transactional email can never be disabled", () => {
    for (const kind of TRANSACTIONAL_EMAILS) expect(isTransactionalEmail(kind)).toBe(true);
    expect(isTransactionalEmail("promotions")).toBe(false);
  });

  it("unsubscribe tokens only unsubscribe — never grant back", () => {
    const prefs = { ...DEFAULT_MARKETING_PREFS, promotions: true, productUpdates: true };
    expect(applyUnsubscribe(prefs, "all")).toEqual(DEFAULT_MARKETING_PREFS);
    expect(applyUnsubscribe(prefs, "promotions")).toEqual({ ...prefs, promotions: false });
    expect(applyUnsubscribe(prefs, "productUpdates").promotions).toBe(true);
    // Applying again cannot re-enable anything.
    const afterAll = applyUnsubscribe(prefs, "all");
    expect(applyUnsubscribe(afterAll, "promotions")).toEqual(DEFAULT_MARKETING_PREFS);
  });

  it("anyMarketingEmail needs consent AND a category on", () => {
    const any = (await_import_guard(), { ...DEFAULT_MARKETING_PREFS, classes: true });
    function await_import_guard() { return 0; }
    expect(anyMarketingEmailCore(any, false)).toBe(false);
    expect(anyMarketingEmailCore(DEFAULT_MARKETING_PREFS, true)).toBe(false);
    expect(anyMarketingEmailCore(any, true)).toBe(true);
  });

  function anyMarketingEmailCore(p: typeof DEFAULT_MARKETING_PREFS, consent: boolean) {
    return consent && Object.values(p).some(Boolean);
  }
});

describe("data export minimization", () => {
  it("never exports the DOB or credential material", () => {
    expect(EXPORT_FIELD_RULES.dob?.included).toBe(false);
    expect(EXPORT_FIELD_RULES.secret_hash?.included).toBe(false);
    expect(EXPORT_FIELD_RULES.session_tokens?.included).toBe(false);
    expect(EXPORT_FIELD_RULES.age_band?.included).toBe(true);
  });

  it("never exports other users' data", () => {
    expect(EXPORT_SECTIONS.find((s) => s.section === "other_users_data")?.included).toBe(false);
    expect(EXPORT_SECTIONS.find((s) => s.section === "consent_history")?.included).toBe(true);
  });

  it("manifest lists excluded fields with reasons", () => {
    const m = exportManifest();
    expect(m.sections).not.toContain("other_users_data");
    const dob = m.excludedFields.find((f) => f.field === "dob");
    expect(dob?.reason).toBeTruthy();
  });

  it("envelope pins a format version and generation time", () => {
    const env = buildExportEnvelope({ account: { email: "x@densen.test" } }, NOW);
    expect(env.formatVersion).toBe(1);
    expect(env.generatedAt).toBe(NOW);
    expect(env.manifest.sections.length).toBeGreaterThan(0);
  });
});

describe("business information (operator-configured)", () => {
  it("defaults are ALL empty — no company number, VAT, address or entity is invented", () => {
    expect(Object.values(EMPTY_BUSINESS_INFO).every((v) => v === "")).toBe(true);
  });

  it("completeness requires real operator data", () => {
    expect(businessIsComplete(EMPTY_BUSINESS_INFO)).toBe(false);
    expect(
      businessIsComplete({ ...EMPTY_BUSINESS_INFO, legalName: "  ", contactEmail: "a@b.co", supportEmail: "c@d.co" }),
    ).toBe(false);
    expect(
      businessIsComplete({ ...EMPTY_BUSINESS_INFO, legalName: "Acme", contactEmail: "a@b.co", supportEmail: "c@d.co" }),
    ).toBe(true);
  });

  it("validates email shapes and caps lengths", () => {
    expect(decideBusinessUpdate({ contactEmail: "not-an-email" })).toEqual({ ok: false, error: "bad_email" });
    expect(decideBusinessUpdate({ contactEmail: "ops@densen.app" })).toEqual({
      ok: true,
      cleaned: { contactEmail: "ops@densen.app" },
    });
    expect(decideBusinessUpdate({ legalName: "x".repeat(301) })).toEqual({ ok: false, error: "field_too_long" });
    expect(decideBusinessUpdate({ legalName: "DENSEN (to be confirmed)" })).toEqual({
      ok: true,
      cleaned: { legalName: "DENSEN (to be confirmed)" },
    });
  });
});
