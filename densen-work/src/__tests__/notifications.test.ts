/**
 * DENSEN — Day 16 notification internals tests.
 * ============================================
 * Pins the notification-center rules: the 12-category taxonomy, the security
 * category's immutability, age-aware default mutes, the per-category opt-out
 * decision, and the single suppression point (muted categories never deliver,
 * no user is ever notified about their own action).
 */
import { describe, expect, it } from "vitest";
import {
  MUTABLE_CATEGORIES,
  NOTIFICATION_CATEGORIES,
  TYPE_CATEGORY,
  categoryForType,
  decideDelivery,
  decidePrefChange,
  defaultMutedFor,
  typeDelivers,
} from "../../convex/notifyInternals";

/* ---------------- taxonomy ---------------- */
describe("notifications: category taxonomy", () => {
  it("ships exactly the 12 Day-16 categories", () => {
    expect(NOTIFICATION_CATEGORIES).toEqual([
      "social",
      "energy",
      "comments",
      "shares",
      "practice",
      "challenges",
      "achievements",
      "learning",
      "messages",
      "purchases",
      "moderation",
      "security",
    ]);
  });

  it("every category except security is mutable", () => {
    expect(MUTABLE_CATEGORIES).toHaveLength(11);
    expect(MUTABLE_CATEGORIES).not.toContain("security");
  });

  it("maps the platform's event types to categories", () => {
    expect(categoryForType("follow")).toBe("social");
    expect(categoryForType("interaction_fire")).toBe("energy");
    expect(categoryForType("comment")).toBe("comments");
    expect(categoryForType("interaction_remix")).toBe("shares");
    expect(categoryForType("challenge_invite")).toBe("challenges");
    expect(categoryForType("class_completed")).toBe("learning");
    expect(categoryForType("message")).toBe("messages");
    expect(categoryForType("achievement_unlocked")).toBe("achievements");
    expect(categoryForType("purchase_paid")).toBe("purchases");
    expect(categoryForType("copyright_claim")).toBe("moderation");
    expect(categoryForType("security_password_changed")).toBe("security");
  });

  it("unknown types fall back to moderation (fail-safe, still deliverable)", () => {
    expect(categoryForType("made_up_event")).toBe("moderation");
  });

  it("every value in TYPE_CATEGORY is a real category", () => {
    for (const cat of Object.values(TYPE_CATEGORY)) {
      expect(NOTIFICATION_CATEGORIES).toContain(cat);
    }
  });
});

/* ---------------- age-aware defaults ---------------- */
describe("notifications: age-aware defaults", () => {
  it("children start with the quietest inbox", () => {
    const muted = defaultMutedFor("child_u13");
    expect(muted).toContain("social");
    expect(muted).toContain("energy");
    expect(muted).toContain("messages");
    expect(muted).not.toContain("moderation");
    expect(muted).not.toContain("security");
  });

  it("young teens are quieter than older teens and adults", () => {
    const teen = defaultMutedFor("teen13_15");
    expect(teen).toEqual(["energy", "shares", "purchases"]);
    expect(defaultMutedFor("teen16_17")).toEqual([]);
    expect(defaultMutedFor("adult")).toEqual([]);
  });
});

/* ---------------- preference changes ---------------- */
describe("notifications: preference decisions", () => {
  it("rejects unknown categories (closed vocabulary)", () => {
    expect(decidePrefChange({ currentMuted: [], category: "made_up", enable: false })).toEqual({
      action: "deny",
      error: "invalid_category",
    });
  });

  it("security can NEVER be muted", () => {
    expect(decidePrefChange({ currentMuted: [], category: "security", enable: false })).toEqual({
      action: "deny",
      error: "security_immutable",
    });
    // …but opting back in is a no-op success if ever muted (defense in depth).
    const res = decidePrefChange({ currentMuted: ["security"], category: "security", enable: true });
    expect(res.action).toBe("allow");
    if (res.action === "allow") expect(res.muted).not.toContain("security");
  });

  it("mutes and unmutes in canonical order", () => {
    const muted = decidePrefChange({ currentMuted: [], category: "energy", enable: false });
    expect(muted).toEqual({ action: "allow", muted: ["energy"] });
    const unmuted = decidePrefChange({ currentMuted: ["energy"], category: "energy", enable: true });
    expect(unmuted).toEqual({ action: "allow", muted: [] });
    // Order follows NOTIFICATION_CATEGORIES regardless of toggle history.
    const multi = decidePrefChange({ currentMuted: ["purchases"], category: "comments", enable: false });
    if (multi.action === "allow") expect(multi.muted).toEqual(["comments", "purchases"]);
  });
});

/* ---------------- delivery decision ---------------- */
describe("notifications: delivery decision", () => {
  it("muted categories are suppressed at write time", () => {
    expect(decideDelivery({ recipientMuted: ["energy"], type: "interaction_fire", recipientUserId: "u_me" })).toEqual({
      action: "suppress",
      reason: "category_muted",
    });
    expect(decideDelivery({ recipientMuted: ["energy"], type: "comment", recipientUserId: "u_me" }).action).toBe("deliver");
  });

  it("nobody is ever notified about their own action", () => {
    expect(
      decideDelivery({ recipientMuted: [], type: "comment", actorUserId: "u_me", recipientUserId: "u_me" })
    ).toEqual({ action: "suppress", reason: "self_notify" });
  });

  it("security always delivers even when every mutable category is muted", () => {
    const allMutable = MUTABLE_CATEGORIES as unknown as string[];
    expect(decideDelivery({ recipientMuted: allMutable as never, type: "security_password_changed", recipientUserId: "u_me" }).action).toBe("deliver");
  });

  it("typeDelivers mirrors decideDelivery for producers", () => {
    expect(typeDelivers(["energy"], "interaction_fire")).toBe(false);
    expect(typeDelivers(["energy"], "follow")).toBe(true);
    expect(typeDelivers([], "comment", "u_me", "u_me")).toBe(false);
  });
});
