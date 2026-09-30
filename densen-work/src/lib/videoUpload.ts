/**
 * DENSEN — Video upload orchestrator (Day 4).
 * ============================================
 * Real browser→Convex-storage upload with REAL progress events (XMLHttpRequest,
 * since fetch has no upload progress). The thumbnail is genuinely captured from
 * the decoded video via canvas — no placeholder images. Every failure maps to
 * a stable code the UI can present bilingually.
 *
 * Server contract: api.videos.requestVideoUpload → PUT →
 * api.videos.requestThumbnailUpload → PUT → api.videos.completeVideoUpload.
 */
import { api } from "../../convex/_generated/api";

export type UploadStage =
  | { stage: "idle" }
  | { stage: "preparing" }
  | { stage: "uploading"; percent: number }
  | { stage: "processing" }
  | { stage: "thumbnail"; percent: number }
  | { stage: "done"; videoId: string }
  | { stage: "failed"; error: UploadErrorCode };

export type UploadErrorCode =
  | "unsupported_type"
  | "too_large"
  | "invalid_duration"
  | "too_many_pending"
  | "upload_window_expired"
  | "blob_missing"
  | "network"
  | "aborted"
  | "unauthenticated"
  | "not_resumable"
  | "upload_failed";

export interface UploadResult {
  ok: boolean;
  videoId?: string;
  error?: UploadErrorCode;
}

/** Accepted input mirrors convex/videoInternals.ts (parity-tested). */
export const CLIENT_VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
export const CLIENT_VIDEO_LIMIT_BYTES = 512 * 1024 * 1024;
export const CLIENT_MAX_DURATION_SEC = 600;

/** Fast client-side pre-check — the server re-decides everything. */
export function precheckVideoFile(file: File): UploadErrorCode | null {
  if (!CLIENT_VIDEO_MIME_TYPES.includes(file.type)) return "unsupported_type";
  if (file.size <= 0 || file.size > CLIENT_VIDEO_LIMIT_BYTES) return "too_large";
  return null;
}

/** Real duration probe from the decoded metadata (not the filename). */
export function probeVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("video");
    el.preload = "metadata";
    const cleanup = (d: number) => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(d) && d > 0 ? d : 0);
    };
    el.onloadedmetadata = () => cleanup(el.duration);
    el.onerror = () => cleanup(0);
    el.src = url;
  });
}

/**
 * Genuine thumbnail: seeks the decoded video to ~1s (or 10% in), paints the
 * frame onto a canvas and exports a JPEG blob. Returns null when the browser
 * cannot decode the file — the caller proceeds without a thumbnail (server
 * treats it as optional).
 */
export function captureThumbnail(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("video");
    el.preload = "auto";
    el.muted = true;
    el.playsInline = true;
    const fail = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    el.onerror = fail;
    el.onloadeddata = () => {
      try {
        el.currentTime = Math.min(1, el.duration / 10 || 0.1);
      } catch {
        fail();
        return;
      }
      el.onseeked = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = el.videoWidth || 720;
          canvas.height = el.videoHeight || 1280;
          const ctx2d = canvas.getContext("2d");
          if (!ctx2d) return fail();
          ctx2d.drawImage(el, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(
            (blob) => {
              URL.revokeObjectURL(url);
              resolve(blob && blob.size > 0 ? blob : null);
            },
            "image/jpeg",
            0.82
          );
        } catch {
          fail();
        }
      };
    };
    el.src = url;
  });
}

/** PUT with real upload progress; resolves with the response body (storageId JSON). */
function putWithProgress(
  uploadUrl: string,
  body: Blob,
  contentType: string,
  onProgress: (percent: number) => void,
  signal: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", uploadUrl);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve(typeof xhr.response === "string" ? xhr.response : "")
        : reject(new Error(`HTTP_${xhr.status}`));
    xhr.onerror = () => reject(new Error("network"));
    xhr.onabort = () => reject(new Error("aborted"));
    signal.addEventListener("abort", () => xhr.abort());
    xhr.send(body);
  });
}

