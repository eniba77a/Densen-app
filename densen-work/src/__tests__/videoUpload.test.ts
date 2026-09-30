import { describe, expect, it } from "vitest";
import {
  VIDEO_MIME_TYPES,
  VIDEO_LIMIT_BYTES,
  VIDEO_MAX_DURATION_SEC,
  UPLOAD_WINDOW_MS,
  validateVideoFile,
  validateThumbnailFile,
  validateDuration,
  decideVideoVisibility,
  uploadWindowExpired,
  uploadIsResumable,
} from "../../convex/videoInternals";
import { UploadLimits } from "../../convex/media";
import {
  CLIENT_VIDEO_MIME_TYPES,
  CLIENT_VIDEO_LIMIT_BYTES,
  CLIENT_MAX_DURATION_SEC,
  precheckVideoFile,
} from "../../src/lib/videoUpload";

/**
 * Day 4 — real dance-video upload pipeline.
 *
 * These tests pin the *server-side* decision rules (convex/videoInternals.ts)
 * and the client↔server contract (src/lib/videoUpload.ts constants): the
 * client pre-check is UX only, the server re-decides everything, so both sides
 * must agree on accepted types, size limits, and duration bounds.
 */

/* ---------------- file validation (the server gate) ---------------- */
describe("video file validation", () => {
  it("accepts the web + mobile camera-roll containers", () => {
    for (const ct of VIDEO_MIME_TYPES) {
      expect(validateVideoFile({ contentType: ct, sizeBytes: 1024 }).ok).toBe(true);
    }
    expect([...VIDEO_MIME_TYPES]).toEqual(["video/mp4", "video/quicktime", "video/webm"]);
  });

  it("rejects unsupported types (the classic .avi/.mp3/GIF trap)", () => {
    for (const ct of ["video/avi", "video/x-msvideo", "audio/mpeg", "image/gif", ""]) {
      expect(validateVideoFile({ contentType: ct, sizeBytes: 1024 })).toEqual({
        ok: false,
        error: "unsupported_type",
      });
    }
  });

  it("rejects empty and oversized video payloads", () => {
    expect(validateVideoFile({ contentType: "video/mp4", sizeBytes: 0 })).toEqual({ ok: false, error: "too_large" });
    expect(validateVideoFile({ contentType: "video/mp4", sizeBytes: -1 })).toEqual({ ok: false, error: "too_large" });
    expect(validateVideoFile({ contentType: "video/mp4", sizeBytes: VIDEO_LIMIT_BYTES + 1 })).toEqual({
      ok: false,
      error: "too_large",
    });
    expect(validateVideoFile({ contentType: "video/mp4", sizeBytes: VIDEO_LIMIT_BYTES }).ok).toBe(true);
    expect(VIDEO_LIMIT_BYTES).toBe(UploadLimits.video);
  });

  it("thumbnail validation is separate and smaller", () => {
    expect(validateThumbnailFile({ contentType: "image/jpeg", sizeBytes: 2048 }).ok).toBe(true);
    expect(validateThumbnailFile({ contentType: "image/png", sizeBytes: 2048 }).ok).toBe(true);
    expect(validateThumbnailFile({ contentType: "image/webp", sizeBytes: 2048 }).ok).toBe(true);
    expect(validateThumbnailFile({ contentType: "image/jpeg", sizeBytes: UploadLimits.thumbnail + 1 })).toEqual({
      ok: false,
      error: "too_large",
    });
    expect(validateThumbnailFile({ contentType: "video/mp4", sizeBytes: 10 })).toEqual({
      ok: false,
      error: "unsupported_type",
    });
  });
});

/* ---------------- duration bounds ---------------- */
describe("duration validation", () => {
  it("accepts the 1s–10min band and rejects everything outside it", () => {
    expect(validateDuration(1).ok).toBe(true);
    expect(validateDuration(30.7).ok).toBe(true);
    expect(validateDuration(VIDEO_MAX_DURATION_SEC).ok).toBe(true);
    expect(validateDuration(0)).toEqual({ ok: false, error: "invalid_duration" });
    expect(validateDuration(0.5)).toEqual({ ok: false, error: "invalid_duration" });
    expect(validateDuration(VIDEO_MAX_DURATION_SEC + 1)).toEqual({ ok: false, error: "invalid_duration" });
    expect(validateDuration(Number.NaN)).toEqual({ ok: false, error: "invalid_duration" });
    expect(validateDuration(Number.POSITIVE_INFINITY)).toEqual({ ok: false, error: "invalid_duration" });
  });
});

/* ---------------- visibility clamp (youth-safety) ---------------- */
describe("server-side visibility clamp", () => {
  it("minors can never publish publicly — public is clamped to followers", () => {
    expect(decideVideoVisibility("public", true)).toBe("followers");
    expect(decideVideoVisibility("followers", true)).toBe("followers");
    expect(decideVideoVisibility("private", true)).toBe("private");
  });

  it("adults get exactly the visibility they chose", () => {
    expect(decideVideoVisibility("public", false)).toBe("public");
    expect(decideVideoVisibility("followers", false)).toBe("followers");
    expect(decideVideoVisibility("private", false)).toBe("private");
  });
});

/* ---------------- upload-window state machine ---------------- */
describe("upload window + resumability", () => {
  it("expiry is undefined-safe and boundary-exact", () => {
    expect(uploadWindowExpired(undefined, 1000)).toBe(false);
    expect(uploadWindowExpired(999, 1000)).toBe(true);
    expect(uploadWindowExpired(1000, 1000)).toBe(false);
    expect(UPLOAD_WINDOW_MS).toBe(60 * 60 * 1000);
  });

  it("only awaiting_upload and failed rows can act; ready/processing are terminal", () => {
    expect(uploadIsResumable("awaiting_upload")).toBe(true);
    expect(uploadIsResumable("failed")).toBe(true);
    expect(uploadIsResumable("ready")).toBe(false);
    expect(uploadIsResumable("processing")).toBe(false);
    expect(uploadIsResumable(undefined)).toBe(false); // legacy = ready
  });
});

/* ---------------- client↔server contract parity ---------------- */
describe("client pre-check parity with the server gate", () => {
  it("accepted MIME types match the server list exactly", () => {
    expect(CLIENT_VIDEO_MIME_TYPES).toEqual([...VIDEO_MIME_TYPES]);
  });

  it("size limit matches the server limit", () => {
    expect(CLIENT_VIDEO_LIMIT_BYTES).toBe(VIDEO_LIMIT_BYTES);
  });

  it("duration cap matches the server cap", () => {
    expect(CLIENT_MAX_DURATION_SEC).toBe(VIDEO_MAX_DURATION_SEC);
  });

  it("pre-check returns a stable code for junk input and null for good input", () => {
    const good = { type: "video/mp4", size: 1024 } as File;
    expect(precheckVideoFile(good)).toBeNull();
    expect(precheckVideoFile({ type: "video/avi", size: 10 } as File)).toBe("unsupported_type");
    expect(precheckVideoFile({ type: "video/mp4", size: 0 } as File)).toBe("too_large");
    expect(precheckVideoFile({ type: "video/mp4", size: CLIENT_VIDEO_LIMIT_BYTES + 1 } as File)).toBe("too_large");
  });
});
