/**
 * DENSEN — Video upload pipeline (Day 4, REAL uploads).
 * ======================================================
 * Active storage provider: **Convex built-in file storage** — no external
 * service, no credentials, no fake uploads. Blobs live in the deployment's
 * object storage; database rows keep opaque references only (media.ts rule).
 * External providers (S3/R2/Mux) plug in later through the existing
 * `MediaProvider` seam in `convex/media.ts` + `setMediaProvider` (their
 * credentials land in the action runtime only, never the browser).
 *
 * Flow: requestVideoUpload (row + signed URL) → browser PUT with progress →
 * requestThumbnailUpload (signed URL) → thumbnail PUT → completeVideoUpload
 * (server verifies the blobs via the system _storage table) → ready.
 * Failures: markVideoFailed (client-reported) + expiry checks server-side;
 * deleteVideo removes blobs AND the row (owner-only, audited).
 */
import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { callerFromToken } from "./content";
import {
  uploadIsResumable,
  uploadWindowExpired,
  validateDuration,
  validateThumbnailFile,
  validateVideoFile,
  UPLOAD_WINDOW_MS,
} from "./videoInternals";

const MAX_PENDING_UPLOADS = 5; // honest cap against storage abuse

interface VideoRow {
  _id: string;
  ownerUserId: string;
  storageRef: string;
  thumbnailRef?: string;
  durationSec: number;
  processingStatus?: string;
  uploadExpiresAt?: number;
  visibility?: "public" | "followers" | "private";
  moderationStatus: string;
  createdAt: number;
  updatedAt: number;
}

async function requireCaller(db: { get: any; query: (t: string) => any }, sessionToken: string) {
  const caller = await callerFromToken(db, sessionToken);
  if (!caller) return null;
  const user = await db.get(caller.userId as never);
  if (!user) return null;
  return { caller, user };
}

async function storageMeta(db: any, storageId: string): Promise<{ contentType?: string; size?: number } | null> {
  // db.system.get(fileId) returns the _storage row (contentType, sha256, size)
  // WITHOUT downloading the blob — the documented metadata API. An earlier
  // version used db.system.query("_storage").withIndex("by_id", …) which is
  // not a valid index range on this Convex backend (id is not an indexable
  // field) and made every real upload fail at completion.
  return (await db.system.get(storageId)) ?? null;
}

/* --------------------------- upload session --------------------------- */

export const requestVideoUpload = mutationGeneric({
  args: {
    sessionToken: v.string(),
    contentType: v.string(),
    sizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };

    // Boundary validation (client checks are UX only; this is the gate).
    const fileCheck = validateVideoFile({ contentType: args.contentType, sizeBytes: args.sizeBytes });
    if (!fileCheck.ok) return { ok: false as const, error: fileCheck.error };

    // Housekeeping: cap in-flight uploads per user (fail-closed against abuse).
    const mine = (await ctx.db
      .query("videos")
      .withIndex("by_owner", (q: any) => q.eq("ownerUserId", c.caller.userId))
      .collect()) as VideoRow[];
    const pending = mine.filter((r) => uploadIsResumable(r.processingStatus));
    if (pending.length >= MAX_PENDING_UPLOADS) return { ok: false as const, error: "too_many_pending" as const };

    const videoId = await ctx.db.insert("videos", {
      ownerUserId: c.caller.userId as never,
      storageRef: "pending",
      durationSec: 0,
      moderationStatus: "pending",
      processingStatus: "awaiting_upload",
      uploadExpiresAt: now + UPLOAD_WINDOW_MS,
      createdAt: now,
      updatedAt: now,
    });

    // Real, single-use signed upload URL from the deployment's storage.
    const uploadUrl = await ctx.storage.generateUploadUrl();
    return { ok: true as const, videoId, uploadUrl };
  },
});

/** Separate signed URL for the client-generated thumbnail (real capture). */
export const requestThumbnailUpload = mutationGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };
    const uploadUrl = await ctx.storage.generateUploadUrl();
    return { ok: true as const, uploadUrl };
  },
});

/* --------------------------- completion + failure --------------------------- */

/**
 * Finalize an upload: verify the blobs REALLY exist in storage (system table),
 * attach metadata, mark ready. This is the honest "processing" step — a future
 * transcode worker would transition ready → processing → ready with variants.
 */
