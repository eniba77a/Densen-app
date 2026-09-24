/**
 * DENSEN — Music rights wire (Day 13).
 * ====================================
 * Applies the pure music-rights core inside Convex transactions:
 *   - musicRecords CRUD (staff) + composer-facing queries,
 *   - claim intake (detect/receive) → notify uploader → containment
 *     (restrict / replace audio / remove audio / remove content),
 *   - dispute submission + staff review transitions,
 *   - every state change appends an auditLogs row (append-only).
 *
 * NOTHING here makes a legal determination: claims/disputes change
 * containment state and queue for humans; only staff resolve, and the
 * resolution reason is always recorded. No safe-second rule exists —
 * duration checks go through evaluateMusicUse against the track's own
 * license cap only.
 */
import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

import {
  canTransitionClaim,
  canTransitionDispute,
  claimActionFor,
  decideSubmitDispute,
  evaluateMusicUse,
  sanitizeDurationSec,
  sanitizeEvidenceRef,
  sanitizeTerritory,
  sortForComposer,
  type ClaimStatus,
  type DisputeStatus,
  type MusicRecord,
  type UseKind,
} from "./musicRights";
import { callerFromToken } from "./content";
import { requireRole, type Caller } from "./security";

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ------------------------------ helpers ------------------------------ */

interface WireCaller {
  userId: string;
  userStatus: string;
  role: string;
}

async function requireCaller(db: any, sessionToken: string): Promise<WireCaller | null> {
  const caller = await callerFromToken(db, sessionToken);
  if (!caller) return null;
  const user = (await db.get(caller.userId)) as any;
  if (!user) return null;
  return { userId: String(caller.userId), userStatus: String(user.status ?? "active"), role: String(user.role ?? "user") };
}

function isStaff(c: WireCaller): boolean {
  return c.role === "moderator" || c.role === "admin";
}

function staffCaller(c: WireCaller): Caller {
  return { userId: c.userId, role: c.role as Caller["role"], userStatus: c.userStatus as Caller["userStatus"] };
}

async function appendAudit(
  db: any,
  entry: {
    actorUserId?: string;
    actorRole?: string;
    eventType: string;
    targetType?: string;
    targetId?: string;
    summary: string;
    now: number;
  }
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

async function notify(
  db: any,
  n: { userId: string; actorUserId?: string; type: string; targetType?: string; targetId?: string; now: number }
): Promise<void> {
  await db.insert("notifications", {
    userId: n.userId as never,
    actorUserId: n.actorUserId ? (n.actorUserId as never) : undefined,
    type: n.type,
    targetType: n.targetType,
    targetId: n.targetId,
    read: false,
    createdAt: n.now,
  } as never);
}

function projectRecord(row: any): MusicRecord & { id: string; addedByUserId?: string; createdAt: number; updatedAt: number } {
  return {
    id: String(row._id),
    title: row.title as string,
    artist: row.artist as string,
    album: row.album as string | undefined,
    audioId: row.audioId as string,
    rightsHolder: row.rightsHolder as string,
    licensingStatus: row.licensingStatus,
    territories: (row.territories ?? []) as string[],
    permittedUse: (row.permittedUse ?? []) as UseKind[],
    commercialUse: Boolean(row.commercialUse),
    maxDurationSec: row.maxDurationSec as number | undefined,
    licenseExpiresAt: row.licenseExpiresAt as number | undefined,
    fingerprintRef: row.fingerprintRef as string | undefined,
    restrictions: row.restrictions as string | undefined,
    addedByUserId: row.addedByUserId as string | undefined,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number,
  };
}

const useKindArg = v.union(
  v.literal("personal_post"),
  v.literal("commercial_post"),
  v.literal("course_content"),
  v.literal("challenge_content"),
  v.literal("monetized_post")
);

/**
 * UPLOADER — request a signed upload URL for dispute evidence (license
 * scans, ownership docs). Same real storage pipeline as video/thumbnail
 * uploads: the resulting storageId is what evidenceRefs reference. Staff
 * review reads these blobs; the client never needs access to them.
 */
export const requestEvidenceUpload = mutationGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx: any, args: any) => {
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };
    const uploadUrl = await ctx.storage.generateUploadUrl();
    return { ok: true as const, uploadUrl };
  },
});

/**
 * UPLOADER — register a user-owned/user-licensed music record. A disputant
 * answering "I own this audio" / "I have a license" can register THEIR
 * track so the platform holds a real permission record to evaluate against
 * (the composer/publish check reads records, not client claims). The row is
 * created with the caller's declared ownership and the DENSEN home market;
 * staff can correct or widen it via upsertMusicRecord. Creating a record
 * never approves a dispute — that stays a staff decision.
 */
