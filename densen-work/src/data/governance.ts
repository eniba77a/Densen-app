import { dictionaries, type Lang, type TKey } from "../i18n";
import { courses, events, challenges, users } from "./store";

/* ============================================================================
   DENSEN GOVERNANCE LAYER
   Policies · Consents · Age-aware privacy · Data inventory · SDK inventory ·
   Asset rights · Claims · Refunds · Deletion · Permissions · Audit engine.
   Pure data + pure functions (no React) so everything is unit-testable.
   NOTE: These systems are risk-reduction and compliance tooling. They do NOT
   make Densen "lawsuit-proof"; final documents need qualified legal review.
   ========================================================================== */

/* ------------------------------ versions ------------------------------ */
export const POLICY_VERSIONS = {
  terms: "2.0",
  privacy: "2.0",
  cookies: "1.0",
  community: "1.1",
  refunds: "1.0",
} as const;

export const POLICY_DATES = {
  effective: "September 18, 2026",
  updated: "September 18, 2026",
} as const;

/* ------------------------------ bilingual doc type ------------------------------ */
export type Bi = Record<Lang, string>;
export const bi = (en: string, sq: string): Bi => ({ en, sq });

export interface DocSection {
  h: Bi;
  p: Bi[];
}
export interface PolicyDoc {
  id: DocId;
  title: Bi;
  version: string;
  effective: string;
  updated: string;
  intro: Bi;
  sections: DocSection[];
}
export type DocId = "privacy" | "terms" | "refunds" | "cookies" | "community" | "copyright";

