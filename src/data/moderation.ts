/**
 * DENSEN — Moderation client labels (Day 15).
 * ===========================================
 * Bilingual (EN/SQ) labels for the 11 report categories, report statuses,
 * staff actions and appeal statuses — mirroring convex/moderation.ts's
 * closed vocabularies. Pure data, no React.
 */

export const MOD_REPORT_CATEGORIES: { id: string; en: string; sq: string; escalate: boolean }[] = [
  { id: "child_safety", en: "Child safety (highest priority)", sq: "Siguria e fëmijëve (prioriteti më i lartë)", escalate: true },
  { id: "harassment", en: "Harassment", sq: "Ngacmim", escalate: true },
  { id: "bullying", en: "Bullying", sq: "Bullizëm", escalate: true },
  { id: "hate", en: "Hate speech", sq: "Fjalë urrejtjeje", escalate: true },
  { id: "sexual_content", en: "Sexual content", sq: "Përmbajtje seksuale", escalate: true },
  { id: "copyright", en: "Copyright or music licensing", sq: "Të drejta autorit ose licenca muzikore", escalate: false },
  { id: "dangerous_behavior", en: "Dangerous behavior", sq: "Sjellje e rrezikshme", escalate: false },
  { id: "spam", en: "Spam", sq: "Spam", escalate: false },
  { id: "scam", en: "Scam or fraud", sq: "Mashtrim ose fraud", escalate: false },
  { id: "impersonation", en: "Impersonation", sq: "Mashtrim identiteti", escalate: false },
  { id: "other", en: "Something else", sq: "Diçka tjetër", escalate: false },
];

export const MOD_CATEGORY_LABELS: Record<string, { en: string; sq: string }> = Object.fromEntries(
  MOD_REPORT_CATEGORIES.map((c) => [c.id, { en: c.en, sq: c.sq }])
);

export const MOD_STATUS_LABELS: Record<string, { en: string; sq: string }> = {
  pending: { en: "PENDING", sq: "NË PRITJE" },
  under_review: { en: "UNDER REVIEW", sq: "NË SHQYRTIM" },
  action_taken: { en: "ACTION TAKEN", sq: "VEPRIM I MARRË" },
  dismissed: { en: "DISMISSED", sq: "REFUZUAR" },
  appealed: { en: "APPEALED", sq: "NË ANKIM" },
  resolved: { en: "RESOLVED", sq: "ZGJIDHUR" },
};

export const MOD_ACTION_LABELS: Record<string, { en: string; sq: string }> = {
  hide: { en: "Restrict content", sq: "Kufizo përmbajtjen" },
  remove: { en: "Remove content", sq: "Hiq përmbajtjen" },
  restore: { en: "Restore content", sq: "Rikthe përmbajtjen" },
  restrict_user: { en: "Restrict account", sq: "Kufizo llogarinë" },
  lift_restrictions: { en: "Lift restrictions", sq: "Hiq kufizimet" },
  suspend_user: { en: "Suspend account", sq: "Pezullo llogarinë" },
  restrict_messaging: { en: "Restrict messaging", sq: "Kufizo mesazhet" },
  dismiss: { en: "Dismiss report", sq: "Refuzo raportin" },
};

export const MOD_APPEAL_STATUS_LABELS: Record<string, { en: string; sq: string }> = {
  submitted: { en: "SUBMITTED", sq: "DËRGUAR" },
  under_review: { en: "UNDER REVIEW", sq: "NË SHQYRTIM" },
  upheld: { en: "UPHELD", sq: "MBETET NË FUQI" },
  overturned: { en: "OVERTURNED", sq: "ANULLUAR" },
  resolved: { en: "RESOLVED", sq: "ZGJIDHUR" },
};

export const MOD_PRIORITY_LABELS: Record<string, { en: string; sq: string }> = {
  critical: { en: "CRITICAL", sq: "KRITIK" },
  high: { en: "HIGH", sq: "I LARTË" },
  normal: { en: "NORMAL", sq: "NORMAL" },
};

export const MOD_TARGET_LABELS: Record<string, { en: string; sq: string }> = {
  post: { en: "Video", sq: "Video" },
  comment: { en: "Comment", sq: "Koment" },
  user: { en: "Profile", sq: "Profil" },
  message: { en: "Message", sq: "Mesazh" },
  challenge: { en: "Challenge", sq: "Sfidë" },
};
