/**
 * DENSEN — Privacy decision-core tests (Day 3).
 * Covers: age category mapping, band-aware privacy clamping (minors never
 * loosen), consent rules (minor denials, versions), device-permission states.
 */
import { describe, expect, it } from "vitest";
import { LEGAL_DOC_REGISTRY } from "../../convex/legal";
import {
  ageCategoryFromBand,
  consentVersionFor,
  decideConsentRecord,
  decidePermissionRecord,
  decidePrivacyUpdate,
} from "../../convex/privacyInternals";

describe("ageCategoryFromBand", () => {
  it("maps bands to CHILD/TEEN/ADULT", () => {
    expect(ageCategoryFromBand("child_u13")).toBe("child");
    expect(ageCategoryFromBand("teen13_15")).toBe("teen");
    expect(ageCategoryFromBand("teen16_17")).toBe("teen");
    expect(ageCategoryFromBand("adult")).toBe("adult");
  });
});

describe("decidePrivacyUpdate — adult", () => {
  it("accepts loosening toggles for adults", () => {
    const r = decidePrivacyUpdate(
      { privateAccount: false, messagesFrom: "everyone", showCity: true, personalization: true },
      "adult"
    );
    expect(r).toEqual({
      ok: true,
      cleaned: { privateAccount: false, messagesFrom: "everyone", showCity: true, personalization: true },
    });
  });

  it("rejects an invalid audience value", () => {
    const r = decidePrivacyUpdate({ messagesFrom: "staff" as never }, "adult");
    expect(r).toEqual({ ok: false, error: "invalid_audience" });
  });

  it("rejects an empty patch", () => {
    expect(decidePrivacyUpdate({}, "adult")).toEqual({ ok: false, error: "empty" });
  });
});

describe("decidePrivacyUpdate — minors never loosen", () => {
  it("keeps private accounts private and city hidden (teen16_17)", () => {
    const r = decidePrivacyUpdate(
      { privateAccount: false, showCity: true, discoverableByHandle: true },
      "teen16_17"
    );
    expect(r).toEqual({ ok: true, cleaned: { privateAccount: true, showCity: false, discoverableByHandle: true } });
  });

  it("under-13 loses discoverability entirely", () => {
    const r = decidePrivacyUpdate({ discoverableByHandle: true }, "child_u13");
    expect(r).toEqual({ ok: true, cleaned: { discoverableByHandle: false } });
  });

  it("clamps 'everyone' audiences down to followers for any minor", () => {
    for (const band of ["child_u13", "teen13_15", "teen16_17"] as const) {
      const r = decidePrivacyUpdate(
        { messagesFrom: "everyone", mentionsFrom: "everyone", tagsFrom: "everyone" },
        band
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.cleaned.messagesFrom).toBe("followers");
        expect(r.cleaned.mentionsFrom).toBe("followers");
        expect(r.cleaned.tagsFrom).toBe("followers");
      }
    }
  });

  it("keeps the comment filter on and personalization off for minors", () => {
    const r = decidePrivacyUpdate({ commentFilter: false, personalization: true }, "teen13_15");
    expect(r).toEqual({ ok: true, cleaned: { commentFilter: true, personalization: false } });
  });
});

describe("decideConsentRecord", () => {
  it("accepts required and optional grants for adults", () => {
    expect(decideConsentRecord("terms", true, "adult")).toEqual({ ok: true });
    expect(decideConsentRecord("marketing_email", true, "adult")).toEqual({ ok: true });
    expect(decideConsentRecord("music_rights", true, "adult")).toEqual({ ok: true });
  });

  it("denies profiling/licensing consents for minors", () => {
    for (const band of ["child_u13", "teen13_15", "teen16_17"] as const) {
      expect(decideConsentRecord("marketing_email", true, band)).toEqual({ ok: false, error: "minor_denied" });
      expect(decideConsentRecord("personalization", true, band)).toEqual({ ok: false, error: "minor_denied" });
      expect(decideConsentRecord("music_rights", true, band)).toEqual({ ok: false, error: "minor_denied" });
    }
  });

  it("always allows withdrawal", () => {
    expect(decideConsentRecord("marketing_email", false, "child_u13")).toEqual({ ok: true });
  });

  it("rejects unknown consent types", () => {
    expect(decideConsentRecord("shiny_thing", true, "adult")).toEqual({ ok: false, error: "unknown_type" });
  });

  it("pins versions per type (server-side, resolved through the Day 19 legal registry)", () => {
    // Day 19 — versions resolve through LEGAL_DOC_REGISTRY; the property that
    // matters is registry-consistency, not a hardcoded string.
    expect(consentVersionFor("terms")).toBe(LEGAL_DOC_REGISTRY.terms.version);
    expect(consentVersionFor("guidelines")).toBe(LEGAL_DOC_REGISTRY.community.version);
    expect(consentVersionFor("privacy")).toBe(LEGAL_DOC_REGISTRY.privacy.version);
    expect(consentVersionFor("marketing_email")).toBe(LEGAL_DOC_REGISTRY.privacy.version);
    expect(consentVersionFor("cookies")).toBe(LEGAL_DOC_REGISTRY.cookies.version);
    expect(consentVersionFor("purchase_terms")).toBe(LEGAL_DOC_REGISTRY.refunds.version);
    expect(consentVersionFor("music_rights")).toBe(LEGAL_DOC_REGISTRY.copyright.version);
  });
});

describe("decidePermissionRecord", () => {
  it("accepts the five device permissions with OS states", () => {
    for (const p of ["camera", "microphone", "photos", "location", "notifications"]) {
      expect(decidePermissionRecord(p, "granted")).toEqual({ ok: true });
      expect(decidePermissionRecord(p, "denied")).toEqual({ ok: true });
    }
  });

  it("rejects unknown permissions and states", () => {
    expect(decidePermissionRecord("bluetooth", "granted")).toEqual({ ok: false, error: "unknown_permission" });
    expect(decidePermissionRecord("camera", "maybe")).toEqual({ ok: false, error: "unknown_state" });
  });
});
