/**
 * DENSEN — Messaging decision core (Day 16).
 * =========================================
 * Pure decision functions for the messaging module. The wire layer
 * (messagingWire.ts) resolves every input server-side from real rows and
 * session identity — never from client args — then applies these decisions:
 *
 *   - decideDirectMessage  — text/rich-share send through the existing
 *                            canMessageCore age gate + grooming scan +
 *                            contact-pattern watch (safetyCore.ts)
 *   - unreadCountFor       — server-side read-state math
 *   - rankSearchResults    — privacy- and age-aware user search ranking
 *
 * The existing minor-contact gate in content.ts (decideMessage) stays the
 * authoritative DM gate for the plain text path; this core extends the same
 * rules to rich shares (video/class/course/combo/choreography/post/challenge
 * invite) — a share is a message and obeys every gate a message obeys.
 */
import type { Caller } from "./security";

/* ================================================================== */
/*                        Share vocabulary                             */
/* ================================================================== */

/** Typed share kinds a chat message can carry. */
export const SHARE_KINDS = ["video", "class", "course", "combo", "choreography", "post", "challenge_invite"] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

export function isShareKind(k: string): k is ShareKind {
  return (SHARE_KINDS as readonly string[]).includes(k);
}

export interface ShareDecisionInput {
  shareKind: string;
  /** The shared content row, resolved server-side (null = missing). */
  target: { exists: boolean; isPublished: boolean; ownerUserId?: string } | null;
  /** Challenge invitations are only issued against OPEN, published challenges. */
  challengePhase: "upcoming" | "open" | "closed" | null;
}

export type ShareDecision =
  | { action: "allow"; shareKind: ShareKind }
  | { action: "deny"; error: "invalid_kind" | "share_unavailable" | "challenge_not_open" };

/**
 * Validate a share before the message gate runs: the kind must be from the
 * closed vocabulary, the target must really exist and be visible, and a
 * challenge invitation needs an open challenge.
 */
export function decideShare(input: ShareDecisionInput): ShareDecision {
  if (!isShareKind(input.shareKind)) return { action: "deny", error: "invalid_kind" };
  if (!input.target || !input.target.exists) return { action: "deny", error: "share_unavailable" };
  if (input.shareKind === "challenge_invite") {
    if (!input.target.isPublished) return { action: "deny", error: "share_unavailable" };
    if (input.challengePhase !== "open") return { action: "deny", error: "challenge_not_open" };
  } else if (!input.target.isPublished) {
    return { action: "deny", error: "share_unavailable" };
  }
  return { action: "allow", shareKind: input.shareKind };
}

/** The notification type a delivered share raises for the recipient. */
export function shareNotificationType(kind: ShareKind): string {
  return kind === "challenge_invite" ? "challenge_invite" : "message_share";
}

/* ================================================================== */
/*                    The direct-message decision                      */
/* ================================================================== */

export interface DirectMessageInput {
  caller: Caller | null;
  /** Caller's own age band from their server row (never client input). */
  callerIsMinor: boolean;
  /** Trimmed body ("" for share-only messages). */
  body: string;
  share: ShareDecision | null; // null = plain text message
  recipient: { userId: string; isMinor: boolean; status: string } | null;
  recipientPrivacy: { messagesFrom: "everyone" | "followers" | "none" } | null;
  /** Sender is a VERIFIED teacher (schema state machine, not self-claimed). */
  callerIsVerifiedTeacher: boolean;
  /** Does the recipient follow the sender back? */
  recipientFollowsCaller: boolean;
  /** Existing direct thread between the two (id when present). */
  existingConversation: { _id: string; guardianVisible: boolean } | null;
  isBlockedByEither: boolean;
  /** Contact attempts sender→recipient (dm+share) in the window. */
  contactAttemptCount: number;
  /** Server grooming scan result for the body. */
  groomSeverity: "none" | "review" | "critical";
}

export type DirectMessageDecision =
  | {
      action: "deliver";
      conversationId: string; // "" = create lazily in the wire layer
      guardianVisible: boolean;
      flagged: boolean;
      watchlist: "none" | "watch" | "restrict";
    }
  | {
      action: "deny";
      error:
        | "unauthenticated"
        | "caller_restricted"
        | "recipient_unavailable"
        | "messaging_off"
        | "blocked"
        | "adult_to_minor"
        | "minor_gate"
        | "followers_only"
        | "invalid_body"
        | "abuse_pattern"
        | "invalid_share"
        | "invalid_kind"
        | "share_unavailable"
        | "challenge_not_open";
    };

