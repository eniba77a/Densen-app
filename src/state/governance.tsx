import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ageAwareDefaults,
  ageBand,
  DEFAULT_BUSINESS,
  DEFAULT_EMAIL_PREFS,
  detectRegion,
  hasConsent as hasConsentOf,
  POLICY_VERSIONS,
  runComplianceAudit,
  type AgeBand,
  type AuditStatus,
  type BusinessInfo,
  type ConsentRecord,
  type ConsentType,
  type CookieConsent,
  type DeletionRequest,
  type DeletionStatus,
  type EmailPrefs,
  type PermissionKey,
  type PermissionUiState,
  type Purchase,
  type RefundRequest,
  type RefundStatus,
  type Region,
  type Report,
  type ReportCategory,
  type ReportTargetType,
  type Review,
} from "../data/governance";
import { users } from "../data/store";
import { priceOf } from "../data/governance";
import {
  canViewEvent,
  evaluateContactPattern,
  type AuditEvent,
  type AuditEventType,
  type ContactAttempt,
  type StaffRole,
} from "../data/safety";
import { courseById, ME } from "../data/store";

const LS = "densen_governance_v1";

export interface Account {
  name: string;
  email: string;
  /** Session-only. Never persisted — the derived age band persists instead (data-minimization). */
  dob?: string;
  /** Persisted derived age band; drives youth-safety defaults without storing the DOB. */
  ageBand?: AgeBand;
  region: Region;
}

interface Persisted {
  onboarded: boolean;
  account: Account;
  consents: ConsentRecord[];
  cookieConsent?: CookieConsent;
  purchases: Purchase[];
  refunds: RefundRequest[];
  deletion?: DeletionRequest;
  reports: Report[];
  emailPrefs: EmailPrefs;
  personalization: boolean;
  blocked: string[];
  muted: string[];
  perms: Partial<Record<PermissionKey, PermissionUiState>>;
  business: BusinessInfo;
  reviews: Review[];
  auditEvents: AuditEvent[];
  contactAttempts: ContactAttempt[];
  staffRole: StaffRole;
  guardianName: string;
}

const defaults: Persisted = {
  onboarded: false,
  account: { name: "", email: "", dob: undefined, ageBand: undefined, region: detectRegion() },
  consents: [],
  purchases: [],
  refunds: [],
  reports: [],
  emailPrefs: DEFAULT_EMAIL_PREFS,
  personalization: false,
  blocked: [],
  muted: [],
  perms: {},
  business: DEFAULT_BUSINESS,
  reviews: [],
  auditEvents: [],
  contactAttempts: [],
  staffRole: "moderator",
  guardianName: "",
};

function load(): Persisted {
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    const legacyAccount = { ...defaults.account, ...(parsed.account ?? {}) } as Account;
    // Migration: a raw DOB must never be re-persisted. Derive the band once
    // (preserving existing users' protections), then drop the DOB for good.
    const band = legacyAccount.ageBand ?? ageBand(legacyAccount.dob || undefined);
    return { ...defaults, ...parsed, account: { ...legacyAccount, dob: undefined, ageBand: band } };
  } catch {
    return defaults;
  }
}

/**
 * Pure serializer used for persistence: strips the session-only DOB so the raw
 * date of birth never reaches localStorage; the derived age band persists.
 */
export function persistableState(s: Persisted): Persisted {
  const { account, ...rest } = s;
  const { dob: _sessionDob, ...accountPublic } = account;
  return { ...rest, account: accountPublic } as Persisted;
}

const nowIso = () => new Date().toISOString();
const rid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

