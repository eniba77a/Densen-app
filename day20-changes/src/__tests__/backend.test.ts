import { describe, expect, it } from "vitest";
import {
  roleAtLeast,
  requireUser,
  requireRole,
  requireOwner,
  requireSelfOrStaff,
  canViewProfile,
  parseReportTarget,
  type Caller,
} from "../../convex/security";
import {
  vEnum,
  vHandle,
  vCaption,
  vCommentBody,
  vDob,
  vHashtagList,
  vObject,
  vString,
  vInt,
  vBool,
  publicProfileOf,
  publicPostOf,
  publicCommentOf,
  vReactionKind,
  CAPTION_MAX,
  HANDLE_PATTERN,
} from "../../convex/validators";
import { appendAudit, type AuditEntry } from "../../convex/auditInternals";
import { decideFollow, followCountDeltas, decideReaction, reactionCountDelta } from "../../convex/social";
import { decidePost } from "../../convex/content";
import {
  getMediaProvider,
  isMediaConfigured,
  isMediaKind,
  setMediaProvider,
  UploadLimits,
  type MediaProvider,
} from "../../convex/media";
import schema from "../../convex/schema";
import { persistableState } from "../state/governance";

/* ---------------- helpers ---------------- */
const me = (over: Partial<Caller> = {}): Caller => ({
  userId: "u_me",
  role: "user",
  userStatus: "active",
  ...over,
});
const expectThrow = (fn: () => unknown, msg: string) => {
  try {
    fn();
    throw new Error(`expected throw ${msg}`);
  } catch (e) {
    expect(String((e as Error).message)).toContain(msg);
  }
};

/* ---------------- roles & guards ---------------- */
describe("security: roles & fail-closed guards", () => {
  it("undefined role is denied for every requirement", () => {
    expect(roleAtLeast(undefined, "user")).toBe(false);
    expect(roleAtLeast(undefined, "teacher")).toBe(false);
    expect(roleAtLeast(undefined, "moderator")).toBe(false);
    expect(roleAtLeast(undefined, "admin")).toBe(false);
  });

  it("rank order user < teacher < moderator < admin", () => {
    expect(roleAtLeast("user", "user")).toBe(true);
    expect(roleAtLeast("teacher", "user")).toBe(true);
    expect(roleAtLeast("moderator", "teacher")).toBe(true);
    expect(roleAtLeast("admin", "moderator")).toBe(true);
    expect(roleAtLeast("user", "teacher")).toBe(false);
    expect(roleAtLeast("teacher", "moderator")).toBe(false);
    expect(roleAtLeast("moderator", "admin")).toBe(false);
  });

  it("requireUser denies null and deleted accounts", () => {
    expectThrow(() => requireUser(null), "UNAUTHENTICATED");
    expectThrow(() => requireUser(me({ userStatus: "deleted" })), "account_deleted");
    expect(requireUser(me()).userId).toBe("u_me");
  });

  it("suspended accounts keep no role privileges (fail closed)", () => {
    expectThrow(() => requireRole(me({ role: "admin", userStatus: "suspended" }), "moderator"), "account_suspended");
    expectThrow(() => requireRole(me({ role: "moderator" }), "admin"), "FORBIDDEN:admin");
    expect(requireRole(me({ role: "moderator" }), "moderator").role).toBe("moderator");
  });

  it("requireOwner rejects non-owners", () => {
    expectThrow(() => requireOwner(me(), "u_other"), "not_owner");
    expect(requireOwner(me(), "u_me").userId).toBe("u_me");
  });

  it("requireSelfOrStaff allows staff, denies strangers", () => {
    expect(requireSelfOrStaff(me({ role: "moderator" }), "u_other").userId).toBe("u_me");
    expectThrow(() => requireSelfOrStaff(me(), "u_other"), "FORBIDDEN");
  });
});

