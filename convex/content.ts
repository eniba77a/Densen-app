/**
 * DENSEN — Content module (Day 3): posts, comments, messages, notifications.
 * ========================================================================
 * The server write paths the Day-1/Day-2 schema prepared. Safety enforcement
 * lives here (convex/safetyCore.ts), NOT in the client: the client scanners
 * are a UX preview, these are the gate.
 *
 * Identity: resolved from the Day-2 session token (raw token in React memory,
 * validated server-side against authSessions). Guests have no write path.
 *
 * Every decision is a pure core (unit-tested); every wire function is thin.
 * Blocked content is never stored; audit entries contain no PII.
 */
import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { sha256Hex } from "./authInternals";
import { sessionValid } from "./sessionsInternals";
import {
  scanCommentCore,
  scanGroomingCore,
  scanVideoSubmissionCore,
  canMessageCore,
  evaluateContactPatternCore,
} from "./safetyCore";
import type { Caller, Role } from "./security";

/* ================================================================== */
/*                    Caller resolution + notify helper               */
/* ================================================================== */

/**
 * Resolve a Caller from a raw session token. Invalid/revoked/expired ⇒ null.
 * (db is typed loosely: the generic-mode builder's overloaded `get` is not
 * structurally expressible here; table/query usage is bounded to this module.)
 */
export async function callerFromToken(
  db: { get: any; query: (t: string) => any },
  sessionToken: string
): Promise<Caller | null> {
  const tokenHash = await sha256Hex(sessionToken);
  const session = await db
    .query("authSessions")
    .withIndex("by_token_hash", (q: any) => q.eq("tokenHash", tokenHash))
    .unique();
  if (!session || !sessionValid(session as { expiresAt: number; revokedAt?: number }, Date.now())) {
    return null;
  }
  const user = await db.get(session.userId);
  if (!user || user.status === "deleted" || user.status === "suspended") return null;
  return {
    userId: user._id as string,
    role: user.role as Role,
    userStatus: user.status as Caller["userStatus"],
  };
}

/** Insert a notification row. Never notifies an actor about their own action. */
export async function notify(
  db: { insert: (t: string, row: Record<string, unknown>) => Promise<unknown> },
  n: {
    userId: string;
    actorUserId?: string;
    type: string;
    targetType?: string;
    targetId?: string;
    now: number;
  }
): Promise<void> {
  if (n.actorUserId && n.actorUserId === n.userId) return;
  await db.insert("notifications", {
    userId: n.userId as never,
    actorUserId: n.actorUserId ? (n.actorUserId as never) : undefined,
    type: n.type,
    targetType: n.targetType,
    targetId: n.targetId,
    read: false,
    createdAt: n.now,
  });
}

/* ================================================================== */
/*                          Comments (Talk layer)                      */
/* ================================================================== */

export interface CommentDecisionInput {
  caller: Caller | null;
  /** Trimmed comment body as submitted. */
  body: string;
  /** The post being commented on, as visible server-side (null = missing). */
  post: {
    _id: string;
    userId: string;
    status: string;
    visibility: "public" | "followers" | "private";
  } | null;
  /** Post author's band/isMinor/status for safety gates. */
  author: { isMinor: boolean; status: string } | null;
  /** Author's privacy row (comment filter). */
  authorPrivacy: { commentFilter: boolean; privateAccount: boolean } | null;
  /** Caller blocks author or vice versa (either direction is absolute). */
  blockedByEither: boolean;
  /** Caller follows the author (visibility="followers" gate). */
  callerFollowsAuthor: boolean;
  now: number;
}

export type CommentDecision =
  | { action: "insert"; status: "visible" | "hidden"; notifyUserId: string; ruleIds: string[] }
  | {
      action: "deny";
      error:
        | "unauthenticated"
        | "caller_restricted"
        | "post_unavailable"
        | "author_privacy"
        | "blocked";
    };