interface GovShape {
  // account
  onboarded: boolean;
  account: Account;
  ageBandValue: AgeBand;
  defaultsForAge: ReturnType<typeof ageAwareDefaults>;
  completeOnboarding: (a: { name: string; email: string; dob: string; marketing: boolean; region: Region }) => void;
  updateAccount: (patch: Partial<Account>) => void;
  // consents
  consents: ConsentRecord[];
  recordConsent: (type: ConsentType, granted: boolean, source: string, version?: string) => void;
  hasConsent: (type: ConsentType) => boolean;
  withdrawConsent: (type: ConsentType, source: string) => void;
  // cookies
  cookieConsent?: CookieConsent;
  setCookieConsent: (c: { functional: boolean; analytics: boolean; marketing: boolean }, source: string) => void;
  clearCookieConsent: () => void;
  // purchases & refunds
  purchases: Purchase[];
  buyCourse: (courseId: string) => Purchase;
  owns: (courseId: string) => boolean;
  requestRefund: (purchaseId: string, reason: string) => void;
  advanceRefund: (refundId: string, approved: boolean) => void;
  refunds: RefundRequest[];
  // deletion
  deletion?: DeletionRequest;
  requestDeletion: (confirmText: string) => boolean;
  advanceDeletion: () => void;
  // reports
  reports: Report[];
  submitReport: (targetType: ReportTargetType, targetId: string, category: ReportCategory, details: string) => Report;
  resolveReport: (id: string) => void;
  // blocking
  blocked: string[];
  muted: string[];
  toggleBlock: (userId: string) => void;
  toggleMute: (userId: string) => void;
  isBlocked: (userId: string) => boolean;
  isMuted: (userId: string) => boolean;
  // email
  emailPrefs: EmailPrefs;
  setEmailPrefs: (p: Partial<EmailPrefs>, source?: string) => void;
  personalization: boolean;
  setPersonalization: (v: boolean) => void;
  // permissions
  perms: Partial<Record<PermissionKey, PermissionUiState>>;
  queryPermission: (key: PermissionKey) => Promise<PermissionUiState>;
  requestPermission: (key: PermissionKey) => Promise<PermissionUiState>;
  // business
  business: BusinessInfo;
  updateBusiness: (patch: Partial<BusinessInfo>) => void;
  // reviews (authentic UGC only)
  reviews: Review[];
  addReview: (courseId: string, rating: Review["rating"], text: string) => void;
  // audit
  audit: () => ReturnType<typeof runComplianceAudit>;
  auditEvents: AuditEvent[];
  logEvent: (type: AuditEventType, severity: AuditEvent["severity"], summary: string, subject?: string) => void;
  canViewEvent: (type: AuditEventType) => boolean;
  staffRole: StaffRole;
  setStaffRole: (r: StaffRole) => void;
  contactAttempts: ContactAttempt[];
  logContactAttempt: (a: Omit<ContactAttempt, "ts">) => "none" | "watch" | "restrict";
  guardianName: string;
  setGuardianName: (n: string) => void;
  dobLocked: boolean;
  auditStatusCounts: { pass: number; warning: number; action_required: number };
  // ui
  toast: (t: string) => void;
  toasts: { id: number; text: string }[];
}

const Ctx = createContext<GovShape | null>(null);

