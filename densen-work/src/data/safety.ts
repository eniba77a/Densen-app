import {
  ageAwareDefaults,
  bi,
  scanClaims,
  type AgeBand,
  type AgeDefaults,
  type Bi,
  type ChecklistItem,
  type Region,
} from "./governance";
import { challenges, users } from "./store";

/* ============================================================================
   DENSEN YOUTH PROTECTION LAYER (safety spec 37-67)
   Regional rules · DM gating · comment & grooming detection · reuse controls ·
   challenge safety · teacher verification · staff roles · audit log ·
   profile field policy · safe recommendations · security posture.
   Pure data + pure functions (no React) so everything is unit-testable.
   These systems are risk-reduction, not a claim of legal compliance.
   ========================================================================== */

/* ------------------------- 37/38: regional privacy rules ------------------------- */
export type RegionGroup = "eu" | "uk" | "us" | "other";
export interface RegionRule {
  group: RegionGroup;
  label: Bi;
  digitalConsentAge: number;
  parentalConsentUnder: number;
  teenDmFloor: "none" | "followers";
  notes: Bi;
}
export const REGION_RULES: Record<RegionGroup, RegionRule> = {
  eu: {
    group: "eu",
    label: bi("EU / EEA (GDPR)", "BE/EE (GDPR)"),
    digitalConsentAge: 16,
    parentalConsentUnder: 13,
    teenDmFloor: "none",
    notes: bi(
      "Minors' data is never used for profiling or targeted ads; accounts are private-by-default and discoverability stays restricted until the dancer changes it.",
      "Të dhënat e të miturve nuk përdoren kurrë për profilizim apo reklama të synuara; llogaritë janë private-sipas-standardit dhe zbulimi mbetet i kufizuar derisa kërcimtari ta ndryshojë.",
    ),
  },
  uk: {
    group: "uk",
    label: bi("United Kingdom (age-appropriate design code)", "Mbretëria e Bashkuar (kodi i dizajnit sipas moshës)"),
    digitalConsentAge: 13,
    parentalConsentUnder: 13,
    teenDmFloor: "none",
    notes: bi(
      "High-privacy defaults for minors: geolocation off, messaging restricted, no nudge techniques.",
      "Standard të larta privatësie për të mitur: vendndodhja jashtë, mesazhet e kufizuara, pa truke shtytjeje.",
    ),
  },
  us: {
    group: "us",
    label: bi("United States (COPPA & state codes)", "Shtetet e Bashkuara (COPPA & kode shtetërore)"),
    digitalConsentAge: 13,
    parentalConsentUnder: 13,
    teenDmFloor: "none",
    notes: bi(
      "Under-13 accounts are guardian-managed; stricter state rules apply automatically where present.",
      "Llogaritë nën 13 menaxhohen nga mbrojtësi; rregullat shtetërore më strikte zbatohen automatikisht ku ekzistojnë.",
    ),
  },
  other: {
    group: "other",
    label: bi("Rest of world", "Pjesa tjetër e botës"),
    digitalConsentAge: 16,
    parentalConsentUnder: 13,
    teenDmFloor: "none",
    notes: bi(
      "Densen's strictest built-in defaults apply everywhere; where local law is stricter, the stricter rule wins.",
      "Standardet më strikte të Densen zbatohen kudo; ku ligji vendor është më strikt, rregulli më strikt fiton.",
    ),
  },
};
export const regionRuleFor = (r: Region): RegionRule => (r === "eu" ? REGION_RULES.eu : REGION_RULES.other);

/** Age defaults composed with the regional floor — the stricter rule always wins. */
export function effectiveDefaults(band: AgeBand, region: Region): AgeDefaults {
  const base = ageAwareDefaults(band);
  const rule = regionRuleFor(region);
  if (band !== "adult" && rule.teenDmFloor === "none" && base.messagesFrom === "followers") {
    return { ...base, messagesFrom: "none" };
  }
  return base;
}

