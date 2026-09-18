import { describe, expect, it } from "vitest";
import {
  ageAwareDefaults,
  ageBand,
  ASSETS,
  averageRating,
  bandLabel,
  COOKIE_CATEGORIES,
  collectMarketedStrings,
  consentHistory,
  CONSENT_LABELS,
  contrastAudit,
  contrastRatio,
  DATA_INVENTORY,
  DEFAULT_BUSINESS,
  DELETION_CONSEQUENCES,
  DOCS,
  DOC_LIST,
  hasConsent,
  latestConsent,
  licenseUnknown,
  money,
  nextRefundStatus,
  optionalCookiesAllowed,
  PERMISSIONS,
  POLICY_VERSIONS,
  priceOf,
  REPORT_CATEGORIES,
  reportPriority,
  reviewsFor,
  runComplianceAudit,
  scanClaims,
  THIRD_PARTY,
  type ConsentRecord,
  type ConsentType,
  type Report,
} from "../data/governance";
import { dictionaries } from "../i18n";

/* ---------------- consent records ---------------- */
const mk = (type: ConsentType, granted: boolean, ts: string, source = "test", version = "1.0"): ConsentRecord => ({
  id: `${type}-${ts}-${granted}`,
  userId: "me",
  type,
  granted,
  ts,
  region: "eu",
  source,
  version,
});

describe("consent records", () => {
  it("latestConsent returns the most recent record per type", () => {
    const recs = [mk("terms", true, "2026-01-01T00:00:00Z"), mk("terms", true, "2026-06-01T00:00:00Z")];
    expect(latestConsent(recs, "terms")?.ts).toBe("2026-06-01T00:00:00Z");
  });

  it("history is sorted newest-first and never deduplicated (append-only)", () => {
    const recs = [mk("marketing_email", true, "2026-02-01T00:00:00Z"), mk("marketing_email", false, "2026-05-01T00:00:00Z")];
    const hist = consentHistory(recs);
    expect(hist).toHaveLength(2);
    expect(hist[0].granted).toBe(false);
  });

  it("withdrawal flips consent but the granted record stays in history", () => {
    const recs = [mk("marketing_email", true, "2026-02-01T00:00:00Z"), mk("marketing_email", false, "2026-05-01T00:00:00Z")];
    expect(hasConsent(recs, "marketing_email")).toBe(false);
    expect(recs).toHaveLength(2); // nothing deleted — history immutable
  });

  it("every consent type has bilingual labels", () => {
    for (const type of Object.keys(CONSENT_LABELS) as ConsentType[]) {
      expect(CONSENT_LABELS[type].en.length).toBeGreaterThan(0);
      expect(CONSENT_LABELS[type].sq.length).toBeGreaterThan(0);
    }
  });
});

/* ---------------- age-aware privacy ---------------- */
describe("age bands and protections", () => {
  const ref = new Date("2026-09-18");

  it("computes exact age bands from a date of birth", () => {
    expect(ageBand("2020-01-01", ref)).toBe("under13"); // 6y
    expect(ageBand("2013-09-17", ref)).toBe("teen13_15"); // just turned 13
    expect(ageBand("2009-06-01", ref)).toBe("teen16_17"); // 17
    expect(ageBand("2011-06-01", ref)).toBe("teen13_15"); // 15
    expect(ageBand("2005-06-01", ref)).toBe("adult"); // 21
  });

  it("under-13 is the strictest profile and requires parental authorization", () => {
    const d = ageAwareDefaults("under13");
    expect(d.privateAccount).toBe(true);
    expect(d.messagesFrom).toBe("none");
    expect(d.discoverable).toBe(false);
    expect(d.allowLocation).toBe(false);
    expect(d.targetedProfilingAllowed).toBe(false);
    expect(d.parentalConsentRequired).toBe(true);
  });

  it("teens get strong-but-not-total restrictions, adults standard", () => {
    const teen = ageAwareDefaults("teen16_17");
    expect(teen.privateAccount).toBe(true);
    expect(teen.allowDuetFromStrangers).toBe(false);
    expect(teen.parentalConsentRequired).toBe(false);
    const adult = ageAwareDefaults("adult");
    expect(adult.privateAccount).toBe(false);
    expect(adult.targetedProfilingAllowed).toBe(false); // never on for anyone
  });

  it("band labels are bilingual and never expose a DOB", () => {
    for (const b of Object.keys(bandLabel) as (keyof typeof bandLabel)[]) {
      expect(bandLabel[b].en).not.toMatch(/\d{4}/); // no year in the label
    }
  });
});

