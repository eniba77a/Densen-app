/**
 * DENSEN — Messaging wire layer (Day 16).
 * ======================================
 * Real database workflows composing the pure core in `messaging.ts`:
 *
 *   - searchUsers           — privacy + age aware dancer directory (session required)
 *   - listMyConversations   — the caller's direct threads + server unread counts
 *   - getConversation       — one thread (membership-gated) + messages + read state
 *   - markConversationRead  — server read cursor (never moves backwards)
 *   - sendMessage           — text + typed shares through the full minor-contact
 *                             gate, grooming scan, contact-pattern watch; lazy
 *                             conversation creation; pref-checked recipient
 *                             notification (challenge_invite / message_share)
 *
 * Every input is resolved server-side: identity from the session token,
 * minor status/privacy/verification from real rows, blocks from real block
 * rows. The client gates are UX previews only. No PII in projections; audit
 * entries carry rule ids, never message bodies.
 */
import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

import { callerFromToken } from "./content";
import { scanGroomingCore } from "./safetyCore";
import {
  decideDirectMessage,
  decideSearch,
  decideShare,
  nextReadCursor,
  SHARE_KINDS,
  shareNotificationType,
  unreadCountFor,
  type ShareKind,
} from "./messaging";
import { conversationMembersOf, ensureConversationMembers } from "./messagingInternals";
import { notifyUser } from "./notifyInternals";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function requireCaller(db: any, sessionToken: string) {
  return callerFromToken(db, sessionToken);
}

async function appendAudit(
  db: any,
  entry: { actorUserId?: string; actorRole?: string; eventType: string; targetType?: string; targetId?: string; summary: string; now: number }
): Promise<void> {
  await db.insert("auditLogs", {
    actorUserId: entry.actorUserId ? (entry.actorUserId as never) : undefined,
    actorRole: entry.actorRole ? (entry.actorRole as never) : undefined,
    eventType: entry.eventType,
    targetType: entry.targetType,
    targetId: entry.targetId,
    summary: entry.summary,
    createdAt: entry.now,
  } as never);
}

/** Either-direction block between two users (absolute). */
async function blockedBetween(db: any, a: string, b: string): Promise<boolean> {
  if (!a || !b || a === b) return false;
  const fromA = (await db.query("blocks").withIndex("by_blocker", (q: any) => q.eq("blockerId", a)).collect()) as any[];
  if (fromA.some((r) => String(r.blockedId) === b)) return true;
  const fromB = (await db.query("blocks").withIndex("by_blocker", (q: any) => q.eq("blockerId", b)).collect()) as any[];
  return fromB.some((r) => String(r.blockedId) === a);
}

/** The caller's block + mute id lists (for search filtering + UI state). */
async function myBlockMuteIds(db: any, userId: string): Promise<{ blocked: string[]; muted: string[] }> {
  const blockRows = (await db.query("blocks").withIndex("by_blocker", (q: any) => q.eq("blockerId", userId)).collect()) as any[];
  const muteRows = (await db.query("mutes").withIndex("by_muter", (q: any) => q.eq("muterId", userId)).collect()) as any[];
  return {
    blocked: blockRows.map((r) => String(r.blockedId)),
    muted: muteRows.map((r) => String(r.mutedId)),
  };
}

/* ================================================================== */
/*                            User search                              */
/* ================================================================== */

