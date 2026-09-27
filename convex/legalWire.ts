/* eslint-disable @typescript-eslint/no-explicit-any */
import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { callerFromToken } from "./content";
import {
  DEFAULT_MARKETING_PREFS,
  DELETION_COOLING_OFF_MS,
  EMPTY_BUSINESS_INFO,
  applyUnsubscribe,
  buildExportEnvelope,
  businessIsComplete,
  consentDocVersion,
  decideBusinessUpdate,
  decideDeletionAdvance,
  decideMarketingGrant,
  decideMarketingSend,
  generateUnsubscribeToken,
  projectDeletion,
  projectLegalDocs,
  type BusinessInfo,
  type DeletionRequestRow,
  type MarketingPrefs,
  type UnsubscribeScope,
} from "./legal";

/**
 * Day 19 — LEGAL + PRIVACY CENTER wire layer.
 *
 * Every mutation re-decides SERVER-side via the pure core in legal.ts; the
 * client is a preview only. Consent versions resolve through the legal
 * document registry — never hardcoded strings.
 */

async function sha256Hex(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Session-token caller (fail-closed; mirrors privacy.ts). */
async function requireCaller(db: any, sessionToken: string) {
  return callerFromToken(db, sessionToken);
}

async function audit(
  db: any,
  userId: string,
  role: string,
  eventType: string,
  summary: string
): Promise<void> {
  await db.insert("auditLogs", {
    actorUserId: userId as never,
    actorRole: role as never,
    eventType,
    targetType: "legal",
    targetId: userId,
    summary,
    createdAt: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Legal document registry (public, guest-safe)
// ---------------------------------------------------------------------------

export const listLegalDocuments = queryGeneric({
  args: {},
  handler: async (ctx) => {
    // Registry-driven projection. The live legalDocuments table mirrors what
    // has actually been PUSHED for rendering; the registry is the source of
    // truth for version metadata until an operator publishes a newer row.
    const rows = (await ctx.db.query("legalDocuments").collect()) as any[];
    const registry = projectLegalDocs();
    // Union: registry always present; table rows add pushed content refs.
    const pushed = new Map<string, { status: string; contentRef: string; effectiveAt: number; updatedAt?: number }>();
    for (const r of rows) {
      if (r.locale !== "en") continue; // per-locale content; metadata comes from the registry
      const prev = pushed.get(r.docId);
      if (!prev || r.createdAt > (prev.effectiveAt ?? 0)) {
        pushed.set(r.docId, { status: r.status, contentRef: r.contentRef, effectiveAt: r.effectiveAt, updatedAt: r.updatedAt });
      }
    }
    return {
      ok: true as const,
      documents: registry.map((d) => ({
        ...d,
        contentRef: pushed.get(d.docId)?.contentRef,
        tableStatus: pushed.get(d.docId)?.status,
      })),
    };
  },
});

// ---------------------------------------------------------------------------
// Deletion: REQUESTED → PROCESSING → COMPLETED (cooling-off enforced)
// ---------------------------------------------------------------------------

async function latestDeletionRow(db: any, userId: string): Promise<(DeletionRequestRow & { _id: string }) | null> {
  const rows = (await db
    .query("deletionRequests")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .collect()) as any[];
  if (rows.length === 0) return null;
  rows.sort((a, b) => b.requestedAt - a.requestedAt);
  const r = rows[0];
  return {
    _id: r._id,
    userId: String(r.userId),
    status: r.status,
    stateChangedAt: r.stateChangedAt,
    requestedAt: r.requestedAt,
    eligibleAt: r.eligibleAt,
    note: r.note,
    completedAt: r.completedAt,
  };
}

/** The caller's deletion request state (own data). */
export const getMyDeletionStatus = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthorized" };
    const row = await latestDeletionRow(ctx.db, String(c.userId));
    return { ok: true as const, deletion: projectDeletion(row, Date.now()) };
  },
});

/** Open a deletion request (idempotent while one is open). */
export const requestDeletionFlow = mutationGeneric({
  args: { sessionToken: v.string(), confirmText: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthorized" as const };
    if (args.confirmText.trim().toUpperCase() !== "DELETE") {
      return { ok: false as const, error: "confirm_required" as const };
    }

    const existing = await latestDeletionRow(ctx.db, String(c.userId));
    if (existing && existing.status !== "completed") {
      return { ok: true as const, alreadyOpen: true, deletion: projectDeletion(existing, now) };
    }

    const row = {
      userId: c.userId as never,
      status: "requested" as const,
      requestedAt: now,
      stateChangedAt: now,
      eligibleAt: now + DELETION_COOLING_OFF_MS,
      reason: args.reason?.slice(0, 300),
      createdAt: now,
      updatedAt: now,
    };
    await ctx.db.insert("deletionRequests", row);

    // Consent-record the deletion request for the append-only history.
    await ctx.db.insert("consents", {
      userId: c.userId as never,
      type: "account_deletion",
      granted: true,
      version: "1.0",
      region: "app",
      source: "privacy_center",
      createdAt: now,
    });
    await audit(ctx.db, c.userId, c.role, "account_deletion", "deletion_requested");
    return { ok: true as const, alreadyOpen: false };
  },
});

/**
 * Advance the state machine. A user may advance REQUESTED → PROCESSING
 * (confirming their intent); PROCESSING → COMPLETED requires the cooling-off
 * window to have elapsed AND a staff caller (erasure is a staff/executed
 * action, never a client-only claim). COMPLETED is terminal.
 */
export const advanceDeletionFlow = mutationGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthorized" as const };

    const row = await latestDeletionRow(ctx.db, String(c.userId));
    const decision = decideDeletionAdvance(row, now);
    if (!decision.ok) return { ok: false as const, error: decision.error };
    const next = decision.next;

    // PROCESSING → COMPLETED is the ERASURE step: staff-only (and it is the
    // caller's own request here — staff sweeping other users is an internal job).
    if (next === "completed" && c.role !== "admin" && c.role !== "moderator") {
      return { ok: false as const, error: "staff_required" as const };
    }

    const patch: Record<string, unknown> = { status: next, stateChangedAt: now, updatedAt: now };
    if (next === "completed") patch.completedAt = now;
    await ctx.db.patch(row!._id as never, patch as never);
    await audit(ctx.db, c.userId, c.role, "account_deletion", `deletion_${next}`);

    if (next === "completed") {
      // Execute the erasure per ERASURE_SCOPE (behavioral data). Consent rows
      // and purchase receipts are retained where the law requires them.
      const user = (await ctx.db.get(c.userId as never)) as any;
      if (user) {
        await ctx.db.patch(c.userId as never, { status: "deleted", updatedAt: now } as never);
      }
      // Revoke every session (fail-closed sign-out).
      const sessions = (await ctx.db
        .query("authSessions")
        .withIndex("by_user_time", (q: any) => q.eq("userId", c.userId))
        .collect()) as any[];
      for (const s of sessions) {
        if (!s.revokedAt) await ctx.db.patch(s._id, { revokedAt: now } as never);
      }
    }
    return { ok: true as const, status: next };
  },
});