/* ---------------- cookies ---------------- */
describe("cookie consent", () => {
  it("necessary is never optional; others are", () => {
    for (const c of COOKIE_CATEGORIES) {
      expect(c.optional).toBe(c.id !== "necessary");
    }
  });

  it("optional tech is blocked before consent exists", () => {
    expect(optionalCookiesAllowed(undefined, "analytics")).toBe(false);
    const consent = { necessary: true as const, functional: false, analytics: false, marketing: false, ts: "", version: "", region: "eu" as const };
    expect(optionalCookiesAllowed(consent, "analytics")).toBe(false);
    expect(optionalCookiesAllowed({ ...consent, analytics: true }, "analytics")).toBe(true);
    // marketing stays blocked even when analytics allowed
    expect(optionalCookiesAllowed({ ...consent, analytics: true }, "marketing")).toBe(false);
  });
});

/* ---------------- refunds ---------------- */
describe("refund state machine", () => {
  it("follows requested → under_review → approved → refunded", () => {
    expect(nextRefundStatus("requested", true)).toBe("under_review");
    expect(nextRefundStatus("under_review", true)).toBe("approved");
    expect(nextRefundStatus("approved", true)).toBe("refunded");
    expect(nextRefundStatus("refunded", true)).toBe("refunded");
  });

  it("supports rejection at review time and stays terminal", () => {
    expect(nextRefundStatus("under_review", false)).toBe("rejected");
    expect(nextRefundStatus("rejected", true)).toBe("rejected");
  });

  it("prices exist for paid courses and money formats with currency", () => {
    const p = priceOf("c_commercial1");
    expect(p).toBeDefined();
    expect(money(p!.priceCents, p!.currency)).toBe("8.00 EUR");
  });
});

/* ---------------- deletion ---------------- */
describe("deletion consequences", () => {
  it("covers every major data class with a bilingual outcome", () => {
    expect(DELETION_CONSEQUENCES.length).toBeGreaterThanOrEqual(10);
    for (const c of DELETION_CONSEQUENCES) {
      expect(c.item.en.length).toBeGreaterThan(0);
      expect(c.outcome.sq.length).toBeGreaterThan(0);
    }
  });
});

/* ---------------- reports ---------------- */
describe("report prioritization", () => {
  it("child safety is always critical", () => {
    const r: Report = { id: "1", targetType: "post", targetId: "p1", category: "child_safety", details: "", ts: "", status: "open" };
    expect(reportPriority(r)).toBe("critical");
  });

  it("harassment escalates to high; spam stays normal", () => {
    const h: Report = { id: "2", targetType: "user", targetId: "u_luca", category: "harassment", details: "", ts: "", status: "open" };
    const s: Report = { id: "3", targetType: "post", targetId: "p1", category: "spam", details: "", ts: "", status: "open" };
    expect(reportPriority(h)).toBe("high");
    expect(reportPriority(s)).toBe("normal");
  });

  it("child safety category exists and is flagged to escalate", () => {
    const cs = REPORT_CATEGORIES.find((c) => c.id === "child_safety");
    expect(cs?.escalate).toBe(true);
  });
});

/* ---------------- claims audit ---------------- */
describe("claims scanner", () => {
  it("flags superlatives, guarantees and absolute claims", () => {
    expect(scanClaims("The #1 dance app").length).toBeGreaterThan(0);
    expect(scanClaims("Guaranteed results in 30 days").length).toBeGreaterThan(0);
    expect(scanClaims("100% copyright free music").length).toBeGreaterThan(0);
  });

  it("passes honest, evidence-based copy", () => {
    expect(scanClaims("Build real hip hop foundations: groove, bounce, isolation and timing.")).toHaveLength(0);
    expect(scanClaims("One drill a day for 30 days.")).toHaveLength(0);
  });

  it("live marketed strings are clean (no unsupported claims shipped)", () => {
    const hits = collectMarketedStrings().flatMap((s) => scanClaims(s));
    expect(hits).toHaveLength(0);
  });
});