export const searchUsers = queryGeneric({
  args: { sessionToken: v.string(), q: v.string() },
  handler: async (ctx, args) => {
    const caller = await requireCaller(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated" as const, users: [] as never[] };

    const me = (await ctx.db.get(caller.userId as never)) as any;
    const viewerIsMinor = Boolean(me?.isMinor);

    // Candidates: active profiles with their privacy rows. Bounded scan —
    // this is a prototype-scale directory; the handle index keeps it honest.
    const profiles = (await ctx.db.query("profiles").collect()) as any[];
    const privacyRows = (await ctx.db.query("privacySettings").collect()) as any[];
    const privacyByUser = new Map<string, any>(privacyRows.map((p) => [String(p.userId), p]));
    const usersById = new Map<string, any>();
    for (const p of profiles) {
      const u = (await ctx.db.get(p.userId as never)) as any;
      if (u) usersById.set(String(p.userId), u);
    }

    const { blocked, muted } = await myBlockMuteIds(ctx.db, caller.userId);
    const candidates = profiles
      .map((p) => ({
        userId: String(p.userId),
        handle: String(p.handle ?? ""),
        displayName: String(p.displayName ?? ""),
        isPrivate: Boolean(p.isPrivate),
        discoverableByHandle: Boolean(privacyByUser.get(String(p.userId))?.discoverableByHandle),
        status: String(usersById.get(String(p.userId))?.status ?? "deleted"),
      }));

    const decision = decideSearch({
      viewer: caller,
      query: args.q,
      candidates,
      blockedByViewer: blocked,
      mutedByViewer: muted,
      viewerIsMinor,
    });
    if (decision.action === "deny") return { ok: false as const, error: decision.error, users: [] as never[] };

    return { ok: true as const, users: decision.results };
  },
});

/* ================================================================== */
/*                          Conversations                              */
/* ================================================================== */

/** The caller's direct threads, newest message first, with unread counts. */
export const listMyConversations = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const caller = await requireCaller(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated" as const, conversations: [] as never[] };

    const convos = (await conversationMembersOf(ctx.db, String(caller.userId))) as any[];

    const out: {
      id: string;
      otherUserId: string;
      otherHandle: string;
      otherDisplayName: string;
      otherAvatarUrl?: string;
      guardianVisible: boolean;
      lastMessageAt: number | undefined;
      lastMessagePreview: string;
      unread: number;
      muted: boolean;
      blocked: boolean;
    }[] = [];

    for (const c of convos) {
      if (c.kind !== "direct") continue;
      const otherId = (c.memberUserIds as string[]).find((m) => String(m) !== String(caller.userId));
      if (!otherId) continue;

      const messages = (await ctx.db
        .query("messages")
        .withIndex("by_conversation_time", (q: any) => q.eq("conversationId", c._id))
        .order("desc")
        .take(50)) as any[];

      const readRow = (await ctx.db
        .query("conversationReads")
        .withIndex("by_member_read", (q: any) => q.eq("userId", caller.userId).eq("conversationId", c._id))
        .unique()) as any;
      const lastReadAt = readRow?.lastReadAt ?? 0;
      const unread = unreadCountFor({
        lastReadAt,
        messages: messages.map((m) => ({ _id: m._id as string, senderId: String(m.senderId), createdAt: m.createdAt as number })),
        viewerId: String(caller.userId),
      });

      const profile = (await ctx.db.query("profiles").withIndex("userId", (q: any) => q.eq("userId", otherId)).unique()) as any;
      const muteRows = (await ctx.db.query("mutes").withIndex("by_muter", (q: any) => q.eq("muterId", caller.userId)).collect()) as any[];
      const blockRows = (await ctx.db.query("blocks").withIndex("by_blocker", (q: any) => q.eq("blockerId", caller.userId)).collect()) as any[];

      const last = messages[0];
      const preview = last
        ? (last.body as string) ||
          (last.shareKind ? `📎 ${(last.attachmentTitle as string) ?? (last.shareKind as string)}` : "📎")
        : "";

      out.push({
        id: c._id as string,
        otherUserId: otherId,
        otherHandle: profile?.handle ?? "dancer",
        otherDisplayName: profile?.displayName ?? "Dancer",
        otherAvatarUrl: profile?.avatarUrl,
        guardianVisible: Boolean(c.guardianVisible),
        lastMessageAt: c.lastMessageAt as number | undefined,
        lastMessagePreview: preview,
        unread,
        muted: muteRows.some((r) => String(r.mutedId) === otherId),
        blocked: blockRows.some((r) => String(r.blockedId) === otherId),
      });
    }
    out.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
    return { ok: true as const, conversations: out };
  },
});

