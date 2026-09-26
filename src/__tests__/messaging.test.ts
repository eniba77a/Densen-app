/**
 * DENSEN — Day 16 messaging core tests.
 * =====================================
 * Pins the messaging rules: the closed share vocabulary, share availability
 * (published targets, open challenges only), the direct-message decision
 * (lockstep with the client canMessage table + safetyCore), server read-state
 * math (unread counts, never-backwards read cursor), and the privacy/age
 * fail-closed user search.
 */
import { describe, expect, it } from "vitest";
import {
  MINOR_CONTACT_ATTEMPT_LIMIT,
  SHARE_KINDS,
  canMessageCoreInline,
  decideDirectMessage,
  decideSearch,
  decideShare,
  evaluateContactPatternInline,
  nextReadCursor,
  shareNotificationType,
  unreadCountFor,
} from "../../convex/messaging";

const CALLER = { userId: "u_me", userStatus: "active", role: "user" } as const;
const RECIPIENT = { userId: "u_them", isMinor: false, status: "active" };

function dmInput(overrides: Partial<Parameters<typeof decideDirectMessage>[0]> = {}) {
  return {
    caller: CALLER,
    callerIsMinor: false,
    body: "hello",
    share: null,
    recipient: RECIPIENT,
    recipientPrivacy: { messagesFrom: "everyone" as const },
    callerIsVerifiedTeacher: false,
    recipientFollowsCaller: false,
    existingConversation: null,
    isBlockedByEither: false,
    contactAttemptCount: 0,
    groomSeverity: "none" as const,
    ...overrides,
  };
}

/* ---------------- share vocabulary ---------------- */
describe("messaging: share vocabulary", () => {
  it("ships exactly the Day-16 share kinds", () => {
    expect(SHARE_KINDS).toEqual(["video", "class", "course", "combo", "choreography", "post", "challenge_invite"]);
  });

  it("rejects unknown kinds before anything else", () => {
    expect(decideShare({ shareKind: "made_up", target: null, challengePhase: null })).toEqual({
      action: "deny",
      error: "invalid_kind",
    });
  });

  it("denies shares of missing or unpublished targets", () => {
    expect(decideShare({ shareKind: "class", target: null, challengePhase: null })).toEqual({ action: "deny", error: "share_unavailable" });
    expect(
      decideShare({ shareKind: "class", target: { exists: true, isPublished: false }, challengePhase: null })
    ).toEqual({ action: "deny", error: "share_unavailable" });
  });

  it("allows challenge invites only for OPEN published challenges", () => {
    expect(
      decideShare({ shareKind: "challenge_invite", target: { exists: true, isPublished: true }, challengePhase: "open" })
    ).toEqual({ action: "allow", shareKind: "challenge_invite" });
    expect(
      decideShare({ shareKind: "challenge_invite", target: { exists: true, isPublished: true }, challengePhase: "closed" })
    ).toEqual({ action: "deny", error: "challenge_not_open" });
    expect(
      decideShare({ shareKind: "challenge_invite", target: { exists: true, isPublished: true }, challengePhase: "upcoming" })
    ).toEqual({ action: "deny", error: "challenge_not_open" });
  });

  it("maps challenge invites to the challenge_invite notification type", () => {
    expect(shareNotificationType("challenge_invite")).toBe("challenge_invite");
    expect(shareNotificationType("video")).toBe("message_share");
  });
});