export const registerUserOwnedRecord = mutationGeneric({
  args: {
    sessionToken: v.string(),
    audioId: v.string(),
    title: v.string(),
    artist: v.string(),
    rightsHolder: v.string(),
    ownership: v.union(v.literal("user_owned"), v.literal("user_licensed")),
  },
  handler: async (ctx: any, args: any) => {
    const now = Date.now();
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };

    const audioId = String(args.audioId).trim().slice(0, 120);
    const title = String(args.title).trim().slice(0, 200);
    const artist = String(args.artist).trim().slice(0, 200);
    const rightsHolder = String(args.rightsHolder).trim().slice(0, 200);
    if (!audioId || !title || !artist || !rightsHolder) return { ok: false as const, error: "bad_fields" as const };

    const existing = (await ctx.db
      .query("musicRecords")
      .withIndex("by_audio", (q: any) => q.eq("audioId", audioId))
      .unique()) as any;
    if (existing) return { ok: false as const, error: "audio_id_exists" as const };

    const id = await ctx.db.insert("musicRecords", {
      audioId,
      title,
      artist,
      rightsHolder,
      licensingStatus: args.ownership,
      territories: ["AL"], // DENSEN home market; staff can widen via upsertMusicRecord
      permittedUse: ["personal_post"],
      commercialUse: false,
      addedByUserId: c.userId as never,
      createdAt: now,
      updatedAt: now,
    } as never);
    await appendAudit(ctx.db, {
      actorUserId: c.userId,
      actorRole: c.role,
      eventType: "music_rights",
      targetType: "music_record",
      targetId: id,
      summary: `user-registered ${args.ownership} record: ${title}`,
      now,
    });
    return { ok: true as const, id };
  },
});

/* ================================================================== */
/*                          Platform bootstrap                         */
/* ================================================================== */

/**
 * Idempotent platform seed for the music-rights system (fired once per load
 * by the app shell, exactly like the challenges bootstrap). Inserts the
 * DENSEN-approved starter catalog ONLY when a track's audioId is missing:
 * staff edits via upsertMusicRecord always win — a seed never overwrites a
 * corrected licensing record. Includes one RESTRICTED and one EXPIRED
 * example so the composer displays real restrictions and the fail-closed
 * path is experienceable end to end.
 */
const STARTER_RECORDS = [
  {
    audioId: "a1",
    title: "Mëso Vallëzimin",
    artist: "MC Dhoma",
    rightsHolder: "DENSEN Music Library",
    licensingStatus: "densen_licensed" as const,
    territories: [] as string[],
    permittedUse: ["personal_post", "challenge_content", "course_content"] as const,
    commercialUse: false,
  },
  {
    audioId: "a2",
    title: "Golden Hour",
    artist: "Ivy Reese",
    rightsHolder: "Golden Hour Publishing",
    licensingStatus: "platform_licensed" as const,
    territories: [] as string[],
    permittedUse: ["personal_post", "challenge_content"] as const,
    commercialUse: false,
    maxDurationSec: 45,
  },
  {
    audioId: "a3",
    title: "Balkan Bounce",
    artist: "DJ Ilir",
    rightsHolder: "Balkan Beat Records",
    licensingStatus: "densen_licensed" as const,
    territories: ["AL", "XK", "MK", "DE"] as string[],
    permittedUse: ["personal_post"] as const,
    commercialUse: false,
  },
  {
    audioId: "a4",
    title: "Slow Burn",
    artist: "Nova & The Fog",
    rightsHolder: "Fog & Nova",
    licensingStatus: "restricted" as const,
    territories: [] as string[],
    permittedUse: ["personal_post"] as const,
    commercialUse: false,
    restrictions: "Personal posts only; no monetization; credit 'Nova & The Fog' in the caption.",
  },
  {
    audioId: "a5",
    title: "Timberline",
    artist: "OAKS",
    rightsHolder: "Timberline Rights AG",
    licensingStatus: "platform_licensed" as const,
    territories: [] as string[],
    permittedUse: ["personal_post"] as const,
    commercialUse: false,
    // A license that already lapsed: the fail-closed path is real.
    licenseExpiresAt: Date.parse("2025-12-31T23:59:59Z"),
  },
];

async function ensureMusicRecordsSeed(db: any): Promise<void> {
  const now = Date.now();
  const existing = new Set(((await db.query("musicRecords").collect()) as any[]).map((r) => r.audioId as string));
  for (const r of STARTER_RECORDS) {
    if (existing.has(r.audioId)) continue;
    await db.insert("musicRecords", {
      ...r,
      permittedUse: [...r.permittedUse],
      createdAt: now,
      updatedAt: now,
    } as never);
  }
}

/** Idempotent seed mutation — safe to fire from the shell on every load. */
export const bootstrapMusicRights = mutationGeneric({
  args: {},
  handler: async (ctx: any) => {
    await ensureMusicRecordsSeed(ctx.db);
    return { ok: true as const };
  },
});

