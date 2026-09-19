/**
 * DENSEN — Media storage abstraction (integration point, NOT yet configured)
 * ==========================================================================
 * Day-1 foundation: defines the contract every future media provider implements
 * and ships a not-configured default that fails loudly. No fake uploads, no
 * placeholder files, no credentials read or stored anywhere.
 *
 * To wire a real provider later (S3/R2/Convex Storage/Mux):
 *   1. Implement `MediaProvider` (see interface below).
 *   2. Register it via `setMediaProvider()` in the server bootstrap only —
 *      provider selection is server-side; the browser never sees provider config.
 *   3. Required configuration (names only, values supplied via the platform's
 *      environment settings): MEDIA_PROVIDER, MEDIA_BUCKET, MEDIA_REGION,
 *      MEDIA_PUBLIC_BASE_URL, and the provider's credential secret. None are read
 *      by this module; the provider implementation reads them from process.env
 *      inside the server runtime when it lands.
 *
 * Design rules:
 *  - Videos/images/thumbnails/audio are stored by opaque REFERENCE, never inline
 *    in database rows (schema keeps *Ref columns only).
 *  - Uploads mint short-lived, single-use signed upload URLs from an authenticated
 *    mutation; the browser talks directly to the provider and never holds bucket
 *    credentials.
 *  - Read access is mediated: signed read URLs are minted per-request server-side
 *    (or the provider's CDN URL for public assets), gated by visibility rules.
 *  - Processed variants (renditions, thumbnails, transcodes) live behind the same
 *    interface via `kind` + `variant` metadata.
 *  - When no provider is configured, every operation throws MEDIA_NOT_CONFIGURED —
 *    the UI can catch this and surface an honest "storage not set up" state. There
 *    are no fake uploads and no local-disk fallback.
 */
import { v } from "convex/values";

/* ---------------- contract ---------------- */

export type MediaKind = "video" | "image" | "thumbnail" | "audio" | "processed_video";

export interface SignedUpload {
  /** One-time upload target for the browser to PUT/POST directly. */
  uploadUrl: string;
  /** Opaque reference to persist in schema `*Ref` columns after upload completes. */
  ref: string;
  /** Provider-generated object key (kept server-side; never treated as public URL). */
  objectKey: string;
  expiresAt: number;
}

export interface SignedRead {
  url: string;
  expiresAt: number;
}

export interface MediaProvider {
  readonly name: string;
  /** Capability flags the bootstrap can assert before accepting work. */
  readonly supports: Record<MediaKind, boolean>;
  /** Single-use signed upload URL for a direct browser→provider upload. */
  createUploadUrl(input: {
    kind: MediaKind;
    userId: string;
    fileName?: string;
    contentType?: string;
    maxBytes: number;
  }): Promise<SignedUpload>;
  /** Short-lived read URL, gated server-side by the caller's visibility check. */
  createReadUrl(ref: string, opts?: { ttlSeconds?: number }): Promise<SignedRead>;
  /** Delete underlying objects (original + variants) — moderation/deletion flows. */
  deleteObject(ref: string): Promise<void>;
}

/* ---------------- not-configured default (fails loudly, honestly) ---------------- */

export class MediaNotConfiguredError extends Error {
  constructor(op: string) {
    super(`MEDIA_NOT_CONFIGURED:${op}`);
    this.name = "MediaNotConfiguredError";
  }
}

const notConfiguredProvider: MediaProvider = {
  name: "not_configured",
  supports: {
    video: false,
    image: false,
    thumbnail: false,
    audio: false,
    processed_video: false,
  },
  async createUploadUrl() {
    throw new MediaNotConfiguredError("createUploadUrl");
  },
  async createReadUrl() {
    throw new MediaNotConfiguredError("createReadUrl");
  },
  async deleteObject() {
    throw new MediaNotConfiguredError("deleteObject");
  },
};

/* ---------------- server-side registry ---------------- */

let active: MediaProvider = notConfiguredProvider;

/** Server bootstrap only. Never expose the provider instance or its config client-side. */
export function setMediaProvider(p: MediaProvider): void {
  active = p;
}

export function getMediaProvider(): MediaProvider {
  return active;
}

/** True when a real provider has been registered (used by honest UI state). */
export function isMediaConfigured(): boolean {
  return active !== notConfiguredProvider;
}

/* ---------------- validators shared by future media mutations ---------------- */

export const MediaKinds = ["video", "image", "thumbnail", "audio", "processed_video"] as const;

export const UploadLimits: Record<MediaKind, number> = {
  video: 512 * 1024 * 1024, // 512 MB
  image: 10 * 1024 * 1024, // 10 MB
  thumbnail: 5 * 1024 * 1024, // 5 MB
  audio: 20 * 1024 * 1024, // 20 MB
  processed_video: 1024 * 1024 * 1024, // 1 GB
};

export const mediaKindValidator = v.union(
  v.literal("video"),
  v.literal("image"),
  v.literal("thumbnail"),
  v.literal("audio"),
  v.literal("processed_video")
);

/** Runtime guard for non-Convex-args code paths (worker jobs, tests). */
export function isMediaKind(x: unknown): x is MediaKind {
  return (MediaKinds as readonly string[]).includes(x as string);
}
