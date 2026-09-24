/**
 * DENSEN — Fingerprinting provider abstraction (integration point, Day 13).
 * =========================================================================
 * Mirrors `media.ts`: defines the contract a legitimate copyright /
 * fingerprinting provider implements, and ships a not-configured default that
 * FAILS LOUDLY. No fake matches, no placeholder fingerprints, no credentials
 * read or stored anywhere in this module.
 *
 * Design rules:
 *  - Provider results are EVIDENCE for the claim workflow, never verdicts.
 *    A fingerprint match opens/updates a musicClaims row for staff review —
 *    it never removes content or decides an outcome automatically
 *    (no automatic legal determinations).
 *  - `identify` is what an upload pipeline calls when the media module
 *    yields a real audio asset; it returns provider match data or null.
 *  - `registerReference` stores a rights-holder-provided reference
 *    fingerprint for a musicRecords row (musicRecords.fingerprintRef).
 *  - To wire a real provider (e.g. an ACRCloud / Audible Magic / Pex
 *    integration): implement `FingerprintProvider`, register it via
 *    `setFingerprintProvider()` in the server bootstrap only. Configuration
 *    names (values supplied via the platform environment, never in source):
 *      FINGERPRINT_PROVIDER, FINGERPRINT_API_URL, FINGERPRINT_API_KEY.
 */
import { v } from "convex/values";

/* ---------------- contract ---------------- */

export interface FingerprintMatch {
  /** The provider's reference-id the uploaded audio matched. */
  referenceId: string;
  /** Provider's own confidence score (0-1). Displayed to staff, never acted on alone. */
  confidence: number;
  /** Offset of the match inside the uploaded audio, in seconds. */
  offsetSec?: number;
  /** Provider match report reference (stored on the claim, not parsed here). */
  reportRef?: string;
}

export interface FingerprintProvider {
  readonly name: string;
  /** Identify an uploaded audio asset against the provider's reference DB. */
  identify(input: {
    /** Media-module ref of the uploaded audio (opaque). */
    audioRef: string;
    userId: string;
    durationSec?: number;
  }): Promise<FingerprintMatch[] | null>;
  /** Store/refresh a rights-holder reference fingerprint for a track. */
  registerReference(input: {
    audioId: string;
    /** Media-module ref of the reference audio. */
    audioRef: string;
  }): Promise<{ referenceId: string }>;
  /** Optional: verify an evidence reference a disputant submitted. */
  verifyEvidence?(input: { evidenceRef: string }): Promise<{ verified: boolean }>;
}

/* ---------------- not-configured default (fails loudly, honestly) ---------------- */

export class FingerprintNotConfiguredError extends Error {
  constructor(op: string) {
    super(`FINGERPRINTING_NOT_CONFIGURED:${op}`);
    this.name = "FingerprintNotConfiguredError";
  }
}

const notConfiguredProvider: FingerprintProvider = {
  name: "not_configured",
  async identify() {
    throw new FingerprintNotConfiguredError("identify");
  },
  async registerReference() {
    throw new FingerprintNotConfiguredError("registerReference");
  },
};

/* ---------------- server-side registry ---------------- */

let active: FingerprintProvider = notConfiguredProvider;

/** Server bootstrap only. Never expose the provider instance or config client-side. */
export function setFingerprintProvider(p: FingerprintProvider): void {
  active = p;
}

export function getFingerprintProvider(): FingerprintProvider {
  return active;
}

/** True when a real provider is registered (honest UI state, like media). */
export function isFingerprintingConfigured(): boolean {
  return active !== notConfiguredProvider;
}

/* ---------------- validators shared by future provider mutations ---------------- */

export const fingerprintMatchValidator = v.object({
  referenceId: v.string(),
  confidence: v.number(),
  offsetSec: v.optional(v.number()),
  reportRef: v.optional(v.string()),
});

/** Runtime guard for non-Convex-args code paths (worker jobs, tests). */
export function isFingerprintMatch(x: unknown): x is FingerprintMatch {
  if (typeof x !== "object" || x === null) return false;
  const m = x as Partial<FingerprintMatch>;
  return typeof m.referenceId === "string" && m.referenceId.length > 0 && typeof m.confidence === "number";
}