/* ---------------- assets & SDKs ---------------- */
describe("asset rights & third-party inventory", () => {
  it("every shipped asset has an entry; unknown licenses are detectable", () => {
    expect(ASSETS.length).toBeGreaterThanOrEqual(5);
    const unknown = ASSETS.filter(licenseUnknown).map((a) => a.name);
    // pravatar + music metadata are honestly flagged unknown, never silently "free"
    expect(unknown.some((n) => n.includes("pravatar"))).toBe(true);
  });

  it("every SDK row documents purpose, region and a privacy URL", () => {
    for (const s of THIRD_PARTY) {
      expect(s.purpose.en.length).toBeGreaterThan(0);
      expect(s.region.en.length).toBeGreaterThan(0);
      expect(s.privacyUrl.startsWith("http")).toBe(true);
    }
    // planned integrations must be explicitly disabled until reviewed
    expect(THIRD_PARTY.filter((s) => !s.enabled).length).toBeGreaterThan(0);
  });
});

/* ---------------- contrast ---------------- */
describe("WCAG contrast audit", () => {
  it("all core text/background pairs pass AA (>= 4.5:1)", () => {
    const results = contrastAudit();
    const failing = results.filter((r) => !r.passesAA);
    expect(failing, `failing: ${failing.map((f) => `${f.fg}/${f.bg}=${f.ratio}`).join(", ")}`).toHaveLength(0);
  });

  it("the gold-on-charcoal brand pair is AA compliant", () => {
    expect(contrastRatio("#e3b341", "#0b0d10")).toBeGreaterThanOrEqual(4.5);
  });

  it("text-on-gold-buttons passes AA", () => {
    expect(contrastRatio("#171204", "#e3b341")).toBeGreaterThanOrEqual(4.5);
  });
});

/* ---------------- compliance audit engine ---------------- */
describe("compliance audit engine", () => {
  const baseInput = {
    consents: [] as ConsentRecord[],
    cookieConsent: undefined,
    region: "eu" as const,
    dob: undefined,
    deletion: undefined,
    business: DEFAULT_BUSINESS,
    reports: [],
  };

  it("marks acceptance items as ACTION REQUIRED when onboarding never ran", () => {
    const items = runComplianceAudit(baseInput);
    const terms = items.find((i) => i.id === "policy_acceptance");
    expect(terms?.status).toBe("action_required");
    const cookies = items.find((i) => i.id === "cookie_consent");
    expect(cookies?.status).toBe("action_required");
  });

  it("upgrades to PASS once consents + cookie choice + DOB exist", () => {
    const items = runComplianceAudit({
      ...baseInput,
      consents: [mk("terms", true, "2026-09-01T00:00:00Z", "onboarding", POLICY_VERSIONS.terms), mk("privacy", true, "2026-09-01T00:00:00Z", "onboarding", POLICY_VERSIONS.privacy)],
      cookieConsent: { necessary: true, functional: false, analytics: false, marketing: false, ts: "2026-09-01T00:00:00Z", version: POLICY_VERSIONS.cookies, region: "eu" },
      dob: "2000-05-05",
    });
    expect(items.find((i) => i.id === "policy_acceptance")?.status).toBe("pass");
    expect(items.find((i) => i.id === "cookie_consent")?.status).toBe("pass");
    expect(items.find((i) => i.id === "age_aware")?.status).toBe("pass");
  });

  it("business info stays WARNING until real details are provided (never invented)", () => {
    const items = runComplianceAudit(baseInput);
    expect(items.find((i) => i.id === "business_info")?.status).toBe("warning");
    const withBiz = runComplianceAudit({ ...baseInput, business: { ...DEFAULT_BUSINESS, legalName: "Densen sh.p.k.", contactEmail: "hello@densen.app", supportEmail: "support@densen.app" } });
    expect(withBiz.find((i) => i.id === "business_info")?.status).toBe("pass");
  });

  it("unknown-license assets produce a WARNING, not a silent PASS", () => {
    const items = runComplianceAudit(baseInput);
    expect(items.find((i) => i.id === "asset_licensing")?.status).toBe("warning");
  });

  it("every item carries bilingual label + detail text", () => {
    for (const item of runComplianceAudit(baseInput)) {
      expect(item.label.en.length).toBeGreaterThan(0);
      expect(item.detail.sq.length).toBeGreaterThan(0);
    }
  });
});