/* ---------------- direct-message gate ---------------- */
describe("messaging: direct-message gate", () => {
  it("requires a session", () => {
    expect(decideDirectMessage(dmInput({ caller: null }))).toEqual({ action: "deny", error: "unauthenticated" });
  });

  it("blocked relationships are absolute", () => {
    expect(decideDirectMessage(dmInput({ isBlockedByEither: true }))).toEqual({ action: "deny", error: "blocked" });
  });

  it("suspended callers and inactive recipients fail closed", () => {
    expect(
      decideDirectMessage(dmInput({ caller: { userId: "u_me", userStatus: "suspended", role: "user" } }))
    ).toEqual({ action: "deny", error: "caller_restricted" });
    expect(decideDirectMessage(dmInput({ recipient: { ...RECIPIENT, status: "suspended" } }))).toEqual({
      action: "deny",
      error: "recipient_unavailable",
    });
    expect(decideDirectMessage(dmInput({ recipient: null }))).toEqual({ action: "deny", error: "recipient_unavailable" });
  });

  it("a message is text, a share, or both — never neither", () => {
    expect(decideDirectMessage(dmInput({ body: "", share: null }))).toEqual({ action: "deny", error: "invalid_body" });
  });

  it("bodies are bounded at 2000 chars", () => {
    expect(decideDirectMessage(dmInput({ body: "x".repeat(2001) }))).toEqual({ action: "deny", error: "invalid_body" });
    expect(decideDirectMessage(dmInput({ body: "x".repeat(2000) })).action).toBe("deliver");
  });

  it("adults can never OPEN a thread with a minor (server-enforced)", () => {
    const res = decideDirectMessage(
      dmInput({ recipient: { ...RECIPIENT, isMinor: true }, recipientPrivacy: { messagesFrom: "everyone" } })
    );
    expect(res).toEqual({ action: "deny", error: "adult_to_minor" });
  });

  it("minors only receive from followed-back dancers or existing threads", () => {
    const res = decideDirectMessage(
      dmInput({
        callerIsMinor: true,
        recipient: { ...RECIPIENT, isMinor: true },
        recipientPrivacy: { messagesFrom: "followers" },
        recipientFollowsCaller: false,
      })
    );
    expect(res).toEqual({ action: "deny", error: "minor_gate" });
    const ok = decideDirectMessage(
      dmInput({
        callerIsMinor: true,
        recipient: { ...RECIPIENT, isMinor: true },
        recipientPrivacy: { messagesFrom: "followers" },
        recipientFollowsCaller: true,
      })
    );
    expect(ok.action).toBe("deliver");
    if (ok.action === "deliver") expect(ok.guardianVisible).toBe(true);
  });

  it("an adult minor-contact that follows back is guardian-visible", () => {
    const ok = decideDirectMessage(
      dmInput({
        recipient: { ...RECIPIENT, isMinor: true },
        recipientPrivacy: { messagesFrom: "everyone" },
        recipientFollowsCaller: true,
      })
    );
    expect(ok.action).toBe("deliver");
    if (ok.action === "deliver") expect(ok.guardianVisible).toBe(true);
  });

  it("messaging off and followers-only privacy deny strangers", () => {
    expect(decideDirectMessage(dmInput({ recipientPrivacy: { messagesFrom: "none" } }))).toEqual({
      action: "deny",
      error: "messaging_off",
    });
    expect(decideDirectMessage(dmInput({ recipientPrivacy: { messagesFrom: "followers" } }))).toEqual({
      action: "deny",
      error: "followers_only",
    });
    // …but an existing thread overrides followers-only (reply path).
    expect(
      decideDirectMessage(dmInput({ recipientPrivacy: { messagesFrom: "followers" }, existingConversation: { _id: "c1", guardianVisible: false } })).action
    ).toBe("deliver");
  });

  it("grooming-critical bodies are never delivered", () => {
    expect(decideDirectMessage(dmInput({ groomSeverity: "critical" }))).toEqual({ action: "deny", error: "abuse_pattern" });
  });

  it("repeated minor-contact attempts trip the watchlist", () => {
    // An existing thread keeps the age gate open so the contact-pattern
    // watch is the rule that fires (lockstep with safetyCore thresholds).
    expect(
      decideDirectMessage(
        dmInput({
          contactAttemptCount: MINOR_CONTACT_ATTEMPT_LIMIT + 1,
          recipient: { ...RECIPIENT, isMinor: true },
          existingConversation: { _id: "c1", guardianVisible: true },
        })
      )
    ).toEqual({ action: "deny", error: "abuse_pattern" });
  });

  it("share validation rides the same gate (invalid share denies the whole message)", () => {
    expect(
      decideDirectMessage(dmInput({ share: { action: "deny", error: "share_unavailable" } }))
    ).toEqual({ action: "deny", error: "share_unavailable" });
    expect(
      decideDirectMessage(dmInput({ share: { action: "allow", shareKind: "class" } })).action
    ).toBe("deliver");
  });
});

/* ---------------- lockstep safety math ---------------- */
describe("messaging: lockstep canMessage math", () => {
  it("mirrors the safetyCore table on the critical rows", () => {
    expect(canMessageCoreInline({ fromIsAdult: true, fromIsVerifiedTeacher: false, toIsMinor: true, toPref: "everyone", followingBack: false, isContact: false, isBlockedByEither: false })).toEqual({
      allowed: false,
      flag: "adult_to_minor",
    });
    expect(canMessageCoreInline({ fromIsAdult: true, fromIsVerifiedTeacher: true, toIsMinor: true, toPref: "everyone", followingBack: false, isContact: false, isBlockedByEither: false }).allowed).toBe(false);
    expect(canMessageCoreInline({ fromIsAdult: false, fromIsVerifiedTeacher: false, toIsMinor: true, toPref: "everyone", followingBack: true, isContact: false, isBlockedByEither: false }).allowed).toBe(true);
    expect(canMessageCoreInline({ fromIsAdult: false, fromIsVerifiedTeacher: false, toIsMinor: false, toPref: "none", followingBack: true, isContact: false, isBlockedByEither: false }).allowed).toBe(false);
  });

  it("contact-pattern thresholds match safetyCore", () => {
    expect(evaluateContactPatternInline(1, true)).toBe("none");
    expect(evaluateContactPatternInline(2, true)).toBe("watch");
    expect(evaluateContactPatternInline(4, true)).toBe("restrict");
    expect(evaluateContactPatternInline(5, false)).toBe("none");
    expect(evaluateContactPatternInline(6, false)).toBe("watch");
  });
});