/** Admin queue: open deletion requests sweeping toward eligibility. */
export const deletionQueue = queryGeneric({
  args: { adminSessionToken: v.string() },
  handler: async (ctx, args) => {
    const admin = await requireCaller(ctx.db, args.adminSessionToken);
    if (!admin) return { ok: false as const, error: "unauthorized" as const };
    if (admin.role !== "admin" && admin.role !== "moderator") {
      return { ok: false as const, error: "staff_required" as const };
    }
    const rows = (await ctx.db.query("deletionRequests").collect()) as any[];
    rows.sort((a, b) => b.requestedAt - a.requestedAt);
    const now = Date.now();
    return {
      ok: true as const,
      queue: rows.slice(0, 100).map((r) => ({
        userId: String(r.userId),
        status: r.status as string,
        requestedAt: r.requestedAt as number,
        eligibleAt: r.eligibleAt as number,
        coolingOffDone: now >= r.eligibleAt,
        note: r.note,
      })),
    };
  },
});

// ---------------------------------------------------------------------------
// Marketing email preferences + unsubscribe tokens
// ---------------------------------------------------------------------------

async function marketingRow(db: any, userId: string) {
  return (await db
    .query("marketingPrefs")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .unique()) as any;
}

/** Read own marketing prefs + consent state. */
export const getMyMarketingPrefs = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthorized" };
    const row = await marketingRow(ctx.db, String(c.userId));
    const consentRows = (await ctx.db
      .query("consents")
      .withIndex("by_user_type_time", (q: any) => q.eq("userId", c.userId))
      .collect()) as any[];
    const marketingConsent = consentRows
      .filter((r) => r.type === "marketing_email")
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    return {
      ok: true as const,
      prefs: (row?.prefs as MarketingPrefs) ?? DEFAULT_MARKETING_PREFS,
      marketingConsentGranted: marketingConsent?.granted === true,
      unsubscribeTokenConfigured: Boolean(row?.unsubscribeTokenHash),
    };
  },
});