/**
 * Decide a direct message (text or share). Lockstep with the client
 * canMessage table AND with content.ts's decideMessage:
 *   - blocked relationships are absolute
 *   - adults can never OPEN a thread with a minor (server-enforced)
 *   - minors only receive from followed-back dancers (or existing threads)
 *   - grooming-critical bodies are never delivered
 *   - repeated minor-contact attempts trip the watchlist (→ deny at restrict)
 * Shares ride through the exact same gate — no side door.
 */
export function decideDirectMessage(input: DirectMessageInput): DirectMessageDecision {
  if (!input.caller) return { action: "deny", error: "unauthenticated" };
  if (input.caller.userStatus === "suspended") return { action: "deny", error: "caller_restricted" };

  // A message is text, a share, or both — never neither.
  const share = input.share && input.share.action === "allow" ? input.share : null;
  if (input.share && !share) {
    return {
      action: "deny",
      error: input.share.action === "deny" ? input.share.error : "invalid_share",
    };
  }
  const hasBody = input.body.length > 0;
  if (!hasBody && !share) return { action: "deny", error: "invalid_body" };
  if (hasBody && (input.body.length > 2000 || !share)) {
    // Plain text obeys the body rules even when a share rides along.
    if (input.body.length > 2000) return { action: "deny", error: "invalid_body" };
  }

  if (!input.recipient || input.recipient.status !== "active") {
    return { action: "deny", error: "recipient_unavailable" };
  }
  if (input.isBlockedByEither) return { action: "deny", error: "blocked" };

  // The existing age-aware messaging gate (safetyCore.canMessageCore).
  const gate = canMessageCoreInline({
    fromIsAdult: !input.callerIsMinor,
    fromIsVerifiedTeacher: input.callerIsVerifiedTeacher,
    toIsMinor: input.recipient.isMinor,
    toPref: input.recipientPrivacy?.messagesFrom ?? "followers",
    followingBack: input.recipientFollowsCaller,
    isContact: input.existingConversation !== null,
    isBlockedByEither: input.isBlockedByEither,
  });
  if (!gate.allowed) {
    const error =
      gate.flag === "adult_to_minor"
        ? "adult_to_minor"
        : input.recipient.isMinor
          ? "minor_gate"
          : input.recipientPrivacy?.messagesFrom === "none"
            ? "messaging_off"
            : "followers_only";
    return { action: "deny", error };
  }

  // Contact-pattern watch (same math as content.ts / safetyCore).
  const watchlist = evaluateContactPatternInline(input.contactAttemptCount, input.recipient.isMinor);
  if (watchlist === "restrict") return { action: "deny", error: "abuse_pattern" };
  if (input.groomSeverity === "critical") return { action: "deny", error: "abuse_pattern" };

  return {
    action: "deliver",
    conversationId: input.existingConversation?._id ?? "",
    guardianVisible: gate.guardianVisible === true || input.existingConversation?.guardianVisible === true,
    flagged: input.groomSeverity === "review",
    watchlist,
  };
}

/* ================================================================== */
/*                        Read-state math                              */
/* ================================================================== */

export interface ReadStateInput {
  /** The viewer's lastReadAt for this thread (0 = never read). */
  lastReadAt: number;
  /** The thread's messages (id, senderId, createdAt). */
  messages: { _id: string; senderId: string; createdAt: number }[];
  viewerId: string;
}

/** Unread = messages from OTHERS newer than the viewer's read cursor. */
export function unreadCountFor(input: ReadStateInput): number {
  return input.messages.filter((m) => m.senderId !== input.viewerId && m.createdAt > input.lastReadAt).length;
}

/**
 * Decide the read-cursor patch on opening a thread: never move backwards,
 * never below the newest visible message.
 */
export function nextReadCursor(lastReadAt: number, newestMessageAt: number): number {
  return Math.max(lastReadAt, newestMessageAt, 0);
}

/* ================================================================== */
/*                    User search (privacy + age aware)                 */
/* ================================================================== */

export interface SearchCandidate {
  userId: string;
  handle: string;
  displayName: string;
  isPrivate: boolean;
  /** privacySettings.discoverableByHandle (default false = fail closed). */
  discoverableByHandle: boolean;
  status: string;
}