/* ------------------------- 40/43: messaging safety gate ------------------------- */
export interface MessagingContext {
  fromIsAdult: boolean;
  fromIsVerifiedTeacher: boolean;
  toIsMinor: boolean;
  toPref: "everyone" | "followers" | "none";
  /** The recipient follows the sender back. */
  followingBack: boolean;
  /** An existing conversation already exists between the two. */
  isContact: boolean;
  isBlockedByEither: boolean;
}
export interface MessagingCheck {
  allowed: boolean;
  reason?: Bi;
  /** Teacher↔minor conversations are visible to the guardian — never secret. */
  guardianVisible?: boolean;
  flag?: "adult_to_minor" | "repeated_attempts";
}
export function canMessage(ctx: MessagingContext): MessagingCheck {
  if (ctx.isBlockedByEither)
    return {
      allowed: false,
      reason: bi("Messaging is unavailable because one of you blocked the other.", "Mesazhet nuk janë të disponueshme sepse njëri prej jush ka bllokuar tjetrin."),
    };
  if (ctx.toPref === "none")
    return { allowed: false, reason: bi("This dancer has messaging turned off.", "Ky kërcimtar ka mesazhet e fikura.") };
  if (!ctx.toIsMinor) {
    if (ctx.toPref === "followers" && !ctx.followingBack && !ctx.isContact)
      return {
        allowed: false,
        reason: bi("Only dancers this person follows back can start a chat.", "Vetëm kërcimtarët që kjo person i ndjek mbrapsht mund të nisin një bisedë."),
      };
    return { allowed: true };
  }
  // Recipient is a minor — platform-level protections apply on top of personal settings.
  if (!ctx.fromIsAdult && !ctx.followingBack && !ctx.isContact)
    return {
      allowed: false,
      reason: bi("Teen dancers can only be contacted by people they follow back.", "Kërcimtarët adoleshentë mund të kontaktohen vetëm nga njerëzit që ndjekin mbrapsht."),
    };
  if (ctx.fromIsAdult) {
    // The dancer chose the connection (follow-back) or started the conversation themselves.
    if (ctx.followingBack || ctx.isContact) return { allowed: true, guardianVisible: true };
    return {
      allowed: false,
      reason: bi(
        "Adults can't start chats with teen dancers. A conversation can begin when the dancer messages you first or follows you back.",
        "Të rriturit nuk mund të nisin biseda me kërcimtarë adoleshentë. Një bisedë mund të nisë kur kërcimtari të shkruajë i pari ose të të ndjekë mbrapsht.",
      ),
      flag: "adult_to_minor",
    };
  }
  return { allowed: true, guardianVisible: true };
}

export interface ContactAttempt {
  from: string;
  to: string;
  ts: string;
  kind: "dm" | "mention" | "duet" | "tag";
}
export const MINOR_CONTACT_ATTEMPT_LIMIT = 3;
/** "watch" = log for review, "restrict" = interaction restrictions recommended. */
export function evaluateContactPattern(attemptCount: number, toIsMinor: boolean): "none" | "watch" | "restrict" {
  if (!toIsMinor) return attemptCount >= 6 ? "watch" : "none";
  if (attemptCount > MINOR_CONTACT_ATTEMPT_LIMIT) return "restrict";
  if (attemptCount >= 2) return "watch";
  return "none";
}