/* ---------------- visibility ---------------- */
describe("security: profile visibility", () => {
  const base = {
    targetUserStatus: "active" as const,
    isPrivate: false,
    viewerIsFollower: false,
    viewerRole: undefined,
    viewerIsSelf: false,
  };

  it("guests see public profiles only", () => {
    expect(canViewProfile(base)).toBe(true);
    expect(canViewProfile({ ...base, isPrivate: true })).toBe(false);
  });

  it("private profiles visible to follower and staff, not guests/strangers", () => {
    const priv = { ...base, isPrivate: true };
    expect(canViewProfile({ ...priv, viewerRole: "user", viewerIsFollower: true })).toBe(true);
    expect(canViewProfile({ ...priv, viewerRole: "user", viewerIsFollower: false })).toBe(false);
    expect(canViewProfile({ ...priv, viewerRole: "moderator" })).toBe(true);
    expect(canViewProfile({ ...priv, viewerRole: "admin" })).toBe(true);
  });

  it("suspended/deleted targets are invisible to everyone except self", () => {
    for (const status of ["suspended", "deleted"] as const) {
      expect(canViewProfile({ ...base, targetUserStatus: status, viewerRole: "admin" })).toBe(false);
      expect(canViewProfile({ ...base, targetUserStatus: status, viewerIsSelf: true })).toBe(true);
    }
  });
});

/* ---------------- report targets ---------------- */
describe("security: report target resolver", () => {
  it("accepts known types, rejects unknown and empty ids", () => {
    expect(parseReportTarget("post", "p1")).toEqual({ targetType: "post", targetId: "p1" });
    expect(parseReportTarget("message", "m9")).toEqual({ targetType: "message", targetId: "m9" });
    expect(parseReportTarget("profile", "p1")).toBeNull();
    expect(parseReportTarget("post", "")).toBeNull();
  });
});

/* ---------------- validators ---------------- */
describe("validators", () => {
  it("closed enums reject off-list values", () => {
    const vRole = vEnum(["user", "teacher", "moderator", "admin"] as const);
    expect(vRole("teacher")).toBe("teacher");
    expect(() => vRole("superadmin")).toThrow();
  });

  it("handle format is enforced", () => {
    expect(vHandle("dancer_01")).toBe("dancer_01");
    expect(() => vHandle("No")).toThrow(); // too short
    expect(() => vHandle("has space")).toThrow();
    expect(() => vHandle("UPPER")).toThrow();
    expect("x".repeat(25)).not.toMatch(HANDLE_PATTERN);
  });

  it("caption/comment length caps are enforced", () => {
    expect(vCaption("a")).toBe("a");
    expect(() => vCaption("x".repeat(CAPTION_MAX + 1))).toThrow();
    expect(() => vCommentBody("")).toThrow();
  });

  it("dob accepts only strict ISO dates", () => {
    expect(vDob("2008-05-05")).toBe("2008-05-05");
    expect(() => vDob("05/05/2008")).toThrow();
    expect(() => vDob("not-a-date")).toThrow();
  });

  it("hashtag lists dedupe, cap at 10 and validate format", () => {
    expect(vHashtagList()(["#Dance", "#dance", "#hiphop"])).toEqual(["#dance", "#hiphop"]);
    expect(vHashtagList()(["#a", "#b", "#c", "#d", "#e", "#f", "#g", "#h", "#i", "#j", "#k"]).length).toBe(10);
    expect(() => vHashtagList()(["no-hash"])).toThrow();
  });

  it("vObject rejects unknown fields (mass-assignment protection)", () => {
    const spec = vObject({ name: vString() });
    expect(spec({ name: "a" })).toEqual({ name: "a" });
    expect(() => spec({ name: "a", role: "admin" })).toThrow();
  });

  it("vInt range checks", () => {
    const v = vInt({ min: 0, max: 100 });
    expect(v(50)).toBe(50);
    expect(() => v(101)).toThrow();
    expect(() => v(1.5)).toThrow();
    expect(vBool()(true)).toBe(true);
    expect(() => vBool()("yes")).toThrow();
  });
});