/**
 * Decide a comment write. Fail-closed and server-authoritative:
 *  - the client scan is a preview; THIS scan decides (blocked ⇒ never stored)
 *  - blocked relationships are absolute (either direction)
 *  - hidden verdicts are stored as status="hidden" (invisible in feeds,
 *    retained for moderation review)
 *  - author commentFilter=true denies ("author_privacy") — pre-approval
 *    gating is a moderation feature, not shipped half-way here
 */
export function decideComment(input: CommentDecisionInput): CommentDecision {
  if (!input.caller) return { action: "deny", error: "unauthenticated" };
  if (input.caller.userStatus === "suspended") return { action: "deny", error: "caller_restricted" };
  if (input.blockedByEither) return { action: "deny", error: "blocked" };
  const post = input.post;
  if (!post || post.status !== "published") return { action: "deny", error: "post_unavailable" };
  if (input.author && input.author.status !== "active") return { action: "deny", error: "post_unavailable" };

  if (input.authorPrivacy?.commentFilter) return { action: "deny", error: "author_privacy" };

  if (post.visibility === "private" && input.caller.userId !== post.userId) {
    return { action: "deny", error: "post_unavailable" };
  }
  if (post.visibility === "followers" && input.caller.userId !== post.userId && !input.callerFollowsAuthor) {
    return { action: "deny", error: "post_unavailable" };
  }

  const scan = scanCommentCore(input.body, input.author?.isMinor ?? false);
  if (scan.verdict === "blocked") {
    // Blocked content is never persisted — the rule IDs go back to the caller.
    return { action: "deny", error: "blocked" };
  }
  const hidden = scan.verdict === "hidden";
  return {
    action: "insert",
    status: hidden ? "hidden" : "visible",
    notifyUserId: post.userId,
    ruleIds: scan.ruleIds,
  };
}

/** commentCount delta on the post for an accepted, visible comment. */
export function commentCountDelta(decision: CommentDecision): number {
  return decision.action === "insert" && decision.status === "visible" ? 1 : 0;
}

/**
 * Create a comment on a post. Identity from session token; the server scan
 * (not the client preview) is the gate; count + notification are consistent
 * in-transaction. Blocked verdicts are rejected WITHOUT storing the body.
 */
export const createComment = mutationGeneric({
  args: { sessionToken: v.string(), postId: v.string(), body: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const caller = await callerFromToken(ctx.db, args.sessionToken);
    const body = args.body.trim();
    if (!caller) return { ok: false as const, error: "unauthenticated" };
    if (body.length === 0 || body.length > 500) return { ok: false as const, error: "invalid_body" };

    const post = (await ctx.db.get(args.postId as never)) as
      | { _id: string; userId: string; status: string; visibility: "public" | "followers" | "private" }
      | null;
    const author = post
      ? ((await ctx.db.get(post.userId as never)) as { isMinor: boolean; status: string } | null)
      : null;
    const authorPrivacy = post
      ? ((await ctx.db
          .query("privacySettings")
          .withIndex("by_user", (q: any) => q.eq("userId", post.userId))
          .unique()) as { commentFilter: boolean; privateAccount: boolean } | null)
      : null;

    // Either-direction block = absolute.
    const myBlocks = (await ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q: any) => q.eq("blockerId", caller.userId as never))
      .collect()) as { blockedId: string }[];
    const blocksMe = (await ctx.db
      .query("blocks")
      .withIndex("by_blocked", (q: any) => q.eq("blockedId", caller.userId as never))
      .collect()) as { blockerId: string }[];
    const blockedByEither =
      myBlocks.some((b) => b.blockedId === post?.userId) || blocksMe.some((b) => b.blockerId === post?.userId);

    // follows-gate for visibility="followers"
    const myFollows = (await ctx.db
      .query("follows")
      .withIndex("by_follower", (q: any) => q.eq("followerId", caller.userId as never))
      .collect()) as { followeeId: string }[];
    const callerFollowsAuthor = myFollows.some((f) => f.followeeId === post?.userId);

    const decision = decideComment({
      caller,
      body,
      post: post
        ? {
            _id: post._id as string,
            userId: post.userId as string,
            status: post.status,
            visibility: post.visibility,
          }
        : null,
      author: author ? { isMinor: author.isMinor, status: author.status } : null,
      authorPrivacy: authorPrivacy
        ? { commentFilter: authorPrivacy.commentFilter, privateAccount: authorPrivacy.privateAccount }
        : null,
      blockedByEither,
      callerFollowsAuthor,
      now,
    });

    if (decision.action === "deny") return { ok: false as const, error: decision.error, ruleIds: [] as string[] };

    await ctx.db.insert("comments", {
      postId: args.postId as never,
      userId: caller.userId as never,
      body,
      status: decision.status,
      createdAt: now,
      updatedAt: now,
    });
    const delta = commentCountDelta(decision);
    if (delta !== 0 && post) {
      await ctx.db.patch(post._id as never, { commentCount: Math.max(0, (post as any).commentCount + delta) });
    }
    await notify(ctx.db, {
      userId: decision.notifyUserId,
      actorUserId: caller.userId,
      type: "comment",
      targetType: "post",
      targetId: args.postId,
      now,
    });
    await ctx.db.insert("auditLogs", {
      actorUserId: caller.userId as never,
      action: decision.status === "hidden" ? "comment_auto_hidden" : "comment_created",
      summary: `comment on post; rules:${decision.ruleIds.join("|") || "none"}`,
      createdAt: now,
    });
    return { ok: true as const, status: decision.status };
  },
});