export const completeVideoUpload = mutationGeneric({
  args: {
    sessionToken: v.string(),
    videoId: v.string(),
    storageId: v.string(),
    durationSec: v.number(),
    thumbnailStorageId: v.optional(v.string()),
    altText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };

    const video = (await ctx.db.get(args.videoId as never)) as VideoRow | null;
    if (!video || video.ownerUserId !== c.caller.userId) return { ok: false as const, error: "not_found" as const };
    if (!uploadIsResumable(video.processingStatus)) return { ok: false as const, error: "not_resumable" as const };
    if (uploadWindowExpired(video.uploadExpiresAt, now)) {
      await ctx.db.patch(video._id as never, { processingStatus: "failed", failedReason: "upload_window_expired", updatedAt: now });
      return { ok: false as const, error: "upload_window_expired" as const };
    }

    const duration = validateDuration(args.durationSec);
    if (!duration.ok) return { ok: false as const, error: duration.error };

    // REAL verification against the system _storage table — the blob must exist.
    const vMeta = await storageMeta(ctx.db, args.storageId);
    if (!vMeta) return { ok: false as const, error: "blob_missing" as const };
    const vCheck = validateVideoFile({ contentType: vMeta.contentType ?? "", sizeBytes: vMeta.size ?? 0 });
    if (!vCheck.ok) return { ok: false as const, error: vCheck.error };

    let thumbnailRef: string | undefined;
    if (args.thumbnailStorageId) {
      const tMeta = await storageMeta(ctx.db, args.thumbnailStorageId);
      if (!tMeta) return { ok: false as const, error: "blob_missing" as const };
      const tCheck = validateThumbnailFile({ contentType: tMeta.contentType ?? "", sizeBytes: tMeta.size ?? 0 });
      if (!tCheck.ok) return { ok: false as const, error: tCheck.error };
      thumbnailRef = args.thumbnailStorageId;
    }

    await ctx.db.patch(video._id as never, {
      storageRef: args.storageId,
      thumbnailRef,
      durationSec: Math.round(args.durationSec),
      altText: args.altText?.slice(0, 200),
      processingStatus: "ready", // transcoding/copyright pipeline hooks live behind this state
      uploadExpiresAt: undefined,
      failedReason: undefined,
      updatedAt: now,
    });

    await ctx.db.insert("auditLogs", {
      actorUserId: c.caller.userId as never,
      eventType: "media_event",
      targetType: "video",
      targetId: video._id,
      summary: "video_upload_completed",
      createdAt: now,
    });
    return { ok: true as const, videoId: video._id, processingStatus: "ready" as const };
  },
});

/** Client-reported upload failure (unsupported/network/abort). Stable codes only. */
export const markVideoFailed = mutationGeneric({
  args: { sessionToken: v.string(), videoId: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };

    const video = (await ctx.db.get(args.videoId as never)) as VideoRow | null;
    if (!video || video.ownerUserId !== c.caller.userId) return { ok: false as const, error: "not_found" as const };
    if (!uploadIsResumable(video.processingStatus)) return { ok: false as const, error: "not_resumable" as const };

    const KNOWN = ["unsupported_type", "too_large", "network", "upload_failed", "aborted"];
    const reason = KNOWN.includes(args.reason) ? args.reason : "upload_failed";
    await ctx.db.patch(video._id as never, { processingStatus: "failed", failedReason: reason, updatedAt: now });
    return { ok: true as const };
  },
});

/* --------------------------- deletion + reads --------------------------- */

/**
 * Owner-only deletion: removes BOTH blobs from storage and the row itself.
 * Posts referencing the video keep their text; their video link dangles by
 * design (read paths must tolerate a missing video row).
 */
export const deleteVideo = mutationGeneric({
  args: { sessionToken: v.string(), videoId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };

    const video = (await ctx.db.get(args.videoId as never)) as VideoRow | null;
    if (!video || video.ownerUserId !== c.caller.userId) return { ok: false as const, error: "not_found" as const };

    try {
      if (video.storageRef && video.storageRef !== "pending") await ctx.storage.delete(video.storageRef as never);
      if (video.thumbnailRef) await ctx.storage.delete(video.thumbnailRef as never);
    } catch {
      // Blob cleanup is best-effort; the row is always removed so no dangling
      // reference can ever be resolved again.
    }
    await ctx.db.delete(video._id as never);
    await ctx.db.insert("auditLogs", {
      actorUserId: c.caller.userId as never,
      eventType: "media_event",
      targetType: "video",
      targetId: video._id,
      summary: "video_deleted",
      createdAt: now,
    });
    return { ok: true as const };
  },
});

/** Owner-scoped library: newest first, processing state included. */
export const getMyVideos = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };

    const rows = (await ctx.db
      .query("videos")
      .withIndex("by_owner", (q: any) => q.eq("ownerUserId", c.caller.userId))
      .collect()) as VideoRow[];
    rows.sort((a, b) => b.createdAt - a.createdAt);
    return {
      ok: true as const,
      videos: rows.map((r) => ({
        videoId: r._id,
        storageRef: r.storageRef,
        thumbnailRef: r.thumbnailRef,
        durationSec: r.durationSec,
        processingStatus: r.processingStatus ?? "ready", // legacy rows = ready
        visibility: r.visibility ?? "public",
        moderationStatus: r.moderationStatus,
        createdAt: r.createdAt,
      })),
    };
  },
});