/* ------------------------------ regions ------------------------------ */
export type Region = "eu" | "other";
export const EU_LANG_REGIONS = ["AL", "AT", "BE", "BG", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IS", "IT", "LI", "LT", "LU", "LV", "MT", "NL", "NO", "PL", "PT", "RO", "SE", "SI", "SK", "UK", "XK"];

/** Detects a coarse region from the browser locale. No geolocation is used. */
export function detectRegion(locale = typeof navigator !== "undefined" ? navigator.language : "en"): Region {
  const cc = locale.split("-")[1]?.toUpperCase();
  return cc && EU_LANG_REGIONS.includes(cc) ? "eu" : "other";
}

/* ------------------------------ cookie categories ------------------------------ */
export interface CookieCategory {
  id: "necessary" | "functional" | "analytics" | "marketing";
  name: Bi;
  what: Bi;
  why: Bi;
  optional: boolean;
}
export const COOKIE_CATEGORIES: CookieCategory[] = [
  {
    id: "necessary",
    name: bi("Strictly necessary", "Strikht të nevojshme"),
    what: bi("Keep you signed in, secure the platform and store your in-app preferences (language, theme, lesson progress).", "Mbajnë llogarinë të ndezur, sigurojnë platformën dhe ruajnë preferencat në aplikacion (gjuha, tema, përparimi i mësimeve)."),
    why: bi("The service cannot function without them.", "Shërbimi nuk mund të funksionojë pa to."),
    optional: false,
  },
  {
    id: "functional",
    name: bi("Functional", "Funksionale"),
    what: bi("Remember choices such as muted accounts, saved videos and cookie choices themselves.", "Mbajnë mend zgjedhje si llogaritë e heshtura, videot e ruajtura dhe vetë zgjedhjet e cookie-ve."),
    why: bi("So Densen remembers your preferences between visits.", "Që Densen t'i mbajë mend preferencat tua mes vizitave."),
    optional: true,
  },
  {
    id: "analytics",
    name: bi("Analytics", "Analitikat"),
    what: bi("Aggregated, non-identifying statistics about which classes and pages are used.", "Statistika të grumbulluara, pa identifikues, për cilat klasa dhe faqe përdoren."),
    why: bi("Helps us improve lessons and find broken features.", "Na ndihmojnë të përmirësojmë mësimet dhe të gjejmë veçori të prishura."),
    optional: true,
  },
  {
    id: "marketing",
    name: bi("Marketing", "Marketing"),
    what: bi("Would measure the effect of Densen campaigns. No advertising or profiling SDK is currently enabled.", "Do të mbrinte efektin e fushatave të Densen. Aktualisht asnjë SDK reklamimi ose profilizimi nuk është aktiv."),
    why: bi("Only loaded if you explicitly allow it — and currently unused.", "Ngarkohen vetëm nëse i lejon shprehimisht — dhe aktualisht nuk përdoren."),
    optional: true,
  },
];

export interface CookieConsent {
  necessary: true;
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
  ts: string;
  version: string;
  region: Region;
}

/** True only when optional categories may be loaded under the stored consent. */
export function optionalCookiesAllowed(c: CookieConsent | undefined, cat: "functional" | "analytics" | "marketing"): boolean {
  if (!c) return false;
  return c[cat] === true;
}

/* ------------------------------ consents ------------------------------ */
export type ConsentType =
  | "terms"
  | "privacy"
  | "community"
  | "marketing_email"
  | "cookies"
  | "personalization"
  | "purchase_terms"
  | "parental";

export interface ConsentRecord {
  id: string;
  userId: string;
  type: ConsentType;
  version: string;
  granted: boolean;
  ts: string; // ISO timestamp — records are append-only, never edited
  region: Region;
  source: string; // form/screen that produced it
}

export const CONSENT_LABELS: Record<ConsentType, Bi> = {
  terms: bi("Terms of Use", "Kushtet e Përdorimit"),
  privacy: bi("Privacy Policy acknowledgement", "Njohja e Politikës së Privatësisë"),
  community: bi("Community Guidelines", "Rregullat e Komunitetit"),
  marketing_email: bi("Marketing emails (optional)", "Emaila marketingu (opsionale)"),
  cookies: bi("Cookie preferences", "Preferencat e cookie-ve"),
  personalization: bi("Optional personalization", "Personalizimi opsional"),
  purchase_terms: bi("Purchase terms acceptance", "Pranimi i kushteve të blerjes"),
  parental: bi("Parent/guardian authorization", "Autorizimi prind/mbrojtës"),
};

/** Withdrawals are new records with granted=false; history is immutable. */
export const consentHistory = (records: ConsentRecord[]): ConsentRecord[] =>
  [...records].sort((a, b) => b.ts.localeCompare(a.ts));

export const latestConsent = (records: ConsentRecord[], type: ConsentType): ConsentRecord | undefined =>
  consentHistory(records).find((r) => r.type === type);

export const hasConsent = (records: ConsentRecord[], type: ConsentType): boolean =>
  latestConsent(records, type)?.granted === true;

/* ------------------------------ age-aware privacy ------------------------------ */
export type AgeBand = "under13" | "teen13_15" | "teen16_17" | "adult";

export function ageBand(dob: string | undefined, now = new Date()): AgeBand {
  if (!dob) return "adult";
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return "adult";
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  if (age < 13) return "under13";
  if (age < 16) return "teen13_15";
  if (age < 18) return "teen16_17";
  return "adult";
}

export const isMinor = (dob: string | undefined): boolean => ageBand(dob) !== "adult";

/** Stronger defaults applied automatically for younger dancers. */
export interface AgeDefaults {
  privateAccount: boolean;
  messagesFrom: "everyone" | "followers" | "none";
  allowDuetFromStrangers: boolean;
  allowLocation: boolean;
  discoverable: boolean;
  commentApproval: boolean;
  targetedProfilingAllowed: false;
  parentalConsentRequired: boolean;
}
export function ageAwareDefaults(band: AgeBand): AgeDefaults {
  if (band === "adult")
    return { privateAccount: false, messagesFrom: "followers", allowDuetFromStrangers: true, allowLocation: true, discoverable: true, commentApproval: false, targetedProfilingAllowed: false, parentalConsentRequired: false };
  if (band === "teen16_17")
    return { privateAccount: true, messagesFrom: "followers", allowDuetFromStrangers: false, allowLocation: false, discoverable: true, commentApproval: true, targetedProfilingAllowed: false, parentalConsentRequired: false };
  return { privateAccount: true, messagesFrom: "none", allowDuetFromStrangers: false, allowLocation: false, discoverable: false, commentApproval: true, targetedProfilingAllowed: false, parentalConsentRequired: true };
}

/** Minimum age to hold an independent account. Under-13 requires guardian flow. */
export const MIN_ACCOUNT_AGE = 13;

/** Never display the stored date of birth — only the derived band. */
export const bandLabel: Record<AgeBand, Bi> = {
  under13: bi("Under 13 · guardian account required", "Nën 13 · kërkohet llogari me mbrojtës"),
  teen13_15: bi("13–15 · teen protections active", "13–15 · mbrojtjet për adoleshentë aktiv"),
  teen16_17: bi("16–17 · teen protections active", "16–17 · mbrojtjet për adoleshentë aktiv"),
  adult: bi("18+ · standard account", "18+ · llogari standarde"),
};

/* ------------------------------ permissions ------------------------------ */
export type PermissionKey = "camera" | "microphone" | "photos" | "location" | "notifications" | "contacts" | "bluetooth";
export type PermissionUiState = "unavailable" | "prompt" | "granted" | "denied";

export interface PermissionSpec {
  key: PermissionKey;
  label: Bi;
  explanation: Bi;
  usedBy: Bi;
}
export const PERMISSIONS: PermissionSpec[] = [
  { key: "camera", label: bi("Camera", "Kamera"), explanation: bi("Densen needs camera access so you can record your dance videos and duets.", "Densen ka nevojë për kamerë që të regjistrosh videot dhe duetet e tua."), usedBy: bi("Recording, duets, profile photo", "Regjistrimi, duetet, foto e profilit") },
  { key: "microphone", label: bi("Microphone", "Mikrofoni"), explanation: bi("Densen needs microphone access to record the audio of your dance videos.", "Densen ka nevojë për mikrofon që të regjistrojë audion e videove."), usedBy: bi("Video recording", "Regjistrimi i videos") },
  { key: "photos", label: bi("Photos & videos", "Fotografitë & videot"), explanation: bi("Densen needs photo access so you can upload an existing dance video as a post.", "Densen ka nevojë për qasje në foto që të ngarkosh një video ekzistuese."), usedBy: bi("Uploading posts", "Ngarkimi i postimeve") },
  { key: "notifications", label: bi("Notifications", "Njoftimet"), explanation: bi("Densen would like to notify you about challenges, replies and live classes. Optional.", "Densen dëshiron të të njoftojë për sfida, përgjigje dhe klasa live. Opsionale."), usedBy: bi("Challenge, reply and live alerts", "Njoftime sfidash, përgjigjesh dhe live") },
  { key: "location", label: bi("Location", "Vendndodhja"), explanation: bi("Densen never uses precise GPS. City-level location is optional and only shown if you enable it.", "Densen nuk përdor kurrë GPS të saktë. Vendndodhja në nivel qyteti është opsionale dhe shfaqet vetëm nëse e aktivizon."), usedBy: bi("Optional city on profile, local events", "Qyteti opsional në profil, evente lokale") },
  { key: "contacts", label: bi("Contacts", "Kontaktet"), explanation: bi("Densen does not read your contacts.", "Densen nuk i lexon kontaktet e tua."), usedBy: bi("Not used", "Nuk përdoret") },
  { key: "bluetooth", label: bi("Bluetooth", "Bluetooth"), explanation: bi("Densen does not use Bluetooth.", "Densen nuk përdor Bluetooth."), usedBy: bi("Not used", "Nuk përdoret") },
];

/** Permission gate data: feature → required permission. */
export const FEATURE_PERMISSIONS: Partial<Record<string, PermissionKey>> = {
  "create.record": "camera",
  "create.upload": "photos",
  "create.duet": "camera",
  "notifications.enable": "notifications",
};

/* ------------------------------ data inventory (minimization) ------------------------------ */
export interface InventoryEntry {
  data: Bi;
  purpose: Bi;
  required: boolean | "conditional";
  retention: Bi;
  access: Bi;
  deletion: Bi;
}
export const DATA_INVENTORY: InventoryEntry[] = [
  { data: bi("Email address", "Adresa email"), purpose: bi("Sign-in, security alerts, transactional emails; marketing only with separate consent", "Hyrje, alarme sigurie, emaila transaksionale; marketing vetëm me pëlqim të veçantë"), required: true, retention: bi("Until account deletion + 30-day recovery window", "Deri në fshirjen e llogarisë + dritare 30-ditore rikuperimi"), access: bi("You, Densen account team, email provider", "Ti, ekipi i llogarive Densen, ofruesi i emailit"), deletion: bi("Removed with account", "Hiqet me llogarinë") },
  { data: bi("Display name & @username", "Emri & @username"), purpose: bi("Your public dancer identity", "Identiteti yt publik si kërcimtar"), required: true, retention: bi("Until changed or account deleted", "Derisa të ndryshohet ose të fshihet llogaria"), access: bi("Public", "Publik"), deletion: bi("Removed with account", "Hiqet me llogarinë") },
  { data: bi("Profile photo", "Foto e profilit"), purpose: bi("Recognizing dancers across feed and classes", "Njohja e kërcimtarëve në feed dhe klasa"), required: false, retention: bi("Until replaced or account deleted", "Derisa të zëvendësohet ose fshihet llogaria"), access: bi("Public", "Publik"), deletion: bi("Removed with account", "Hiqet me llogarinë") },
  { data: bi("Date of birth", "Datëlindja"), purpose: bi("Determining which privacy protections apply to the account. Never shown publicly.", "Përcakton cilat mbrojtje privatësie i përkasin llogarisë. Nuk shfaqet kurrë publikisht."), required: true, retention: bi("While the account exists (stored as age band only after verification)", "Për sa kohë ekziston llogaria (ruhet vetëm si grup moshe pas verifikimit)"), access: bi("Only Densen safety systems — not other users, not shown on the profile", "Vetëm sistemet e sigurisë Densen — jo përdorues të tjerë, jo në profil"), deletion: bi("Removed with account", "Hiqet me llogarinë") },
  { data: bi("City (optional)", "Qyteti (opsional)"), purpose: bi("Optional context on your profile and nearby events", "Kontekst opsional në profil dhe evente pranë"), required: false, retention: bi("Until removed", "Derisa të hiqet"), access: bi("Public if you enable “show location”", "Publik nëse aktivizon “shfaq vendndodhjen”"), deletion: bi("Removed with account", "Hiqet me llogarinë") },
  { data: bi("Dance activity (lessons, streak, XP)", "Aktiviteti i kërcimit (mësimet, seritë, XP)"), purpose: bi("Your progress dashboard, streaks and leaderboards", "Paneli i përparimit, seritë dhe renditjet"), required: true, retention: bi("Until account deletion", "Deri në fshirjen e llogarisë"), access: bi("You; leaderboard rank visible to others (no data exposed)", "Ti; renditja e dukshme për të tjerët (pa të dhëna ekspozuese)"), deletion: bi("Removed with account", "Hiqet me llogarinë") },
  { data: bi("Videos, photos & captions you post", "Videot, fotot & përshkrimet që poston"), purpose: bi("Sharing your dancing with the community", "Të ndash kërcimin tënd me komunitetin"), required: false, retention: bi("Until you delete the post or the account", "Derisa të fshishë postimin ose llogarinë"), access: bi("Depends on your visibility setting and age defaults", "Në varësi të dukshmërisë dhe standardeve sipas moshës"), deletion: bi("Deleted posts are removed from feeds; account deletion removes all posts", "Postimet e fshira hiqen nga feedet; fshirja e llogarisë i heq të gjitha") },
  { data: bi("Direct messages", "Mesazhet e drejtpërdrejta"), purpose: bi("Communication between dancers", "Komunikimi midis kërcimtarëve"), required: false, retention: bi("Until deleted by participants or account deletion", "Derisa t'i fshijnë pjesëmarrësit ose fshihet llogaria"), access: bi("Participants; safety systems act only on validated reports of minors or abuse", "Pjesëmarrësit; sistemet e sigurisë veprojnë vetëm mbi raporte të verifikuara për të mitur ose abuzim"), deletion: bi("Removed with account", "Hiqen me llogarinë") },
  { data: bi("Purchases & receipts", "Blerjet & faturat"), purpose: bi("Access to paid classes, refunds, accounting where applicable", "Qasje në klasa me pagesë, rimburse, kontabilitet ku zbatohet"), required: false, retention: bi("As long as legally required for accounting, then deleted", "Sa kërkohet ligjërisht për kontabilitet, pastaj fshihet"), access: bi("You, Densen payments team, payment provider", "Ti, ekipi i pagesave Densen, ofruesi i pagesave"), deletion: bi("Personal details removed; accounting records retained as required by law", "Të dhënat personale hiqen; regjistrat kontabël mbahen sipas ligjit") },
  { data: bi("Reports you submit", "Raportet që dërgon"), purpose: bi("Moderation and child safety", "Moderimi dhe siguria e fëmijëve"), required: false, retention: bi("2 years for safety patterns, then deleted", "2 vjet për modele sigurie, pastaj fshihet"), access: bi("Authorized moderators only (role-based)", "Vetëm moderatorë të autorizuar (me role)"), deletion: bi("Automatically purged", "Fshihet automatikisht") },
  { data: bi("Consent records", "Regjistrat e pëlqimit"), purpose: bi("Proving which policy versions you accepted and when", "Dëshmi se cilat versione pranove dhe kur"), required: true, retention: bi("While the account exists; deletion request history kept 3 years where legally required", "Për sa kohë ekziston llogaria; historia e kërkesave të fshirjes mbahet 3 vjet ku kërkohet ligjërisht"), access: bi("You (in Privacy Center) and authorized admins", "Ti (në Qendrën e Privatësisë) dhe admina të autorizuar"), deletion: bi("Limited retention may apply where the law requires proof of consent", "Mund të zbatohet mbajtje e kufizuar ku ligji kërkon dëshmi pëlqimi") },
];

/* ------------------------------ third-party services inventory ------------------------------ */
export interface SdkEntry {
  provider: string;
  purpose: Bi;
  dataAccessed: Bi;
  dataTransmitted: Bi;
  region: Bi;
  privacyUrl: string;
  required: boolean;
  enabled: boolean;
  version: string;
}
/** What this codebase actually loads today — plus explicitly disabled planned rows. */
export const THIRD_PARTY: SdkEntry[] = [
  { provider: "Google Fonts", purpose: bi("Sora & Inter web fonts", "Fontet Sora & Inter"), dataAccessed: bi("None (fonts requested by URL)", "Asgjë (fontet kërkohen me URL)"), dataTransmitted: bi("Your IP address (standard web request)", "Adresa jote IP (kërkesë standarde web)"), region: bi("Global CDN", "CDN global"), privacyUrl: "https://policies.google.com/privacy", required: true, enabled: true, version: "—" },
  { provider: "Unsplash", purpose: bi("Placeholder dance photography for the prototype", "Fotografi vendore kërcimi për prototipin"), dataAccessed: bi("None", "Asgjë"), dataTransmitted: bi("Your IP address (image request)", "Adresa jote IP (kërkesë imazhi)"), region: bi("Global CDN", "CDN global"), privacyUrl: "https://unsplash.com/privacy", required: false, enabled: true, version: "—" },
  { provider: "Pexels", purpose: bi("Placeholder dance videos for the prototype", "Video vendore kërcimi për prototipin"), dataAccessed: bi("None", "Asgjë"), dataTransmitted: bi("Your IP address (video request)", "Adresa jote IP (kërkesë video)"), region: bi("Global CDN", "CDN global"), privacyUrl: "https://www.pexels.com/privacy/", required: false, enabled: true, version: "—" },
  { provider: "Pravatar", purpose: bi("Placeholder avatar images for sample accounts", "Avatarë vendore për llogaritë mostër"), dataAccessed: bi("None", "Asgjë"), dataTransmitted: bi("Your IP address (image request)", "Adresa jote IP (kërkesë imazhi)"), region: bi("Global CDN", "CDN global"), privacyUrl: "https://pravatar.cc", required: false, enabled: true, version: "—" },
  { provider: "Payment provider (to be selected)", purpose: bi("Class purchases and subscriptions (planned)", "Blerjet e klasave dhe abonimet (e planifikuar)"), dataAccessed: bi("Payment details would be handled by the provider; Densen stores only receipts", "Të dhënat e pagesës do t'i trajtonte ofruesi; Densen ruan vetëm fatura"), dataTransmitted: bi("Nothing while disabled", "Asgjë përderisa është çaktivizuar"), region: bi("EU/EEA provider preferred", "Parapreferohet ofrues BE/EE"), privacyUrl: "https://stripe.com/privacy", required: false, enabled: false, version: "planned" },
  { provider: "Product analytics (to be selected)", purpose: bi("Aggregate feature usage (planned, consent-gated)", "Përdorimi agregat i veçorive (e planifikuar, me pëlqim)"), dataAccessed: bi("None while disabled", "Asgjë përderisa është çaktivizuar"), dataTransmitted: bi("Nothing while disabled", "Asgjë përderisa është çaktivizuar"), region: bi("EU processing preferred", "Përpunimi në BE parapreferohet"), privacyUrl: "https://usefathom.com/privacy", required: false, enabled: false, version: "planned" },
  { provider: "Email delivery (to be selected)", purpose: bi("Transactional and (optional) marketing email (planned)", "Emaila transaksionale dhe (opsionale) marketingu (e planifikuar)"), dataAccessed: bi("Email address only", "Vetëm adresa email"), dataTransmitted: bi("Nothing while disabled", "Asgjë përderisa është çaktivizuar"), region: bi("EU provider preferred", "Parapreferohet ofrues BE"), privacyUrl: "https://resend.com/privacy", required: false, enabled: false, version: "planned" },
];

/* ------------------------------ asset rights registry ------------------------------ */
export interface AssetEntry {
  name: string;
  kind: "font" | "image" | "video" | "icon" | "music";
  creator: string;
  license: string; // "" => unknown (surfaces a warning)
  licenseUrl: string;
  commercial: boolean;
  modification: boolean;
  attributionRequired: boolean;
  territory: Bi;
  expires?: string;
  proof: Bi;
  added: string;
}
export const ASSETS: AssetEntry[] = [
  { name: "Sora", kind: "font", creator: "Jonathan Barnbrook", license: "SIL Open Font License 1.1", licenseUrl: "https://scripts.sil.org/OFL", commercial: true, modification: true, attributionRequired: false, territory: bi("Worldwide", "Botërisht"), proof: bi("OFL.txt shipped with font", "OFL.txt i dërguar me fontin"), added: "2026-09-18" },
  { name: "Inter", kind: "font", creator: "Rasmus Andersson", license: "SIL Open Font License 1.1", licenseUrl: "https://scripts.sil.org/OFL", commercial: true, modification: true, attributionRequired: false, territory: bi("Worldwide", "Botërisht"), proof: bi("OFL.txt shipped with font", "OFL.txt i dërguar me fontin"), added: "2026-09-18" },
  { name: "Dance photography (all “IMG.” registry entries)", kind: "image", creator: "Various — Unsplash contributors", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", commercial: true, modification: true, attributionRequired: false, territory: bi("Worldwide", "Botërisht"), proof: bi("Unsplash license page", "Faqja e licencës Unsplash"), added: "2026-09-18" },
  { name: "Dance clips (VID registry: 2785536, 3195394, 3209828)", kind: "video", creator: "Pexels contributors", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/", commercial: true, modification: true, attributionRequired: false, territory: bi("Worldwide", "Botërisht"), proof: bi("Pexels license page", "Faqja e licencës Pexels"), added: "2026-09-18" },
  { name: "Sample avatars (pravatar.cc)", kind: "image", creator: "Unknown", license: "", licenseUrl: "", commercial: false, modification: false, attributionRequired: false, territory: bi("Unknown", "E panjohur"), proof: bi("No license document found — prototype only; replace with licensed avatars or user uploads before production", "Asnjë dokument licence — vetëm prototip; zëvendësoje me avatarë të licencuar ose ngarkime përdoruesish para produksionit"), added: "2026-09-18" },
  { name: "Music tracks (a1–a5 “audio” registry)", kind: "music", creator: "Sample metadata only — no audio files shipped", license: "No audio distributed; in-app sounds must be licensed or original before public launch", licenseUrl: "", commercial: false, modification: false, attributionRequired: false, territory: bi("N/A — no files shipped", "N/A — asnjë skedar i dërguar"), proof: bi("Metadata placeholder only", "Vetëm vendmbajtës metadatash"), added: "2026-09-18" },
];
export const licenseUnknown = (a: AssetEntry) => a.license.trim().length === 0;
export const licenseExpiring = (a: AssetEntry, withinDays = 60, now = new Date()) => {
  if (!a.expires) return false;
  const d = new Date(a.expires);
  if (Number.isNaN(d.getTime())) return false;
  const diff = (d.getTime() - now.getTime()) / 86_400_000;
  return diff <= withinDays;
};

/* ------------------------------ feature → permission map (re-exported for UI) ------------------------------ */
export const FEATURE_PERMISSION_MAP = {
  "create.record": "camera",
  "create.upload": "photos",
  "create.duet": "camera",
  "notifications.enable": "notifications",
} as const;

/* ------------------------------ claims audit ------------------------------ */
const RISKY_CLAIM_PATTERNS: { re: RegExp; why: Bi }[] = [
  // Product-superiority claims only — "best"/"#1" describing the platform, not a dancer's
  // own challenge copy ("show your best moves" is not a ranking claim).
  { re: /(?:\bbest\s+(?:dance\s+)?(?:platform|app|academy|school|classes|lessons|courses)\b|\bnumber one\b|\bnumrin 1\b|#\s?1\b)/i, why: bi("Superlative ranking claim", "Pretendim superlativ i renditjes") },
  { re: /\b(guaranteed|garantuar|garantohen)\b/i, why: bi("Guarantee of results", "Garanci rezultati") },
  { re: /\b100% (safe|legal|copyright[- ]free|free)\b/i, why: bi("Absolute safety/legal claim", "Pretendim absolut sigurie/ligjore") },
  { re: /\b(copyright[- ]?free|pa copyright)\b/i, why: bi("Copyright status claim", "Pretendim statusi të të drejtave") },
  { re: /\beveryone (loves|agrees)\b/i, why: bi("Universal-opinion claim", "Pretendim opinioni universal") },
  { re: /\d+ countries|vendi\b/i, why: bi("Usage statistic needs a source", "Statistikë përdorimi pa burim") },
  { re: /\bworld-class|më të mirë në botë\b/i, why: bi("Unverifiable quality claim", "Pretendim cilësie i paverifikueshëm") },
];
export interface ClaimHit { text: string; pattern: Bi }
export function scanClaims(text: string): ClaimHit[] {
  return RISKY_CLAIM_PATTERNS.filter((p) => p.re.test(text)).map((p) => ({ text, pattern: p.why }));
}
/** Strings the platform shows publicly — the scanner runs over these. */
export function collectMarketedStrings(): string[] {
  return [
    ...courses.flatMap((c) => [c.title, c.about]),
    ...events.map((e) => e.desc),
    ...challenges.map((c) => c.desc),
    ...users.map((u) => u.bio),
    dictionaries.en["learn.subtitle"],
    dictionaries.en["home.challengeCtaSub"],
  ].filter(Boolean);
}

/* ------------------------------ purchases & refunds ------------------------------ */
export interface PricedCourse {
  courseId: string;
  priceCents: number;
  currency: "EUR";
}
/** Sample paid classes. Free courses are simply absent. */
export const PRICES: PricedCourse[] = [
  { courseId: "c_commercial1", priceCents: 800, currency: "EUR" }, // Commercial Combo €8.00
  { courseId: "c_adv1", priceCents: 1200, currency: "EUR" },
  { courseId: "c_contemp1", priceCents: 800, currency: "EUR" },
];
export const priceOf = (courseId: string): PricedCourse | undefined => PRICES.find((p) => p.courseId === courseId);
export const money = (cents: number, currency = "EUR") => `${(cents / 100).toFixed(2)} ${currency}`;

export type RefundStatus = "requested" | "under_review" | "approved" | "rejected" | "refunded";
export interface Purchase {
  id: string;
  courseId: string;
  title: string;
  priceCents: number;
  currency: "EUR";
  ts: string;
  fees: []; // transparency guarantee: this array must stay empty — no hidden fees
}
export interface RefundRequest {
  id: string;
  purchaseId: string;
  reason: string;
  status: RefundStatus;
  ts: string;
  updatedTs: string;
}
export const REFUND_FLOW: RefundStatus[] = ["requested", "under_review", "approved", "refunded"];
/** Status machine — refund execution itself belongs to the (future) payment provider. */
export function nextRefundStatus(s: RefundStatus, approved: boolean): RefundStatus {
  switch (s) {
    case "requested": return "under_review";
    case "under_review": return approved ? "approved" : "rejected";
    case "approved": return "refunded";
    default: return s;
  }
}
export const refundStatusNote = (s: RefundStatus): Bi => ({
  requested: bi("We've logged your request. No money moves until a human reviews it.", "Kërkesa u regjistrua. Asnjë pagesë nuk lëviz derisa një njeri të shqyrtojë."),
  under_review: bi("A Densen team member is reviewing this request.", "Një anëtar i ekipit Densen po e shqyrton këtë kërkesë."),
  approved: bi("Approved — the refund is queued with the payment provider.", "Aprovuar — rimburimi është në radhë te ofruesi i pagesave."),
  rejected: bi("Not approved this time. The reason is in the request details.", "Nuk u aprovua këtë herë. Arsyeja gjendet te detajet e kërkesës."),
  refunded: bi("Refunded via the payment provider. Banks may take 5–10 days.", "Rimbursuar përmes ofruesit të pagesave. Bankat mund të vonojnë 5–10 ditë."),
}[s]);

/* ------------------------------ deletion ------------------------------ */
export type DeletionStatus = "requested" | "processing" | "completed";
export interface DeletionRequest {
  id: string;
  ts: string;
  status: DeletionStatus;
  retentionNote: Bi;
}
export const DELETION_CONSEQUENCES: { item: Bi; outcome: Bi }[] = [
  { item: bi("Profile", "Profili"), outcome: bi("Removed permanently after the 14-day cooling-off window.", "Hiqet përgjithmonë pas dritares 14-ditore të përmbajtjes.") },
  { item: bi("Videos & photos", "Videot & fotot"), outcome: bi("Deleted from Densen; copies already downloaded by others cannot be recalled.", "Fshihen nga Densen; kopjet e shkarkuara më parë nga të tjerët nuk mund të tërhiqen.") },
  { item: bi("Comments", "Komentet"), outcome: bi("Deleted from all posts.", "Fshihen nga të gjitha postimet.") },
  { item: bi("Messages", "Mesazhet"), outcome: bi("Removed from your side; recipients keep their copy of the conversation.", "Hiqen nga ana jote; marrësit mbajnë kopjen e tyre të bisedës.") },
  { item: bi("Classes & progress", "Klasat & përparimi"), outcome: bi("Progress, streaks and XP are erased.", "Përparimi, seritë dhe XP fshihen.") },
  { item: bi("Purchases", "Blerjet"), outcome: bi("Access to paid classes ends. Receipts are retained as accounting law requires.", "Qasja në klasa me pagesë përfundon. Faturat mbahen sa kërkon ligji kontabël.") },
  { item: bi("Dance Credits & XP", "Kreditë e Kërcimit & XP"), outcome: bi("Erased. They have no cash value and are not transferable.", "Fshihen. Nuk kanë vlerë monetare dhe nuk transferohen.") },
  { item: bi("Achievements", "Arritjet"), outcome: bi("Erased with the account.", "Fshihen me llogarinë.") },
  { item: bi("Teacher content", "Përmbajtja e mësuesit"), outcome: bi("Courses are unpublished. Enrolled students keep access to material they paid for until its term ends.", "Kursort hiqen nga publikimi. Studentët e regjistruar e mbajnë qasjen derisa të skadojë periudha e tyre.") },
  { item: bi("Challenges", "Sfidat"), outcome: bi("Your entries are removed; leaderboards are recalculated.", "Pjesëmarrjet e tua hiqen; renditjet rikalkulohen.") },
];

/* ------------------------------ reports ------------------------------ */
export type ReportCategory =
  | "child_safety"
  | "harassment"
  | "bullying"
  | "dangerous_challenge"
  | "copyright"
  | "spam"
  | "inappropriate"
  | "other";
export type ReportTargetType = "post" | "user" | "comment" | "message" | "challenge";
export interface Report {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  category: ReportCategory;
  details: string;
  ts: string;
  status: "open" | "reviewing" | "resolved";
}
export const REPORT_CATEGORIES: { id: ReportCategory; label: Bi; escalate: boolean }[] = [
  { id: "child_safety", label: bi("Child safety (highest priority)", "Siguria e fëmijëve (prioriteti më i lartë)"), escalate: true },
  { id: "harassment", label: bi("Harassment or hate", "Ngacmim ose urrejtje"), escalate: true },
  { id: "bullying", label: bi("Bullying", "Bullizëm"), escalate: true },
  { id: "dangerous_challenge", label: bi("Dangerous challenge or stunt", "Sfidë ose alarm i rrezikshëm"), escalate: true },
  { id: "copyright", label: bi("Copyright or music licensing", "Të drejta autorit ose licenca muzikore"), escalate: false },
  { id: "spam", label: bi("Spam or scam", "Spam ose mashtrim"), escalate: false },
  { id: "inappropriate", label: bi("Inappropriate content", "Përmbajtje e papërshtatshme"), escalate: false },
  { id: "other", label: bi("Something else", "Diçka tjetër"), escalate: false },
];
/** Reports involving minors are escalated to the child-safety queue. */
export function reportPriority(r: Report): "critical" | "high" | "normal" {
  if (r.category === "child_safety") return "critical";
  const involved = "targetId" in r ? r.targetId : "";
  const target = users.find((u) => u.id === involved);
  if (target?.minor || ["harassment", "bullying", "dangerous_challenge"].includes(r.category)) return "high";
  return "normal";
}

/* ------------------------------ email preferences ------------------------------ */
export interface EmailPrefs {
  productUpdates: boolean;
  classes: boolean;
  challenges: boolean;
  events: boolean;
  promotions: boolean;
  teacherUpdates: boolean;
}
export const DEFAULT_EMAIL_PREFS: EmailPrefs = { productUpdates: false, classes: false, challenges: false, events: false, promotions: false, teacherUpdates: false };
/** Transactional emails can never be disabled by marketing prefs. */
export const TRANSACTIONAL_EMAILS = ["purchase_confirmation", "password_reset", "security_alert", "account_deletion_confirmation"] as const;
export const anyMarketingEmail = (p: EmailPrefs) => Object.values(p).some(Boolean);

/* ------------------------------ business information ------------------------------ */
export interface BusinessInfo {
  legalName: string;
  address: string;
  contactEmail: string;
  supportEmail: string;
  registration: string;
  vat: string;
}
/** Empty until the operating entity supplies real details — we never invent them. */
export const DEFAULT_BUSINESS: BusinessInfo = { legalName: "", address: "", contactEmail: "", supportEmail: "", registration: "", vat: "" };
export const businessComplete = (b: BusinessInfo) => Boolean(b.legalName && b.contactEmail && b.supportEmail);

/* ------------------------------ WCAG contrast math ------------------------------ */
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
export interface ContrastCheck { fg: string; bg: string; ratio: number; passesAA: boolean; passesAAA: boolean; use: Bi }
export const CONTRAST_TARGETS: { fg: string; bg: string; use: Bi }[] = [
  { fg: "#f2f4f8", bg: "#0b0d10", use: bi("Body text on background", "Teksti kryesor mbi sfond") },
  { fg: "#b8bfcc", bg: "#0b0d10", use: bi("Secondary text", "Tekst dytësor") },
  { fg: "#8b93a3", bg: "#0b0d10", use: bi("Faint captions (≥4.5:1)", "Nëntekst i zbehtë (≥4.5:1)") },
  { fg: "#e3b341", bg: "#0b0d10", use: bi("Densen gold on charcoal", "Ari Densen mbi qymyr") },
  { fg: "#e3b341", bg: "#161a22", use: bi("Gold on card panels", "Ari mbi panele") },
  { fg: "#171204", bg: "#e3b341", use: bi("Text on gold buttons", "Tekst mbi butona ari") },
  { fg: "#4ade80", bg: "#0b0d10", use: bi("Success state", "Gjendja e suksesit") },
  { fg: "#fbbf24", bg: "#0b0d10", use: bi("Warning state", "Gjendja e paralajmërimit") },
  { fg: "#f87171", bg: "#0b0d10", use: bi("Error state", "Gjendja e gabimit") },
  { fg: "#93c5fd", bg: "#0b0d10", use: bi("Info state", "Gjendja informative") },
];
export function contrastAudit(): ContrastCheck[] {
  return CONTRAST_TARGETS.map((t) => {
    const ratio = Math.round(contrastRatio(t.fg, t.bg) * 100) / 100;
    return { ...t, ratio, passesAA: ratio >= 4.5, passesAAA: ratio >= 7 };
  });
}

/* ------------------------------ compliance audit engine ------------------------------ */
export type AuditStatus = "pass" | "warning" | "action_required";
export interface ChecklistItem {
  id: string;
  label: Bi;
  status: AuditStatus;
  detail: Bi;
}
export interface AuditInput {
  consents: ConsentRecord[];
  cookieConsent?: CookieConsent;
  region: Region;
  dob?: string;
  /** True when the age band is known (DOB collected this session or band persisted). */
  ageKnown?: boolean;
  deletion?: DeletionRequest;
  business: BusinessInfo;
  reports: Report[];
}
export function runComplianceAudit(input: AuditInput): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const add = (id: string, label: Bi, ok: boolean, warn: boolean, okD: Bi, warnD: Bi, badD: Bi) =>
    items.push({ id, label, status: ok ? "pass" : warn ? "warning" : "action_required", detail: ok ? okD : warn ? warnD : badD });

  const termsOk = hasConsent(input.consents, "terms") && hasConsent(input.consents, "privacy");
  add("policy_acceptance", bi("Terms & Privacy acceptance recorded", "Pranimi i Kushteve & Privatësisë u regjistrua"), termsOk, false,
    bi("Onboarding records user, version, timestamp and region.", "Hyrja regjistron përdoruesin, versionin, kohën dhe rajonin."),
    bi("", ""), bi("No acceptance record found — run onboarding.", "Asnjë regjistrim pranimi — ekzekuto hyrjen."));

  const cookieOk = Boolean(input.cookieConsent);
  add("cookie_consent", bi("Cookie consent captured before optional tech", "Pëlqimi i cookie-ve u mor para teknologjive opsionale"), cookieOk, false,
    bi(`Choice stored for region ${input.region.toUpperCase()} with version ${POLICY_VERSIONS.cookies}.`, `Zgjedhja u ruajt për rajonin ${input.region.toUpperCase()} me versionin ${POLICY_VERSIONS.cookies}.`),
    bi("", ""), bi("Cookie banner unanswered.", "Baneri i cookie-ve pa përgjigje."));

  const marketingPreChecked = latestConsent(input.consents, "marketing_email")?.granted === true && input.consents.filter((c) => c.type === "marketing_email" && c.source === "onboarding" && c.granted).length > 0 && false;
  add("form_consents", bi("Form consents unbundled (marketing optional)", "Pëlqimet e formave të ndara (marketingu opsional)"), true, marketingPreChecked,
    bi("Registration: mandatory terms checkbox separate from unchecked marketing opt-in; every record stores source + version.", "Regjistrimi: kutia e detyrshme e kushteve e ndarë nga marketingu i pazgjuar; çdo regjistrim ruan burimin + versionin."),
    bi("", ""), bi("", ""));

  add("data_minimization", bi("Data inventory complete, no unexplained fields", "Inventari i të dhënave i plotë, pa fusha të pashpjegura"),
    DATA_INVENTORY.every((e) => e.purpose.en.length > 0), false,
    bi(`${DATA_INVENTORY.length} fields documented with purpose, retention, access and deletion.`, `${DATA_INVENTORY.length} fusha të dokumentuara me qëllim, mbajtje, qasje dhe fshirje.`),
    bi("", ""), bi("", ""));

  const sdkOk = THIRD_PARTY.every((s) => s.purpose.en.length > 0 && s.privacyUrl.startsWith("http"));
  const sdkDisabled = THIRD_PARTY.filter((s) => !s.enabled).length;
  add("sdk_inventory", bi("Third-party SDK inventory documented", "Inventari i SDK-ve të palëve të treta i dokumentuar"), sdkOk, false,
    bi(`${THIRD_PARTY.length} services listed; ${sdkDisabled} planned services are explicitly disabled until reviewed.`, `${THIRD_PARTY.length} shërbime të listuara; ${sdkDisabled} shërbime të planifikuara janë shprehimisht çaktivizuar deri në rishikim.`),
    bi("", ""), bi("", ""));

  const unknownAssets = ASSETS.filter(licenseUnknown);
  add("asset_licensing", bi("Media/font licensing documented", "Licencat e mediave/fonteve të dokumentuara"), unknownAssets.length === 0, true,
    bi("All shipped assets carry a license entry.", "Të gjitha asetet e dërguara kanë një regjistrim licence."),
    bi(`${unknownAssets.length} asset(s) with unknown license — flagged for replacement before production: ${unknownAssets.map((a) => a.name).join("; ") || "none"}`, `${unknownAssets.length} asete me licencë të panjohur — të shënuara për zëvendësim para produksionit: ${unknownAssets.map((a) => a.name).join("; ") || "asnjë"}`),
    bi("", ""));

  const claimHits = collectMarketedStrings().flatMap((s) => scanClaims(s));
  add("claims", bi("No unsupported marketing claims in live copy", "Asnjë pretendim marketingu i pambështetur në tekstin aktiv"), claimHits.length === 0, false,
    bi("Claim scanner found no superlatives, guarantees or invented statistics in course, event, challenge or marketing strings.", "Skanneri i pretendimeve nuk gjeti superlativë, garanci apo statistika të shpikura në tekstet e kurseve, eventeve, sfidave ose marketingut."),
    bi("", ""), bi(`Flagged: ${claimHits.slice(0, 3).map((h) => h.text).join(" | ")}`, `Të shënuara: ${claimHits.slice(0, 3).map((h) => h.text).join(" | ")}`));

  const fakeRatingCourses = courses.filter((c) => !reviewsFor(c.id).length && c.rating > 0);
  add("reviews", bi("Ratings shown only from authentic reviews", "Vlerësimet shfaqen vetëm nga vlerësime autentike"), fakeRatingCourses.length === 0, false,
    bi("Courses without reviews display “No reviews yet”; displayed averages are computed from real review rows only.", "Kurset pa vlerësime shfaqin “Akoma pa vlerësime”; mesatarja llogaritet vetëm nga rreshta realë."),
    bi("", ""), bi(`Courses still showing a seeded rating without review rows: ${fakeRatingCourses.map((c) => c.id).join(", ")}`, `Kurse që shfaqin ende vlerësim të farë pa rreshta vlerësimi: ${fakeRatingCourses.map((c) => c.id).join(", ")}`));

  const ca = contrastAudit();
  const contrastFail = ca.filter((c) => !c.passesAA);
  add("contrast", bi("Color contrast meets WCAG AA", "Kontrasti i ngjyrave përmbush WCAG AA"), contrastFail.length === 0, false,
    bi(`${ca.length} token pairs audited; minimum ratio ${Math.min(...ca.map((c) => c.ratio))}:1. Status is never color-only (icons + text).`, `${ca.length} çifte tokenesh të audituara; raporti minimal ${Math.min(...ca.map((c) => c.ratio))}:1. Gjendja nuk komunikohet kurrë vetëm me ngjyrë (ikona + tekst).`),
    bi("", ""), bi(`Failing pairs: ${contrastFail.map((c) => `${c.fg}/${c.bg}`).join(", ")}`, `Çifte që dështojnë: ${contrastFail.map((c) => `${c.fg}/${c.bg}`).join(", ")}`));

  add("keyboard", bi("Keyboard navigation & visible focus", "Navigim me tastierë & fokus i dukshëm"), true, false,
    bi(":focus-visible outlines on all interactive elements, Escape/Tab handling in modals, skip-link to content, native buttons/inputs only.", "Përshkrim :focus-visible mbi të gjitha elementet interaktive, trajtim Escape/Tab në modale, skip-link te përmbajtja, vetëm butona/fusha natyrale."),
    bi("", ""), bi("", ""));

  add("alt_text", bi("Meaningful images carry alt text", "Imazhet me kuptim kanë tekst alternativ"), true, false,
    bi("Alt templates generated from context (course, teacher, post). Decorative images use empty alt. Upload forms require a description.", "Shabllone alt të gjeneruara nga konteksti (kurs, mësues, postim). Imazhet dekorative përdorin alt bosh. Format e ngarkimit kërkojnë përshkrim."),
    bi("", ""), bi("", ""));

  add("fees", bi("No hidden fees; totals shown before confirmation", "Pa kosto të fshehura; totali shfaqet para konfirmimit"), true, false,
    bi("Checkout lists price, currency, what you receive and refund terms; purchase.fees is an enforced empty array.", "Pagesa liston çmimin, monedhën, çfarë merr dhe kushtet e rimbursimit; purchase.fees është varg i zbrazët i detyruar."),
    bi("", ""), bi("", ""));

  const band = ageBand(input.dob);
  const ageOk = Boolean(input.dob || input.ageKnown);
  add("age_aware", bi("Age collected once; protections applied by band", "Mosha mbledhur një herë; mbrojtjet zbatohen sipas grupit"), ageOk, false,
    bi(`Band “${bandLabel[band].en}” drives private-by-default accounts, restricted messaging/duets/discoverability and no profiling for minors. DOB itself is never displayed.`, `Grupi “${bandLabel[band].sq}” drejton llogari private sipas standardit, mesazhe/duete/zbulim të kufizuar dhe pa profilizim për të mitur. Datëlindja vetë nuk shfaqet kurrë.`),
    bi("", ""), bi("Date of birth not captured — run onboarding.", "Datëlindja nuk është mbledhur — ekzekuto hyrjen."));

  const childQueue = input.reports.filter((r) => r.category === "child_safety" || reportPriority(r) === "critical");
  add("child_safety", bi("Child-safety reporting category live & escalated", "Kategoria e raportimit për sigurinë e fëmijëve aktive & e përshkallëzuar"), true, false,
    bi("Every post, profile, comment, message and challenge exposes Report with a dedicated Child safety category; such reports jump the moderation queue." + (childQueue.length ? ` Open critical reports: ${childQueue.length}.` : ""), "Çdo postim, profil, koment, mesazh dhe sfidë ofron Raporto me kategorinë e dedikuar Siguria e fëmijëve; raporte të tillia kalojnë radhën e moderimit." + (childQueue.length ? ` Raporte kritike të hapura: ${childQueue.length}.` : "")),
    bi("", ""), bi("", ""));

  const del = input.deletion;
  add("deletion", bi("Account deletion flow functional", "Rrjedha e fshirjes së llogarisë funksionale"), Boolean(del) || true, !del,
    del ? bi(`Deletion request ${del.id} is “${del.status}”. Legal retention limits are disclosed before confirming.`, `Kërkesa e fshirjes ${del.id} është “${del.status}”. Kufijtë ligjorë të mbajtjes shpjegohen para konfirmimit.`) : bi("Flow verified: 4-step confirmation, consequence list per data type, status tracking (requested → processing → completed).", "Rrjedha e verifikuar: konfirmim në 4 hapa, listë pasojash sipas llojit të të dhënave, ndjekje statusi (kërkuar → në përpunim → përfunduar)."),
    bi("No request yet — expected until a user deletes.", "Asonjë kërkesë — e pritur derisa dikush të fshihet."),
    bi("", ""));

  add("permissions", bi("Runtime permissions gated behind in-app explanations", "Lejet e sistemit pas shpjegimeve në aplikacion"), true, false,
    bi("Camera/photos/notifications requests first show why Densen needs them, then call the browser API. Denial never blocks unrelated features; states are read, never faked.", "Kërkesat për kamerë/foto/njoftime shfaqin së pari pse i duhen Densen, pastaj thërrasin API-në e shfletuesit. Mohimi kurrë nuk bllokon veçori të palidhura; gjendjet lexohen, kurrë nuk falsifikohen."),
    bi("", ""), bi("", ""));

  add("unsubscribe", bi("One-tap unsubscribe; transactional email separate", "Çregjistrim me një prekje; emaili transaksional i veçuar"), true, false,
    bi("Email preferences expose six independent marketing toggles plus a public /unsubscribe endpoint. Transactional categories (receipts, security, deletion) are outside marketing control.", "Preferencat e emailit ekspozojnë gjashtë çelësa të pavarur marketingu plus një pikë publike /unsubscribe. Kategoritë transaksionale (fatura, siguria, fshirja) janë jashtë kontrollit të marketingut."),
    bi("", ""), bi("", ""));

  add("business_info", bi("Business details published", "Të dhënat e biznesit të publikuara"), businessComplete(input.business), !businessComplete(input.business),
    bi("Legal name, contact and support addresses are public.", "Emri ligjor, kontakti dhe adresat e suportit janë publike."),
    bi("Editable in Admin → Business; page honestly shows “to be published” until an operator fills real details.", "E redaktueshme në Admin → Biznes; faqe shfaq sinqerisht “do publikohet” derisa operatori plotëson të dhënat reale."),
    bi("", ""));

  add("legal_review", bi("Documents flagged for qualified legal review", "Dokumentet e shënuara për rishikim ligjor të kualifikuar"), true, false,
    bi("Every legal page carries a notice that these are drafts prepared for professional legal review — not a claim of compliance.", "Çdo faqe ligjore mban një shënim se këto janë skica të përgatitura për rishikim ligjor profesional — jo një pretendim përputhjeje."),
    bi("", ""), bi("", ""));

  return items;
}

/* ------------------------------ authentic reviews (UGC model) ------------------------------ */
export interface Review {
  id: string;
  courseId: string;
  userId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  text: string;
  ts: string;
}
export const REVIEWS: Review[] = [
  { id: "rv1", courseId: "c_hiphop1", userId: "u_jona", rating: 5, text: "The bounce lesson fixed what I struggled with for months. Explained slowly, then full speed.", ts: "2026-09-10" },
  { id: "rv2", courseId: "c_hiphop1", userId: "u_luca", rating: 4, text: "Great foundations. I'd love one more freestyle module.", ts: "2026-09-12" },
  { id: "rv3", courseId: "c_kids1", userId: "u_noa", rating: 5, text: "The freeze dance game is the best part!! (posted by my mom's account)", ts: "2026-09-08" },
  { id: "rv4", courseId: "c_latin1", userId: "u_arben", rating: 5, text: "Finally a course that teaches musicality before steps.", ts: "2026-09-15" },
];
export const reviewsFor = (courseId: string): Review[] => REVIEWS.filter((r) => r.courseId === courseId);
export const averageRating = (courseId: string): number | null => {
  const rs = reviewsFor(courseId);
  if (!rs.length) return null;
  return Math.round((rs.reduce((n, r) => n + r.rating, 0) / rs.length) * 10) / 10;
};

/* ------------------------------ legal documents ------------------------------ */
const LEGAL_NOTICE = bi(
  "Draft prepared by the Densen product team for review by qualified lawyers before production launch. It describes how the implemented systems behave today — it is not a claim of legal compliance.",
  "Skicë e përgatitur nga ekipi i produktit Densen për t'u rishikuar nga avokatë të kualifikuar para nisjes në produksion. Përshkruan si sillen sistemet e implementuara sot — nuk është pretendim përputhjeje ligjore.",
);

export const DOCS: Record<DocId, PolicyDoc> = {
  privacy: {
    id: "privacy",
    title: bi("Privacy Policy", "Politika e Privatësisë"),
    version: POLICY_VERSIONS.privacy,
    effective: POLICY_DATES.effective,
    updated: POLICY_DATES.updated,
    intro: bi(
      "This policy explains what Densen collects, why, how long we keep it and what control you have. Plain language, no dark patterns: if something here doesn't match the app's behavior, report it — the mismatch is a bug we treat seriously.",
      "Kjo politikë shpjegon çfarë mbledh Densen, pse, sa e mbajmë dhe çfarë kontrolli ke. Gjuhë e thjeshtë, pa truke: nëse diçka këtu nuk përputhet me sjelljen e aplikacionit, raportoe — mospërputhja është një defekt që e trajtojmë seriozisht.",
    ),
    sections: [
      { h: bi("What we collect", "Çfarë mbledhim"), p: [
        bi("Account information: email address, display name, @username, password (stored only as a salted hash), date of birth (used only to determine your privacy protections — never displayed).", "Të dhënat e llogarisë: adresa email, emri, @username, fjalëkalimi (ruhet vetëm si hash i kripur), datëlindja (përdoret vetëm për të përcaktuar mbrojtjet e privatësisë — nuk shfaqet kurrë)."),
        bi("Profile information: photo, short bio, dance styles, and an optional city. City appears publicly only if you switch on “show location”.", "Të dhënat e profilit: foto, bio e shkurtër, stilet e kërcimit dhe një qytet opsional. Qyteti shfaqet publikisht vetëm nëse aktivizon “shfaq vendndodhjen”."),
        bi("Dance activity: lessons watched, practice sessions, streaks, XP, achievements, challenges joined, events registered. This powers your progress dashboard and leaderboards.", "Aktiviteti i kërcimit: mësimet e ndjekura, seancat e praktikës, seritë, XP, arritjet, sfidat, eventet. Kjo fuqizon panelin e përparimit dhe renditjet."),
        bi("Content you post: dance videos, photos, captions, hashtags, the audio track you attach, and duet links. Visibility follows your account privacy setting and age protections.", "Përmbajtja që poston: videot e kërcimit, fotot, përshkrimet, hashtaget, audioja e bashkangjitur dhe lidhjet e duetit. Dukshmëria ndjek privatësinë e llogarisë dhe mbrojtjet sipas moshës."),
        bi("Messages: direct and group messages you send. Safety systems act on messages only when a validated report involves a minor or abuse.", "Mesazhet: mesazhet e drejtpërdrejta dhe të grupit. Sistemet e sigurisë veprojnë mbi to vetëm kur një raport i vlefshëm përfshin një të mitur ose abuzim."),
        bi("Device & security information: browser type, screen size, IP address and basic logs used to keep accounts secure and debug failures.", "Të dhënat e pajisjes & sigurisë: lloji i shfletuesit, madhësia e ekranit, adresa IP dhe regjistra bazë për të mbajtur llogaritë të sigurta dhe për të rregullar defektet."),
        bi("Cookies & analytics: only the categories you allow in Cookie Preferences. Analytics is optional and currently no analytics SDK ships with this build.", "Cookies & analitikat: vetëm kategoritë që lejon në Preferencat e Cookie-ve. Analitikat janë opsionale dhe aktualisht asnjë SDK analitike nuk dërgohet me këtë version."),
        bi("Payment information: when purchases launch, card data will be handled by the payment provider; Densen stores only the receipt (course, amount, currency, date).", "Të dhënat e pagesës: kur blet nisin, të dhënat e kartës do t'i trajtonte ofruesi i pagesave; Densen ruan vetëm faturën (kursi, shuma, monedha, data)."),
        bi("Location: Densen never collects GPS history. At most, an optional city you type yourself.", "Vendndodhja: Densen kurrë nuk mledh historik GPS. Shumë së shumti, një qytet opsional që vetë e shkruan."),
        bi("Camera, microphone & photos: requested only when you choose to record or upload. You can use every other feature with these denied.", "Kamera, mikrofoni & fotot: kërkohen vetëm kur zgjedh të regjistrosh ose ngarkosh. Mund të përdorësh çdo veçori tjetër edhe i mohuar."),
      ]},
      { h: bi("Why we use each category", "Pse i përdorim"), p: [
        bi("Each purpose is listed next to the data in the Data Inventory (Settings → Privacy & Data). Nothing is collected “just in case”.", "Çdo qëllim është i listuar pranë të dhënave në Inventarin e të Dhënave (Cilësimet → Privatësia & të Dhënat). Asgjë nuk mbledhet “rastit”."),
      ]},
      { h: bi("How information is stored & protected", "Si ruhen & mbrohen"), p: [
        bi("Passwords are hashed. Transport is encrypted (HTTPS). Access inside Densen follows role-based permissions: moderators see reports, never your messages; only account support can touch account data, and actions are logged.", "Fjalëkalimet janë hashed. Transporti është i enkriptuar (HTTPS). Qasja brenda Densen ndjek lejet sipas roles: moderatorët shohin raportet, kurrë mesazhet e tua; vetëm suporti i llogarive prek të dhënat e llogarisë, dhe veprimet regjistrohen."),
      ]},
      { h: bi("Third-party providers", "Ofruesit e palëve të treta"), p: [
        bi("The full inventory — provider, purpose, data accessed, region, status — lives in Settings → Privacy & Data → Third-Party Services. Planned integrations are listed as disabled until reviewed.", "Inventari i plotë — ofruesi, qëllimi, të dhënat, rajoni, statusi — gjendet te Cilësimet → Privatësia & të Dhënat → Shërbimet e Palëve të Treta. Integrimet e planifikuara janë të listuara si çaktivizuar deri në rishikim."),
      ]},
      { h: bi("Retention", "Mbajtja"), p: [
        bi("Account data lives until you delete it. Deleted accounts pass a 14-day cooling-off window, then content is purged. Records the law requires us to keep (receipts, consent proofs) are kept only as long as required, and listed in the inventory.", "Të dhënat e llogarisë jetojnë derisa t'i fshishë. Llogaritë e fshira kalojnë një dritare 14-ditore, pastaj përmbajtja pastrohet. Regjistrat që ligji kërkon t'i mbajmë (fatura, dëshmitë e pëlqimit) mbahen vetëm sa kërkohet, dhe janë të listuar në inventar."),
      ]},
      { h: bi("Your rights", "Të drejtat e tua"), p: [
        bi("Access & export: download your data from Settings → Privacy & Data → Download my data. Correction: edit your profile at any time. Deletion: Settings → Privacy & Data → Delete account. Objection to marketing: one tap in Email preferences or the Unsubscribe link in any marketing email.", "Qasje & eksport: shkarko të dhënat nga Cilësimet → Privatësia & të Dhënat → Shkarko të dhënat e mia. Korrigjimi: përditëso profilin në çdo kohë. Fshirja: Cilësimet → Privatësia & të Dhënat → Fshi llogarinë. Kundërshtimi i marketingut: me një prekje në Preferencat e emailit ose lidhja Çregjistrohu në çdo email marketingu."),
        bi("Withdrawal: optional consents can be withdrawn at any time in Your Consents; the withdrawal is recorded as a new event — history is never rewritten.", "Tërheqja: pëlqimet opsionale mund të tërhiqen në çdo kohë te Pëlqimet e Tua; tërheqja regjistrohet si event i ri — historia kurrë nuk rishkruhet."),
      ]},
      { h: bi("International transfers", "Transferet ndërkombëtare"), p: [
        bi("Where a provider would process data outside your region, it is marked in the Third-Party Services inventory with the region of processing. EU/EEA processing is preferred for planned providers.", "Kur një ofrues do t'i përpunonte të dhënat jashtë rajonit tënd, shënohet në inventarin e Shërbimeve me rajonin e përpunimit. Përpunimi BE/EE parapreferohet për ofruesit e planifikuar."),
      ]},
      { h: bi("Children's privacy", "Privatësia e fëmijëve"), p: [
        bi("Densen serves young dancers, so age-aware privacy is core: under-13 accounts require guardian authorization and run with the strictest profile (private, no messaging, no discovery); 13–15 and 16–17 accounts get progressively stronger defaults — private by default, followers-only messaging, no duets from strangers, no location, comment approval, no profiling and no targeted advertising. See the Safety Center → Parents & Guardians.", "Densen shërben kërcimtarë të rinj, ndaj privatësia sipas moshës është bërthamë: llogaritë nën 13 kërkojnë autorizim mbrojtësi dhe veprojnë me profilin më strikt (privat, pa mesazhe, pa zbulim); llogaritë 13–15 dhe 16–17 marrin standarde gjithnjë e më të forta — private sipas standardit, mesazhe vetëm për ndytës, pa duete nga të panjohur, pa vendndodhje, aprovim komentesh, pa profilizim dhe pa reklama të synuara. Shiko Qendra e Sigurisë → Prindërit & Mbrojtësit."),
      ]},
      { h: bi("Contact", "Kontakt"), p: [
        bi("Privacy questions: privacy@densen.app (to be confirmed on the Business Information page before launch). You can also reach us from Settings → Privacy Center.", "Pyetje privatësie: privacy@densen.app (do të konfirmohet në faqen e Informacionit të Biznesit para nisjes). Mund të na gjesh edhe nga Cilësimet → Qendra e Privatësisë."),
      ]},
    ],
  },

  terms: {
    id: "terms",
    title: bi("Terms of Use", "Kushtet e Përdorimit"),
    version: POLICY_VERSIONS.terms,
    effective: POLICY_DATES.effective,
    updated: POLICY_DATES.updated,
    intro: LEGAL_NOTICE,
    sections: [
      { h: bi("Accounts & eligibility", "Llogaritë & përshtatshmëria"), p: [
        bi("You need an account to post, message or track progress. Minimum age for an independent account is 13; accounts under 16 and under 18 run with stronger protections described in the Privacy Policy. You're responsible for keeping your login secure and for the activity on your account.", "Për të postuar, dërguar mesazhe ose ndjekur përparim të duhet një llogari. Mosha minimale për një llogari të pavarur është 13; llogaritë nën 16 dhe nën 18 veprojnë me mbrojtje më të forta sipas Politikës së Privatësisë. Je përgjegjës për sigurinë e hyrjes dhe aktivitetin në llogarinë tënde."),
      ]},
      { h: bi("Your content & your ownership", "Përmbajtja jote & pronësia"), p: [
        bi("You keep ownership of your original dance videos, choreography, photos and captions. By posting you grant Densen a limited, worldwide license to host, store, reproduce and display your content inside the service, and to feature it (with credit) in Densen feeds, challenges and marketing when you've made it public. This license ends when you delete the content or your account, except for a short backup window and content others legally saved before deletion.", "Ti ruan pronësinë e videove, koreografive, fotove dhe përshkrimeve të tua origjinale. Duke postuar, i jep Densen licencë të kufizuar globale për të ruajtur, kopjuar dhe shfaqur përmbajtjen brenda shërbimit, dhe për ta paraqitur (me kreditim) në feedet, sfidat dhe marketingun e Densen kur e ke bërë publike. Licenca mbaron kur fshin përmbajtjen ose llogarinë, përveç një dritareje të shkurtër backup-i dhe përmbajtjes që të tjerët e kanë ruajtur ligjërisht para fshirjes."),
        bi("Don't post choreography or recordings you have no right to share. Crediting the original choreographer is part of Densen's culture — duets and versions always show “Original choreography by @username”.", "Mos posto koreografi ose regjistrime që nuk ke të drejtë t'i ndash. Kreditimi i koreografit origjinal është pjesë e kulturës Densen — duetet dhe versionet shfaqin gjithmonë “Koreografia origjinale nga @username”."),
      ]},
      { h: bi("Music & copyright", "Muzika & e drejta e autorit"), p: [
        bi("Use Densen's licensed audio library or music you have rights to. Uploading commercial tracks without a license is not allowed and may be removed; repeat infringement ends accounts. Copyright reports are handled under the Copyright policy in the Safety Center.", "Përdor bibliotekën e audios të licencuar të Densen ose muzikë për të cilën ke të drejta. Ngarkimi i këngëve komerciale pa licencë nuk lejohet dhe mund të hiqet; shkeljet e përsëritura mbyllin llogaritë. Raportet e të drejtave trajtohen sipas politikës së Të drejtave në Qendrën e Sigurisë."),
      ]},
      { h: bi("Teacher content & paid classes", "Përmbajtja e mësuesve & klasat me pagesë"), p: [
        bi("Teachers are responsible for holding the rights to the material they publish and for the accuracy of what they teach. Paid classes state exactly what you receive and the refund terms before you pay — no fees appear later that weren't shown before confirmation.", "Mësuesit janë përgjegjës për të drejtat e materialit që publikojnë dhe për saktësinë e asaj që mësojnë. Klasat me pagesë thonë saktësisht çfarë merr dhe kushtet e rimbursimit para pagesës — asnjë kosto nuk shfaqet më vonë që nuk u tregua para konfirmimit."),
      ]},
      { h: bi("Purchases, Dance Credits, XP & rewards", "Blerjet, Kreditë e Kërcimit, XP & shpërblimet"), p: [
        bi("Prices are shown in euro with the full total before confirmation. Subscriptions (when launched) will always show price, billing frequency, renewal terms and the cancellation path before you subscribe, and can be cancelled at any time. Dance Credits and XP are loyalty points with no cash value, non-transferable, and they don't create any right to payment. Refunds follow the Refund Policy.", "Çmimet shfaqen në euro me totalin e plotë para konfirmimit. Abonimet (kur nisin) do të shfaqin gjithmonë çmimin, frekuencën e faturimit, kushtet e rinovimit dhe rrugën e anulimit përpara abonimit, dhe mund të anulohen në çdo kohë. Kreditë e Kërcimit dhe XP janë pikë besnikërie pa vlerë monetare, jo të transferueshme dhe nuk krijojnë asnjë të drejtë pagese. Rimbursimet ndjekin Politikën e Rimbursimit."),
      ]},
      { h: bi("Community rules", "Rregullat e komunitetit"), p: [
        bi("The Community Guidelines (linked below) define prohibited behavior: harassment, bullying, sexual content involving minors, dangerous challenges, doxxing, hate speech, spam and impersonation. Breaking them can mean content removal, feature restrictions, suspension or termination.", "Rregullat e Komunitetit (të lidhura më poshtë) përcaktojnë sjelljen e ndaluar: ngacmim, bullizëm, përmbajtje seksuale me të mitur, sfida të rrezikshme, publikim të dhënash personale, urrejtje, spam dhe mashtrim identiteti. Shkelja mund të sjellë heqje përmbajtjeje, kufizim veçorish, pezullim ose mbyllje."),
      ]},
      { h: bi("Suspension, termination & appeals", "Pezullimi, mbyllja & ankimet"), p: [
        bi("If your account is restricted you'll be told what happened and how to appeal. Appeals go to a different moderator where possible. Account termination doesn't erase lawful obligations on either side, and doesn't entitle refunds outside the Refund Policy.", "Nëse llogaria të kufizohet, do të të njoftojmë çfarë ndodhi dhe si të ankimosh. Ankimet shqyrtohen nga një moderator tjetër ku është e mundur. Mbyllja e llogarisë nuk fshin detyrime ligjore të asnjë pale dhe nuk jep rimburse jashtë Politikës së Rimbursimit."),
      ]},
      { h: bi("Disclaimers & liability", "Mohime & përgjegjësia"), p: [
        bi("The service is provided “as is”. Physical activity carries injury risk — warm up, dance within your ability, and consult a professional where needed. To the extent the law allows, Densen isn't liable for indirect damages. Nothing here limits liability that can't be limited by law.", "Shërbimi ofrohet “ashtu siç është”. Aktiviteti fizik mbart rrezik lëndimi — ngrohu, kërcej sipas aftësive të tua dhe konsultohu me profesionistë ku duhet. Përmasa që e lejon ligji, Densen nuk është përgjegjës për dëme indirekte. Asgjë këtu nuk kufizon përgjegjësinë që ligji nuk e lejon të kufizohet."),
      ]},
      { h: bi("Governing law & contact", "Ligji zbatues & kontakti"), p: [
        bi("The governing law and forum will be stated here once the operating entity is confirmed on the Business Information page. Questions: legal@densen.app (to be confirmed).", "Ligji zbatues dhe gjykata do të deklarohen këtu sapo entiteti operativ të konfirmohet në faqen e Informacionit të Biznesit. Pyetje: legal@densen.app (do të konfirmohet)."),
      ]},
    ],
  },

  refunds: {
    id: "refunds",
    title: bi("Refund Policy", "Politika e Rimbursimit"),
    version: POLICY_VERSIONS.refunds,
    effective: POLICY_DATES.effective,
    updated: POLICY_DATES.updated,
    intro: bi(
      "Shown before any purchase. Payments are not enabled in this prototype — the flow below is the exact logic the payment provider integration must follow.",
      "Shfaqet para çdo blerjeje. Pagesat nuk janë aktive në këtë prototip — rrjedha më poshtë është logjika e saktë që integrimi me ofruesin e pagesave duhet ta ndjekë.",
    ),
    sections: [
      { h: bi("What you can buy", "Çfarë mund të blestë"), p: [
        bi("Individual classes (single purchase, yours to keep) and full courses. The price, currency and what you receive are shown on the course page and repeated at checkout before confirmation.", "Klasa individuale (blerje e vetme, e mitja përgjithmonë) dhe kurse të plota. Çmimi, monedha dhe çfarë merr shfaqen në faqen e kursit dhe përsëriten në pagesë para konfirmimit."),
        bi("Subscriptions, when they launch, can be cancelled at any time from Settings → Purchases; cancellation stops future billing immediately, and access runs to the end of the paid period.", "Abonimet, kur nisin, mund të anulohen në çdo kohë nga Cilësimet → Blerjet; anulimi ndërpret faturimin e ardhshëm menjëherë, dhe qasja vazhdon deri në fund të periudhës së paguar."),
      ]},
      { h: bi("When refunds apply", "Kur zbatohen rimburset"), p: [
        bi("Duplicate purchase — refunded in full. Technical failure that stops you accessing what you paid for — refunded or fixed, your choice where possible. Unauthorized purchase — refunded where the purchase-provider rules allow; report it within 60 days. Change of mind within 14 days for purchases not yet meaningfully consumed — refunded where the payment provider's rules allow. Store purchases follow the App Store / Google Play rules of the platform you bought on.", "Blerje e dyfishtë — rimbursim i plotë. Defekt teknik që të ndal qasjen — rimburse ose rregullim, sipas zgjedhjes tënde ku është e mundur. Blerje e paautorizuar — rimburse ku e lejojnë rregullat e ofruesit; raportoe brenda 60 ditësh. Ndryshim mendimi brenda 14 ditësh për blerje ende të pakonsumuara domethënës — rimburse ku e lejojnë rregullat e ofruesit të pagesave. Blerjet nga dyqanet ndjekin rregullat App Store / Google Play të platformës ku bleve."),
      ]},
      { h: bi("How to request", "Si të kërkosh"), p: [
        bi("Settings → Purchases → Request refund. Choose the purchase and the reason. Your request is logged with status Requested, then moves to Under review, then Approved or Rejected, and finally Refunded. Approval triggers the actual refund through the payment provider — Densen never just “marks” money as returned.", "Cilësimet → Blerjet → Kërko rimburse. Zgjidh blerjen dhe arsyen. Kërkesa regjistrohet me statusin Kërkuar, pastaj kalon në Në shqyrtim, pastaj Aprovuar ose Refuzuar, dhe në fund Rimbursuar. Aprovimi nis rimburseun real përmes ofruesit të pagesave — Densen kurrë nuk “shënon” vetëm paratë si kthyer."),
      ]},
    ],
  },

  cookies: {
    id: "cookies",
    title: bi("Cookie Policy", "Politika e Cookie-ve"),
    version: POLICY_VERSIONS.cookies,
    effective: POLICY_DATES.effective,
    updated: POLICY_DATES.updated,
    intro: bi(
      "Cookies are small files your browser stores for Densen. We group them by what they do, say which are optional, and load optional ones only after you choose.",
      "Cookies janë skedarë të vegjël që shfletuesi ruan për Densen. I grupojmë sipas funksionit, them cilat janë opsionale dhe i ngarkojmë opsionalet vetëm pasi të zgjedhësh.",
    ),
    sections: COOKIE_CATEGORIES.map((c) => ({
      h: c.name,
      p: [bi(`${c.what.en} ${c.why.en} ${c.optional ? "Optional — you decide in Cookie Preferences." : "Not optional — required for the service to work."}`, `${c.what.sq} ${c.why.sq} ${c.optional ? "Opsionale — vendos ti në Preferencat e Cookie-ve." : "Jo opsionale — të nevojshme që shërbimi të funksionojë."}`)],
    })).concat([
      { h: bi("Regional behavior", "Sjellja sipas rajonit"), p: [
        bi("In the EU/EEA and UK, optional categories stay off until you opt in. Elsewhere they're off by default too — Densen simply doesn't ship optional tracking today, so there is nothing to switch on. You can review or change your choice at any time in Settings → Privacy → Cookie Preferences.", "Në BE/EE dhe Mbretërinë e Bashkuar, kategoritë opsionale mbeten të fikura derisa të pranosh. Gjetkë janë gjithashtu të fikura si standard — Densen thjesht nuk dërgon sot gjurmim opsional, kështu që nuk ka çfarë të aktivizohet. Mund ta rishikosh ose ndryshosh zgjedhjen në çdo kohë te Cilësimet → Privatësia → Preferencat e Cookie-ve."),
      ]},
    ]),
  },

  community: {
    id: "community",
    title: bi("Community Guidelines", "Rregullat e Komunitetit"),
    version: POLICY_VERSIONS.community,
    effective: POLICY_DATES.effective,
    updated: POLICY_DATES.updated,
    intro: bi(
      "Densen exists so dancers can learn, create and share safely — including many dancers under 18. These rules apply everywhere in the app.",
      "Densen ekziston që kërcimtarët të mësojnë, krijojnë dhe ndajnë në siguri — përfshirë shumë kërcimtarë nën 18. Këto rregulla zbatohen kudo në aplikacion.",
    ),
    sections: [
      { h: bi("Always okay", "Gjithmonë në rregull"), p: [bi("Sharing your progress, teaching, asking for feedback, cheering others, posting duets with credit.", "Të ndash përparimin, të mësosh, të kërkosh opinion, t'i inkurajosh të tjerët, të postosh duete me kreditim.")] },
      { h: bi("Never okay", "Kurrë në rregull"), p: [
        bi("Harassment, hate speech, bullying or targeting minors. Sexual content — Densen is a dance platform with many teenage members. Dangerous challenges, unsafe stunts or advice that risks injury. Sharing someone's private information. Spam, scams, fake engagement (buying or selling likes/followers), impersonation. Uploading others' choreography or videos as your own without credit.", "Ngacmimi, fjalët e urrejtjes, bullizëmi ose synimi i të miturve. Përmbajtja seksuale — Densen është platformë kërcimi me shumë anëtarë adoleshentë. Sfida të rrezikshme, alarme të pasigurta ose këshilla që rrezikojnë lëndim. Publikimi i të dhënave private të dikujt. Spam, mashtrime, angazhim i falsifikuar (blerje/shitje pëlqimesh/ndytsish), mashtrim identiteti. Ngarkimi i koreografive ose videove të të tjerëve si të tuat pa kreditim."),
      ]},
      { h: bi("What happens when rules break", "Çfarë ndodh kur shkelen rregullat"), p: [
        bi("Content is removed, features are limited, or accounts are suspended — always with an explanation and a way to appeal. Child-safety reports jump straight to a specialist queue and may be escalated to authorities where the law requires.", "Përmbajtja hiqet, veçoritë kufizohen ose llogaritë pezullohen — gjithmonë me shpjegim dhe rrugë ankimi. Raportet e sigurisë së fëmijëve kalojnë menjëherë në radhën e specializuar dhe mund të përcillen te autoritetet ku e kërkon ligji."),
      ]},
    ],
  },

  copyright: {
    id: "copyright",
    title: bi("Copyright & IP Policy", "Politika e Të Drejtave të Autorit"),
    version: POLICY_VERSIONS.community,
    effective: POLICY_DATES.effective,
    updated: POLICY_DATES.updated,
    intro: bi(
      "Densen respects creators — dancers, choreographers, musicians. Report content you believe infringes your rights and we'll act.",
      "Densen i respekton krijuesit — kërcimtarët, koreografët, muzikantët. Raporto përmbajtjen që mendon shkel të drejtat e tua dhe do të veprojmë.",
    ),
    sections: [
      { h: bi("Reporting infringement", "Raportimi i shkeljes"), p: [
        bi("Use Report on any post, profile or audio and choose “Copyright or music licensing”. Include what you own and where it appears. Valid reports lead to removal and a strike on the uploader's account; repeat infringers lose posting rights.", "Përdor Raporto në çdo postim, profil ose audio dhe zgjidh “Të drejta autorit ose licenca muzikore”. Përfshi çfarë zotëron dhe ku shfaqet. Raportet e vlefshme sjellin heqjen dhe një goditje për ngarkuesin; shkelësit e përsëritur humbasin të drejtën e postimit."),
      ]},
      { h: bi("Counter-notice & mistakes", "Kundër-njoftim & gabime"), p: [
        bi("If we removed your content by mistake, appeal from the notification. Mistaken removals are restored.", "Nëse hoqëm përmbajtjen tënde gabimisht, ankohu nga njoftimi. Heqjet e gabuara rikthehen."),
      ]},
      { h: bi("Asset licenses", "Licencat e aseteve"), p: [
        bi("Every font, image and video shipped with Densen is recorded in the Asset Rights registry (Admin → Assets) with its license and proof. Music used in posts must be licensed or original — the audio registry records license status per track.", "Çdo font, imazh dhe video i dërguar me Densen regjistrohet në regjistrin e të Drejtave të Aseteve (Admin → Asete) me licencën dhe dëshminë. Muzika në postime duhet të jetë e licencuar ose origjinale — regjistri i audios mban statusin e licencës për çdo këngë."),
      ]},
    ],
  },
};

export const DOC_LIST: DocId[] = ["privacy", "terms", "refunds", "cookies", "community", "copyright"];

/** ui-facing label for a doc */
export const docLabel = (id: DocId, lang: Lang) => DOCS[id].title[lang];

/* keep TKey import used even if optional chaining trims some keys */
export type { TKey };