/* ================================================================== */
/*                    Posts (Feed layer: publish path)                 */
/* ================================================================== */

export interface PostDecisionInput {
  caller: Caller | null;
  caption: string;
  /** Server-side scan result (already computed by the wire layer). */
  scan: { status: "published" | "in_review" | "blocked"; ruleIds: string[] };
}

export type PostDecision =
  | { action: "insert"; status: "published" | "in_review" }
  | { action: "deny"; error: "unauthenticated" | "caller_restricted" | "blocked_by_safety" | "invalid_caption" };

/**
 * Decide a post publish. The scan result comes from scanVideoSubmissionCore —
 * blocked content is never stored; review content is stored as "in_review"
 * (invisible in feeds until a moderator approves).
 */
export function decidePost(input: PostDecisionInput): PostDecision {
  if (!input.caller) return { action: "deny", error: "unauthenticated" };
  if (input.caller.userStatus === "suspended") return { action: "deny", error: "caller_restricted" };
  const caption = input.caption.trim();
  if (caption.length === 0 || caption.length > 2200) return { action: "deny", error: "invalid_caption" };
  if (input.scan.status === "blocked") return { action: "deny", error: "blocked_by_safety" };
  return { action: "insert", status: input.scan.status };
}

/**
 * Create a post. Identity from session token; publish state decided by the
 * SERVER scan (creator minor status comes from the caller's own row, never
 * from client input). Minors with review-level signals are held for human
 * moderation (never auto-published). Visibility and remix flags honor the
 * caller's profile defaults as passed by the client.
 */