/* ================================================================== */
/*                        Music record catalog                         */
/* ================================================================== */

/**
 * COMPOSER CATALOG — the audio picker's source of truth.
 * Returns only licensable tracks, DENSEN-approved first, each with its REAL
 * permission fields so the upload flow can display actual restrictions.
 * Each entry also carries `allowedHere`: the server's evaluation of that
 * track for the requested use/territory/duration (no client-side rights math).
 */
export const listComposerMusic = queryGeneric({
  args: {
    use: useKindArg,
    territory: v.optional(v.string()),
    durationSec: v.optional(v.number()),
  },
  handler: async (ctx: any, args: any) => {
    const now = Date.now();
    const rows = (await ctx.db.query("musicRecords").collect()) as any[];
    const records = rows.map(projectRecord);
    const ordered = sortForComposer(records);
    const territory = sanitizeTerritory(args.territory) ?? "AL"; // DENSEN home market default
    const durationSec = sanitizeDurationSec(args.durationSec) ?? 0;

    const tracks = ordered.map((r) => {
      const decision = evaluateMusicUse({ record: r, use: args.use, territory, durationSec, now });
      return {
        ...r,
        allowedHere: decision.action === "allow",
        denyReason: decision.action === "deny" ? decision.error : undefined,
      };
    });
    // DENSEN-approved usable tracks lead; usable-after-acknowledgement follow;
    // tracks denied in this context stay visible WITH their real reason (the
    // composer shows why, never silently hides licensing facts).
    tracks.sort((a, b) => Number(b.allowedHere) - Number(a.allowedHere));
    return { ok: true as const, tracks, fingerprintingConfigured: false };
  },
});

/** One record by audioId — used by the post-publish audio check and the UI. */
export const getMusicRecord = queryGeneric({
  args: { audioId: v.string() },
  handler: async (ctx: any, args: any) => {
    const row = (await ctx.db
      .query("musicRecords")
      .withIndex("by_audio", (q: any) => q.eq("audioId", args.audioId))
      .unique()) as any;
    if (!row) return { ok: false as const, error: "not_found" as const };
    return { ok: true as const, record: projectRecord(row) };
  },
});

/**
 * STAFF — upsert a music record with its real license facts. This is the
 * ONLY path that writes licensing data (no client-invented licenses).
 */
export const upsertMusicRecord = mutationGeneric({
  args: {
    sessionToken: v.string(),
    audioId: v.string(),
    title: v.string(),
    artist: v.string(),
    album: v.optional(v.string()),
    rightsHolder: v.string(),
    licensingStatus: v.union(
      v.literal("densen_licensed"),
      v.literal("platform_licensed"),
      v.literal("user_owned"),
      v.literal("user_licensed"),
      v.literal("restricted"),
      v.literal("copyright_detected"),
      v.literal("removed"),
      v.literal("disputed")
    ),
    territories: v.optional(v.array(v.string())),
    permittedUse: v.array(useKindArg),
    commercialUse: v.boolean(),
    maxDurationSec: v.optional(v.number()),
    licenseExpiresAt: v.optional(v.number()),
    fingerprintRef: v.optional(v.string()),
    restrictions: v.optional(v.string()),
  },
  handler: async (ctx: any, args: any) => {
    const now = Date.now();
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };
    requireRole(staffCaller(c), "moderator");

    const audioId = String(args.audioId).trim().slice(0, 120);
    const title = String(args.title).trim().slice(0, 200);
    const artist = String(args.artist).trim().slice(0, 200);
    const rightsHolder = String(args.rightsHolder).trim().slice(0, 200);
    if (!audioId || !title || !artist || !rightsHolder) return { ok: false as const, error: "bad_fields" as const };

    const territories = (args.territories ?? [])
      .map((t: unknown) => sanitizeTerritory(t))
      .filter((t: string | undefined): t is string => t !== undefined);

    const fields = {
      audioId,
      title,
      artist,
      album: args.album ? String(args.album).slice(0, 200) : undefined,
      rightsHolder,
      licensingStatus: args.licensingStatus,
      territories,
      permittedUse: args.permittedUse,
      commercialUse: Boolean(args.commercialUse),
      maxDurationSec: sanitizeDurationSec(args.maxDurationSec),
      licenseExpiresAt: typeof args.licenseExpiresAt === "number" ? args.licenseExpiresAt : undefined,
      fingerprintRef: args.fingerprintRef ? String(args.fingerprintRef).slice(0, 256) : undefined,
      restrictions: args.restrictions ? String(args.restrictions).slice(0, 1000) : undefined,
    };

    const existing = (await ctx.db
      .query("musicRecords")
      .withIndex("by_audio", (q: any) => q.eq("audioId", audioId))
      .unique()) as any;

    if (existing) {
      await ctx.db.patch(existing._id, { ...fields, updatedAt: now } as never);
      await appendAudit(ctx.db, {
        actorUserId: c.userId,
        actorRole: c.role,
        eventType: "music_rights",
        targetType: "music_record",
        targetId: String(existing._id),
        summary: `music record updated: ${title} status=${args.licensingStatus}`,
        now,
      });
      return { ok: true as const, id: String(existing._id), updated: true as const };
    }

    const id = await ctx.db.insert("musicRecords", {
      ...fields,
      addedByUserId: c.userId as never,
      createdAt: now,
      updatedAt: now,
    } as never);
    await appendAudit(ctx.db, {
      actorUserId: c.userId,
      actorRole: c.role,
      eventType: "music_rights",
      targetType: "music_record",
      targetId: id,
      summary: `music record created: ${title} status=${args.licensingStatus}`,
      now,
    });
    return { ok: true as const, id, updated: false as const };
  },
});

