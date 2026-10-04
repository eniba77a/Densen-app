/**
 * Day 8 — Teacher Studio core tests.
 * Pins the studio rules: verified-teacher-only access (fail closed on every
 * non-verified state), owner-or-admin editing, DRAFT/PUBLISHED/UNPUBLISHED
 * lifecycle transitions, item validation, and the revenue split math.
 */
import { describe, expect, it } from "vitest";
import {
  decidePublishTransition,
  decideStudioAccess,
  decideStudioDelete,
  decideStudioEdit,
  normalizeSteps,
  splitRevenue,
  validateStudioItem,
  STUDIO_KINDS,
  PAID_MIN_CENTS,
  PAID_MAX_CENTS,
} from "../../convex/studio";

const activeTeacher = { userId: "u_t", role: "teacher" as const, userStatus: "active" as const };
const activeDancer = { userId: "u_d", role: "user" as const, userStatus: "active" as const };
const activeAdmin = { userId: "u_a", role: "admin" as const, userStatus: "active" as const };
const verified = { status: "verified" as const, revenueSharePct: 70 };

describe("decideStudioAccess (verified-teacher gate)", () => {
  it("allows a verified teacher", () => {
    expect(decideStudioAccess(activeTeacher, verified)).toEqual({ allowed: true, isStaff: false });
  });

  it("FAILS CLOSED on every non-verified teacher state", () => {
    expect(decideStudioAccess(activeTeacher, { status: "pending" })).toEqual({ allowed: false, error: "teacher_pending" });
    expect(decideStudioAccess(activeTeacher, { status: "rejected" })).toEqual({ allowed: false, error: "teacher_rejected" });
    expect(decideStudioAccess(activeTeacher, { status: "revoked" })).toEqual({ allowed: false, error: "teacher_revoked" });
  });

  it("denies a dancer with no teacher row and denies guests", () => {
    expect(decideStudioAccess(activeDancer, null)).toEqual({ allowed: false, error: "not_teacher" });
    expect(decideStudioAccess(null, verified)).toEqual({ allowed: false, error: "unauthenticated" });
  });

  it("suspended/deleted callers are denied regardless of verification", () => {
    const suspended = { ...activeTeacher, userStatus: "suspended" as const };
    expect(decideStudioAccess(suspended, verified)).toEqual({ allowed: false, error: "caller_restricted" });
  });

  it("an admin with no teacher row may administer but is not a publishing teacher; moderators get nothing", () => {
    expect(decideStudioAccess(activeAdmin, null)).toEqual({ allowed: true, isStaff: true });
    const mod = { ...activeDancer, role: "moderator" as const };
    expect(decideStudioAccess(mod, null).allowed).toBe(false);
  });

  it("a user cannot self-verify: role teacher without a verified row is denied", () => {
    // even if users.role were tampered to "teacher", the profile row gates access
    expect(decideStudioAccess(activeTeacher, null)).toEqual({ allowed: false, error: "not_teacher" });
  });
});

describe("decideStudioEdit (ownership)", () => {
  it("owner may edit", () => {
    expect(decideStudioEdit(activeTeacher, "u_t")).toEqual({ ok: true });
  });

  it("another teacher may NOT edit someone else's content", () => {
    expect(decideStudioEdit(activeTeacher, "u_other")).toEqual({ ok: false, error: "not_owner" });
  });

  it("authorized admin may edit any item; moderators may not", () => {
    expect(decideStudioEdit(activeAdmin, "u_other")).toEqual({ ok: true });
    const mod = { ...activeDancer, role: "moderator" as const };
    expect(decideStudioEdit(mod, "u_other")).toEqual({ ok: false, error: "not_owner" });
  });

  it("suspended owners lose edit rights (fail closed)", () => {
    const suspended = { ...activeTeacher, userStatus: "suspended" as const };
    expect(decideStudioEdit(suspended, "u_t")).toEqual({ ok: false, error: "caller_restricted" });
  });
});

describe("lifecycle: DRAFT → PUBLISHED → UNPUBLISHED", () => {
  it("publish from draft and from unpublished always lands on published", () => {
    expect(decidePublishTransition("draft", "publish")).toEqual({ ok: true, next: "published" });
    expect(decidePublishTransition("unpublished", "publish")).toEqual({ ok: true, next: "published" });
    expect(decidePublishTransition("published", "publish")).toEqual({ ok: true, next: "published" });
  });

  it("unpublish only from published; revert to draft only from unpublished", () => {
    expect(decidePublishTransition("published", "unpublish")).toEqual({ ok: true, next: "unpublished" });
    expect(decidePublishTransition("draft", "unpublish")).toEqual({ ok: false, error: "invalid_transition" });
    expect(decidePublishTransition("unpublished", "revert_to_draft")).toEqual({ ok: true, next: "draft" });
    expect(decidePublishTransition("published", "revert_to_draft")).toEqual({ ok: false, error: "invalid_transition" });
  });
});