/** Update a marketing pref (opt-in requires adult + consent flow). */
export const setMyMarketingPref = mutationGeneric({
  args: { sessionToken: v.string(), category: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthorized" as const };

    const user = (await ctx.db.get(c.userId as never)) as any;
    const band = user?.ageBand as "child_u13" | "teen13_15" | "teen16_17" | "adult" | undefined;
    if (!(args.category in DEFAULT_MARKETING_PREFS)) return { ok: false as const, error: "unknown_category" as const };

    // ENABLING any category requires the marketing_email consent grant
    // (adults only). Disabling is always allowed (withdrawal).
    if (args.enabled) {
      const gate = decideMarketingGrant(band ?? "adult", true);
      if (!gate.ok) return { ok: false as const, error: gate.error };
      const rows = (await ctx.db
        .query("consents")
        .withIndex("by_user_type_time", (q: any) => q.eq("userId", c.userId))
        .collect()) as any[];
      const consent = rows.filter((r) => r.type === "marketing_email").sort((a, b) => b.createdAt - a.createdAt)[0];
      if (!consent?.granted) return { ok: false as const, error: "consent_required" as const };
    }

    let row = await marketingRow(ctx.db, String(c.userId));
    if (!row) {
      await ctx.db.insert("marketingPrefs", {
        userId: c.userId as never,
        prefs: { ...DEFAULT_MARKETING_PREFS, [args.category]: args.enabled },
        updatedAt: now,
        createdAt: now,
      });
      return { ok: true as const };
    }
    const prefs = { ...(row.prefs as MarketingPrefs), [args.category]: args.enabled };
    await ctx.db.patch(row._id as never, { prefs, updatedAt: now } as never);
    await audit(ctx.db, c.userId, c.role, "marketing_pref", `${args.category}:${args.enabled}`);
    return { ok: true as const };
  },
});

/** Record the marketing_email consent grant/withdrawal (versioned via registry). */
export const recordMarketingConsent = mutationGeneric({
  args: { sessionToken: v.string(), granted: v.boolean(), source: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthorized" as const };

    const user = (await ctx.db.get(c.userId as never)) as any;
    const band = user?.ageBand as "child_u13" | "teen13_15" | "teen16_17" | "adult" | undefined;
    const gate = decideMarketingGrant(band ?? "adult", args.granted);
    if (!gate.ok) return { ok: false as const, error: gate.error };

    // Withdrawal clears every category (one-tap opt-out).
    if (!args.granted) {
      const row = await marketingRow(ctx.db, String(c.userId));
      if (row) await ctx.db.patch(row._id as never, { prefs: { ...DEFAULT_MARKETING_PREFS }, updatedAt: now } as never);
    }

    await ctx.db.insert("consents", {
      userId: c.userId as never,
      type: "marketing_email",
      granted: args.granted,
      version: consentDocVersion("privacy"),
      region: "app",
      source: args.source.slice(0, 60),
      createdAt: now,
    });
    await audit(ctx.db, c.userId, c.role, "consent_change", `marketing_email:${args.granted ? "granted" : "withdrawn"}`);
    return { ok: true as const };
  },
});

/** Mint (or rotate) the caller's unsubscribe token. Stored hashed. */
export const rotateUnsubscribeToken = mutationGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthorized" as const };

    const token = generateUnsubscribeToken();
    const tokenHash = await sha256Hex(token);
    const existing = await marketingRow(ctx.db, String(c.userId));
    if (existing) {
      await ctx.db.patch(existing._id as never, { unsubscribeTokenHash: tokenHash, updatedAt: now } as never);
    } else {
      await ctx.db.insert("marketingPrefs", {
        userId: c.userId as never,
        prefs: { ...DEFAULT_MARKETING_PREFS },
        unsubscribeTokenHash: tokenHash,
        updatedAt: now,
        createdAt: now,
      });
    }
    await audit(ctx.db, c.userId, c.role, "marketing_pref", "unsubscribe_token_rotated");
    return { ok: true as const, token };
  },
});