/* ================================================================== */
/*                          Claim workflow                             */
/* ================================================================== */

/**
 * CLAIM INTAKE — detect/receive a claim. Reachable by staff on behalf of a
 * rights holder, by the fingerprinting pipeline (source=fingerprint_match,
 * internal only), or by an in-platform user report. Creates the claim row,
 * notifies the uploader immediately (step 2 of the flow) and audits.
 */
export const submitClaim = mutationGeneric({
  args: {
    sessionToken: v.string(),
    audioId: v.string(),
    postId: v.optional(v.string()),
    claimantName: v.string(),
    assertion: v.string(),
    source: v.union(v.literal("rights_holder_report"), v.literal("user_report")),
    fingerprintRef: v.optional(v.string()),
  },
  handler: async (ctx: any, args: any) => {
    const now = Date.now();
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };

    const recordRow = (await ctx.db
      .query("musicRecords")
      .withIndex("by_audio", (q: any) => q.eq("audioId", args.audioId))
      .unique()) as any;

    // Resolve the affected post + uploader (server-side, never client-claimed).
    let postId: string | undefined;
    let affectedUserId: string | undefined;
    if (args.postId) {
      const post = (await ctx.db.get(args.postId as never)) as any;
      if (!post) return { ok: false as const, error: "post_not_found" as const };
      postId = String(post._id);
      affectedUserId = String(post.userId);
    }

    // Duplicate containment: one open claim per (audioId, post).
    if (postId) {
      const existing = (await ctx.db
        .query("musicClaims")
        .withIndex("by_audio", (q: any) => q.eq("audioId", args.audioId))
        .collect()) as any[];
      const dup = existing.find((r) => r.postId === postId && r.status !== "resolved" && r.status !== "rejected");
      if (dup) return { ok: false as const, error: "claim_already_open" as const, claimId: String(dup._id) };
    }

    const claimId = await ctx.db.insert("musicClaims", {
      audioId: args.audioId,
      musicRecordId: recordRow ? recordRow._id : undefined,
      postId: postId as never,
      affectedUserId: affectedUserId as never,
      source: args.source,
      claimantUserId: c.userId as never,
      claimantName: String(args.claimantName).trim().slice(0, 200),
      assertion: String(args.assertion).trim().slice(0, 2000),
      fingerprintRef: args.fingerprintRef ? String(args.fingerprintRef).slice(0, 256) : undefined,
      status: "submitted" as const,
      createdAt: now,
      updatedAt: now,
    } as never);

    // Flow step 2 — notify the uploader right away (submitted → notified).
    if (affectedUserId) {
      await notify(ctx.db, {
        userId: affectedUserId,
        actorUserId: c.userId,
        type: "copyright_claim",
        targetType: "post",
        targetId: postId,
        now,
      });
      await ctx.db.patch(claimId as never, { status: "notified", updatedAt: now } as never);
    }

    // Flow step 3 — restrict if appropriate: detected copyright content is
    // contained while humans review. This is containment, NOT an outcome.
    if (recordRow && recordRow.licensingStatus !== "removed" && recordRow.licensingStatus !== "disputed") {
      await ctx.db.patch(recordRow._id, { licensingStatus: "disputed", updatedAt: now } as never);
    }

    await appendAudit(ctx.db, {
      actorUserId: c.userId,
      actorRole: c.role,
      eventType: "copyright_claim",
      targetType: "music_claim",
      targetId: claimId,
      summary: `claim received (${args.source}) for audio ${args.audioId}${postId ? ` on post ${postId}` : ""}; uploader notified; track marked disputed pending review`,
      now,
    });

    return { ok: true as const, claimId };
  },
});