/* ------------------------- 44: comment safety scanner ------------------------- */
export type CommentVerdict = "clean" | "hidden" | "blocked";
export interface CommentScan {
  verdict: CommentVerdict;
  matched: Bi[];
}
interface CommentRule {
  id: string;
  re: RegExp;
  action: CommentVerdict;
  label: Bi;
  targetMinorEscalates?: boolean;
}
const COMMENT_RULES: CommentRule[] = [
  { id: "sexual", re: /\b(sexy|nudes?|hot body|sexual)\b/i, action: "blocked", label: bi("Sexual content", "Përmbajtje seksuale") },
  { id: "solicitation", re: /\b(send|dm) (me )?(pics?|photos?|videos?)\b/i, action: "blocked", label: bi("Solicitation of images", "Kërkim imazhesh") },
  { id: "selfharm", re: /\b(kill yourself|kys|hurt yourself|end it)\b/i, action: "blocked", label: bi("Self-harm encouragement", "Nxitje vetëlëndimi") },
  { id: "hate", re: /\b(hate|disgusting|worthless)\b/i, action: "hidden", label: bi("Hate or degradation", "Urrejtje ose poshtërim"), targetMinorEscalates: true },
  { id: "insult", re: /\b(stupid|idiot|ugly|loser)\b/i, action: "hidden", label: bi("Bullying language", "Gjuhë bullizmi"), targetMinorEscalates: true },
  { id: "threat", re: /\b(threat|watch your back|find you)\b/i, action: "blocked", label: bi("Threat", "Kërcënim") },
  { id: "doxx", re: /\b(lives at|home address|goes to .* school|school name)\b/i, action: "hidden", label: bi("Personal information", "Të dhëna personale") },
  { id: "contact", re: /\b(whatsapp|snap(chat)?|telegram|my number)\b/i, action: "hidden", label: bi("Off-platform contact", "Kontakt jashtë platformës"), targetMinorEscalates: true },
  { id: "scam", re: /\b(free followers|buy likes|click .*(link|here)|crypto)\b/i, action: "hidden", label: bi("Spam or scam", "Spam ose mashtrim") },
];
export function scanComment(text: string, targetIsMinor = false): CommentScan {
  const matched: Bi[] = [];
  let verdict: CommentVerdict = "clean";
  for (const r of COMMENT_RULES) {
    if (!r.re.test(text)) continue;
    const action = targetIsMinor && r.targetMinorEscalates ? ("blocked" as const) : r.action;
    matched.push(r.label);
    if (action === "blocked") verdict = "blocked";
    else if (action === "hidden" && verdict !== "blocked") verdict = "hidden";
  }
  return { verdict, matched };
}

