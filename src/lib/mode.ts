/**
 * DENSEN — Mode gating (Day 23, pure).
 * ====================================
 * Two experiences, one app: Dancer Mode (watch, practice, learn) and Teacher
 * Mode (dashboard, lessons, publishing). The PREFERENCE lives in client
 * settings; the PERMISSION always comes from the server session role —
 * switching the selector can never grant the teacher role, and Teacher Mode
 * never grants admin.
 */

export type AppMode = "dancer" | "teacher";

export interface ModeViewer {
  role?: string | null;
}

/** A verified teacher or an admin may use Teacher Mode. Nobody else can. */
export function canTeach(viewer: ModeViewer | null | undefined): boolean {
  return viewer?.role === "teacher" || viewer?.role === "admin";
}

/**
 * The mode the UI should render: the saved preference when the caller is
 * allowed to teach, otherwise always Dancer Mode (preference silently kept
 * for when the role arrives — it is never dropped, only deferred).
 */
export function effectiveMode(preference: string | undefined, viewer: ModeViewer | null | undefined): AppMode {
  if (preference === "teacher" && canTeach(viewer)) return "teacher";
  return "dancer";
}

/** True when the saved preference differs from what the UI can render. */
export function modeDeferred(preference: string | undefined, viewer: ModeViewer | null | undefined): boolean {
  return preference === "teacher" && !canTeach(viewer);
}