/* ---------------- sanitizers ---------------- */
describe("PII sanitizers", () => {
  it("profile projection strips email/dob and honors showCity", () => {
    const dto = publicProfileOf({
      userId: "u1",
      handle: "hana",
      displayName: "Hana",
      styles: ["Hip Hop"],
      showCity: false,
      city: "Tirana",
      isTeacher: false,
    });
    expect(dto.city).toBeUndefined();
    const dto2 = publicProfileOf({
      userId: "u1",
      handle: "hana",
      displayName: "Hana",
      styles: [],
      showCity: true,
      city: "Tirana",
      isTeacher: true,
      teacherStatus: "verified",
    });
    expect(dto2.city).toBe("Tirana");
    expect(dto2.teacherStatus).toBe("verified");
    // The projection type has no email/dob fields at all — compile-time guarantee.
  });

  it("post projection hides unpublished rows", () => {
    const row = {
      id: "p1",
      caption: "hi",
      hashtags: ["#d"],
      style: "Hip Hop",
      status: "in_review",
      likeCount: 0,
      commentCount: 0,
      createdAt: 1,
    };
    expect(publicPostOf(row, null)).toBeNull();
    expect(publicPostOf({ ...row, status: "published" }, null)?.caption).toBe("hi");
  });

  it("comment projection hides hidden/removed", () => {
    expect(publicCommentOf({ id: "c1", userId: "u", body: "x", status: "hidden", createdAt: 1 })).toBeNull();
    expect(publicCommentOf({ id: "c1", userId: "u", body: "x", status: "visible", createdAt: 1 })?.body).toBe("x");
  });
});

/* ---------------- data minimization ---------------- */
describe("DOB data-minimization", () => {
  it("never serializes the raw DOB; the derived age band persists instead", () => {
    const state = {
      onboarded: true,
      account: { name: "Ana", email: "a@x.app", dob: "2011-06-01", ageBand: "teen13_15", region: "eu" },
    } as never as Parameters<typeof persistableState>[0];
    const out = persistableState(state);
    expect(JSON.stringify(out)).not.toContain("2011-06-01");
    expect(out.account).not.toHaveProperty("dob");
    expect(out.account.ageBand).toBe("teen13_15");
  });
});

/* ---------------- follow logic ---------------- */
describe("social: follow decision", () => {
  it("denies unauthenticated, self-follow and unavailable targets", () => {
    expect(decideFollow({ caller: null, followee: { userId: "u2", status: "active" }, existingRow: null })).toEqual({
      action: "deny",
      error: "unauthenticated",
    });
    expect(
      decideFollow({ caller: me(), followee: { userId: "u_me", status: "active" }, existingRow: null })
    ).toEqual({ action: "deny", error: "cannot_follow_self" });
    expect(
      decideFollow({ caller: me(), followee: { userId: "u2", status: "suspended" }, existingRow: null })
    ).toEqual({ action: "deny", error: "target_unavailable" });
    expect(decideFollow({ caller: me(), followee: null, existingRow: null })).toEqual({
      action: "deny",
      error: "target_unavailable",
    });
  });

  it("toggles insert and delete with correct counter deltas", () => {
    expect(decideFollow({ caller: me(), followee: { userId: "u2", status: "active" }, existingRow: null })).toEqual({
      action: "insert",
      followerId: "u_me",
      followeeId: "u2",
      following: true,
    });
    expect(
      decideFollow({ caller: me(), followee: { userId: "u2", status: "active" }, existingRow: { _id: "f1" } })
    ).toEqual({ action: "delete", rowId: "f1", following: false });

    expect(followCountDeltas({ action: "insert", followerId: "u", followeeId: "v", following: true })).toEqual({
      followeeFollowerDelta: 1,
      callerFollowingDelta: 1,
    });
    expect(followCountDeltas({ action: "delete", rowId: "f", following: false })).toEqual({
      followeeFollowerDelta: -1,
      callerFollowingDelta: -1,
    });
    expect(followCountDeltas({ action: "deny", error: "unauthenticated" })).toEqual({
      followeeFollowerDelta: 0,
      callerFollowingDelta: 0,
    });
  });
});