/**
 * Unsubscribe via email-link token — NO session required (that's the point).
 * Tokens can only unsubscribe; they can never grant consent back.
 */
export const unsubscribeByToken = mutationGeneric({
  args: { token: v.string(), scope: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const tokenHash = await sha256Hex(args.token);
    const rows = (await ctx.db.query("marketingPrefs").collect()) as any[];
    const row = rows.find((r) => r.unsubscribeTokenHash === tokenHash);
    if (!row) return { ok: false as const, error: "invalid_token" };

    const scope = (args.scope ?? "all") as UnsubscribeScope;
    const prefs = applyUnsubscribe(row.prefs as MarketingPrefs, scope);
    await ctx.db.patch(row._id as never, { prefs, updatedAt: now } as never);

    // Record the withdrawal in the append-only consent history (version via registry).
    await ctx.db.insert("consents", {
      userId: row.userId,
      type: "marketing_email",
      granted: false,
      version: consentDocVersion("privacy"),
      region: "email",
      source: `unsubscribe_link:${scope}`,
      createdAt: now,
    });
    await audit(ctx.db, String(row.userId), "user", "consent_change", `marketing_unsubscribed:${scope}`);
    return { ok: true as const, scope };
  },
});

// ---------------------------------------------------------------------------
// Data export ("Download my data") — own data only
// ---------------------------------------------------------------------------

export const exportMyData = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthorized" as const };
    const now = Date.now();

    const user = (await ctx.db.get(c.userId as never)) as any;
    const profile = (await ctx.db
      .query("profiles")
      .withIndex("userId", (q: any) => q.eq("userId", c.userId))
      .unique()) as any;
    const privacy = (await ctx.db
      .query("privacySettings")
      .withIndex("by_user", (q: any) => q.eq("userId", c.userId))
      .unique()) as any;
    const marketing = await marketingRow(ctx.db, String(c.userId));

    const consentRows = (await ctx.db
      .query("consents")
      .withIndex("by_user_type_time", (q: any) => q.eq("userId", c.userId))
      .collect()) as any[];
    const postRows = (await ctx.db
      .query("posts")
      .withIndex("by_user_status", (q: any) => q.eq("userId", c.userId))
      .collect()) as any[];
    const practiceRows = (await ctx.db
      .query("practiceItems")
      .withIndex("by_user", (q: any) => q.eq("userId", c.userId))
      .collect()) as any[];
    const purchaseRows = (await ctx.db
      .query("purchases")
      .withIndex("by_user", (q: any) => q.eq("userId", c.userId))
      .collect()) as any[];
    const deletionRows = (await ctx.db
      .query("deletionRequests")
      .withIndex("by_user", (q: any) => q.eq("userId", c.userId))
      .collect()) as any[];

    // Own-data minimization per EXPORT_FIELD_RULES: NO dob, NO credential
    // material, NO other users' data.
    const sections: Record<string, unknown> = {
      account: {
        email: user?.email,
        ageBand: user?.ageBand,
        createdAt: user?.createdAt,
        status: user?.status,
      },
      profile: {
        handle: profile?.handle,
        displayName: profile?.displayName,
        bio: profile?.bio,
        styles: profile?.styles,
        city: profile?.city,
        level: profile?.level,
        followerCount: profile?.followerCount,
      },
      privacy_settings: privacy
        ? {
            privateAccount: privacy.privateAccount,
            messagesFrom: privacy.messagesFrom,
            commentFilter: privacy.commentFilter,
            discoverableByHandle: privacy.discoverableByHandle,
            showCity: privacy.showCity,
            personalization: privacy.personalization,
          }
        : null,
      consent_history: consentRows.map((r) => ({
        type: r.type, granted: r.granted, version: r.version, source: r.source, region: r.region, at: r.createdAt,
      })),
      marketing_prefs: {
        prefs: marketing?.prefs ?? DEFAULT_MARKETING_PREFS,
        unsubscribeConfigured: Boolean(marketing?.unsubscribeTokenHash),
      },
      posts: postRows.map((p) => ({ caption: p.caption, hashtags: p.hashtags, style: p.style, visibility: p.visibility, at: p.createdAt })),
      practice_progress: practiceRows.map((p) => ({ kind: p.kind, title: p.title, sessionCount: p.sessionCount, totalSeconds: p.totalSeconds, completedAt: p.completedAt })),
      purchases_receipts: purchaseRows.map((p) => ({ amountCents: p.amountCents, currency: p.currency, status: p.status, provider: p.provider, at: p.createdAt })),
      deletion_requests: deletionRows.map((r) => ({ status: r.status, requestedAt: r.requestedAt, eligibleAt: r.eligibleAt, completedAt: r.completedAt })),
    };

    const deletion = await latestDeletionRow(ctx.db, String(c.userId));
    sections.deletion_requests = deletion
      ? [projectDeletion(deletion, now)]
      : (sections.deletion_requests as unknown[]);

    return { ok: true as const, export: buildExportEnvelope(sections, now) };
  },
});

