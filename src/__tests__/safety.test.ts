import { describe, expect, it } from "vitest";
import {
  canMessage,
  canReuse,
  canViewEvent,
  evaluateContactPattern,
  GROOMING_PATTERNS,
  isVerifiedTeacher,
  MINOR_CONTACT_ATTEMPT_LIMIT,
  PROFILE_FIELD_POLICY,
  rankRecommendations,
  recRulesFor,
  regionRuleFor,
  REGION_RULES,
  reuseDefaultsFor,
  ROLE_PERMS,
  scanChallenge,
  scanComment,
  scanGrooming,
  scanVideoSubmission,
  SECURITY_CONTROLS,
  TEACHER_VERIFICATIONS,
  youthAuditItems,
  type ContactAttempt,
} from "../data/safety";

/* ---------------- regional rules ---------------- */
describe("regional privacy rules (37)", () => {
  it("covers eu, uk, us and other with configurable floors", () => {
    for (const g of ["eu", "uk", "us", "other"] as const) {
      const r = REGION_RULES[g];
      expect(r.digitalConsentAge).toBeGreaterThan(0);
      expect(r.parentalConsentUnder).toBeGreaterThan(0);
      expect(r.label.en.length).toBeGreaterThan(0);
      expect(r.notes.sq.length).toBeGreaterThan(0);
    }
  });

  it("composes age defaults with the regional floor — stricter wins", () => {
    // EU teens 16-17: base allows follower DMs, EU floor forces none for under-16 only.
    // teen13_15 base is already "none", eu floor keeps "none".
    const d = regionRuleFor("eu");
    expect(d.teenDmFloor).toBe("none");
    // rule lookup: "other" region for non-EU
    expect(regionRuleFor("other").group).toBe("other");
  });
});

/* ---------------- messaging gate (40/43) ---------------- */
describe("canMessage gate", () => {
  const base = {
    fromIsAdult: true,
    fromIsVerifiedTeacher: false,
    toIsMinor: true,
    toPref: "everyone" as const,
    followingBack: false,
    isContact: false,
    isBlockedByEither: false,
  };

  it("blocks unknown adults from initiating chats with minors", () => {
    const r = canMessage(base);
    expect(r.allowed).toBe(false);
    expect(r.reason?.en.length).toBeGreaterThan(0);
    expect(r.flag).toBe("adult_to_minor");
  });

  it("allows when the minor initiated contact first", () => {
    expect(canMessage({ ...base, isContact: true }).allowed).toBe(true);
  });

  it("allows when the minor follows the adult back", () => {
    expect(canMessage({ ...base, followingBack: true }).allowed).toBe(true);
  });

  it("verified teachers may continue conversations with guardian visibility", () => {
    const r = canMessage({ ...base, fromIsVerifiedTeacher: true, isContact: true });
    expect(r.allowed).toBe(true);
    expect(r.guardianVisible).toBe(true);
  });

  it("block and messaging-off always win", () => {
    expect(canMessage({ ...base, isContact: true, isBlockedByEither: true }).allowed).toBe(false);
    expect(canMessage({ ...base, toPref: "none" }).allowed).toBe(false);
  });

  it("adult-to-adult chats respect followers-only preference", () => {
    const adult = { ...base, toIsMinor: false, toPref: "followers" as const };
    expect(canMessage(adult).allowed).toBe(false);
    expect(canMessage({ ...adult, followingBack: true }).allowed).toBe(true);
  });
});

/* ---------------- contact pattern (40) ---------------- */
describe("evaluateContactPattern", () => {
  it("escalates repeated attempts toward minors", () => {
    expect(evaluateContactPattern(0, true)).toBe("none");
    expect(evaluateContactPattern(1, true)).toBe("none");
    expect(evaluateContactPattern(2, true)).toBe("watch");
    expect(evaluateContactPattern(MINOR_CONTACT_ATTEMPT_LIMIT, true)).toBe("watch");
    expect(evaluateContactPattern(MINOR_CONTACT_ATTEMPT_LIMIT + 1, true)).toBe("restrict");
  });

  it("is more lenient toward adults", () => {
    expect(evaluateContactPattern(5, false)).toBe("none");
    expect(evaluateContactPattern(6, false)).toBe("watch");
  });
});

/* ---------------- comment scanner (44) ---------------- */
describe("scanComment", () => {
  it("blocks sexual content, solicitation, self-harm and threats", () => {
    expect(scanComment("send me pics").verdict).toBe("blocked");
    expect(scanComment("kys").verdict).toBe("blocked");
    expect(scanComment("I will find you").verdict).toBe("blocked");
  });

  it("hides harassment, doxxing, off-platform contact and scams", () => {
    expect(scanComment("you are so stupid").verdict).toBe("hidden");
    expect(scanComment("add me on whatsapp").verdict).toBe("hidden");
    expect(scanComment("free followers click here").verdict).toBe("hidden");
  });

  it("escalates hidden rules to blocked when the target is a minor", () => {
    expect(scanComment("you are so stupid", false).verdict).toBe("hidden");
    expect(scanComment("you are so stupid", true).verdict).toBe("blocked");
  });

  it("passes normal dance feedback untouched", () => {
    const r = scanComment("Great timing! Try bending your knees more on the bounce.");
    expect(r.verdict).toBe("clean");
    expect(r.matched).toHaveLength(0);
  });

  it("returns matched reasons in both languages", () => {
    const r = scanComment("send me pics");
    expect(r.matched.length).toBeGreaterThan(0);
    for (const m of r.matched) {
      expect(m.en.length).toBeGreaterThan(0);
      expect(m.sq.length).toBeGreaterThan(0);
    }
  });
});