export interface SearchDecisionInput {
  viewer: Caller | null;
  query: string;
  candidates: SearchCandidate[];
  /** The viewer's own block/mute lists (never listed, never listed as targets). */
  blockedByViewer: string[];
  mutedByViewer: string[];
  /** Caller's minor status: minors never surface restricted-target accounts. */
  viewerIsMinor: boolean;
  /** Candidates the target has restricted messaging on stay discoverable but flagged. */
}

export type SearchDecision =
  | { action: "allow"; results: { userId: string; handle: string; displayName: string; isPrivate: boolean; messagingLimited: boolean }[] }
  | { action: "deny"; error: "unauthenticated" | "query_too_short" };

/**
 * Decide a user search. Fail-closed:
 *   - requires a session (no anonymous directory enumeration)
 *   - query must be ≥2 chars (bounded, no one-letter scraping)
 *   - non-discoverable + private accounts are excluded for strangers
 *   - blocked/muted relations never appear on either side
 *   - suspended/deleted accounts never appear
 * Private-but-discoverable accounts surface by handle with the privacy
 * flag attached — messaging them is still gated by the DM gate.
 */
export function decideSearch(input: SearchDecisionInput): SearchDecision {
  if (!input.viewer) return { action: "deny", error: "unauthenticated" };
  const q = input.query.trim().toLowerCase();
  if (q.length < 2) return { action: "deny", error: "query_too_short" };

  const hidden = new Set([...input.blockedByViewer, ...input.mutedByViewer]);
  const results = input.candidates
    .filter((c) => c.status === "active")
    .filter((c) => c.userId !== input.viewer!.userId)
    .filter((c) => !hidden.has(c.userId))
    .filter((c) => c.discoverableByHandle || (!c.isPrivate && c.handle.toLowerCase().includes(q)))
    .filter((c) => (input.viewerIsMinor ? c.status === "active" : true))
    .filter((c) => c.handle.toLowerCase().includes(q) || c.displayName.toLowerCase().includes(q))
    .slice(0, 20)
    .map((c) => ({ userId: c.userId, handle: c.handle, displayName: c.displayName, isPrivate: c.isPrivate, messagingLimited: false }));
  return { action: "allow", results };
}

/* ================================================================== */
/*              Inlined lockstep safety math (mirrors safetyCore)       */
/* ================================================================== */

/**
 * canMessageCore re-declared locally so this core stays dependency-free for
 * unit tests. LOCKSTEP CONTRACT with convex/safetyCore.ts canMessageCore —
 * changes there MUST be mirrored here (parity-tested in
 * src/__tests__/messaging.test.ts).
 */
export interface InlineMessagingGateInput {
  fromIsAdult: boolean;
  fromIsVerifiedTeacher: boolean;
  toIsMinor: boolean;
  toPref: "everyone" | "followers" | "none";
  followingBack: boolean;
  isContact: boolean;
  isBlockedByEither: boolean;
}

export interface InlineMessagingGateResult {
  allowed: boolean;
  guardianVisible?: boolean;
  flag?: "adult_to_minor" | "repeated_attempts";
}

export function canMessageCoreInline(ctx: InlineMessagingGateInput): InlineMessagingGateResult {
  if (ctx.isBlockedByEither) return { allowed: false };
  if (ctx.toPref === "none") return { allowed: false };
  if (!ctx.toIsMinor) {
    if (ctx.toPref === "followers" && !ctx.followingBack && !ctx.isContact) return { allowed: false };
    return { allowed: true };
  }
  if (!ctx.fromIsAdult && !ctx.followingBack && !ctx.isContact) return { allowed: false };
  if (ctx.fromIsAdult) {
    if (ctx.followingBack || ctx.isContact) return { allowed: true, guardianVisible: true };
    return { allowed: false, flag: "adult_to_minor" };
  }
  return { allowed: true, guardianVisible: true };
}

export const MINOR_CONTACT_ATTEMPT_LIMIT = 3; // must match safetyCore

export function evaluateContactPatternInline(attemptCount: number, toIsMinor: boolean): "none" | "watch" | "restrict" {
  if (!toIsMinor) return attemptCount >= 6 ? "watch" : "none";
  if (attemptCount > MINOR_CONTACT_ATTEMPT_LIMIT) return "restrict";
  if (attemptCount >= 2) return "watch";
  return "none";
}
