/**
 * DENSEN — Densen Help wire layer (Day 21).
 * =========================================
 * The assistant that lives INSIDE Messages (Messages → Densen Help 🤖).
 * It answers only app-usage and basic-dance questions; everything else is
 * refused/redirected (spec §3/§4). The knowledge base in `helpInternals.ts`
 * is the source of truth: FAQ matches are answered deterministically BEFORE
 * any AI call; unmatched in-scope questions go to the server-only AI action
 * (`helpAi.ts`) with trimmed context + retrieved docs, and the model's reply
 * is scope-validated before it is ever stored (spec §7/§9/§10).
 *
 * Every function:
 *   - resolves the caller from the SESSION TOKEN (identity never from args);
 *   - fails closed, and fails HONESTLY: with no AI key configured the AI path
 *     returns `assistant_not_configured` — it never fakes an AI answer;
 *   - audits safety events (`help_event`) with reason ids, never bodies;
 *   - never auto-bans: injection attempts are flagged for staff, only.
 *
 * Rate limiting (spec §13) is per-user over rolling day/hour windows, counted
 * from `helpRateEvents` (mirrors interactions.ts), admin-configurable.
 */
import { internalMutationGeneric, mutationGeneric, queryGeneric, anyApi } from "convex/server";
import { v } from "convex/values";

import { callerFromToken } from "./content";
import { requireRole, type Caller } from "./security";
import {
  DEFAULT_HELP_CONFIG,
  HELP_DOCS,
  MAX_CONTEXT_MESSAGES,
  SAFE_REPLIES,
  classifyHelpMessage,
  findHelpDoc,
  normalizeHelpInput,
  rankHelpDocs,
  type BilingualText,
  type HelpLang,
  type HelpMessageDecision,
} from "./helpInternals";

// Convex functions run in a managed server runtime that provides `process.env`.
// Declared locally because the browser-oriented tsconfig has no @types/node.
declare const process: { env: Record<string, string | undefined> };

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

export const AI_ASSISTANT_ERROR = "assistant_not_configured" as const;

/** The config row merged over the code defaults — always complete. */
export interface HelpEffectiveConfig {
  enabled: boolean;
  welcomeMessage: BilingualText;
  maxMessageLength: number;
  rateLimitPerDay: number;
  rateLimitPerHour: number;
  model: string;
  faqVersion: number;
}

async function getHelpConfig(db: Db): Promise<HelpEffectiveConfig> {
  const row = (await db
    .query("helpAssistantConfig")
    .withIndex("by_key", (q: any) => q.eq("key", "help"))
    .unique()) as {
    enabled: boolean;
    welcomeMessage?: BilingualText;
    maxMessageLength: number;
    rateLimitPerDay: number;
    rateLimitPerHour: number;
    model?: string;
    faqVersion: number;
  } | null;
  return {
    enabled: row?.enabled ?? DEFAULT_HELP_CONFIG.enabled,
    welcomeMessage: row?.welcomeMessage ?? DEFAULT_HELP_CONFIG.welcomeMessage,
    maxMessageLength: row?.maxMessageLength ?? DEFAULT_HELP_CONFIG.maxMessageLength,
    rateLimitPerDay: row?.rateLimitPerDay ?? DEFAULT_HELP_CONFIG.rateLimitPerDay,
    rateLimitPerHour: row?.rateLimitPerHour ?? DEFAULT_HELP_CONFIG.rateLimitPerHour,
    model: row?.model ?? DEFAULT_HELP_CONFIG.model,
    faqVersion: row?.faqVersion ?? DEFAULT_HELP_CONFIG.faqVersion,
  };
}

async function requireCaller(db: Db, sessionToken: string): Promise<Caller | null> {
  return callerFromToken(db, sessionToken);
}

/** Audit entry with reason ids only — NEVER message bodies (spec §20). */
async function appendAudit(
  db: Db,
  entry: { actorUserId?: string; eventType: string; targetType?: string; targetId?: string; summary: string; now: number },
): Promise<void> {
  await db.insert("auditLogs", {
    actorUserId: entry.actorUserId ? (entry.actorUserId as never) : undefined,
    eventType: entry.eventType,
    targetType: entry.targetType,
    targetId: entry.targetId,
    summary: entry.summary,
    createdAt: entry.now,
  } as never);
}

async function insertHelpMessage(
  db: Db,
  row: {
    userId: string;
    role: "user" | "assistant";
    text: string;
    answeredBy?: "faq" | "ai" | "safety" | "config";
    flags?: string[];
    lang?: HelpLang;
    now: number;
  },
): Promise<string> {
  return (await db.insert("helpMessages", {
    userId: row.userId as never,
    role: row.role,
    text: row.text,
    answeredBy: row.answeredBy,
    flags: row.flags && row.flags.length > 0 ? row.flags : undefined,
    lang: row.lang,
    createdAt: row.now,
  } as never)) as string;
}