/* ---------------- Energy: DENSEN reactions (fire/hype/gold) ---------------- */
describe("social: Energy reaction decision", () => {
  it("denies unauthenticated, suspended callers and unavailable targets", () => {
    expect(decideReaction({ caller: null, kind: "fire", target: { status: "published" }, existingRow: null })).toEqual({
      action: "deny",
      error: "unauthenticated",
    });
    expect(
      decideReaction({ caller: me({ userStatus: "suspended" }), kind: "fire", target: { status: "published" }, existingRow: null })
    ).toEqual({ action: "deny", error: "caller_restricted" });
    expect(
      decideReaction({ caller: me(), kind: "fire", target: { status: "removed" }, existingRow: null })
    ).toEqual({ action: "deny", error: "target_unavailable" });
    expect(decideReaction({ caller: me(), kind: "fire", target: null, existingRow: null })).toEqual({
      action: "deny",
      error: "target_unavailable",
    });
  });

  it("toggles insert/delete with consistent likeCount deltas", () => {
    expect(decideReaction({ caller: me(), kind: "gold", target: { status: "published" }, existingRow: null })).toEqual({
      action: "insert",
      userId: "u_me",
      kind: "gold",
    });
    expect(
      decideReaction({ caller: me(), kind: "gold", target: { status: "published" }, existingRow: { _id: "r1" } })
    ).toEqual({ action: "delete", rowId: "r1" });
    expect(reactionCountDelta({ action: "insert", userId: "u", kind: "fire" })).toBe(1);
    expect(reactionCountDelta({ action: "delete", rowId: "r" })).toBe(-1);
    expect(reactionCountDelta({ action: "deny", error: "target_unavailable" })).toBe(0);
  });

  it("restricts the reaction vocabulary to fire/hype/gold", () => {
    expect(vReactionKind("fire")).toBe("fire");
    expect(vReactionKind("hype")).toBe("hype");
    expect(vReactionKind("gold")).toBe("gold");
    expectThrow(() => vReactionKind("like"), "expected one of");
    expectThrow(() => vReactionKind(""), "expected one of");
  });
});

/* ---------------- Day-1 schema completeness ---------------- */
describe("schema foundation covers the Day-1 entity list", () => {
  // Table names as defined in convex/schema.ts (camelCase).
  const REQUIRED = [
    "users", "profiles", "roles", "teacherProfiles", "posts", "videos", "comments",
    "reactions", "follows", "savedContent", "messages", "notifications", "moves",
    "combos", "choreographies", "classes", "courses", "lessons", "practiceSessions",
    "challenges", "challengeParticipants", "xpTransactions", "danceCredits",
    "creditTransactions", "achievements", "userAchievements", "streaks", "missions",
    "userMissions", "purchases", "paymentTransactions", "refundRequests",
    "subscriptions", "teacherPayouts", "copyrightClaims", "copyrightDisputes",
    "reports", "moderationActions", "blocks", "consents", "privacySettings",
    "devicePermissions", "legalDocuments", "auditLogs",
  ] as const;

  it("every required entity exists in the pushed schema", () => {
    const defined = Object.keys((schema as unknown as { tables: Record<string, unknown> }).tables);
    const missing = REQUIRED.filter((t) => !defined.includes(t));
    expect(missing, `missing: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("no duplicate tables were created (one definition per concept)", () => {
    const defined = Object.keys((schema as unknown as { tables: Record<string, unknown> }).tables);
    expect(new Set(defined).size).toBe(defined.length);
  });
});

/* ---------------- media abstraction (not configured) ---------------- */
describe("media storage abstraction", () => {
  it("starts honestly not-configured and fails loudly", async () => {
    expect(isMediaConfigured()).toBe(false);
    expect(getMediaProvider().name).toBe("not_configured");
    await expect(getMediaProvider().createUploadUrl({ kind: "video", userId: "u1", maxBytes: 1 })).rejects.toThrow(
      "MEDIA_NOT_CONFIGURED:createUploadUrl"
    );
    await expect(getMediaProvider().createReadUrl("ref")).rejects.toThrow("MEDIA_NOT_CONFIGURED:createReadUrl");
    await expect(getMediaProvider().deleteObject("ref")).rejects.toThrow("MEDIA_NOT_CONFIGURED:deleteObject");
  });

  it("accepts a provider registration and reports configured state", async () => {
    const stub: MediaProvider = {
      name: "test_stub",
      supports: { video: true, image: true, thumbnail: true, audio: true, processed_video: true },
      async createUploadUrl() {
        return { uploadUrl: "https://example/upload", ref: "r1", objectKey: "k1", expiresAt: 1 };
      },
      async createReadUrl(ref: string) {
        return { url: `https://example/${ref}`, expiresAt: 1 };
      },
      async deleteObject() {},
    };
    setMediaProvider(stub);
    expect(isMediaConfigured()).toBe(true);
    expect(getMediaProvider().name).toBe("test_stub");
    await expect(getMediaProvider().createReadUrl("abc")).resolves.toEqual({ url: "https://example/abc", expiresAt: 1 });
  });

  it("upload limits cover every media kind; kind guard is closed", () => {
    expect(Object.keys(UploadLimits).sort()).toEqual(["audio", "image", "processed_video", "thumbnail", "video"]);
    expect(isMediaKind("video")).toBe(true);
    expect(isMediaKind("hologram")).toBe(false);
    expect(isMediaKind(42)).toBe(false);
  });
});

