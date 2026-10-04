/**
 * DENSEN — Practice player logic (Day 23, pure).
 * ==============================================
 * The slow-motion dance player's brain, separated from the DOM so it can be
 * unit-tested: speed handling with pitch preservation, per-lesson speed
 * memory (never feed-wide), time formatting, and the A–B section repeat
 * state machine used by Practice Mode.
 */

export const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export const DEFAULT_SPEED: PlaybackSpeed = 1;

/** Clamp arbitrary input to the four supported dance speeds. */
export function clampSpeed(v: number | undefined | null): PlaybackSpeed {
  const n = Number(v);
  const hit = PLAYBACK_SPEEDS.find((s) => Math.abs(s - n) < 1e-9);
  return hit ?? DEFAULT_SPEED;
}

/* ---------------- per-lesson speed memory ---------------- */

const SPEED_KEY = "densen_speed_v1";

type SpeedMap = Record<string, number>;

function readSpeedMap(): SpeedMap {
  try {
    const raw = localStorage.getItem(SPEED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SpeedMap;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Speed chosen for ONE lesson while practicing. Deliberately per-lesson (not
 * global): the feed and other lessons keep their own normal speed so a
 * practice session never unexpectedly slows unrelated videos.
 */
export function loadLessonSpeed(lessonKey: string): PlaybackSpeed {
  return clampSpeed(readSpeedMap()[lessonKey]);
}

export function saveLessonSpeed(lessonKey: string, speed: PlaybackSpeed): void {
  try {
    const map = readSpeedMap();
    if (speed === DEFAULT_SPEED) delete map[lessonKey];
    else map[lessonKey] = speed;
    localStorage.setItem(SPEED_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable — speed simply won't persist */
  }
}

/* ---------------- time formatting ---------------- */

/** 62.4 → "1:02"; ≥1h → "1:02:03". NaN-safe. */
export function formatTime(sec: number | undefined | null): string {
  const s = Number.isFinite(sec as number) ? Math.max(0, Math.floor(sec as number)) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(r).padStart(2, "0")}`;
}

/* ---------------- A–B section repeat (Practice Mode) ---------------- */

export interface ABMarkers {
  /** Section start (seconds), or null when unset. */
  a: number | null;
  /** Section end (seconds), or null when unset. */
  b: number | null;
}

export const emptyAB: ABMarkers = { a: null, b: null };

export type ABAction =
  | { type: "setA"; at: number }
  | { type: "setB"; at: number }
  | { type: "clear" }
  | { type: "seeked"; to: number };

/**
 * The marker state machine. Rules:
 *  - setA always lands BEFORE setB (setting A past B clears B);
 *  - setB requires a positive span (B must be after A);
 *  - moving the playhead far outside the section does not silently clear it —
 *    only an explicit `clear` or a reorder via setA does.
 */
export function reduceAB(state: ABMarkers, action: ABAction): ABMarkers {
  switch (action.type) {
    case "setA": {
      const a = Math.max(0, action.at);
      if (state.b !== null && a >= state.b) return { a, b: null };
      return { a, b: state.b };
    }
    case "setB": {
      const b = Math.max(0, action.at);
      const base = state.a ?? 0;
      if (b <= base) return { ...state, b: null };
      return { a: state.a ?? 0, b };
    }
    case "clear":
      return { ...emptyAB };
    default:
      return state;
  }
}

/**
 * Should the player jump back to A right now? True exactly when the playhead
 * passed the B marker while a complete section is armed.
 */
export function shouldLoopToA(markers: ABMarkers, currentTime: number, previousTime: number): boolean {
  if (markers.a === null || markers.b === null) return false;
  return previousTime < markers.b && currentTime >= markers.b;
}

/** Seek target for "return to the beginning of the section". */
export function sectionStart(markers: ABMarkers, fallback = 0): number {
  return markers.a ?? fallback;
}