/** Rolling day/hour counts for the caller (spec §13). */
async function helpRateCounts(db: Db, userId: string, now: number): Promise<{ hour: number; day: number }> {
  const events = (await db
    .query("helpRateEvents")
    .withIndex("by_user_time", (q: any) => q.eq("userId", userId).gte("createdAt", now - 86_400_000))
    .collect()) as { createdAt: number }[];
  let hour = 0;
  for (const e of events) if (e.createdAt >= now - 3_600_000) hour += 1;
  return { hour, day: events.length };
}

/* ================================================================== */
/*                       Client queries (help page)                    */
/* ================================================================== */

/** Effective public config for the help UI (welcome copy, limits, enabled). */
export const helpConfig = queryGeneric({
  args: { sessionToken: v.string(), lang: v.union(v.literal("en"), v.literal("sq")) },
  handler: async (ctx, args) => {
    const caller = await requireCaller(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated" as const };
    const cfg = await getHelpConfig(ctx.db);
    return {
      ok: true as const,
      enabled: cfg.enabled,
      welcome: cfg.welcomeMessage[args.lang],
      maxMessageLength: cfg.maxMessageLength,
      rateLimitPerDay: cfg.rateLimitPerDay,
      rateLimitPerHour: cfg.rateLimitPerHour,
      faqVersion: cfg.faqVersion,
    };
  },
});

/** The caller's OWN help thread (last 100 turns, oldest first). Private:
 *  no other user can ever read it, and rows are projected minimally. */
export const getHelpConversation = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const caller = await requireCaller(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated" as const, messages: [] as never[] };
    const rows = (await ctx.db
      .query("helpMessages")
      .withIndex("by_user_time", (q: any) => q.eq("userId", caller.userId))
      .order("desc")
      .take(100)) as any[];
    return {
      ok: true as const,
      messages: rows
        .slice()
        .reverse()
        .map((r) => ({
          id: r._id as string,
          role: r.role as "user" | "assistant",
          text: r.text as string,
          answeredBy: r.answeredBy as string | undefined,
          flags: (r.flags ?? []) as string[],
          createdAt: r.createdAt as number,
        })),
    };
  },
});

/* ================================================================== */
/*                     askHelp — the guarded pipeline                  */
/* ================================================================== */

const DECISION_REPLY: Record<string, keyof typeof SAFE_REPLIES> = {
  crisis: "crisisSafety",
  injury: "injurySafety",
  internal: "internalRefusal",
  injection: "injectionDeflect",
  pii: "piiRefusal",
  out_of_scope: "offScope",
};

/**
 * One help turn. Precedence: auth → enabled → rate → normalize → crisis →
 * injury → internal/injection/pii/scope → FAQ → AI. The AI path requires a
 * configured key and runs server-side only; the reply lands in the thread
 * asynchronously via the scheduled action (client shows the thinking state).
 */
