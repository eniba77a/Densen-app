/**
 * DENSEN — Video upload decision cores (pure, unit-tested).
 * ==========================================================
 * Client-side pre-validation mirrors these rules for fast UX feedback; the
 * server re-decides everything (the client check is never the gate).
 */
import { UploadLimits } from "./media";

export type VideoUploadError = "unsupported_type" | "too_large" | "invalid_duration";

/** Accepted source video containers (web + mobile camera roll). */
export const VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/quicktime", // .mov (iOS)
  "video/webm",
] as const;

export const VIDEO_LIMIT_BYTES = UploadLimits.video; // 512 MB
export const THUMBNAIL_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const VIDEO_MAX_DURATION_SEC = 600; // 10 minutes

export function validateVideoFile(input: {
  contentType: string;
  sizeBytes: number;
}): { ok: true } | { ok: false; error: VideoUploadError } {
  if (!(VIDEO_MIME_TYPES as readonly string[]).includes(input.contentType)) {
    return { ok: false, error: "unsupported_type" };
  }
  if (input.sizeBytes <= 0 || input.sizeBytes > VIDEO_LIMIT_BYTES) {
    return { ok: false, error: "too_large" };
  }
  return { ok: true };
}

export function validateThumbnailFile(input: {
  contentType: string;
  sizeBytes: number;
}): { ok: true } | { ok: false; error: VideoUploadError } {
  if (!(THUMBNAIL_MIME_TYPES as readonly string[]).includes(input.contentType)) {
    return { ok: false, error: "unsupported_type" };
  }
  if (input.sizeBytes <= 0 || input.sizeBytes > UploadLimits.thumbnail) {
    return { ok: false, error: "too_large" };
  }
  return { ok: true };
}

/** Durations outside [1s, 10min] are rejected — a dance video needs both. */
export function validateDuration(durationSec: number): { ok: true } | { ok: false; error: VideoUploadError } {
  if (!Number.isFinite(durationSec) || durationSec < 1 || durationSec > VIDEO_MAX_DURATION_SEC) {
    return { ok: false, error: "invalid_duration" };
  }
  return { ok: true };
}

/**
 * Server-side visibility clamp: minors never publish publicly — the stored
 * visibility is the SERVER decision (mirrors the client preview and the
 * youth defaults from Day 1).
 */
export function decideVideoVisibility(
  visibility: "public" | "followers" | "private",
  isMinor: boolean
): "public" | "followers" | "private" {
  return isMinor && visibility === "public" ? "followers" : visibility;
}

/** Stale upload windows keep `awaiting_upload` rows from accumulating forever. */
export const UPLOAD_WINDOW_MS = 60 * 60 * 1000; // 1 hour to finish an upload

export function uploadWindowExpired(uploadExpiresAt: number | undefined, now: number): boolean {
  return uploadExpiresAt !== undefined && uploadExpiresAt < now;
}

/** A processing row is terminal when the client can no longer act on it. */
export function uploadIsResumable(processingStatus: string | undefined): boolean {
  return processingStatus === "awaiting_upload" || processingStatus === "failed";
}