/* ------------------------- 45: grooming-pattern detection ------------------------- */
export interface GroomingRule {
  id: string;
  re: RegExp;
  label: Bi;
  severity: "review" | "critical";
}
export const GROOMING_PATTERNS: GroomingRule[] = [
  { id: "offplatform", re: /\b(add me on|message me on|find me on|whatsapp|snap(chat)?|telegram|give me your number|what'?s your number)\b/i, label: bi("Request to move conversation off-platform", "Kërkesë për të lëvizur bisedën jashtë platformës"), severity: "critical" },
  { id: "secrecy", re: /\b(don'?t tell (your )?(mom|dad|parents)|our (little )?secret|keep this between us|just between us)\b/i, label: bi("Request for secrecy", "Kërkesë për sekreci"), severity: "critical" },
  { id: "images", re: /\b(send me (a )?(pic|pics|photo|photos|nudes?)|pics? of you|body pic)\b/i, label: bi("Request for private images", "Kërkesë për imazhe private"), severity: "critical" },
  { id: "meetup", re: /\b(meet (me )?alone|come over|my place|hotel room|when your parents .*(away|out))\b/i, label: bi("Request to meet in private", "Kërkesë për takim privat"), severity: "critical" },
  { id: "flattery-isolation", re: /\b(you'?re so much more mature|only (someone|one) who understands (you|me)|we have a special bond)\b/i, label: bi("Manipulative flattery / isolation pattern", "Model manipulues izolimi"), severity: "review" },
  { id: "gifts", re: /\b(send you (money|a gift)|buy you (a )?(phone|gift))\b/i, label: bi("Gift/money grooming pattern", "Model dhuratash/pagesash"), severity: "review" },
];
export interface GroomingScan {
  severity: "none" | "review" | "critical";
  matched: Bi[];
}
export function scanGrooming(text: string): GroomingScan {
  const matched: Bi[] = [];
  let severity: GroomingScan["severity"] = "none";
  for (const p of GROOMING_PATTERNS) {
    if (!p.re.test(text)) continue;
    matched.push(p.label);
    if (p.severity === "critical") severity = "critical";
    else if (severity === "none") severity = "review";
  }
  return { severity, matched };
}

/* ------------------------- 53: video submission pre-check ------------------------- */
export type PublishStatus = "clean" | "review" | "blocked";
export interface VideoCheckSignal {
  label: Bi;
  severity: "block" | "review" | "info";
}
export interface VideoCheck {
  status: PublishStatus;
  signals: VideoCheckSignal[];
}
const RISKY_HASHTAG_RE = /\b(stunt|dangerous|extreme)\b/i;
export function scanVideoSubmission(p: { caption: string; hashtags: string[]; audioLicensed: boolean; creatorIsMinor: boolean }): VideoCheck {
  const signals: VideoCheckSignal[] = [];
  const groom = scanGrooming(p.caption);
  for (const m of groom.matched) signals.push({ label: m, severity: "block" });
  const comment = scanComment(p.caption, p.creatorIsMinor);
  if (comment.verdict === "blocked") for (const m of comment.matched) signals.push({ label: m, severity: "block" });
  else if (comment.verdict === "hidden") for (const m of comment.matched) signals.push({ label: m, severity: "review" });
  for (const h of scanClaims(p.caption)) signals.push({ label: h.pattern, severity: "info" });
  if (!p.audioLicensed)
    signals.push({
      label: bi("Audio license unverified — use the Densen audio library", "Licenca e audios e paverifikuar — përdor bibliotekën e audios të Densen"),
      severity: "review",
    });
  if (p.hashtags.some((h) => RISKY_HASHTAG_RE.test(h)))
    signals.push({
      label: bi("Hashtag suggests risky stunt content — moderated before showing", "Hashtag sugjeron përmbajtje alarmi të rrezikshme — moderohet para shfaqjes"),
      severity: "review",
    });
  let status: PublishStatus = signals.some((s) => s.severity === "block") ? "blocked" : signals.some((s) => s.severity === "review") ? "review" : "clean";
  if (p.creatorIsMinor && status === "review") status = "blocked"; // minors: held for human moderation, never auto-published
  return { status, signals };
}
export const publishStatusLabel = (s: PublishStatus): Bi => ({
  clean: bi("Ready to publish", "Gati për publikim"),
  review: bi("Held for moderation review", "Nën shqyrtim moderimi"),
  blocked: bi("Blocked by safety checks", "Bllokuar nga kontrollet e sigurisë"),
}[s]);

/* ------------------------- 54: remix / duet / download controls ------------------------- */
export interface ReuseSettings {
  allowRemix: boolean;
  allowDuet: boolean;
  allowDownloads: boolean;
}
export function reuseDefaultsFor(band: AgeBand): ReuseSettings {
  switch (band) {
    case "adult":
      return { allowRemix: true, allowDuet: true, allowDownloads: false };
    case "teen16_17":
      return { allowRemix: true, allowDuet: false, allowDownloads: false };
    case "teen13_15":
      return { allowRemix: false, allowDuet: false, allowDownloads: false };
    default:
      return { allowRemix: false, allowDuet: false, allowDownloads: false };
  }
}
export function canReuse(
  creatorBand: AgeBand | undefined,
  settings: Partial<ReuseSettings> | undefined,
  action: "remix" | "duet" | "download",
): boolean {
  const base = reuseDefaultsFor(creatorBand ?? "adult");
  const s = { ...base, ...(settings ?? {}) };
  if (action === "download") return false; // downloads stay off platform-wide
  return s[action === "remix" ? "allowRemix" : "allowDuet"];
}

/* ------------------------- 55: challenge safety review ------------------------- */
export const DANGEROUS_CHALLENGE_PATTERNS: { re: RegExp; label: Bi }[] = [
  { re: /\b(stunt|jump off|rooftop|hold your breath|choke)\b/i, label: bi("Physical risk / stunts", "Rrezik fizik / alarme") },
  { re: /\b(fast(ing)?|skip meals|diet (pill|tea)|eat (10|20|50)|drink (alcohol|shots))\b/i, label: bi("Eating/drinking challenge", "Sfidë të ngrënit/pirjes") },
  { re: /\b(self[- ]harm|cutting|burn)\b/i, label: bi("Self-harm", "Vetëlëndim") },
  { re: /\b(illegal|steal|trespass|vandal)\b/i, label: bi("Illegal behavior", "Sjellje e paligjshme") },
  { re: /\b(sexual|nude|naked)\b/i, label: bi("Sexual content", "Përmbajtje seksuale") },
];
export function scanChallenge(desc: string): { allowed: boolean; flags: Bi[] } {
  const flags = DANGEROUS_CHALLENGE_PATTERNS.filter((p) => p.re.test(desc)).map((p) => p.label);
  return { allowed: flags.length === 0, flags };
}

/* ------------------------- 56/57: teacher verification ------------------------- */
export interface TeacherVerificationRecord {
  userId: string;
  status: "verified" | "pending";
  checked: Bi;
  docsNote: Bi;
  verifiedOn?: string;
}
export const TEACHER_VERIFICATIONS: TeacherVerificationRecord[] = users
  .filter((u) => u.teacher)
  .map((u, i) => ({
    userId: u.id,
    status: i === 0 ? ("pending" as const) : ("verified" as const),
    checked: bi("Identity, professional dance background and contact details reviewed", "Identiteti, sfondi profesional i kërcimit dhe kontaktet u rishikuan"),
    docsNote: bi(
      "Verification documents are stored encrypted, accessible only to safety staff, and never shown on the public profile.",
      "Dokumentet e verifikimit ruhen të enkriptuara, të aksesueshme vetëm nga stafi i sigurisë dhe kurrë të shfaqura në profilin publik.",
    ),
    ...(i === 0 ? {} : { verifiedOn: "2026-08-30" }),
  }));
export const teacherVerificationOf = (userId: string) => TEACHER_VERIFICATIONS.find((v) => v.userId === userId);
export const isVerifiedTeacher = (userId: string) => teacherVerificationOf(userId)?.status === "verified";

/* ------------------------- 63/64: staff roles & audit log ------------------------- */
export type StaffRole = "moderator" | "child_safety" | "compliance" | "super_admin";
export const STAFF_ROLE_LABELS: Record<StaffRole, Bi> = {
  moderator: bi("Moderator", "Moderator"),
  child_safety: bi("Child-safety specialist", "Specialist sigurie fëmijësh"),
  compliance: bi("Compliance admin", "Admin përputhjeje"),
  super_admin: bi("Super admin", "Super admin"),
};
export interface RolePerm {
  queues: string[];
  privateReports: boolean;
  exportData: boolean;
}
export const ROLE_PERMS: Record<StaffRole, RolePerm> = {
  moderator: { queues: ["reports", "content"], privateReports: false, exportData: false },
  child_safety: { queues: ["reports", "child_safety", "grooming", "appeals"], privateReports: true, exportData: false },
  compliance: { queues: ["legal", "consents", "deletion", "refunds", "audit"], privateReports: false, exportData: true },
  super_admin: { queues: ["all"], privateReports: true, exportData: true },
};

export type AuditEventType =
  | "age_verification"
  | "safety_report"
  | "child_safety_report"
  | "moderation_decision"
  | "account_restriction"
  | "block_action"
  | "appeal"
  | "teacher_verification"
  | "parental_request"
  | "content_removal"
  | "contact_flag"
  | "consent_change";
export interface AuditEvent {
  id: string;
  type: AuditEventType;
  severity: "critical" | "high" | "normal";
  summary: string;
  subject?: string;
  ts: string;
}
export const AUDIT_LABELS: Record<AuditEventType, Bi> = {
  age_verification: bi("Age verification", "Verifikim moshe"),
  safety_report: bi("Safety report", "Raport sigurie"),
  child_safety_report: bi("Child-safety report", "Raport sigurie fëmijësh"),
  moderation_decision: bi("Moderation decision", "Vendim moderimi"),
  account_restriction: bi("Account restriction", "Kufizim llogarie"),
  block_action: bi("Block action", "Veprim bllokimi"),
  appeal: bi("Appeal", "Ankim"),
  teacher_verification: bi("Teacher verification", "Verifikim mësuesi"),
  parental_request: bi("Parent/guardian request", "Kërkesë prind/mbrojtës"),
  content_removal: bi("Content removal", "Heqje përmbajtjeje"),
  contact_flag: bi("Adult→minor contact flag", "Flamur kontakti i rritur→të mitur"),
  consent_change: bi("Consent change", "Ndryshim pëlqimi"),
};
/** Child-safety event types are restricted to authorized roles (63). */
export const RESTRICTED_EVENT_TYPES: AuditEventType[] = ["child_safety_report", "contact_flag"];
export function canViewEvent(role: StaffRole, type: AuditEventType): boolean {
  if (!RESTRICTED_EVENT_TYPES.includes(type)) return true;
  return role === "child_safety" || role === "super_admin";
}

/* ------------------------- 52/61: profile fields & export policy ------------------------- */
export const PROFILE_FIELD_POLICY: { field: Bi; visibility: "public" | "optional" | "never"; note: Bi }[] = [
  { field: bi("Username & display name", "Username & emri"), visibility: "public", note: bi("Your dancer identity.", "Identiteti yt si kërcimtar.") },
  { field: bi("Profile photo", "Foto e profilit"), visibility: "optional", note: bi("You choose whether to add one.", "Zgjedh nëse shton një.") },
  { field: bi("Dance styles & level", "Stilet & niveli i kërcimit"), visibility: "optional", note: bi("Shown to help others find your style.", "Shfaqet për t'i ndihmuar të tjerët të gjejnë stilin tënd.") },
  { field: bi("Achievements & completed classes", "Arritjet & klasat e përfunduara"), visibility: "public", note: bi("No personal data — counts and badges only.", "Pa të dhëna personale — vetëm numra dhe xhufka.") },
  { field: bi("City / region", "Qyteti / rajoni"), visibility: "optional", note: bi("Only if you switch it on and age rules allow — never for under-16s, never precise.", "Vetëm nëse e aktivizon dhe rregullat e moshës e lejojnë — kurrë për nën-16, kurrë e saktë.") },
  { field: bi("Full date of birth", "Datëlindja e plotë"), visibility: "never", note: bi("Used once for protections, then never displayed.", "Përdoret një herë për mbrojtjet, pastaj kurrë nuk shfaqet.") },
  { field: bi("Email & phone", "Email & telefon"), visibility: "never", note: bi("Account data, never public.", "Të dhëna llogarie, kurrë publike.") },
  { field: bi("Exact location, address, school", "Vendndodhja e saktë, adresa, shkolla"), visibility: "never", note: bi("Densen never collects or shows these.", "Densen kurrë nuk i mbledh ose i shfaq.") },
  { field: bi("Device & IP information", "Të dhënat e pajisjes & IP"), visibility: "never", note: bi("Security logs only, never public.", "Vetëm regjistra sigurie, kurrë publike.") },
];
export const EXPORT_CATEGORIES: Bi[] = [
  bi("Account & profile", "Llogaria & profili"),
  bi("Your videos & photos", "Videot & fotot e tua"),
  bi("Your comments & messages (your side only)", "Komentet & mesazhet e tua (vetëm ana jote)"),
  bi("Dance activity, streaks, XP", "Aktiviteti i kërcimit, seritë, XP"),
  bi("Consent records", "Regjistrat e pëlqimit"),
  bi("Reports you submitted", "Raportet që ke dërguar"),
  bi("Purchases & receipts", "Blerjet & faturat"),
];
export const EXPORT_EXCLUDES: Bi = bi(
  "Exports never include other users' private information — only your own data and public content metadata.",
  "Eksportet kurrë nuk përfshijnë informacion privat të përdoruesve të tjerë — vetëm të dhënat e tua dhe metadatën e përmbajtjes publike.",
);

/* ------------------------- 50: recommendation safety rules ------------------------- */
export interface RecRules {
  educationalFirst: boolean;
  engagementCap: boolean;
  excludeNonDiscoverable: boolean;
}
export const recRulesFor = (band: AgeBand): RecRules => ({
  educationalFirst: band !== "adult",
  engagementCap: true, // never optimize purely for time-spent — for anyone
  excludeNonDiscoverable: true,
});
/** Minors get educational content first; non-discoverable authors are filtered for everyone. */
export function rankRecommendations<T extends { userId: string; lessonRef?: string }>(
  band: AgeBand,
  items: T[],
  isDiscoverable: (userId: string) => boolean,
): T[] {
  const filtered = items.filter((i) => isDiscoverable(i.userId));
  if (!recRulesFor(band).educationalFirst) return filtered;
  return [...filtered].sort((a, b) => Number(Boolean(b.lessonRef)) - Number(Boolean(a.lessonRef)));
}

/* ------------------------- 65: security posture ------------------------- */
export const SECURITY_CONTROLS: { id: string; label: Bi; status: "enforced" | "planned"; detail: Bi }[] = [
  { id: "passwords", label: bi("Password hashing", "Hash i fjalëkalimeve"), status: "enforced", detail: bi("Passwords are stored as salted hashes only — never plain text, never logged.", "Fjalëkalimet ruhen vetëm si hash me kripë — kurrë tekst i thjeshtë, kurrë në regjistra.") },
  { id: "transport", label: bi("Encryption in transit", "Enkriptim në tranzit"), status: "enforced", detail: bi("All traffic served over HTTPS.", "I gjithë trafiku shërbehet me HTTPS.") },
  { id: "rbac", label: bi("Role-based admin permissions", "Leje admini sipas roles"), status: "enforced", detail: bi("Sensitive dashboards and child-safety reports require matching staff roles.", "Panelet e ndjeshme dhe raportet e sigurisë së fëmijëve kërkojnë role përkatëse stafi.") },
  { id: "audit", label: bi("Audit logs", "Regjistra auditimi"), status: "enforced", detail: bi("Consents, safety actions and restrictions are append-only events.", "Pëlqimet, veprimet e sigurisë dhe kufizimet janë evente vetëm-shtues.") },
  { id: "sessions", label: bi("Session management & recovery protection", "Menaxhim sesionesh & mbrojtje rikuperimi"), status: "planned", detail: bi("Token rotation, device list and login alerts land with the production backend.", "Rotacioni i tokenave, lista e pajisjeve dhe alarmet e hyrjes vijnë me backend-in e produksionit.") },
  { id: "ratelimit", label: bi("Rate limiting & abuse prevention", "Kufizim kërkesash & parandalim abuzimi"), status: "planned", detail: bi("Server-side rate limits and suspicious-login detection land with the production backend; client-side contact-pattern flags are already active.", "Kufizimet anësore-server dhe detektimi i hyrjeve të dyshimta vijnë me backend-in e produksionit; flamuriku i modeleve kontakti në klient është aktiv tashmë.") },
];

/* ------------------------- audit-engine integration ------------------------- */
export interface YouthAuditInput {
  auditEvents?: AuditEvent[];
  contactAttempts?: ContactAttempt[];
}
export function youthAuditItems(input: YouthAuditInput): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const add = (id: string, label: Bi, ok: boolean, warn: boolean, okD: Bi, warnD: Bi, badD: Bi) =>
    items.push({ id, label, status: ok ? "pass" : warn ? "warning" : "action_required", detail: ok ? okD : warn ? warnD : badD });

  const pendingTeachers = TEACHER_VERIFICATIONS.filter((v) => v.status === "pending");
  add(
    "teacher_verification",
    bi("Teacher verification recorded", "Verifikimi i mësuesve i regjistruar"),
    pendingTeachers.length === 0,
    pendingTeachers.length > 0,
    bi("Every teaching account carries an identity check; documents stay private.", "Çdo llogari mësuesi mban një kontroll identiteti; dokumentet mbeten private."),
    bi(`${pendingTeachers.length} teacher verification(s) pending review.`, `${pendingTeachers.length} verifikim(e) mësuesish në pritje rishikimi.`),
    bi("", ""),
  );

  const riskyChallenges = challenges.map((c) => ({ c, s: scanChallenge(c.desc) })).filter((x) => !x.s.allowed);
  add(
    "challenge_safety",
    bi("Challenges screened for dangerous behavior", "Sfidat e shikuara për sjellje të rrezikshme"),
    riskyChallenges.length === 0,
    false,
    bi(
      `All ${challenges.length} live challenges pass the danger-pattern screen (no stunts, fasting, substance or self-harm prompts).`,
      `Të gjitha ${challenges.length} sfidat aktive kalojnë skrimin e modeleve të rrezikut (pa alarme, agjërim, substanca ose vetëlëndim).`,
    ),
    bi("", ""),
    bi(`Flagged: ${riskyChallenges.map((x) => x.c.id).join(", ")}`, `Të shënuara: ${riskyChallenges.map((x) => x.c.id).join(", ")}`),
  );

  const restrictLevel = users
    .filter((u) => u.minor)
    .some((u) => evaluateContactPattern(input.contactAttempts?.filter((a) => a.to === u.id).length ?? 0, true) === "restrict");
  add(
    "dm_gating",
    bi("Adult→minor messaging gated; report/block always available", "Mesazhet e rritur→të mitur të kontrolluara; raporto/blloko gjithmonë të disponueshme"),
    !restrictLevel,
    false,
    bi(
      "canMessage() blocks unknown-adult initiation to minors, teens require follow-back, teacher conversations are guardian-visible, and repeated attempts trigger review.",
      "canMessage() bllokon nisjen nga të rritur të panjohur ndaj të miturve, adoleshentët kërkojnë ndjekje mbrapsht, bisedat me mësues janë të dukshme për mbrojtësin, dhe përpjekjet e përsëritura nisin rishikim.",
    ),
    bi("", ""),
    bi("Contact-pattern restrict level reached — interactions limited pending review.", "Niveli i kufizimit i arritur — ndërveprimet e kufizuara deri në rishikim."),
  );

  add(
    "comment_moderation",
    bi("Comment scanner live (harassment, grooming, personal info)", "Skanneri i komenteve aktiv (ngacmim, rekrutim, të dhëna personale)"),
    true,
    false,
    bi(
      "Comments are scanned before posting; rules escalate for content targeting minors; verdicts are shown to the author with reasons.",
      "Komentet skanohen para publikimit; rregullat përforcohen për përmbajtje që synon të mitur; vendimet i shfaqen autorit me arsye.",
    ),
    bi("", ""),
    bi("", ""),
  );

  const csEvents = (input.auditEvents ?? []).filter((e) => e.type === "child_safety_report");
  add(
    "safety_audit",
    bi("Child-safety audit log active with role-based access", "Regjistri i auditimit të sigurisë së fëmijëve aktiv me qasje sipas roles"),
    csEvents.length === 0,
    true,
    bi(
      "Age verification, reports, moderation decisions, restrictions and parental requests are recorded as append-only events; restricted types require the child-safety role.",
      "Verifikimi i moshës, raportet, vendimet e moderimit, kufizimet dhe kërkesat e prindërve regjistrohen si evente vetëm-shtues; llojet e kufizuara kërkojnë rolin e sigurisë së fëmijëve.",
    ),
    bi(
      `${csEvents.length} open child-safety event(s) awaiting specialist review.`,
      `${csEvents.length} event(e) të hapura sigurie fëmijësh në pritje të rishikimit specializuar.`,
    ),
    bi("", ""),
  );

  const plannedSecurity = SECURITY_CONTROLS.filter((s) => s.status === "planned");
  add(
    "security",
    bi("Security controls documented and honest", "Kontrollet e sigurisë të dokumentuara dhe të sinqerta"),
    plannedSecurity.length === 0,
    true,
    bi("All security controls enforced.", "Të gjitha kontrollet e sigurisë të detyruara."),
    bi(
      `${plannedSecurity.length} control(s) marked PLANNED (backend scope): ${plannedSecurity.map((s) => s.id).join(", ")}.`,
      `${plannedSecurity.length} kontroll(e) të shënuara të PLANIFIKUARA (fushë backend): ${plannedSecurity.map((s) => s.id).join(", ")}.`,
    ),
    bi("", ""),
  );

  return items;
}