/**
 * UPLOADER — every copyright claim against the caller's content, newest
 * first, with the linked dispute when one exists. Powers the user-facing
 * "my copyright claims" view (claim status → dispute → outcome).
 */
export const listMyClaims = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx: any, args: any) => {
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };
    const claims = (await ctx.db
      .query("musicClaims")
      .withIndex("by_affected_user", (q: any) => q.eq("affectedUserId", c.userId))
      .collect()) as any[];
    const sorted = claims.sort((a: any, b: any) => b.createdAt - a.createdAt);
    const out = [];
    for (const cl of sorted) {
      const disputes = (await ctx.db
        .query("musicDisputes")
        .withIndex("by_claim", (q: any) => q.eq("claimId", cl._id))
        .collect()) as any[];
      out.push({
        id: String(cl._id),
        audioId: cl.audioId as string,
        postId: cl.postId ? String(cl.postId) : undefined,
        status: cl.status as ClaimStatus,
        assertion: cl.assertion as string,
        createdAt: cl.createdAt as number,
        dispute: disputes[0]
          ? {
              id: String(disputes[0]._id),
              status: disputes[0].status as DisputeStatus,
              reason: disputes[0].reason as string,
              reviewNote: disputes[0].reviewNote as string | undefined,
            }
          : undefined,
      });
    }
    return { ok: true as const, claims: out };
  },
});

/**
 * STAFF — advance a claim through the flow: restrict → replace audio →
 * remove audio → remove content, plus review transitions. Every move is
 * transition-table-validated and audited.
 */
export const advanceClaim = mutationGeneric({
  args: {
    sessionToken: v.string(),
    claimId: v.string(),
    to: v.union(
      v.literal("restricted"),
      v.literal("audio_replaced"),
      v.literal("audio_removed"),
      v.literal("content_removed"),
      v.literal("under_review"),
      v.literal("resolved"),
      v.literal("rejected")
    ),
    /** Replacement approved audioId (audio_replaced only). */
    replacementAudioId: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx: any, args: any) => {
    const now = Date.now();
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };
    requireRole(staffCaller(c), "moderator"); // containment + outcomes are staff actions

    const claim = (await ctx.db.get(args.claimId as never)) as any;
    if (!claim) return { ok: false as const, error: "not_found" as const };
    const from = claim.status as ClaimStatus;
    const to = args.to as ClaimStatus;
    if (!canTransitionClaim(from, to)) return { ok: false as const, error: "bad_transition" as const };

    const recordRow = claim.musicRecordId
      ? ((await ctx.db.get(claim.musicRecordId as never)) as any)
      : ((await ctx.db
          .query("musicRecords")
          .withIndex("by_audio", (q: any) => q.eq("audioId", claim.audioId))
          .unique()) as any);

    let summary = claimActionFor(to);

    // Containment actions on the affected content.
    if (to === "restricted" && claim.postId) {
      await ctx.db.patch(claim.postId as never, { status: "in_review", updatedAt: now } as never);
    }
    if (to === "audio_removed" && claim.postId) {
      await ctx.db.patch(claim.postId as never, { audioRef: undefined, updatedAt: now } as never);
    }
    if (to === "content_removed" && claim.postId) {
      await ctx.db.patch(claim.postId as never, { status: "removed", updatedAt: now } as never);
    }
    if (to === "audio_replaced") {
      if (!args.replacementAudioId) return { ok: false as const, error: "replacement_required" as const };
      const replacement = (await ctx.db
        .query("musicRecords")
        .withIndex("by_audio", (q: any) => q.eq("audioId", args.replacementAudioId))
        .unique()) as any;
      if (!replacement) return { ok: false as const, error: "replacement_not_found" as const };
      const replacementAllowed = evaluateMusicUse({
        record: projectRecord(replacement),
        use: "personal_post",
        territory: "AL",
        durationSec: 0,
        now,
      });
      if (replacementAllowed.action !== "allow") return { ok: false as const, error: "replacement_not_licensable" as const };
      if (claim.postId) {
        await ctx.db.patch(claim.postId as never, { audioRef: args.replacementAudioId, updatedAt: now } as never);
      }
      summary += ` -> ${args.replacementAudioId}`;
    }

    // Track status follows the containment level.
    if (recordRow) {
      if (to === "audio_removed" || to === "content_removed" || to === "restricted") {
        await ctx.db.patch(recordRow._id, { licensingStatus: "removed", updatedAt: now } as never);
      } else if (to === "resolved") {
        // Staff decided: restore what the record actually permits. The record
        // reverts to its documented status only via upsertMusicRecord — here
        // it goes back to platform_licensed default only if it was never
        // otherwise classified; otherwise staff updates it explicitly.
        await ctx.db.patch(recordRow._id, { licensingStatus: "restricted", updatedAt: now } as never);
      }
    }

    if (to === "resolved" || to === "rejected") {
      await ctx.db.patch(args.claimId as never, {
        status: to,
        reviewedBy: c.userId as never,
        resolvedAt: now,
        updatedAt: now,
      } as never);
    } else {
      await ctx.db.patch(args.claimId as never, { status: to, reviewedBy: c.userId as never, updatedAt: now } as never);
    }

    if (claim.affectedUserId && (to === "restricted" || to === "audio_replaced" || to === "audio_removed" || to === "content_removed" || to === "resolved" || to === "rejected")) {
      await notify(ctx.db, {
        userId: claim.affectedUserId,
        type: "copyright_claim_update",
        targetType: "post",
        targetId: claim.postId ?? undefined,
        now,
      });
    }

    await appendAudit(ctx.db, {
      actorUserId: c.userId,
      actorRole: c.role,
      eventType: "copyright_claim",
      targetType: "music_claim",
      targetId: args.claimId,
      summary: `claim ${from} -> ${to}: ${summary}${args.note ? `; note: ${String(args.note).slice(0, 200)}` : ""}`,
      now,
    });

    return { ok: true as const, status: to };
  },
});

