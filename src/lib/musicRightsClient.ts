/**
 * DENSEN — Music rights client (Day 13).
 * ======================================
 * Shared browser-side helpers for the user-facing copyright flow:
 *  - evidence upload through the REAL storage pipeline (requestEvidenceUpload
 *    → signed URL PUT → opaque storage id; no URL hot-linking, ever),
 *  - the claim/dispute row shapes shared by the Audio page and Admin console.
 *
 * There is no client-side rights math anywhere: every allow/deny comes from
 * the server's record of the track's real license.
 */

export interface ComposerTrack {
  id: string;
  audioId: string;
  title: string;
  artist: string;
  album?: string;
  rightsHolder: string;
  licensingStatus: string;
  territories: string[];
  permittedUse: string[];
  commercialUse: boolean;
  maxDurationSec?: number;
  licenseExpiresAt?: number;
  fingerprintRef?: string;
  restrictions?: string;
  allowedHere: boolean;
  denyReason?: string;
}

export interface MyClaimRow {
  id: string;
  audioId: string;
  postId?: string;
  status: string;
  assertion: string;
  createdAt: number;
  dispute?: {
    id: string;
    status: string;
    reason: string;
    reviewNote?: string;
  };
}

/** The five brief dispute reasons, bilingual, in display order. */
export const DISPUTE_REASONS: { value: string; en: string; sq: string }[] = [
  { value: "i_own", en: "I own this audio", sq: "E zotëroj këtë audio" },
  { value: "i_have_license", en: "I have a license", sq: "Kam licencë" },
  { value: "original_audio", en: "This is my original audio", sq: "Ky është audioja ime origjinale" },
  { value: "incorrect_claim", en: "Incorrect claim", sq: "Pretendim i pasaktë" },
  { value: "other", en: "Other", sq: "Tjetër" },
];

/** Dispute reasons keyed by value (lookup form for the admin console). */
export const DISPUTE_REASON_LABELS: Record<string, { en: string; sq: string }> = Object.fromEntries(
  DISPUTE_REASONS.map((r) => [r.value, { en: r.en, sq: r.sq }])
);

/** Bilingual licensing-status labels — the REAL record status, verbatim. */
export const MUSIC_STATUS_LABELS: Record<string, { en: string; sq: string }> = {
  densen_licensed: { en: "DENSEN LICENSED", sq: "ME LICENCE DENSEN" },
  platform_licensed: { en: "PLATFORM LICENSED", sq: "ME LICENCE PLATFORME" },
  user_owned: { en: "USER OWNED", sq: "I ZOTËSUAR NGA PËRDORUESI" },
  user_licensed: { en: "USER LICENSED", sq: "ME LICENCE PËRDORUESI" },
  restricted: { en: "RESTRICTED", sq: "I KUFIZUAR" },
  copyright_detected: { en: "COPYRIGHT DETECTED", sq: "DEKTUAR AUTORIAL" },
  removed: { en: "REMOVED", sq: "HEQUR" },
  disputed: { en: "DISPUTED", sq: "NË KUNDËRSHTIM" },
};

/** The claim flow steps, bilingual (mirrors the wire's transition table). */
export const CLAIM_FLOW_LABELS: Record<string, { en: string; sq: string }> = {
  submitted: { en: "RECEIVED", sq: "MARRË" },
  notified: { en: "UPLOADER NOTIFIED", sq: "NGARKUESI NJOHUAR" },
  restricted: { en: "RESTRICTED", sq: "I KUFIZUAR" },
  audio_replaced: { en: "AUDIO REPLACED", sq: "AUDIO ZËVENDËSUAR" },
  audio_removed: { en: "AUDIO REMOVED", sq: "AUDIO HEQUR" },
  content_removed: { en: "CONTENT REMOVED", sq: "PËRMBAJTJA HEQUR" },
  under_review: { en: "UNDER REVIEW", sq: "NË SHQYRTIM" },
  resolved: { en: "RESOLVED", sq: "ZGJIDHUR" },
  rejected: { en: "REJECTED", sq: "REFUZUAR" },
};

/** The dispute review statuses, bilingual. */
export const DISPUTE_STATUS_LABELS: Record<string, { en: string; sq: string }> = {
  submitted: { en: "SUBMITTED", sq: "DËRGUAR" },
  under_review: { en: "UNDER REVIEW", sq: "NË SHQYRTIM" },
  more_information: { en: "MORE INFORMATION", sq: "MË SHUMË INFORMACION" },
  accepted: { en: "ACCEPTED", sq: "PRANUAR" },
  rejected: { en: "REJECTED", sq: "REFUZUAR" },
  resolved: { en: "RESOLVED", sq: "ZGJIDHUR" },
};

/**
 * Upload one evidence file through the real storage pipeline and return the
 * opaque storage id that becomes a dispute evidenceRefs entry. Mirrors the
 * video pipeline's contract (signed URL POST → { storageId }).
 */
export async function uploadEvidence(
  callMutation: <A, R>(ref: unknown, args: A) => Promise<R>,
  requestRef: unknown,
  file: File
): Promise<string | null> {
  let uploadUrl: string | undefined;
  try {
    const res = (await callMutation(requestRef, {})) as { ok?: boolean; uploadUrl?: string };
    uploadUrl = res?.uploadUrl;
  } catch {
    return null;
  }
  if (!uploadUrl) return null;
  try {
    const res = await fetch(uploadUrl, {
      method: "POST",
      body: file,
      headers: { "Content-Type": file.type || "application/octet-stream" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { storageId?: string };
    return body.storageId ?? null;
  } catch {
    return null;
  }
}
