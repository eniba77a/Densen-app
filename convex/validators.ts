/**
 * DENSEN — Manual validation & sanitization layer.
 * ===============================================
 * Framework-free validators mirroring the closed enums in `schema.ts`, input
 * format checks, and PII-stripping sanitizers. Every backend module validates
 * inputs at its boundary with these helpers and routes public reads through the
 * `public*Of` sanitizers — rows never leave the backend unprojected.
 *
 * All functions are pure (no ctx/db), which makes the whole layer unit-testable
 * (see src/__tests__/backend.test.ts).
 */

/* ------------------------------------------------------------------ */
/*                            Primitives                               */
/* ------------------------------------------------------------------ */

export type Validator<T> = (x: unknown) => T;

export function vString(opts: { min?: number; max?: number; pattern?: RegExp } = {}): Validator<string> {
  return (x) => {
    if (typeof x !== "string") throw new TypeError("expected string");
    if (opts.min !== undefined && x.length < opts.min) throw new RangeError(`shorter than ${opts.min}`);
    if (opts.max !== undefined && x.length > opts.max) throw new RangeError(`longer than ${opts.max}`);
    if (opts.pattern && !opts.pattern.test(x)) throw new TypeError("pattern mismatch");
    return x;
  };
}

export function vInt(opts: { min?: number; max?: number } = {}): Validator<number> {
  return (x) => {
    if (typeof x !== "number" || !Number.isInteger(x)) throw new TypeError("expected integer");
    if (opts.min !== undefined && x < opts.min) throw new RangeError(`below ${opts.min}`);
    if (opts.max !== undefined && x > opts.max) throw new RangeError(`above ${opts.max}`);
    return x;
  };
}

export function vBool(): Validator<boolean> {
  return (x) => {
    if (typeof x !== "boolean") throw new TypeError("expected boolean");
    return x;
  };
}

/** Closed-union validator — mirrors `v.union(v.literal(...), ...)` from the schema. */
export function vEnum<T extends string>(allowed: readonly T[]): Validator<T> {
  return (x) => {
    if (typeof x !== "string" || !(allowed as readonly string[]).includes(x)) {
      throw new TypeError(`expected one of: ${allowed.join(" | ")}`);
    }
    return x as T;
  };
}

/** Object validator with per-field validators. Unknown keys are rejected. */
export function vObject<S extends Record<string, Validator<unknown>>>(
  spec: S
): Validator<{ [K in keyof S]: S[K] extends Validator<infer T> ? T : never }> {
  return (x) => {
    if (typeof x !== "object" || x === null || Array.isArray(x)) throw new TypeError("expected object");
    const out: Record<string, unknown> = {};
    const input = x as Record<string, unknown>;
    for (const key of Object.keys(input)) {
      if (!(key in spec)) throw new TypeError(`unexpected field: ${key}`);
    }
    for (const [key, validate] of Object.entries(spec)) {
      out[key] = validate(input[key]);
    }
    return out as { [K in keyof S]: S[K] extends Validator<infer T> ? T : never };
  };
}

/* ------------------------------------------------------------------ */
/*                     Schema-mirrored closed enums                    */
/* ------------------------------------------------------------------ */

export const ROLES = ["user", "teacher", "moderator", "admin"] as const;
export const AGE_BANDS = ["child_u13", "teen13_15", "teen16_17", "adult"] as const;
export const PUBLISH_STATUSES = ["draft", "in_review", "published", "rejected", "removed"] as const;
export const POST_VISIBILITY = ["public", "followers", "private"] as const;
export const USER_STATUSES = ["active", "restricted", "suspended", "deleted"] as const;
export const TEACHER_STATUSES = ["pending", "verified", "rejected", "revoked"] as const;
export const MODERATION_STATUSES = ["pending", "approved", "flagged", "removed"] as const;
export const REPORT_PRIORITIES = ["critical", "high", "normal"] as const;
export const DEVICE_PERMISSIONS = ["camera", "microphone", "photos", "location", "notifications"] as const;
export const SAVE_TARGETS = ["post", "course", "lesson", "choreography", "challenge", "teacher"] as const;
export const REACTION_TARGETS = ["post", "comment", "course"] as const;