/* ================================================================== */
/*                          Dispute workflow                           */
/* ================================================================== */

/**
 * UPLOADER — dispute a claim. Reason is one of the five brief options,
 * evidence goes in as media-module REFERENCES (upload via the media pipeline),
 * one dispute per claim, affected uploader only. Submission NEVER changes
 * the claim outcome — staff review does.
 */
export const submitDispute = mutationGeneric({
  args: {
    sessionToken: v.string(),
    claimId: v.string(),
    reason: v.union(
      v.literal("i_own"),
      v.literal("i_have_license"),
      v.literal("original_audio"),
      v.literal("incorrect_claim"),
      v.literal("other")
    ),
    statement: v.string(),
    evidenceRefs: v.optional(v.array(v.string())),
  },
  handler: async (ctx: any, args: any) => {
    const now = Date.now();
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };

    const claim = (await ctx.db.get(args.claimId as never)) as any;
    const existing = (await ctx.db
      .query("musicDisputes")
      .withIndex("by_claim", (q: any) => q.eq("claimId", args.claimId))
      .collect()) as any[];

    const evidenceRefs = (args.evidenceRefs ?? [])
      .map((r: unknown) => sanitizeEvidenceRef(r))
      .filter((r: string | undefined): r is string => r !== undefined);

    const decision = decideSubmitDispute({
      signedIn: true,
      claim: claim ? { status: claim.status as ClaimStatus, affectedUserId: claim.affectedUserId ? String(claim.affectedUserId) : undefined } : null,
      callerUserId: c.userId,
      existingDispute: existing.length > 0,
      reason: args.reason,
      statement: String(args.statement ?? ""),
      evidenceRefs: args.evidenceRefs ?? [],
    });
    if (decision.action === "deny") return { ok: false as const, error: decision.error as never };

    const disputeId = await ctx.db.insert("musicDisputes", {
      claimId: claim._id,
      disputantUserId: c.userId as never,
      reason: args.reason,
      statement: String(args.statement).trim().slice(0, 2000),
      evidenceRefs,
      status: "submitted" as const,
      createdAt: now,
      updatedAt: now,
    } as never);

    // The dispute pulls the claim into staff review — nothing else changes.
    if (canTransitionClaim(claim.status as ClaimStatus, "under_review")) {
      await ctx.db.patch(claim._id, { status: "under_review", updatedAt: now } as never);
    }

    await appendAudit(ctx.db, {
      actorUserId: c.userId,
      actorRole: c.role,
      eventType: "copyright_dispute",
      targetType: "music_dispute",
      targetId: disputeId,
      summary: `dispute submitted (reason: ${args.reason}) against claim ${String(claim._id)}; queued for staff review`,
      now,
    });
    await appendAudit(ctx.db, {
      eventType: "copyright_claim",
      targetType: "music_claim",
      targetId: String(claim._id),
      summary: "dispute received — claim moved to under_review for staff decision",
      now,
    });

    return { ok: true as const, disputeId };
  },
});

/**
 * STAFF — advance a dispute: under_review ⇄ more_information, accepted /
 * rejected, resolved. Accepting a dispute restores the affected post's
 * audio (the claim was wrong); rejecting upholds the containment. Staff
 * choices are recorded with reviewer + note and audited.
 */