function toStorageId(responseBody: string): string {
  try {
    const parsed = JSON.parse(responseBody) as { storageId?: string };
    return parsed.storageId ?? "";
  } catch {
    return "";
  }
}

/**
 * Full pipeline. `onStage` receives honest stage transitions with real
 * percentages. Network interruption / abort surface as stable codes.
 */
export async function uploadDanceVideo(opts: {
  sessionToken: string;
  file: File;
  durationSec: number;
  onStage: (s: UploadStage) => void;
  callMutation: <A, R>(ref: unknown, args: A) => Promise<R>;
  signal?: AbortSignal;
}): Promise<UploadResult> {
  const { sessionToken, file, durationSec, onStage, callMutation, signal } = opts;
  signal?.addEventListener("abort", () => onStage({ stage: "failed", error: "aborted" }));

  onStage({ stage: "preparing" });
  let session: { ok: boolean; error?: UploadErrorCode; videoId?: string; uploadUrl?: string };
  try {
    session = await callMutation(api.videos.requestVideoUpload, {
      sessionToken,
      contentType: file.type,
      sizeBytes: file.size,
    });
  } catch {
    onStage({ stage: "failed", error: "network" });
    return { ok: false, error: "network" };
  }
  if (!session.ok || !session.uploadUrl || !session.videoId) {
    const err = session.error ?? "upload_failed";
    onStage({ stage: "failed", error: err });
    return { ok: false, error: err };
  }
  const videoId = session.videoId;

  onStage({ stage: "uploading", percent: 0 });
  try {
    const uploaded = await putWithProgress(
      session.uploadUrl,
      file,
      file.type,
      (p) => onStage({ stage: "uploading", percent: p }),
      signal ?? new AbortController().signal
    );
    const storageId = toStorageId(uploaded);
    if (!storageId) throw new Error("blob_missing");

    onStage({ stage: "processing" });
    // Genuine frame capture — null is acceptable (thumbnail optional server-side).
    const thumb = await captureThumbnail(file);
    let thumbnailStorageId: string | undefined;
    if (thumb) {
      onStage({ stage: "thumbnail", percent: 0 });
      try {
        const tSession = await callMutation<{ sessionToken: string }, { ok: boolean; uploadUrl?: string }>(
          api.videos.requestThumbnailUpload,
          { sessionToken }
        );
        if (tSession?.ok && tSession.uploadUrl) {
          const tBody = await putWithProgress(
            tSession.uploadUrl,
            thumb,
            "image/jpeg",
            (p) => onStage({ stage: "thumbnail", percent: p }),
            signal ?? new AbortController().signal
          );
          const tId = toStorageId(tBody);
          if (tId) thumbnailStorageId = tId;
        }
      } catch {
        // Thumbnail upload failure is non-fatal (optional asset).
      }
    }

    const done = await callMutation<
      { sessionToken: string; videoId: string; storageId: string; durationSec: number; thumbnailStorageId?: string },
      { ok: boolean; error?: string; videoId?: string }
    >(api.videos.completeVideoUpload, {
      sessionToken,
      videoId,
      storageId,
      durationSec,
      thumbnailStorageId,
    });
    if (!done?.ok) {
      const err = (done?.error ?? "upload_failed") as UploadErrorCode;
      onStage({ stage: "failed", error: err });
      return { ok: false, error: err };
    }
    onStage({ stage: "done", videoId });
    return { ok: true, videoId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "upload_failed";
    const code: UploadErrorCode = msg === "aborted" ? "aborted" : msg === "network" || msg.startsWith("HTTP_") ? "network" : msg === "blob_missing" ? "blob_missing" : "upload_failed";
    onStage({ stage: "failed", error: code });
    try {
      await callMutation(api.videos.markVideoFailed, { sessionToken, videoId, reason: code === "aborted" ? "aborted" : code === "network" ? "network" : "upload_failed" });
    } catch {
      /* server may be unreachable; the expiry window reaps the row */
    }
    return { ok: false, error: code };
  }
}