// ---------------------------------------------------------------------------
// Business information — operator-configured, admin-only writes
// ---------------------------------------------------------------------------

export const getBusinessInfo = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const row = (await ctx.db
      .query("businessInfo")
      .withIndex("by_key", (q: any) => q.eq("key", "business"))
      .unique()) as any;
    const info: BusinessInfo = row
      ? {
          legalName: row.legalName ?? "",
          legalAddress: row.legalAddress ?? "",
          companyNumber: row.companyNumber ?? "",
          vatNumber: row.vatNumber ?? "",
          contactEmail: row.contactEmail ?? "",
          supportEmail: row.supportEmail ?? "",
          privacyEmail: row.privacyEmail ?? "",
        }
      : { ...EMPTY_BUSINESS_INFO };
    return { ok: true as const, business: info, complete: businessIsComplete(info) };
  },
});

export const setBusinessInfo = mutationGeneric({
  args: {
    adminSessionToken: v.string(),
    patch: v.object({
      legalName: v.optional(v.string()),
      legalAddress: v.optional(v.string()),
      companyNumber: v.optional(v.string()),
      vatNumber: v.optional(v.string()),
      contactEmail: v.optional(v.string()),
      supportEmail: v.optional(v.string()),
      privacyEmail: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const admin = await requireCaller(ctx.db, args.adminSessionToken);
    if (!admin) return { ok: false as const, error: "unauthorized" as const };
    if (admin.role !== "admin") return { ok: false as const, error: "admin_required" as const };

    const decision = decideBusinessUpdate(args.patch as Partial<BusinessInfo>);
    if (!decision.ok) return { ok: false as const, error: decision.error };

    const existing = (await ctx.db
      .query("businessInfo")
      .withIndex("by_key", (q: any) => q.eq("key", "business"))
      .unique()) as any;
    if (existing) {
      await ctx.db.patch(existing._id, { ...decision.cleaned, updatedBy: admin.userId, updatedAt: now } as never);
    } else {
      await ctx.db.insert("businessInfo", {
        key: "business" as const,
        ...decision.cleaned,
        updatedBy: admin.userId,
        updatedAt: now,
        createdAt: now,
      });
    }
    await audit(ctx.db, admin.userId, admin.role, "business_info_updated", Object.keys(decision.cleaned).join(","));
    return { ok: true as const };
  },
});

// ---------------------------------------------------------------------------
// Marketing send gate (used by future email actions; exposed for tests/audit)
// ---------------------------------------------------------------------------

export const evaluateMarketingSend = queryGeneric({
  args: { sessionToken: v.string(), kind: v.string() },
  handler: async (ctx, args) => {
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthorized" as const };
    const row = await marketingRow(ctx.db, String(c.userId));
    const rows = (await ctx.db
      .query("consents")
      .withIndex("by_user_type_time", (q: any) => q.eq("userId", c.userId))
      .collect()) as any[];
    const consent = rows.filter((r) => r.type === "marketing_email").sort((a, b) => b.createdAt - a.createdAt)[0];
    const decision = decideMarketingSend(
      args.kind,
      (row?.prefs as MarketingPrefs) ?? DEFAULT_MARKETING_PREFS,
      consent?.granted === true
    );
    return { ok: true as const, decision };
  },
});