export const reviewDispute = mutationGeneric({
  args: {
    sessionToken: v.string(),
    disputeId: v.string(),
    to: v.union(
      v.literal("under_review"),
      v.literal("more_information"),
      v.literal("accepted"),
      v.literal("rejected"),
      v.literal("resolved")
    ),
    note: v.optional(v.string()),
  },
  handler: async (ctx: any, args: any) => {
    const now = Date.now();
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };
    requireRole(staffCaller(c), "moderator");

    const dispute = (await ctx.db.get(args.disputeId as never)) as any;
    if (!dispute) return { ok: false as const, error: "not_found" as const };
    const claim = (await ctx.db.get(dispute.claimId as never)) as any;
    if (!claim) return { ok: false as const, error: "claim_not_found" as const };

    const from = dispute.status as DisputeStatus;
    const to = args.to as DisputeStatus;
    if (!canTransitionDispute(from, to)) return { ok: false as const, error: "bad_transition" as const };

    const patch: Record<string, unknown> = { status: to, reviewedBy: c.userId as never, updatedAt: now };
    if (to === "resolved") patch.resolvedAt = now;
    if (args.note) patch.reviewNote = String(args.note).slice(0, 1000);
    await ctx.db.patch(dispute._id, patch as never);

    // Claim follows the dispute decision (staff decision — audited).
    if (to === "accepted" && canTransitionClaim(claim.status as ClaimStatus, "resolved")) {
      await ctx.db.patch(claim._id, { status: "resolved", reviewedBy: c.userId as never, resolvedAt: now, updatedAt: now } as never);
      // Restore the affected post (audio was contained, the claim was wrong).
      if (claim.postId && (claim.postId as any).status !== undefined) {
        const post = (await ctx.db.get(claim.postId as never)) as any;
        if (post && post.status !== "published") {
          await ctx.db.patch(claim.postId as never, { status: "published", updatedAt: now } as never);
        }
      }
      if (claim.musicRecordId) {
        const rec = (await ctx.db.get(claim.musicRecordId as never)) as any;
        if (rec && rec.licensingStatus === "disputed") {
          await ctx.db.patch(claim.musicRecordId, { licensingStatus: "restricted", updatedAt: now } as never);
        }
      }
    }
    if (to === "rejected" && canTransitionClaim(claim.status as ClaimStatus, "resolved")) {
      await ctx.db.patch(claim._id, { status: "resolved", reviewedBy: c.userId as never, resolvedAt: now, updatedAt: now } as never);
    }
    if (to === "resolved" || to === "accepted" || to === "rejected") {
      if (claim.affectedUserId) {
        await notify(ctx.db, {
          userId: claim.affectedUserId,
          type: "copyright_dispute_update",
          targetType: "post",
          targetId: claim.postId ?? undefined,
          now,
        });
      }
    }

    await appendAudit(ctx.db, {
      actorUserId: c.userId,
      actorRole: c.role,
      eventType: "copyright_dispute",
      targetType: "music_dispute",
      targetId: args.disputeId,
      summary: `dispute ${from} -> ${to}${args.note ? `; note: ${String(args.note).slice(0, 200)}` : ""}`,
      now,
    });

    return { ok: true as const, status: to };
  },
});

/* ================================================================== */
/*                     User-facing queries (own rows)                  */
/* ================================================================== */

/** The uploader's claim + dispute status for one post. */
export const getMyCopyrightStatus = queryGeneric({
  args: { sessionToken: v.string(), postId: v.string() },
  handler: async (ctx: any, args: any) => {
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };
    const claims = (await ctx.db
      .query("musicClaims")
      .withIndex("by_affected_user", (q: any) => q.eq("affectedUserId", c.userId))
      .collect()) as any[];
    const mine = claims.filter((r) => r.postId === args.postId);
    const out = [];
    for (const cl of mine.sort((a: any, b: any) => b.createdAt - a.createdAt)) {
      const disputes = (await ctx.db
        .query("musicDisputes")
        .withIndex("by_claim", (q: any) => q.eq("claimId", cl._id))
        .collect()) as any[];
      out.push({
        id: String(cl._id),
        audioId: cl.audioId as string,
        status: cl.status as ClaimStatus,
        assertion: cl.assertion as string,
        createdAt: cl.createdAt as number,
        dispute: disputes[0]
          ? {
              id: String(disputes[0]._id),
              status: disputes[0].status as DisputeStatus,
              reason: disputes[0].reason as string,
              reviewNote: disputes[0].reviewNote as string | undefined,
            }
          : undefined,
      });
    }
    return { ok: true as const, claims: out };
  },
});

/* ================================================================== */
/*                       Admin dashboard queries                       */
/* ================================================================== */