describe("validateStudioItem", () => {
  const good = {
    title: "Commercial Combo #01",
    description: "Eight counts of attitude.",
    style: "Commercial",
    difficulty: "intermediate" as const,
    durationSec: 510, // 08:30
    priceCents: 500, // €5
    creditPrice: 0,
    tags: ["commercial", "combo01"],
    visibility: "public" as const,
    kind: "combo" as const,
  };

  it("accepts the example combo (€5, intermediate, 08:30)", () => {
    expect(validateStudioItem(good)).toEqual({ ok: true, accessModel: "paid" });
  });

  it("enforces price band and credits bounds", () => {
    expect(validateStudioItem({ ...good, priceCents: 100 }).ok).toBe(false); // €1 < €2
    expect(validateStudioItem({ ...good, priceCents: 5000 }).ok).toBe(false); // €50 > €30
    expect(validateStudioItem({ ...good, priceCents: 0, creditPrice: 5 }).ok).toBe(false); // < 10 credits
    expect(validateStudioItem({ ...good, priceCents: 0, creditPrice: 60 })).toEqual({ ok: true, accessModel: "credits" });
    expect(validateStudioItem({ ...good, priceCents: 500, creditPrice: 60 })).toMatchObject({ ok: true, accessModel: "paid_credits" });
    expect(validateStudioItem({ ...good, priceCents: 0, creditPrice: 0 })).toEqual({ ok: true, accessModel: "free" });
  });

  it("enforces title/duration/tags fields", () => {
    expect(validateStudioItem({ ...good, title: "ab" }).ok).toBe(false);
    expect(validateStudioItem({ ...good, durationSec: 2 }).ok).toBe(false);
    expect(validateStudioItem({ ...good, tags: Array.from({ length: 13 }, (_, i) => `t${i}`) }).ok).toBe(false);
    expect(validateStudioItem({ ...good, style: "Kriz" }).ok).toBe(false);
  });

  it("challenges require a future deadline; other kinds must not carry one", () => {
    const future = Date.now() + 86_400_000;
    expect(validateStudioItem({ ...good, kind: "challenge", deadlineAt: future }).ok).toBe(true);
    expect(validateStudioItem({ ...good, kind: "challenge" }).ok).toBe(false);
    expect(validateStudioItem({ ...good, deadlineAt: future }).ok).toBe(false);
  });
});

describe("revenue architecture", () => {
  it("splits by contract share with floor rounding (teacher never overpaid)", () => {
    expect(splitRevenue(1000, 70)).toEqual({ teacherCents: 700, platformCents: 300 });
    expect(splitRevenue(999, 70)).toEqual({ teacherCents: 699, platformCents: 300 });
    expect(splitRevenue(500, 100)).toEqual({ teacherCents: 500, platformCents: 0 });
  });

  it("clamps pathological share values", () => {
    expect(splitRevenue(1000, 150).teacherCents).toBe(1000);
    expect(splitRevenue(1000, -10).teacherCents).toBe(0);
  });
});

describe("catalog vocabulary", () => {
  it("exposes the six creatable kinds and the €2–€30 constants", () => {
    expect([...STUDIO_KINDS]).toEqual(["move", "combo", "choreography", "class", "course", "challenge"]);
    expect(PAID_MIN_CENTS).toBe(200);
    expect(PAID_MAX_CENTS).toBe(3000);
  });
});

describe("Day 23 — item deletion uses the same ownership rule as editing", () => {
  it("the owner may delete their own lesson", () => {
    expect(decideStudioDelete(activeTeacher, "u_t")).toEqual({ ok: true });
  });

  it("another teacher CANNOT delete someone else's lesson", () => {
    const other = { userId: "u_other", role: "teacher" as const, userStatus: "active" as const };
    expect(decideStudioDelete(other, "u_t")).toEqual({ ok: false, error: "not_owner" });
  });

  it("an admin may administer deletions; guests and restricted callers fail closed", () => {
    expect(decideStudioDelete(activeAdmin, "u_t")).toEqual({ ok: true });
    expect(decideStudioDelete(null, "u_t")).toEqual({ ok: false, error: "unauthenticated" });
    expect(decideStudioDelete({ ...activeTeacher, userStatus: "suspended" }, "u_t")).toEqual({ ok: false, error: "caller_restricted" });
  });
});

describe("Day 23 — teacher movement timestamps (normalizeSteps)", () => {
  it("trims labels, drops nothing valid, and sorts chronologically", () => {
    const r = normalizeSteps([
      { label: "  shoulder pop ", atSec: 12.4 },
      { label: "opening pose", atSec: 0 },
      { label: "turn", atSec: 8.05 },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.steps).toEqual([
      { label: "opening pose", atSec: 0 },
      { label: "turn", atSec: 8.1 },
      { label: "shoulder pop", atSec: 12.4 },
    ]);
  });

  it("accepts absent/empty step lists", () => {
    expect(normalizeSteps(undefined)).toEqual({ ok: true, steps: [] });
    expect(normalizeSteps([])).toEqual({ ok: true, steps: [] });
  });

  it("rejects bad labels, bad times, and oversized lists", () => {
    expect(normalizeSteps([{ label: "   ", atSec: 1 }]).ok).toBe(false);
    expect(normalizeSteps([{ label: "x", atSec: -5 }]).ok).toBe(false);
    expect(normalizeSteps(Array.from({ length: 41 }, (_, i) => ({ label: `s${i}`, atSec: i }))).ok).toBe(false);
  });
});