/** One thread with messages + my read state (membership enforced). */
export const getConversation = queryGeneric({
  // Day 22 chat-memory rule (spec §9): the thread loads as a bounded recent
  // window (latest 50). `before` is an optional createdAt cursor — the client
  // passes it only when the reader explicitly asks for older history.
  args: { sessionToken: v.string(), conversationId: v.string(), before: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const caller = await requireCaller(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated" as const };

    const convo = (await ctx.db.get(args.conversationId as never)) as any;
    if (!convo || convo.kind !== "direct") return { ok: false as const, error: "not_found" as const };
    if (!(convo.memberUserIds as string[]).map(String).includes(String(caller.userId))) {
      return { ok: false as const, error: "not_found" as const };
    }
    const otherId = (convo.memberUserIds as string[]).find((m) => String(m) !== String(caller.userId))!;

    const PAGE = 50;
    let rows = (await ctx.db
      .query("messages")
      .withIndex("by_conversation_time", (q: any) => q.eq("conversationId", convo._id))
      .order("desc")
      .take(PAGE + 1)) as any[];
    if (args.before !== undefined) {
      rows = (await ctx.db
        .query("messages")
        .withIndex("by_conversation_time", (q: any) => q.eq("conversationId", convo._id))
        .order("desc")
        .filter((q: any) => q.lt(q.field("createdAt"), args.before))
        .take(PAGE + 1)) as any[];
    }
    const hasMore = rows.length > PAGE;
    if (hasMore) rows = rows.slice(0, PAGE);
    const messages = rows.slice().reverse(); // ascending for the UI

    const readRow = (await ctx.db
      .query("conversationReads")
      .withIndex("by_member_read", (q: any) => q.eq("userId", caller.userId).eq("conversationId", convo._id))
      .unique()) as any;
    const lastReadAt = readRow?.lastReadAt ?? 0;

    const profile = (await ctx.db.query("profiles").withIndex("userId", (q: any) => q.eq("userId", otherId)).unique()) as any;
    const otherUser = (await ctx.db.get(otherId as never)) as any;
    const muteRows = (await ctx.db.query("mutes").withIndex("by_muter", (q: any) => q.eq("muterId", caller.userId)).collect()) as any[];
    const blockRows = (await ctx.db.query("blocks").withIndex("by_blocker", (q: any) => q.eq("blockerId", caller.userId)).collect()) as any[];

    return {
      ok: true as const,
      hasMore,
      conversation: {
        id: convo._id as string,
        otherUserId: otherId,
        otherHandle: profile?.handle ?? "dancer",
        otherDisplayName: profile?.displayName ?? "Dancer",
        otherAvatarUrl: profile?.avatarUrl,
        otherIsMinor: Boolean(otherUser?.isMinor),
        guardianVisible: Boolean(convo.guardianVisible),
        muted: muteRows.some((r) => String(r.mutedId) === otherId),
        blocked: blockRows.some((r) => String(r.blockedId) === otherId),
      },
      messages: messages.map((m) => ({
        id: m._id as string,
        mine: String(m.senderId) === String(caller.userId),
        senderId: String(m.senderId),
        body: (m.body as string) ?? "",
        shareKind: m.shareKind as string | undefined,
        attachmentType: m.attachmentType as string | undefined,
        attachmentRef: m.attachmentRef as string | undefined,
        attachmentTitle: m.attachmentTitle as string | undefined,
        flagged: Boolean(m.flagged),
        createdAt: m.createdAt as number,
      })),
      lastReadAt,
      unread: unreadCountFor({
        lastReadAt,
        messages: messages.map((m) => ({ _id: m._id as string, senderId: String(m.senderId), createdAt: m.createdAt as number })),
        viewerId: String(caller.userId),
      }),
    };
  },
});

/** Server read cursor — never moves backwards (core math). */
export const markConversationRead = mutationGeneric({
  args: { sessionToken: v.string(), conversationId: v.string() },
  handler: async (ctx, args) => {
    const caller = await requireCaller(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated" as const };

    const convo = (await ctx.db.get(args.conversationId as never)) as any;
    if (!convo || !(convo.memberUserIds as string[]).map(String).includes(String(caller.userId))) {
      return { ok: false as const, error: "not_found" as const };
    }
    const newest = (await ctx.db
      .query("messages")
      .withIndex("by_conversation_time", (q: any) => q.eq("conversationId", convo._id))
      .order("desc")
      .first()) as any;

    const readRow = (await ctx.db
      .query("conversationReads")
      .withIndex("by_member_read", (q: any) => q.eq("userId", caller.userId).eq("conversationId", convo._id))
      .unique()) as any;
    const lastReadAt = readRow?.lastReadAt ?? 0;
    const cursor = nextReadCursor(lastReadAt, newest?.createdAt ?? 0);
    if (cursor === lastReadAt) return { ok: true as const, lastReadAt };

    if (readRow) {
      await ctx.db.patch(readRow._id as never, { lastReadAt: cursor, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("conversationReads", {
        userId: caller.userId as never,
        conversationId: convo._id as never,
        lastReadAt: cursor,
        updatedAt: Date.now(),
      });
    }
    return { ok: true as const, lastReadAt: cursor };
  },
});

/* ================================================================== */
/*                    Send: text + typed rich shares                   */
/* ================================================================== */

/**
 * The caller's shareable content for the chat share sheet — REAL rows only:
 * ready videos, my published posts/combos/choreographies, the published
 * class/course catalog and open challenges. Everything returned here passes
 * decideShare at send time (published/open checks are re-run server-side).
 */
export const listShareableContent = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const caller = await requireCaller(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated" as const, items: [] as never[] };

    const items: {
      shareKind: (typeof SHARE_KINDS)[number];
      ref: string;
      title: string;
      subtitle?: string;
    }[] = [];

    // My ready videos.
    const videos = (await ctx.db
      .query("videos")
      .withIndex("by_owner", (q: any) => q.eq("ownerUserId", caller.userId))
      .collect()) as any[];
    for (const vRow of videos) {
      if ((vRow.processingStatus ?? "ready") !== "ready" || vRow.storageRef === "pending") continue;
      items.push({
        shareKind: "video",
        ref: vRow._id as string,
        title: vRow.altText || `Video · ${Math.round((vRow.durationSec as number) / 60)}min`,
      });
    }

    // My published posts.
    const myPosts = (await ctx.db
      .query("posts")
      .withIndex("by_user_status", (q: any) => q.eq("userId", caller.userId).eq("status", "published"))
      .collect()) as any[];
    for (const p of myPosts.slice(0, 20)) {
      items.push({ shareKind: "post", ref: p._id as string, title: (p.caption as string).slice(0, 80) });
    }

    // My combos + choreographies (published studio items only).
    const combos = (await ctx.db
      .query("combos")
      .withIndex("by_teacher", (q: any) => q.eq("teacherId", caller.userId))
      .collect()) as any[];
    for (const c of combos) {
      if (c.status !== "published") continue;
      items.push({ shareKind: "combo", ref: c._id as string, title: c.name as string, subtitle: c.style as string });
    }
    const choreos = (await ctx.db
      .query("choreographies")
      .withIndex("authorId", (q: any) => q.eq("authorId", caller.userId))
      .collect()) as any[];
    for (const ch of choreos) {
      if (ch.status !== "published") continue;
      items.push({ shareKind: "choreography", ref: ch._id as string, title: ch.title as string, subtitle: ch.style as string | undefined });
    }

    // The published catalog: classes + courses (shareable by everyone).
    const classes = (await ctx.db.query("classes").collect()) as any[];
    for (const cl of classes) {
      if (cl.status !== "published") continue;
      items.push({ shareKind: "class", ref: cl._id as string, title: cl.title as string, subtitle: cl.style as string });
    }
    const courses = (await ctx.db.query("courses").collect()) as any[];
    for (const co of courses) {
      if (co.status !== "published") continue;
      items.push({ shareKind: "course", ref: co._id as string, title: co.title as string, subtitle: co.style as string });
    }

    // Open challenges (invitation targets).
    const challenges = (await ctx.db.query("challenges").collect()) as any[];
    for (const ch of challenges) {
      if (ch.status !== "published") continue;
      if (challengePhaseOf(ch, Date.now()) !== "open") continue;
      items.push({ shareKind: "challenge_invite", ref: ch._id as string, title: ch.title as string });
    }

    items.sort((a, b) => a.title.localeCompare(b.title));
    return { ok: true as const, items: items.slice(0, 60) };
  },
});

const shareKindUnion = v.union(...SHARE_KINDS.map((k) => v.literal(k)));

export const sendMessage = mutationGeneric({
  args: {
    sessionToken: v.string(),
    recipientId: v.string(),
    body: v.string(),
    shareKind: v.optional(shareKindUnion),
    shareRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const caller = await requireCaller(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated" as const };
    if (args.recipientId === caller.userId) return { ok: false as const, error: "recipient_unavailable" as const };

    const recipient = (await ctx.db.get(args.recipientId as never)) as any;
    const recipientPrivacy = recipient
      ? ((await ctx.db.query("privacySettings").withIndex("by_user", (q: any) => q.eq("userId", recipient._id)).unique()) as any)
      : null;

    // Share validation (closed vocabulary, real target, challenge openness).
    let shareDecision: ReturnType<typeof decideShare> | null = null;
    if (args.shareKind) {
      const target = args.shareRef ? ((await ctx.db.get(args.shareRef as never)) as any) : null;
      const challengePhase =
        args.shareKind === "challenge_invite" && target
          ? (challengePhaseOf(target, now) as "upcoming" | "open" | "closed" | null)
          : null;
      shareDecision = decideShare({
        shareKind: args.shareKind,
        target: target
          ? { exists: true, isPublished: target.status === "published", ownerUserId: target.userId ? String(target.userId) : undefined }
          : null,
        challengePhase,
      });
    }

    // Either-direction block = absolute.
    const isBlockedByEither = await blockedBetween(ctx.db, caller.userId, args.recipientId);

    // Follow-back: does the recipient follow the caller?
    const recFollows = (await ctx.db
      .query("follows")
      .withIndex("by_follower", (q: any) => q.eq("followerId", args.recipientId))
      .collect()) as any[];
    const recipientFollowsCaller = recFollows.some((f) => String(f.followeeId) === String(caller.userId));

    // Existing direct thread between the two.
    const myConvos = (await conversationMembersOf(ctx.db, String(caller.userId))) as any[];
    const existing = myConvos.find(
      (c) => c.kind === "direct" && (c.memberUserIds as string[]).length === 2 && (c.memberUserIds as string[]).map(String).includes(args.recipientId)
    );

    // Verified teacher state from the schema state machine only.
    const myTeacher = (await ctx.db.query("teacherProfiles").withIndex("userId", (q: any) => q.eq("userId", caller.userId)).unique()) as any;
    const callerIsVerifiedTeacher = myTeacher?.status === "verified";

    // Contact-pattern window: sender's recent messages to this recipient.
    const recentToRecipient = (await ctx.db
      .query("messages")
      .withIndex("by_sender", (q: any) => q.eq("senderId", caller.userId))
      .order("desc")
      .take(200)) as any[];
    const contactAttemptCount = recentToRecipient.filter(
      (m) => String(m.recipientId ?? "") === String(args.recipientId) && now - (m.createdAt as number) < 24 * 60 * 60 * 1000
    ).length;

    // Server grooming scan on the body (authoritative).
    const groom = scanGroomingCore(args.body);
    const me = (await ctx.db.get(caller.userId as never)) as any;

    const decision = decideDirectMessage({
      caller,
      callerIsMinor: Boolean(me?.isMinor),
      body: args.body.trim(),
      share: shareDecision,
      recipient: recipient ? { userId: String(recipient._id), isMinor: Boolean(recipient.isMinor), status: String(recipient.status) } : null,
      recipientPrivacy: recipientPrivacy ? { messagesFrom: recipientPrivacy.messagesFrom } : null,
      callerIsVerifiedTeacher,
      recipientFollowsCaller,
      existingConversation: existing ? { _id: existing._id as string, guardianVisible: Boolean(existing.guardianVisible) } : null,
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
      await ctx.db.insert("conversationMembers", { conversationId: conversationId as never, userId: caller.userId as never, createdAt: now });
      await ctx.db.insert("conversationMembers", { conversationId: conversationId as never, userId: args.recipientId as never, createdAt: now });
    } else {
      // Legacy thread (pre-mirror): backfill so the next list lookup is index-backed.
      await ensureConversationMembers(ctx.db, conversationId as string);
    }

    const shareAllowed = shareDecision && shareDecision.action === "allow" ? shareDecision : null;
    await ctx.db.insert("messages", {
      conversationId: conversationId as never,
      senderId: caller.userId as never,
      body: args.body.trim() || undefined,
      shareKind: shareAllowed ? (shareAllowed.shareKind as never) : undefined,
      attachmentType: shareAllowed ? (mapAttachmentType(shareAllowed.shareKind) as never) : undefined,
      attachmentRef: args.shareRef,
      attachmentTitle: shareAllowed ? (await shareTitleFor(ctx.db, shareAllowed.shareKind, args.shareRef)) : undefined,
      flagged: decision.flagged,
      createdAt: now,
      recipientId: args.recipientId as never,
    });

    await ctx.db.patch(conversationId as never, { lastMessageAt: now });

    // Pref-checked recipient notification (message / challenge_invite).
    if (recipient) {
      await notifyUser(ctx.db, {
        userId: String(recipient._id),
        actorUserId: caller.userId,
        type: shareAllowed ? shareNotificationType(shareAllowed.shareKind) : "message",
        targetType: "conversation",
        targetId: conversationId,
        now,
      });
    }

    await appendAudit(ctx.db, {
      actorUserId: caller.userId,
      actorRole: String(me?.role ?? "user"),
      eventType: "messaging",
      targetType: "conversation",
      targetId: conversationId,
      summary:
        (decision.watchlist === "restrict" || decision.watchlist === "watch" ? `contact_pattern_${decision.watchlist}; ` : "") +
        (decision.flagged ? "message_flagged_grooming_review; " : "") +
        `dm_delivered${shareAllowed ? ` share:${shareAllowed.shareKind}` : ""}; guardianVisible:${decision.guardianVisible}`,
      now,
    });

    return { ok: true as const, conversationId };
  },
});

/* ------------------------------ helpers ------------------------------ */

function challengePhaseOf(row: any, now: number): "upcoming" | "open" | "closed" {
  const startsAt = row?.startsAt as number | undefined;
  const deadlineAt = row?.deadlineAt as number | undefined;
  if (startsAt && now < startsAt) return "upcoming";
  if (deadlineAt && now > deadlineAt) return "closed";
  return "open";
}

function mapAttachmentType(kind: ShareKind): string {
  switch (kind) {
    case "class":
    case "course":
      return "lesson";
    case "video":
    case "post":
    case "choreography":
    case "combo":
      return kind;
    case "challenge_invite":
      return "challenge";
  }
}

async function shareTitleFor(db: any, _kind: ShareKind, ref: string | undefined): Promise<string | undefined> {
  if (!ref) return undefined;
  const row = (await db.get(ref as never)) as any;
  if (!row) return undefined;
  return (row.title as string) ?? (row.caption as string) ?? (row.name as string) ?? undefined;
}