/** STAFF — the copyright dashboard: claims + disputes + records in one read. */
export const adminCopyrightDashboard = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx: any, args: any) => {
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };
    if (!isStaff(c)) return { ok: false as const, error: "forbidden" as const };

    const claims = ((await ctx.db
      .query("musicClaims")
      .withIndex("by_status", (q: any) => q.eq("status", "submitted"))
      .collect()) as any[])
      .concat(await ctx.db.query("musicClaims").withIndex("by_status", (q: any) => q.eq("status", "notified")).collect())
      .concat(await ctx.db.query("musicClaims").withIndex("by_status", (q: any) => q.eq("status", "restricted")).collect())
      .concat(await ctx.db.query("musicClaims").withIndex("by_status", (q: any) => q.eq("status", "under_review")).collect())
      .concat(await ctx.db.query("musicClaims").withIndex("by_status", (q: any) => q.eq("status", "audio_replaced")).collect())
      .concat(await ctx.db.query("musicClaims").withIndex("by_status", (q: any) => q.eq("status", "audio_removed")).collect())
      .concat(await ctx.db.query("musicClaims").withIndex("by_status", (q: any) => q.eq("status", "content_removed")).collect())
      .sort((a: any, b: any) => b.createdAt - a.createdAt);

    const disputes = ((await ctx.db
      .query("musicDisputes")
      .withIndex("by_status", (q: any) => q.eq("status", "submitted"))
      .collect()) as any[])
      .concat(await ctx.db.query("musicDisputes").withIndex("by_status", (q: any) => q.eq("status", "under_review")).collect())
      .concat(await ctx.db.query("musicDisputes").withIndex("by_status", (q: any) => q.eq("status", "more_information")).collect())
      .sort((a: any, b: any) => b.createdAt - a.createdAt);

    const records = ((await ctx.db
      .query("musicRecords")
      .withIndex("by_status", (q: any) => q.eq("licensingStatus", "disputed"))
      .collect()) as any[])
      .concat(await ctx.db.query("musicRecords").withIndex("by_status", (q: any) => q.eq("licensingStatus", "copyright_detected")).collect())
      .concat(await ctx.db.query("musicRecords").withIndex("by_status", (q: any) => q.eq("licensingStatus", "removed")).collect())
      .map(projectRecord);

    const allRecords = ((await ctx.db.query("musicRecords").withIndex("by_audio", (q: any) => q.gt("audioId", "")).collect()) as any[])
      .sort((a: any, b: any) => b.updatedAt - a.updatedAt)
      .map(projectRecord);

    const counts = { claims: claims.length, disputes: disputes.length, flaggedRecords: records.length, records: allRecords.length };

    return {
      ok: true as const,
      counts,
      records: allRecords.map((r) => ({
        id: r.id,
        title: r.title,
        artist: r.artist,
        audioId: r.audioId,
        rightsHolder: r.rightsHolder,
        licensingStatus: r.licensingStatus,
        territories: r.territories,
        permittedUse: r.permittedUse as string[],
        commercialUse: r.commercialUse,
        maxDurationSec: r.maxDurationSec,
        licenseExpiresAt: r.licenseExpiresAt,
        restrictions: r.restrictions,
      })),
      claims: claims.map((cl: any) => ({
        id: String(cl._id),
        audioId: cl.audioId as string,
        postId: cl.postId ? String(cl.postId) : undefined,
        affectedUserId: cl.affectedUserId ? String(cl.affectedUserId) : undefined,
        source: cl.source as string,
        claimantName: cl.claimantName as string,
        assertion: cl.assertion as string,
        status: cl.status as ClaimStatus,
        fingerprintRef: cl.fingerprintRef as string | undefined,
        createdAt: cl.createdAt as number,
      })),
      disputes: disputes.map((d: any) => ({
        id: String(d._id),
        claimId: String(d.claimId),
        reason: d.reason as string,
        statement: d.statement as string,
        evidenceRefs: (d.evidenceRefs ?? []) as string[],
        status: d.status as DisputeStatus,
        createdAt: d.createdAt as number,
      })),
      flaggedRecords: records,
    };
  },
});

/** STAFF — recent music-rights audit trail (eventType music_rights/copyright_*). */
export const adminRightsAudit = queryGeneric({
  args: { sessionToken: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx: any, args: any) => {
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };
    if (!isStaff(c)) return { ok: false as const, error: "forbidden" as const };
    const limit = Math.min(Math.max(Math.round(args.limit ?? 30), 1), 100);
    const rows = (await ctx.db.query("auditLogs").withIndex("by_time", (q: any) => q.gt("createdAt", 0)).order("desc").take(400)) as any[];
    const mine = rows.filter((r) => ["music_rights", "copyright_claim", "copyright_dispute"].includes(r.eventType as string)).slice(0, limit);
    return {
      ok: true as const,
      entries: mine.map((r) => ({
        id: String(r._id),
        eventType: r.eventType as string,
        summary: r.summary as string,
        actorUserId: r.actorUserId ? String(r.actorUserId) : undefined,
        targetType: r.targetType as string | undefined,
        targetId: r.targetId as string | undefined,
        createdAt: r.createdAt as number,
      })),
    };
  },
});