export const vRole = vEnum(ROLES);
export const vAgeBand = vEnum(AGE_BANDS);
export const vPublishStatus = vEnum(PUBLISH_STATUSES);
export const vVisibility = vEnum(POST_VISIBILITY);
export const vReportPriority = vEnum(REPORT_PRIORITIES);
export const vDevicePermission = vEnum(DEVICE_PERMISSIONS);
export const vSaveTarget = vEnum(SAVE_TARGETS);

/* ------------------------------------------------------------------ */
/*                        Input format checks                          */
/* ------------------------------------------------------------------ */

export const HANDLE_PATTERN = /^[a-z0-9_.]{3,24}$/;
export const HASHTAG_PATTERN = /^#[A-Za-z0-9_]{1,30}$/;
/** ISO date only — DOB is never accepted in looser formats. */
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const CAPTION_MAX = 300;
export const COMMENT_MAX = 500;
export const BIO_MAX = 400;

export const vHandle = vString({ pattern: HANDLE_PATTERN });
export const vHashtag = vString({ pattern: HASHTAG_PATTERN });
export const vCaption = vString({ min: 1, max: CAPTION_MAX });
export const vCommentBody = vString({ min: 1, max: COMMENT_MAX });
export const vDob = vString({ pattern: ISO_DATE_PATTERN });

/** Validate a hashtag list: dedupe, cap at 10, enforce format on each. */
export function vHashtagList(): Validator<string[]> {
  return (x) => {
    if (!Array.isArray(x)) throw new TypeError("expected array");
    const seen = new Set<string>();
    for (const raw of x.slice(0, 10)) {
      const tag = vHashtag(raw); // vHashtag is already an invoked validator
      seen.add(tag.toLowerCase());
    }
    return [...seen];
  };
}

/* ------------------------------------------------------------------ */
/*                  PII-stripping public sanitizers                    */
/* ------------------------------------------------------------------ */

/**
 * The ONLY shapes public queries may return. These pure functions are the
 * single source of truth for what is public; server projections
 * (`security.ts`) are built on the same field lists.
 */

export interface PublicProfileDTO {
  userId: string;
  handle: string;
  displayName: string;
  bio?: string;
  avatarUrl?: string;
  styles: string[];
  level?: string;
  city?: string; // approximate by design; gated by showCity upstream
  isTeacher: boolean;
  teacherStatus?: (typeof TEACHER_STATUSES)[number];
}

export interface PublicPostDTO {
  id: string;
  author: PublicProfileDTO | null;
  caption: string;
  hashtags: string[];
  style: string;
  likeCount: number;
  commentCount: number;
  createdAt: number;
}

/**
 * Strip a profile row (plus its user/teacher context) to the public shape.
 * Explicitly drops: email, dob, auth subject, privateAccount internals,
 * status/restriction details, verification documents.
 */
export function publicProfileOf(row: {
  userId: string;
  handle: string;
  displayName: string;
  bio?: string;
  avatarUrl?: string;
  styles: string[];
  level?: string;
  city?: string;
  showCity: boolean;
  isTeacher: boolean;
  teacherStatus?: (typeof TEACHER_STATUSES)[number];
}): PublicProfileDTO {
  return {
    userId: row.userId,
    handle: row.handle,
    displayName: row.displayName,
    bio: row.bio,
    avatarUrl: row.avatarUrl,
    styles: row.styles,
    level: row.level,
    city: row.showCity ? row.city : undefined,
    isTeacher: row.isTeacher,
    teacherStatus: row.teacherStatus,
  };
}

/** Strip a post row to its public shape; unpublished rows never project. */
export function publicPostOf(
  row: {
    id: string;
    caption: string;
    hashtags: string[];
    style: string;
    status: string;
    likeCount: number;
    commentCount: number;
    createdAt: number;
  },
  author: PublicProfileDTO | null
): PublicPostDTO | null {
  if (row.status !== "published") return null;
  return {
    id: row.id,
    author,
    caption: row.caption,
    hashtags: row.hashtags,
    style: row.style,
    likeCount: row.likeCount,
    commentCount: row.commentCount,
    createdAt: row.createdAt,
  };
}

/** Comment sanitizer: hides hidden/removed rows and drops the author PII context. */
export function publicCommentOf(row: {
  id: string;
  userId: string;
  body: string;
  status: string;
  createdAt: number;
}): { id: string; userId: string; body: string; createdAt: number } | null {
  if (row.status !== "visible") return null;
  return { id: row.id, userId: row.userId, body: row.body, createdAt: row.createdAt };
}