export const createPost = mutationGeneric({
  args: {
    sessionToken: v.string(),
    caption: v.string(),
    hashtags: v.array(v.string()),
    style: v.string(),
    visibility: v.union(v.literal("public"), v.literal("followers"), v.literal("private")),
    audioLicensed: v.boolean(),
    /** True only when the client had a real uploaded video ref (media module). */
    storageRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const caller = await callerFromToken(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated" };

    const user = (await ctx.db.get(caller.userId as never)) as { isMinor: boolean } | null;
    const creatorIsMinor = user?.isMinor ?? false;

    // Server-side safety scan — the authoritative gate.
    const scan = scanVideoSubmissionCore({
      caption: args.caption,
      hashtags: args.hashtags,
      audioLicensed: args.audioLicensed,
      creatorIsMinor,
    });

    const decision = decidePost({
      caller,
      caption: args.caption,
      scan,
    });
    if (decision.action === "deny") return { ok: false as const, error: decision.error, ruleIds: scan.ruleIds };

    const postId = await ctx.db.insert("posts", {
      userId: caller.userId as never,
      caption: args.caption.trim(),
      hashtags: args.hashtags,
      style: args.style,
      visibility: args.visibility,
      status: decision.status,
      likeCount: 0,
      commentCount: 0,
      shareCount: 0,
      viewCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("auditLogs", {
      actorUserId: caller.userId as never,
      action: decision.status === "in_review" ? "post_held_for_review" : "post_published",
      summary: `post publish scan; rules:${scan.ruleIds.join("|") || "none"}`,
      createdAt: now,
    });
    return { ok: true as const, postId, status: decision.status };
  },
});

/* ================================================================== */
/*             Messaging (private conversations, minor-safe)           */
/* ================================================================== */

export interface MessageDecisionInput {
  caller: Caller | null;
  /** Caller's minor status from their own server row (never client input). */
  callerIsMinor: boolean;
  /** Trimmed message body as submitted. */
  body: string;
  recipient: {
    userId: string;
    isMinor: boolean;
    role: string;
    status: string;
  } | null;
  /** Recipient's privacy row. */
  recipientPrivacy: { messagesFrom: "everyone" | "followers" | "none" } | null;
  /** Sender is a VERIFIED teacher (schema state machine, not self-claimed). */
  callerIsVerifiedTeacher: boolean;
  /** The recipient follows the sender back. */
  recipientFollowsCaller: boolean;
  /** An existing direct conversation between the two. */
  existingConversation: { _id: string; guardianVisible: boolean } | null;
  isBlockedByEither: boolean;
  /** Contact attempts sender→recipient (dm+mention+duet+tag) in the window. */
  contactAttemptCount: number;
  /** Server grooming scan result for this body. */
  groomSeverity: "none" | "review" | "critical";
}

export type MessageDecision =
  | {
      action: "deliver";
      conversationId: string;
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
        | "abuse_pattern";
    };

/**
 * Decide a direct message. Lockstep with the client canMessage table:
 * blocks are absolute; minors can only be contacted by followed-back dancers
 * (or reply inside an existing thread); adults can never OPEN a thread with a
 * minor. Grooming-critical bodies are never delivered. Teacher↔minor threads
 * are guardian-visible — safety, never secrecy.
 */
export function decideMessage(input: MessageDecisionInput): MessageDecision {
  if (!input.caller) return { action: "deny", error: "unauthenticated" };
  if (input.caller.userStatus === "suspended") return { action: "deny", error: "caller_restricted" };
  const body = input.body.trim();
  if (body.length === 0 || body.length > 2000) return { action: "deny", error: "invalid_body" };
  if (!input.recipient || input.recipient.status !== "active") {
    return { action: "deny", error: "recipient_unavailable" };
  }
  if (input.isBlockedByEither) return { action: "deny", error: "blocked" };

  const gate = canMessageCore({
    fromIsAdult: !input.callerIsMinor,
    fromIsVerifiedTeacher: input.callerIsVerifiedTeacher,
    toIsMinor: input.recipient.isMinor,
    toPref: input.recipientPrivacy?.messagesFrom ?? "followers",
    followingBack: input.recipientFollowsCaller,
    isContact: input.existingConversation !== null,
    isBlockedByEither: input.isBlockedByEither,
  });
  if (!gate.allowed) {
    const error = gate.flag === "adult_to_minor"
      ? "adult_to_minor"
      : input.recipient.isMinor
        ? "minor_gate"
        : input.recipientPrivacy?.messagesFrom === "none"
          ? "messaging_off"
          : "followers_only";
    return { action: "deny", error };
  }

  const watchlist = evaluateContactPatternCore(input.contactAttemptCount, input.recipient.isMinor);
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

/**
 * Send a direct message. Identity from session token; the minor-contact gate,
 * grooming scan and contact-pattern evaluation all run SERVER-SIDE here —
 * the client checks are UX previews only. Conversation creation is lazy:
 * a thread exists only once a message is actually delivered. Teacher↔minor
 * threads are flagged guardian-visible. Denied messages are never stored.
 */
export const sendMessage = mutationGeneric({
  args: { sessionToken: v.string(), recipientId: v.string(), body: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const caller = await callerFromToken(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated" };
    if (args.recipientId === caller.userId) return { ok: false as const, error: "recipient_unavailable" };

    const recipient = (await ctx.db.get(args.recipientId as never)) as
      | { _id: string; isMinor: boolean; role: string; status: string }
      | null;
    const recipientPrivacy = recipient
      ? ((await ctx.db
          .query("privacySettings")
          .withIndex("by_user", (q: any) => q.eq("userId", recipient._id))
          .unique()) as { messagesFrom: "everyone" | "followers" | "none" } | null)
      : null;

    // Either-direction block = absolute.
    const myBlocks = (await ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q: any) => q.eq("blockerId", caller.userId as never))
      .collect()) as { blockedId: string }[];
    const blocksMe = (await ctx.db
      .query("blocks")
      .withIndex("by_blocked", (q: any) => q.eq("blockedId", caller.userId as never))
      .collect()) as { blockerId: string }[];
    const isBlockedByEither =
      myBlocks.some((b) => b.blockedId === args.recipientId) || blocksMe.some((b) => b.blockerId === args.recipientId);

    // Does the recipient follow the caller back?
    const recFollows = (await ctx.db
      .query("follows")
      .withIndex("by_follower", (q: any) => q.eq("followerId", args.recipientId as never))
      .collect()) as { followeeId: string }[];
    const recipientFollowsCaller = recFollows.some((f) => f.followeeId === caller.userId);

    // Existing direct thread between the two (bounded member-index scan).
    const myConversations = (await ctx.db
      .query("conversations")
      .withIndex("by_member", (q: any) => q.eq("memberUserIds", caller.userId as never))
      .collect()) as { _id: string; kind: string; memberUserIds: string[]; guardianVisible: boolean }[];
    const existing =
      myConversations.find(
        (c) =>
          c.kind === "direct" &&
          c.memberUserIds.length === 2 &&
          c.memberUserIds.includes(args.recipientId)
      ) ?? null;

    // Caller's verified-teacher state from the schema state machine only.
    const myTeacher = (await ctx.db
      .query("teacherProfiles")
      .withIndex("teacherId", (q: any) => q.eq("teacherId", caller.userId as never))
      .unique()) as { verificationStatus?: string } | null;
    const callerIsVerifiedTeacher = myTeacher?.verificationStatus === "verified";

    // Contact-pattern window: sender's recent messages to this recipient
    // (newest-first bounded scan; recipientId groups the thread).
    const recentToRecipient = (await ctx.db
      .query("messages")
      .withIndex("by_sender", (q: any) => q.eq("senderId", caller.userId as never))
      .order("desc")
      .take(200)) as { recipientId?: string; createdAt: number }[];
    const contactAttemptCount = recentToRecipient.filter(
      (m) => (m as any).recipientId === args.recipientId && now - m.createdAt < 24 * 60 * 60 * 1000
    ).length;

    // Server grooming scan on the body (authoritative).
    const groom = scanGroomingCore(args.body);

    const callerUser = (await ctx.db.get(caller.userId as never)) as { isMinor: boolean } | null;
    const decision = decideMessage({
      caller,
      callerIsMinor: callerUser?.isMinor ?? false,
      body: args.body,
      recipient: recipient
        ? { userId: recipient._id as string, isMinor: recipient.isMinor, role: recipient.role, status: recipient.status }
        : null,
      recipientPrivacy: recipientPrivacy
        ? { messagesFrom: recipientPrivacy.messagesFrom }
        : null,
      callerIsVerifiedTeacher,
      recipientFollowsCaller,
      existingConversation: existing ? { _id: existing._id as string, guardianVisible: existing.guardianVisible } : null,
      isBlockedByEither,
      contactAttemptCount,
      groomSeverity: groom.severity,
    });
    if (decision.action === "deny") return { ok: false as const, error: decision.error };

    let conversationId = decision.conversationId;
    if (!conversationId) {
      conversationId = (await ctx.db.insert("conversations", {
        kind: "direct",
        memberUserIds: [caller.userId, args.recipientId] as never,
        guardianVisible: decision.guardianVisible,
        createdAt: now,
      })) as string;
    }

    await ctx.db.insert("messages", {
      conversationId: conversationId as never,
      senderId: caller.userId as never,
      body: args.body.trim(),
      flagged: decision.flagged,
      createdAt: now,
      recipientId: args.recipientId as never,
    });

    await ctx.db.patch(conversationId as never, { lastMessageAt: now });
    await notify(ctx.db, {
      userId: args.recipientId,
      actorUserId: caller.userId,
      type: "message",
      targetType: "conversation",
      targetId: conversationId,
      now,
    });
    await ctx.db.insert("auditLogs", {
      actorUserId: caller.userId as never,
      action:
        decision.watchlist === "restrict" || decision.watchlist === "watch"
          ? `contact_pattern_${decision.watchlist}`
          : decision.flagged
            ? "message_flagged_grooming_review"
            : "message_delivered",
      summary: `dm gate; guardianVisible:${decision.guardianVisible}`,
      createdAt: now,
    });
    return { ok: true as const, conversationId };
  },
});

/* ================================================================== */
/*                       Notifications (real API)                      */
/* ================================================================== */

/**
 * The caller's latest notifications, newest first. Auth via session token.
 * Rows are non-PII by schema; actor handles are resolved to public profile
 * fields only (displayName/handle/avatar) — never email/DOB/location.
 */
export const listNotifications = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const caller = await callerFromToken(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, notifications: [] as never[] };

    const rows = (await ctx.db
      .query("notifications")
      .withIndex("by_user_recent", (q: any) => q.eq("userId", caller.userId as never))
      .order("desc")
      .take(50)) as {
      _id: string;
      actorUserId?: string;
      type: string;
      targetType?: string;
      targetId?: string;
      read: boolean;
      createdAt: number;
    }[];

    // Resolve actor display fields through public profile rows only.
    const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter(Boolean))] as string[];
    const actorProfiles = new Map<string, { handle?: string; displayName?: string; avatarUrl?: string }>();
    for (const actorId of actorIds) {
      const p = (await ctx.db
        .query("profiles")
        .withIndex("userId", (q: any) => q.eq("userId", actorId as never))
        .unique()) as { handle?: string; displayName?: string; avatarUrl?: string } | null;
      if (p) actorProfiles.set(actorId, { handle: p.handle, displayName: p.displayName, avatarUrl: p.avatarUrl });
    }

    return {
      ok: true as const,
      notifications: rows.map((r) => ({
        id: r._id as string,
        type: r.type,
        targetType: r.targetType,
        targetId: r.targetId,
        read: r.read,
        createdAt: r.createdAt,
        actor: r.actorUserId ? (actorProfiles.get(r.actorUserId as string) ?? null) : null,
      })),
    };
  },
});

/** Mark the caller's notifications read — all, or a specific list of ids. */
export const markNotificationsRead = mutationGeneric({
  args: { sessionToken: v.string(), ids: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => {
    const caller = await callerFromToken(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated" };

    const rows = (await ctx.db
      .query("notifications")
      .withIndex("by_user_unread", (q: any) => q.eq("userId", caller.userId as never).eq("read", false))
      .collect()) as { _id: string }[];
    const idSet = args.ids ? new Set(args.ids) : null;
    let count = 0;
    for (const r of rows) {
      if (idSet && !idSet.has(r._id as string)) continue;
      await ctx.db.patch(r._id as never, { read: true });
      count += 1;
    }
    return { ok: true as const, marked: count };
  },
});