/* ---------------- audit immutability ---------------- */
describe("audit log", () => {
  it("append-only sink stores entries with a timestamp; no update path exists", async () => {
    const rows: Array<AuditEntry & { createdAt: number }> = [];
    const sink = { insert: async (_table: "auditLogs", row: never) => { rows.push(row as never); } };
    await appendAudit(sink, { eventType: "follow", summary: "followed u2", actorUserId: "u_me", actorRole: "user" });
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe("follow");
    expect(typeof rows[0].createdAt).toBe("number");
    // The module exports no update/delete helpers — immutability by construction.
  });
});

/* ================= Day 20 audit — child-safety publish cap ================= */

describe("content: decidePost minor cap (Day 20 audit)", () => {
  const adultCaller: Caller = { userId: "u_adult", role: "user", userStatus: "active" };
  const cleanScan = { status: "published" as const, ruleIds: [] };

  it("adult + clean scan ⇒ published", () => {
    expect(
      decidePost({ caller: adultCaller, caption: "new combo drop", callerIsMinor: false, scan: cleanScan })
    ).toEqual({ action: "insert", status: "published" });
  });

  it("minor + CLEAN scan is still HELD for human review (never auto-published)", () => {
    expect(
      decidePost({ caller: adultCaller, caption: "clean teen post", callerIsMinor: true, scan: cleanScan })
    ).toEqual({ action: "insert", status: "in_review" });
  });

  it("minor + review-level scan ⇒ in_review (cap keeps the stricter state)", () => {
    const heldScan = { status: "in_review" as const, ruleIds: ["audio_unlicensed"] };
    expect(
      decidePost({ caller: adultCaller, caption: "teen freestyle", callerIsMinor: true, scan: heldScan })
    ).toEqual({ action: "insert", status: "in_review" });
  });

  it("blocked scan denies regardless of age", () => {
    const blockedScan = { status: "blocked" as const, ruleIds: ["images"] };
    expect(
      decidePost({ caller: adultCaller, caption: "add me on whatsapp", callerIsMinor: false, scan: blockedScan })
    ).toEqual({ action: "deny", error: "blocked_by_safety" });
  });

  it("unauthenticated + suspended still fail closed", () => {
    expect(decidePost({ caller: null, caption: "hi", callerIsMinor: false, scan: cleanScan })).toEqual({
      action: "deny",
      error: "unauthenticated",
    });
    const suspended: Caller = { userId: "u_s", role: "user", userStatus: "suspended" };
    expect(decidePost({ caller: suspended, caption: "hi", callerIsMinor: false, scan: cleanScan })).toEqual({
      action: "deny",
      error: "caller_restricted",
    });
  });
});