export const askHelp = mutationGeneric({
  args: {
    sessionToken: v.string(),
    text: v.string(),
    lang: v.union(v.literal("en"), v.literal("sq")),
  },
  handler: async (ctx, args) => {
    const caller = await requireCaller(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated" as const };
    const cfg = await getHelpConfig(ctx.db);
    if (!cfg.enabled) return { ok: false as const, error: "assistant_disabled" as const };
    const now = Date.now();

    // Rate limit BEFORE anything is stored — denied asks never consume quota.
    const counts = await helpRateCounts(ctx.db, caller.userId, now);
    if (counts.day >= cfg.rateLimitPerDay || counts.hour >= cfg.rateLimitPerHour) {
      return { ok: false as const, error: "rate_limited" as const };
    }

    const norm = normalizeHelpInput(args.text, cfg.maxMessageLength);
    if (!norm.ok) {
      if (norm.reason === "empty") return { ok: false as const, error: "empty" as const };
      // Oversized: keep a truncated copy + a fixed refusal so the child sees why.
      const userId = caller.userId;
      const truncated = args.text.trim().slice(0, cfg.maxMessageLength);
      const userMsgId = await insertHelpMessage(ctx.db, {
        userId, role: "user", text: truncated, flags: ["too_long"], lang: args.lang, now,
      });
      await insertHelpMessage(ctx.db, {
        userId, role: "assistant", text: SAFE_REPLIES.tooLong[args.lang],
        answeredBy: "config", flags: ["too_long"], lang: args.lang, now,
      });
      await ctx.db.insert("helpRateEvents", { userId: userId as never, createdAt: now } as never);
      await appendAudit(ctx.db, {
        actorUserId: userId, eventType: "help_event", targetType: "help_message",
        targetId: userMsgId, summary: "help_too_long", now,
      });
      return { ok: true as const, kind: "config" as const, assistantId: userMsgId };
    }

    const decision: HelpMessageDecision = classifyHelpMessage(norm.text, cfg.maxMessageLength);
    const userId = caller.userId;

    // Fixed, pre-approved replies (safety + scope). No AI, no generation.
    if (decision.kind in DECISION_REPLY) {
      const replyId = DECISION_REPLY[decision.kind];
      const flags = decision.kind === "internal" || decision.kind === "injection" || decision.kind === "out_of_scope"
        ? (decision as { reasons: string[] }).reasons
        : [decision.kind];
      const userMsgId = await insertHelpMessage(ctx.db, {
        userId, role: "user", text: norm.text, flags, lang: args.lang, now,
      });
      await insertHelpMessage(ctx.db, {
        userId, role: "assistant", text: SAFE_REPLIES[replyId][args.lang],
        answeredBy: "safety", flags, lang: args.lang, now,
      });
      await ctx.db.insert("helpRateEvents", { userId: userId as never, createdAt: now } as never);
      if (decision.kind === "injection" || decision.kind === "crisis") {
        await appendAudit(ctx.db, {
          actorUserId: userId, eventType: "help_event", targetType: "help_message",
          targetId: userMsgId, summary: `help_${decision.kind}_flagged:${flags.join(",")}`, now,
        });
      }
      return { ok: true as const, kind: "safety" as const, assistantId: userMsgId };
    }

    if (decision.kind === "faq") {
      const doc = findHelpDoc(decision.docId);
      const userMsgId = await insertHelpMessage(ctx.db, {
        userId, role: "user", text: norm.text, lang: args.lang, now,
      });
      await insertHelpMessage(ctx.db, {
        userId, role: "assistant", text: (doc ?? HELP_DOCS[0]).answer[args.lang],
        answeredBy: "faq", flags: [`faq:${decision.docId}`], lang: args.lang, now,
      });
      await ctx.db.insert("helpRateEvents", { userId: userId as never, createdAt: now } as never);
      return { ok: true as const, kind: "faq" as const, assistantId: userMsgId };
    }

    // Unmatched in-scope question → real AI. Fail HONESTLY when unconfigured.
    if (!process.env.FIREWORKS_API_KEY) {
      return { ok: false as const, error: AI_ASSISTANT_ERROR };
    }
    const userMsgId = await insertHelpMessage(ctx.db, {
      userId, role: "user", text: norm.text, lang: args.lang, now,
    });
    await ctx.db.insert("helpRateEvents", { userId: userId as never, createdAt: now } as never);

    // Minimal context: current message + last turns (spec §9/§10).
    const recent = (await ctx.db
      .query("helpMessages")
      .withIndex("by_user_time", (q: any) => q.eq("userId", userId))
      .order("desc")
      .take(MAX_CONTEXT_MESSAGES)) as any[];
    const history = recent
      .slice()
      .reverse()
      .map((r) => ({ role: r.role as "user" | "assistant", content: r.text as string }));
    const docIds = rankHelpDocs(norm.text).slice(0, 3).map((r) => r.doc.id);

    await ctx.scheduler.runAfter(0, anyApi.helpAi.generateHelpReply, {
      userId: String(userId),
      userMessageId: String(userMsgId),
      history,
      docIds,
      lang: args.lang,
      model: cfg.model,
    });
    return { ok: true as const, kind: "ai_pending" as const, assistantId: userMsgId };
  },
});

/* ================================================================== */
/*              AI reply persistence (from the scheduled action)       */
/* ================================================================== */

/**
 * Lands the model's reply in the thread. Internal (scheduler-only). Guards:
 * the referenced user row must exist and belong to the same user, and a
 * duplicate assistant reply for that turn is skipped (action retries).
 */
export const persistHelpReply = internalMutationGeneric({
  args: {
    userId: v.string(),
    userMessageId: v.string(),
    text: v.string(),
    answeredBy: v.union(v.literal("faq"), v.literal("ai"), v.literal("safety"), v.literal("config")),
    flags: v.array(v.string()),
    lang: v.union(v.literal("en"), v.literal("sq")),
  },
  handler: async (ctx, args) => {
    const userMsg = (await ctx.db.get(args.userMessageId as never)) as any;
    if (!userMsg || String(userMsg.userId) !== args.userId) return { ok: false as const, error: "not_found" };
    const existing = (await ctx.db
      .query("helpMessages")
      .withIndex("by_user_time", (q: any) =>
        q.eq("userId", args.userId).gte("createdAt", userMsg.createdAt as number),
      )
      .collect()) as any[];
    if (existing.some((r) => r.role === "assistant")) return { ok: true as const, deduped: true };
    await insertHelpMessage(ctx.db, {
      userId: args.userId,
      role: "assistant",
      text: args.text,
      answeredBy: args.answeredBy,
      flags: args.flags,
      lang: args.lang,
      now: Date.now(),
    });
    return { ok: true as const };
  },
});

/* ================================================================== */
/*                     Admin configuration (spec §21)                 */
/* ================================================================== */

/** Full config for the admin console (admin-only). */
export const helpAdminConfig = queryGeneric({
  args: { adminSessionToken: v.string() },
  handler: async (ctx, args) => {
    const admin = await requireCaller(ctx.db, args.adminSessionToken);
    if (!admin) return { ok: false as const, error: "unauthenticated" as const };
    requireRole(admin, "admin");
    const cfg = await getHelpConfig(ctx.db);
    const row = (await ctx.db
      .query("helpAssistantConfig")
      .withIndex("by_key", (q: any) => q.eq("key", "help"))
      .unique()) as any;
    return {
      ok: true as const,
      config: cfg,
      usingDefaults: row === null,
      updatedAt: (row?.updatedAt ?? null) as number | null,
    };
  },
});

/** Upsert the help configuration. Admin-only; audited (keys changed, never values of user data). */
export const setHelpAdminConfig = mutationGeneric({
  args: {
    adminSessionToken: v.string(),
    enabled: v.optional(v.boolean()),
    welcomeMessage: v.optional(v.object({ en: v.string(), sq: v.string() })),
    maxMessageLength: v.optional(v.number()),
    rateLimitPerDay: v.optional(v.number()),
    rateLimitPerHour: v.optional(v.number()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireCaller(ctx.db, args.adminSessionToken);
    if (!admin) return { ok: false as const, error: "unauthenticated" as const };
    requireRole(admin, "admin"); // fail-closed staff gate

    if (args.maxMessageLength !== undefined && (args.maxMessageLength < 50 || args.maxMessageLength > 4000)) {
      return { ok: false as const, error: "invalid_max_length" };
    }
    if (args.rateLimitPerDay !== undefined && (args.rateLimitPerDay < 1 || args.rateLimitPerDay > 1000)) {
      return { ok: false as const, error: "invalid_rate_limit" };
    }
    if (args.rateLimitPerHour !== undefined && (args.rateLimitPerHour < 1 || args.rateLimitPerHour > 1000)) {
      return { ok: false as const, error: "invalid_rate_limit" };
    }

    const now = Date.now();
    const row = (await ctx.db
      .query("helpAssistantConfig")
      .withIndex("by_key", (q: any) => q.eq("key", "help"))
      .unique()) as any;
    const patch: Record<string, unknown> = { updatedAt: now, updatedBy: admin.userId };
    const changed: string[] = [];
    if (args.enabled !== undefined) { patch.enabled = args.enabled; changed.push("enabled"); }
    if (args.welcomeMessage !== undefined) { patch.welcomeMessage = args.welcomeMessage; changed.push("welcomeMessage"); }
    if (args.maxMessageLength !== undefined) { patch.maxMessageLength = args.maxMessageLength; changed.push("maxMessageLength"); }
    if (args.rateLimitPerDay !== undefined) { patch.rateLimitPerDay = args.rateLimitPerDay; changed.push("rateLimitPerDay"); }
    if (args.rateLimitPerHour !== undefined) { patch.rateLimitPerHour = args.rateLimitPerHour; changed.push("rateLimitPerHour"); }
    if (args.model !== undefined && args.model.trim().length > 0) { patch.model = args.model.trim(); changed.push("model"); }
    if (changed.length === 0) return { ok: false as const, error: "nothing_to_update" };

    if (row) {
      await ctx.db.patch(row._id, patch);
    } else {
      await ctx.db.insert("helpAssistantConfig", {
        key: "help",
        enabled: args.enabled ?? DEFAULT_HELP_CONFIG.enabled,
        welcomeMessage: args.welcomeMessage,
        maxMessageLength: args.maxMessageLength ?? DEFAULT_HELP_CONFIG.maxMessageLength,
        rateLimitPerDay: args.rateLimitPerDay ?? DEFAULT_HELP_CONFIG.rateLimitPerDay,
        rateLimitPerHour: args.rateLimitPerHour ?? DEFAULT_HELP_CONFIG.rateLimitPerHour,
        model: args.model,
        faqVersion: DEFAULT_HELP_CONFIG.faqVersion,
        updatedBy: admin.userId,
        updatedAt: now,
        createdAt: now,
      } as never);
    }
    await appendAudit(ctx.db, {
      actorUserId: admin.userId, eventType: "help_event", targetType: "help_assistant_config",
      targetId: "help", summary: `help_config_updated:${changed.join(",")}`, now,
    });
    return { ok: true as const, changed };
  },
});