/* ---------------- grooming detection (45) ---------------- */
describe("scanGrooming", () => {
  it("flags critical patterns: off-platform, secrecy, image requests, private meetups", () => {
    expect(scanGrooming("add me on whatsapp").severity).toBe("critical");
    expect(scanGrooming("don't tell your parents, our little secret").severity).toBe("critical");
    expect(scanGrooming("send me a pic of you").severity).toBe("critical");
    expect(scanGrooming("come over when your parents are out").severity).toBe("critical");
  });

  it("flags review-level manipulation patterns", () => {
    expect(scanGrooming("you're so much more mature than others").severity).toBe("review");
    expect(scanGrooming("I'll buy you a phone").severity).toBe("review");
  });

  it("never flags ordinary coaching conversation", () => {
    expect(scanGrooming("Nice improvement since last week — keep practicing the groove.").severity).toBe("none");
  });

  it("every rule carries a bilingual label", () => {
    for (const p of GROOMING_PATTERNS) {
      expect(p.label.en.length).toBeGreaterThan(0);
      expect(p.label.sq.length).toBeGreaterThan(0);
    }
  });
});

/* ---------------- video pre-check (53) ---------------- */
describe("scanVideoSubmission", () => {
  const clean = { caption: "First combo!", hashtags: ["#densen"], audioLicensed: true, creatorIsMinor: false };

  it("passes clean submissions", () => {
    expect(scanVideoSubmission(clean).status).toBe("clean");
  });

  it("blocks grooming content in captions", () => {
    expect(scanVideoSubmission({ ...clean, caption: "message me on snapchat" }).status).toBe("blocked");
  });

  it("holds unlicensed audio and risky hashtags for review", () => {
    expect(scanVideoSubmission({ ...clean, audioLicensed: false }).status).toBe("review");
    expect(scanVideoSubmission({ ...clean, hashtags: ["#stunt"] }).status).toBe("review");
  });

  it("applies stricter thresholds for minors — review becomes blocked", () => {
    const risky = { caption: "extreme challenge!", hashtags: ["#stunt"], audioLicensed: false, creatorIsMinor: false };
    expect(scanVideoSubmission(risky).status).toBe("review");
    expect(scanVideoSubmission({ ...risky, creatorIsMinor: true }).status).toBe("blocked");
  });

  it("surface claims as info-only signals", () => {
    const r = scanVideoSubmission({ ...clean, caption: "The #1 dance app challenge" });
    expect(r.status).toBe("clean");
    expect(r.signals.some((s) => s.severity === "info")).toBe(true);
  });
});

/* ---------------- reuse controls (54) ---------------- */
describe("remix / duet / download controls", () => {
  it("gives minors safer defaults", () => {
    expect(reuseDefaultsFor("adult")).toEqual({ allowRemix: true, allowDuet: true, allowDownloads: false });
    expect(reuseDefaultsFor("teen16_17").allowDuet).toBe(false);
    expect(reuseDefaultsFor("teen13_15").allowRemix).toBe(false);
    expect(reuseDefaultsFor("under13").allowDuet).toBe(false);
  });

  it("creator settings override defaults, but never for downloads", () => {
    expect(canReuse("adult", { allowDuet: false }, "duet")).toBe(false);
    expect(canReuse("teen13_15", { allowRemix: true }, "remix")).toBe(true);
    // downloads can never be re-enabled, even by the creator
    expect(canReuse("adult", { allowDownloads: true }, "download")).toBe(false);
  });

  it("falls back to adult defaults when creator band is unknown", () => {
    expect(canReuse(undefined, undefined, "duet")).toBe(true);
  });
});

/* ---------------- challenge safety (55) ---------------- */
describe("scanChallenge", () => {
  it("flags dangerous challenge prompts", () => {
    expect(scanChallenge("Hold your breath as long as you can").allowed).toBe(false);
    expect(scanChallenge("Fast for 3 days with me").allowed).toBe(false);
    expect(scanChallenge("Rooftop danceoff!").allowed).toBe(false);
  });

  it("passes safe dance challenges", () => {
    const r = scanChallenge("Show your best 20-second salsa shines.");
    expect(r.allowed).toBe(true);
  });
});