/* ---------------- reviews integrity ---------------- */
describe("authentic reviews model", () => {
  it("averages come only from real review rows", () => {
    const rs = reviewsFor("c_hiphop1");
    expect(rs.length).toBeGreaterThan(0);
    const expected = Math.round((rs.reduce((n, r) => n + r.rating, 0) / rs.length) * 10) / 10;
    expect(averageRating("c_hiphop1")).toBe(expected);
  });

  it("courses without reviews return null — the UI shows 'No reviews yet'", () => {
    expect(averageRating("c_adv1")).toBeNull();
    expect(reviewsFor("c_adv1")).toHaveLength(0);
  });
});

/* ---------------- docs completeness ---------------- */
describe("legal documents", () => {
  it("all documents ship bilingual with version and dates", () => {
    for (const id of DOC_LIST) {
      const d = DOCS[id];
      expect(d.title.sq.length).toBeGreaterThan(0);
      expect(d.sections.length).toBeGreaterThanOrEqual(3);
      expect(d.version.length).toBeGreaterThan(0);
      expect(d.effective).toBeTruthy();
      for (const s of d.sections) {
        expect(s.h.en.length).toBeGreaterThan(0);
        expect(s.h.sq.length).toBeGreaterThan(0);
        expect(s.p.length).toBeGreaterThan(0);
      }
    }
  });

  it("the terms state user ownership and a limited Densen license", () => {
    const text = DOCS.terms.sections.flatMap((s) => s.p.map((p) => p.en)).join(" ");
    expect(text).toMatch(/keep ownership|You keep ownership/i);
    expect(text).toMatch(/limited(,[^.]*)? license/i);
  });

  it("privacy policy covers children's privacy and retention", () => {
    const text = DOCS.privacy.sections.map((s) => s.h.en).join(" | ");
    expect(text).toMatch(/Children/i);
    expect(text).toMatch(/Retention/i);
  });
});

/* ---------------- permissions ---------------- */
describe("permission specs", () => {
  it("every permission explains why and what uses it", () => {
    for (const p of PERMISSIONS) {
      expect(p.explanation.en.length).toBeGreaterThan(10);
      expect(p.usedBy.sq.length).toBeGreaterThan(0);
    }
  });

  it("contacts and bluetooth are declared as not used", () => {
    for (const key of ["contacts", "bluetooth"] as const) {
      const p = PERMISSIONS.find((x) => x.key === key)!;
      expect(p.usedBy.en).toMatch(/Not used/i);
    }
  });
});

/* ---------------- data inventory ---------------- */
describe("data inventory (minimization)", () => {
  it("every field documents purpose, retention, access and deletion", () => {
    for (const e of DATA_INVENTORY) {
      expect(e.purpose.en.length).toBeGreaterThan(0);
      expect(e.retention.sq.length).toBeGreaterThan(0);
      expect(e.access.en.length).toBeGreaterThan(0);
      expect(e.deletion.sq.length).toBeGreaterThan(0);
    }
  });

  it("dob is documented as never displayed", () => {
    const dob = DATA_INVENTORY.find((e) => e.data.en.includes("Date of birth"));
    expect(dob?.access.en).toMatch(/never.*displayed|not other users/i);
  });
});

/* ---------------- governance i18n keys ---------------- */
describe("governance i18n", () => {
  it("both dictionaries carry the full gov.* key set", () => {
    const govKeys = Object.keys(dictionaries.en).filter((k) => k.startsWith("gov."));
    expect(govKeys.length).toBeGreaterThan(100);
    for (const k of govKeys) {
      expect(dictionaries.sq[k as never]).toBeTruthy();
    }
  });
});
