/**
 * DENSEN — Notification center wire layer (Day 16).
 * ================================================
 * Real database workflows over the pure cores in `notifyInternals.ts`:
 *
 *   - listMyNotifications   — the caller's feed (rows + read/unread + unread count)
 *   - markMyNotificationsRead — all or a subset (ids) — read state is server state
 *   - getNotificationPrefs  — the caller's category mutes + catalog (for settings UI)
 *   - setNotificationPref   — opt out / back in per category (security immutable)
 *
 * Every notification PRODUCER routes through notifyUser() in
 * notifyInternals.ts, so a muted category is suppressed at write time —
 * muted inboxes are not filtered client-side, they simply never fill.
 */
import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

import { callerFromToken } from "./content";
import {
  categoryForType,
  decidePrefChange,
  defaultMutedFor,
  MUTABLE_CATEGORIES,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from "./notifyInternals";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function requireCaller(db: any, sessionToken: string) {
  return callerFromToken(db, sessionToken);
}

/** The caller's muted categories (empty row = defaults already applied at signup). */
async function mutedOf(db: any, userId: string): Promise<NotificationCategory[]> {
  const row = (await db
    .query("notificationPrefs")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .unique()) as { mutedCategories?: NotificationCategory[] } | null;
  return row?.mutedCategories ?? [];
}

/* ================================================================== */
/*                              Reads                                  */
/* ================================================================== */

export const listMyNotifications = queryGeneric({
  args: { sessionToken: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const caller = await requireCaller(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated" as const, notifications: [], unread: 0 };

    const limit = Math.min(Math.max(args.limit ?? 60, 1), 200);
    const rows = (await ctx.db
      .query("notifications")
      .withIndex("by_user_recent", (q: any) => q.eq("userId", caller.userId))
      .order("desc")
      .take(limit)) as any[];

    let unread = 0;
    for (const r of rows) if (!r.read) unread += 1;

    // Actor display fields resolve through public profile rows only (no PII).
    const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter(Boolean))] as string[];
    const actorProfiles = new Map<string, { handle?: string; displayName?: string; avatarUrl?: string }>();
    for (const actorId of actorIds) {
      const p = (await ctx.db
        .query("profiles")
        .withIndex("userId", (q: any) => q.eq("userId", actorId))
        .unique()) as any;
      if (p) actorProfiles.set(actorId, { handle: p.handle, displayName: p.displayName, avatarUrl: p.avatarUrl });
    }

    return {
      ok: true as const,
      notifications: rows.map((r) => ({
        id: r._id as string,
        type: r.type as string,
        category: categoryForType(r.type as string),
        targetType: r.targetType as string | undefined,
        targetId: r.targetId as string | undefined,
        read: r.read as boolean,
        createdAt: r.createdAt as number,
        actor: r.actorUserId ? (actorProfiles.get(r.actorUserId as string) ?? null) : null,
      })),
      unread,
    };
  },
});

/** Read state is server state: patching rows is the only way anything is "read". */
export const markMyNotificationsRead = mutationGeneric({
  args: { sessionToken: v.string(), ids: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => {
    const caller = await requireCaller(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated" as const };

    const rows = (await ctx.db
      .query("notifications")
      .withIndex("by_user_unread", (q: any) => q.eq("userId", caller.userId).eq("read", false))
      .collect()) as any[];
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

/* ================================================================== */
/*                          Preferences                                */
/* ================================================================== */

export const getNotificationPrefs = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const caller = await requireCaller(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated" as const };

    const user = (await ctx.db.get(caller.userId as never)) as any;
    const muted = await mutedOf(ctx.db, caller.userId);
    return {
      ok: true as const,
      mutedCategories: muted,
      categories: NOTIFICATION_CATEGORIES,
      mutableCategories: MUTABLE_CATEGORIES as readonly string[],
      securityAlwaysOn: true,
      ageBand: (user?.ageBand ?? "adult") as string,
    };
  },
});

export const setNotificationPref = mutationGeneric({
  args: {
    sessionToken: v.string(),
    category: v.string(),
    /** true = receive this category again; false = mute it. */
    enable: v.boolean(),
  },
  handler: async (ctx, args) => {
    const caller = await requireCaller(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated" as const };

    const muted = await mutedOf(ctx.db, caller.userId);
    const decision = decidePrefChange({ currentMuted: muted, category: args.category, enable: args.enable });
    if (decision.action === "deny") return { ok: false as const, error: decision.error };

    const existing = (await ctx.db
      .query("notificationPrefs")
      .withIndex("by_user", (q: any) => q.eq("userId", caller.userId))
      .unique()) as any;

    if (existing) {
      await ctx.db.patch(existing._id as never, { mutedCategories: decision.muted, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("notificationPrefs", {
        userId: caller.userId as never,
        mutedCategories: decision.muted,
        updatedAt: Date.now(),
      });
    }
    return { ok: true as const, mutedCategories: decision.muted };
  },
});

/**
 * Write the age-aware default mutes for a user. Used at signup (auth.ts)
 * so a fresh child/teen account starts quiet. Idempotent: an existing row
 * is never overwritten (user choices win over defaults).
 */
export async function ensureNotificationDefaults(db: any, userId: string, ageBand: string, now: number): Promise<void> {
  const existing = (await db
    .query("notificationPrefs")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .unique()) as unknown;
  if (existing) return;
  await db.insert("notificationPrefs", {
    userId: userId as never,
    mutedCategories: defaultMutedFor(ageBand as any),
    updatedAt: now,
  });
}