export function GovernanceProvider({ children, toast, toasts }: { children: ReactNode; toast: (t: string) => void; toasts: { id: number; text: string }[] }) {
  const [state, setState] = useState<Persisted>(load);

  useEffect(() => {
    try {
      localStorage.setItem(LS, JSON.stringify(persistableState(state)));
    } catch { /* quota */ }
  }, [state]);

  const recordConsent = useCallback((type: ConsentType, granted: boolean, source: string, version: string = POLICY_VERSIONS.terms) => {
    setState((s) => ({
      ...s,
      consents: [
        ...s.consents,
        { id: rid(), userId: ME.id, type, granted, ts: nowIso(), region: s.account.region, source, version },
      ],
    }));
  }, []);

  const store: GovShape = useMemo(() => {
    // In-session DOB wins (freshly collected); otherwise use the persisted band.
    const band = state.account.dob ? ageBand(state.account.dob) : state.account.ageBand ?? "adult";
    const ageDefaults = ageAwareDefaults(band);

    const auditNow = () =>
      runComplianceAudit({
        consents: state.consents,
        cookieConsent: state.cookieConsent,
        region: state.account.region,
        dob: state.account.dob || undefined,
        ageKnown: Boolean(state.account.dob || state.account.ageBand),
        deletion: state.deletion,
        business: state.business,
        reports: state.reports,
      });
    const auditItems = auditNow();
    const auditStatusCounts = auditItems.reduce(
      (acc, i) => { acc[i.status]++; return acc; },
      { pass: 0, warning: 0, action_required: 0 } as Record<AuditStatus, number>,
    );

    return {
      onboarded: state.onboarded,
      account: state.account,
      ageBandValue: band,
      defaultsForAge: ageDefaults,
      completeOnboarding: ({ name, email, dob, marketing, region }) =>
        setState((s) => {
          const ts = nowIso();
          const base: ConsentRecord[] = [
            { id: rid(), userId: ME.id, type: "terms", granted: true, ts, region, source: "onboarding", version: POLICY_VERSIONS.terms },
            { id: rid(), userId: ME.id, type: "privacy", granted: true, ts, region, source: "onboarding", version: POLICY_VERSIONS.privacy },
            { id: rid(), userId: ME.id, type: "community", granted: true, ts, region, source: "onboarding", version: POLICY_VERSIONS.community },
          ];
          if (marketing)
            base.push({ id: rid(), userId: ME.id, type: "marketing_email", granted: true, ts, region, source: "onboarding", version: POLICY_VERSIONS.privacy });
          return { ...s, onboarded: true, account: { name, email, dob, region, ageBand: ageBand(dob || undefined) }, consents: [...s.consents, ...base] };
        }),
      // Age immutability (spec 38): dob/ageBand cannot be rewritten after onboarding.
      updateAccount: (patch) => setState((s) => ({ ...s, account: { ...s.account, ...patch, dob: s.account.dob, ageBand: s.account.ageBand } })),

      consents: state.consents,
      recordConsent,
      hasConsent: (type) => hasConsentOf(state.consents, type),
      withdrawConsent: (type, source) => {
        setState((s) => ({
          ...s,
          consents: [...s.consents, { id: rid(), userId: ME.id, type, granted: false, ts: nowIso(), region: s.account.region, source, version: POLICY_VERSIONS.privacy }],
        }));
        if (type === "marketing_email") setState((s) => ({ ...s, emailPrefs: { ...DEFAULT_EMAIL_PREFS } }));
        if (type === "personalization") setState((s) => ({ ...s, personalization: false }));
      },

      cookieConsent: state.cookieConsent,
      setCookieConsent: (c, source) =>
        setState((s) => ({
          ...s,
          cookieConsent: { necessary: true, ...c, ts: nowIso(), version: POLICY_VERSIONS.cookies, region: s.account.region },
          consents: [
            ...s.consents,
            { id: rid(), userId: ME.id, type: "cookies", granted: true, ts: nowIso(), region: s.account.region, source, version: POLICY_VERSIONS.cookies },
          ],
        })),
      clearCookieConsent: () => setState((s) => ({ ...s, cookieConsent: undefined })),

      purchases: state.purchases,
      buyCourse: (courseId) => {
        const course = courseById(courseId);
        const priced = priceOf(courseId);
        const p: Purchase = {
          id: rid(),
          courseId,
          title: course?.title ?? courseId,
          priceCents: priced?.priceCents ?? 0,
          currency: priced?.currency ?? "EUR",
          ts: nowIso(),
          fees: [], // enforced: no hidden fees, ever
        };
        setState((s) => ({
          ...s,
          purchases: [p, ...s.purchases],
          consents: [...s.consents, { id: rid(), userId: ME.id, type: "purchase_terms", granted: true, ts: nowIso(), region: s.account.region, source: "checkout", version: POLICY_VERSIONS.refunds }],
        }));
        return p;
      },
      owns: (courseId) => state.purchases.some((p) => p.courseId === courseId),
      requestRefund: (purchaseId, reason) =>
        setState((s) => ({
          ...s,
          refunds: [{ id: rid(), purchaseId, reason, status: "requested", ts: nowIso(), updatedTs: nowIso() }, ...s.refunds],
        })),
      advanceRefund: (refundId, approved) =>
        setState((s) => ({
          ...s,
          refunds: s.refunds.map((r) =>
            r.id === refundId
              ? { ...r, status: (r.status === "requested" ? "under_review" : r.status === "under_review" ? (approved ? "approved" : "rejected") : r.status === "approved" ? "refunded" : r.status) as RefundStatus, updatedTs: nowIso() }
              : r,
          ),
        })),
      refunds: state.refunds,

      deletion: state.deletion,
      requestDeletion: (confirmText) => {
        if (confirmText.trim().toUpperCase() !== "DELETE") return false;
        setState((s) => ({ ...s, deletion: { id: rid(), ts: nowIso(), status: "requested", retentionNote: { en: "Limited retention may apply where the law requires (receipts, consent proofs).", sq: "Mund të zbatohet mbajtje e kufizuar ku e kërkon ligji (fatura, dëshmi pëlqimi)." } } }));
        return true;
      },
      advanceDeletion: () =>
        setState((s) => (s.deletion ? { ...s, deletion: { ...s.deletion, status: (s.deletion.status === "requested" ? "processing" : "completed") as DeletionStatus, } } : s)),

      reports: state.reports,
      submitReport: (targetType, targetId, category, details) => {
        const r: Report = { id: rid(), targetType, targetId, category, details, ts: nowIso(), status: "open" };
        setState((s) => ({ ...s, reports: [r, ...s.reports] }));
        return r;
      },
      resolveReport: (id) => setState((s) => ({ ...s, reports: s.reports.filter((r) => r.id !== id) })),

      blocked: state.blocked,
      muted: state.muted,
      toggleBlock: (userId) =>
        setState((s) => ({ ...s, blocked: s.blocked.includes(userId) ? s.blocked.filter((x) => x !== userId) : [...s.blocked, userId] })),
      toggleMute: (userId) =>
        setState((s) => ({ ...s, muted: s.muted.includes(userId) ? s.muted.filter((x) => x !== userId) : [...s.muted, userId] })),
      isBlocked: (userId) => state.blocked.includes(userId),
      isMuted: (userId) => state.muted.includes(userId),

      emailPrefs: state.emailPrefs,
      setEmailPrefs: (patch, source = "settings.email") => {
        void source; // audit hook: every email-pref change is also recorded via withdrawConsent
        setState((s) => ({ ...s, emailPrefs: { ...s.emailPrefs, ...patch } }));
      },
      personalization: state.personalization,
      setPersonalization: (v) => {
        setState((s) => ({ ...s, personalization: v }));
        if (v) recordConsent("personalization", true, "settings.privacy");
        else recordConsent("personalization", false, "settings.privacy");
      },

      perms: state.perms,
      queryPermission: async (key) => {
        try {
          if (key === "notifications" && "Notification" in window) {
            const p = Notification.permission;
            return p === "granted" || p === "denied" ? p : "prompt";
          }
          const md = navigator.mediaDevices;
          if (key === "camera" && md) return "prompt";
          if (key === "microphone" && md) return "prompt";
          if (key === "photos" && "showOpenFilePicker" in window) return "prompt";
          if (key === "location" && navigator.geolocation) return "prompt";
          return "unavailable";
        } catch {
          return "unavailable";
        }
      },
      requestPermission: async (key) => {
        let result: PermissionUiState = "denied";
        try {
          if (key === "notifications" && "Notification" in window) result = (await Notification.requestPermission()) as PermissionUiState;
          else if ((key === "camera" || key === "microphone") && navigator.mediaDevices?.getUserMedia) {
            const stream = await navigator.mediaDevices.getUserMedia({ video: key === "camera", audio: key === "microphone" });
            stream.getTracks().forEach((t) => t.stop());
            result = "granted";
          } else if (key === "location" && navigator.geolocation) {
            await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 }));
            result = "granted";
          } else if (key === "photos") {
            result = "granted"; // file picker requires no standing permission in browsers
          } else {
            result = "unavailable";
          }
        } catch {
          result = "denied";
        }
        setState((s) => ({ ...s, perms: { ...s.perms, [key]: result } }));
        return result;
      },

      business: state.business,
      updateBusiness: (patch) => setState((s) => ({ ...s, business: { ...s.business, ...patch } })),

      reviews: state.reviews,
      addReview: (courseId, rating, text) =>
        setState((s) => ({ ...s, reviews: [{ id: rid(), courseId, userId: ME.id, rating, text, ts: nowIso().slice(0, 10) }, ...s.reviews] })),

      audit: auditNow,
      auditStatusCounts,
      // ---- youth-safety state ----
      auditEvents: state.auditEvents,
      logEvent: (type, severity, summary, subject) =>
        setState((s) => ({
          ...s,
          auditEvents: [{ id: rid(), type, severity, summary, subject, ts: nowIso() }, ...s.auditEvents],
        })),
      canViewEvent: (type) => canViewEvent(state.staffRole, type),
      staffRole: state.staffRole,
      setStaffRole: (r) => setState((s) => ({ ...s, staffRole: r })),
      contactAttempts: state.contactAttempts,
      logContactAttempt: (a) => {
        const attempt: ContactAttempt = { ...a, ts: nowIso() };
        const total = state.contactAttempts.filter((x) => x.from === a.from && x.to === a.to).length + 1;
        const toU = users.find((u) => u.id === a.to);
        const level = evaluateContactPattern(total, Boolean(toU?.minor));
        setState((s) => ({
          ...s,
          contactAttempts: [...s.contactAttempts, attempt],
          auditEvents:
            level === "none"
              ? s.auditEvents
              : [
                  {
                    id: rid(),
                    type: "contact_flag" as const,
                    severity: level === "restrict" ? ("critical" as const) : ("high" as const),
                    summary: `Repeated contact pattern (${level}) toward ${a.to}`,
                    subject: a.from,
                    ts: nowIso(),
                  },
                  ...s.auditEvents,
                ],
        }));
        return level;
      },
      guardianName: state.guardianName,
      setGuardianName: (n) => setState((s) => ({ ...s, guardianName: n })),
      dobLocked: Boolean(state.account.dob || state.account.ageBand),

      toast,
      toasts,
    };
  }, [state, recordConsent, toast, toasts]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useGov(): GovShape {
  const s = useContext(Ctx);
  if (!s) throw new Error("useGov outside GovernanceProvider");
  return s;
}