/* ---------------- read-state math ---------------- */
describe("messaging: read-state math", () => {
  const msgs = [
    { _id: "m1", senderId: "u_me", createdAt: 10 },
    { _id: "m2", senderId: "u_them", createdAt: 20 },
    { _id: "m3", senderId: "u_them", createdAt: 30 },
  ];

  it("unread = messages from OTHERS newer than the read cursor", () => {
    expect(unreadCountFor({ lastReadAt: 0, messages: msgs, viewerId: "u_me" })).toBe(2);
    expect(unreadCountFor({ lastReadAt: 20, messages: msgs, viewerId: "u_me" })).toBe(1);
    expect(unreadCountFor({ lastReadAt: 30, messages: msgs, viewerId: "u_me" })).toBe(0);
    // Own messages never count as unread.
    expect(unreadCountFor({ lastReadAt: 0, messages: [msgs[0]], viewerId: "u_me" })).toBe(0);
  });

  it("the read cursor never moves backwards", () => {
    expect(nextReadCursor(30, 20)).toBe(30);
    expect(nextReadCursor(10, 50)).toBe(50);
    expect(nextReadCursor(0, 0)).toBe(0);
  });
});

/* ---------------- user search ---------------- */
describe("messaging: user search", () => {
  const candidates = [
    { userId: "u_a", handle: "aria", displayName: "Aria", isPrivate: false, discoverableByHandle: false, status: "active" },
    { userId: "u_b", handle: "bexo", displayName: "Bexho", isPrivate: true, discoverableByHandle: true, status: "active" },
    { userId: "u_c", handle: "clara", displayName: "Clara", isPrivate: true, discoverableByHandle: false, status: "active" },
    { userId: "u_g", handle: "gone", displayName: "Gone", isPrivate: false, discoverableByHandle: true, status: "suspended" },
  ];

  it("requires a session and a 2+ char query (no anonymous directory scraping)", () => {
    expect(decideSearch({ viewer: null, query: "ar", candidates, blockedByViewer: [], mutedByViewer: [], viewerIsMinor: false })).toEqual({
      action: "deny",
      error: "unauthenticated",
    });
    expect(
      decideSearch({ viewer: CALLER, query: "a", candidates, blockedByViewer: [], mutedByViewer: [], viewerIsMinor: false })
    ).toEqual({ action: "deny", error: "query_too_short" });
  });

  it("matches handle or display name; suspended accounts never surface", () => {
    const res = decideSearch({ viewer: CALLER, query: "aria", candidates, blockedByViewer: [], mutedByViewer: [], viewerIsMinor: false });
    expect(res.action).toBe("allow");
    if (res.action === "allow") {
      expect(res.results.map((r) => r.userId)).toEqual(["u_a"]);
    }
  });

  it("private non-discoverable accounts are excluded; private discoverable ones surface", () => {
    const res = decideSearch({ viewer: CALLER, query: "clara", candidates, blockedByViewer: [], mutedByViewer: [], viewerIsMinor: false });
    expect(res.action).toBe("allow");
    if (res.action === "allow") expect(res.results).toEqual([]);
    const res2 = decideSearch({ viewer: CALLER, query: "bexo", candidates, blockedByViewer: [], mutedByViewer: [], viewerIsMinor: false });
    if (res2.action === "allow") expect(res2.results.map((r) => r.userId)).toEqual(["u_b"]);
  });

  it("blocked/muted relations never appear", () => {
    const res = decideSearch({ viewer: CALLER, query: "aria", candidates, blockedByViewer: ["u_a"], mutedByViewer: [], viewerIsMinor: false });
    if (res.action === "allow") expect(res.results).toEqual([]);
  });

  it("never returns the viewer themself", () => {
    const self = [...candidates, { userId: "u_me", handle: "me", displayName: "Me", isPrivate: false, discoverableByHandle: true, status: "active" }];
    const res = decideSearch({ viewer: CALLER, query: "me", candidates: self, blockedByViewer: [], mutedByViewer: [], viewerIsMinor: false });
    if (res.action === "allow") expect(res.results).toEqual([]);
  });
});