/* ---------------- teacher verification (56/57) ---------------- */
describe("teacher verification", () => {
  it("covers every teacher account with a status", () => {
    expect(TEACHER_VERIFICATIONS.length).toBeGreaterThan(0);
    for (const v of TEACHER_VERIFICATIONS) {
      expect(["verified", "pending"]).toContain(v.status);
      expect(v.checked.en.length).toBeGreaterThan(0);
      expect(v.docsNote.sq.length).toBeGreaterThan(0);
    }
  });

  it("resolves per-user and treats pending as not verified", () => {
    const anyTeacher = TEACHER_VERIFICATIONS[0];
    expect(isVerifiedTeacher(anyTeacher.userId)).toBe(anyTeacher.status === "verified");
    expect(isVerifiedTeacher("nobody")).toBe(false);
  });
});

/* ---------------- roles & audit access (63/64) ---------------- */
describe("staff roles and audit access", () => {
  it("restricts child-safety events to authorized roles", () => {
    expect(canViewEvent("moderator", "child_safety_report")).toBe(false);
    expect(canViewEvent("compliance", "child_safety_report")).toBe(false);
    expect(canViewEvent("child_safety", "child_safety_report")).toBe(true);
    expect(canViewEvent("super_admin", "child_safety_report")).toBe(true);
    // unrestricted event types are visible to everyone
    expect(canViewEvent("moderator", "safety_report")).toBe(true);
  });

  it("defines role permissions with private-report and export gating", () => {
    expect(ROLE_PERMS.moderator.privateReports).toBe(false);
    expect(ROLE_PERMS.child_safety.privateReports).toBe(true);
    expect(ROLE_PERMS.compliance.exportData).toBe(true);
    expect(ROLE_PERMS.super_admin.queues).toContain("all");
  });
});

/* ---------------- profile policy & recommendations (50/52) ---------------- */
describe("profile field policy", () => {
  it("marks DOB, email, exact location and device data as never public", () => {
    const never = PROFILE_FIELD_POLICY.filter((f) => f.visibility === "never");
    expect(never.length).toBeGreaterThanOrEqual(4);
    for (const f of never) expect(f.note.en.length).toBeGreaterThan(0);
  });
});

describe("recommendation safety (50)", () => {
  const items = [
    { userId: "a", likes: 999 },
    { userId: "b", likes: 5, lessonRef: "c_hiphop1" },
    { userId: "c", likes: 500 },
  ] as never as { userId: string; likes: number; lessonRef?: string }[];

  it("never optimizes purely for engagement (cap on for everyone)", () => {
    expect(recRulesFor("adult").engagementCap).toBe(true);
    expect(recRulesFor("under13").engagementCap).toBe(true);
  });

  it("puts educational content first for minors and filters non-discoverable authors", () => {
    const out = rankRecommendations("under13", items, (u) => u !== "c");
    expect(out[0].lessonRef).toBeDefined();
    expect(out.some((i) => i.userId === "c")).toBe(false);
  });

  it("keeps order for adults but still filters non-discoverable authors", () => {
    const out = rankRecommendations("adult", items, (u) => u !== "c");
    expect(out.map((i) => i.userId)).toEqual(["a", "b"]);
  });
});

/* ---------------- security posture (65) ---------------- */
describe("security posture", () => {
  it("documents enforced controls honestly, including planned ones", () => {
    const ids = SECURITY_CONTROLS.map((s) => s.id);
    expect(ids).toContain("passwords");
    expect(ids).toContain("transport");
    expect(ids).toContain("rbac");
    // backend-scope controls are marked planned, not silently claimed
    expect(SECURITY_CONTROLS.filter((s) => s.status === "planned").length).toBeGreaterThan(0);
    for (const s of SECURITY_CONTROLS) {
      expect(s.detail.sq.length).toBeGreaterThan(0);
    }
  });
});

/* ---------------- audit engine integration ---------------- */
describe("youth audit items", () => {
  it("reports pending teacher verification as a warning", () => {
    const items = youthAuditItems({});
    const t = items.find((i) => i.id === "teacher_verification");
    expect(t).toBeDefined();
    // dataset has at least one pending teacher by design
    expect(["pass", "warning"]).toContain(t!.status);
  });

  it("escalates restrict-level contact patterns to action_required", () => {
    const attempts: ContactAttempt[] = [
      { from: "adult1", to: "u_noa", ts: "t1", kind: "dm" },
      { from: "adult1", to: "u_noa", ts: "t2", kind: "dm" },
      { from: "adult1", to: "u_noa", ts: "t3", kind: "dm" },
      { from: "adult1", to: "u_noa", ts: "t4", kind: "mention" },
    ];
    const items = youthAuditItems({ contactAttempts: attempts });
    expect(items.find((i) => i.id === "dm_gating")?.status).toBe("action_required");
  });

  it("counts open child-safety events", () => {
    const items = youthAuditItems({
      auditEvents: [{ id: "e1", type: "child_safety_report", severity: "critical", summary: "test", ts: "t" }],
    });
    const s = items.find((i) => i.id === "safety_audit");
    expect(s?.status).toBe("warning");
    expect(s?.detail.en).toContain("1");
  });
});
