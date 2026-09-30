/**
 * DENSEN — Registration (signUp) page.
 * =====================================
 * Wire-in: `auth.signUp` (convex/auth.ts) via `useMutation`. One submit →
 * user + profile + privacySettings + authAccounts + verification token +
 * audit entry in a single Convex transaction, with server-side age assurance
 * and youth-safety defaults (AUTH-PLAN.md §3/§5). The client only validates
 * for UX; the server re-decides everything (never trusts the client).
 *
 * When VITE_CONVEX_URL is unset the Convex layer is unmounted — `useMutation`
 * requires a provider — so this file splits into an offline shell (honest
 * explanation, NO fake submission) and the live form. No fake auth, per
 * project rules.
 */
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useStore } from "../state/store";
import { ageBand, bandLabel, type AgeBand } from "../data/governance";
import { Logo } from "../components/ui";
import { IcCheck, IcShield } from "../components/icons";
import { ageBandFromDob, HANDLE_PATTERN, type ServerAgeBand } from "../../convex/authInternals";

type SignUpResult =
  | { ok: true; userId: string; profileId: string; teacherProfileId?: string; isMinor: boolean; emailSent: boolean }
  | { ok: false; error: string };

/** Map the server band vocabulary to the client's (child_u13 → under13). */
const toClientBand = (b: ServerAgeBand): AgeBand => (b === "child_u13" ? "under13" : b);

/** Client-side mirror of the server password policy (authInternals.checkPassword). */
function clientPasswordCheck(pw: string): string | null {
  if (pw.length < 10) return "password_short";
  if (pw.length > 128) return "password_long";
  if (!/\p{L}/u.test(pw)) return "password_letter";
  if (!/\d/.test(pw)) return "password_digit";
  return null;
}

const handleOk = (h: string) => HANDLE_PATTERN.test(h.trim().toLowerCase());

/* ------------------------------------------------------------------ */
/*                       Offline (unconfigured) shell                   */
/* ------------------------------------------------------------------ */

function AuthOffline() {
  const { t } = useStore();
  return (
    <div style={{ minHeight: "100dvh", background: "var(--bg)", padding: "26px 18px calc(30px + var(--sab))" }}>
      <div style={{ maxWidth: 560, margin: "0 auto" }} className="anim-fade">
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
          <Logo size={30} />
        </div>
        <span className="eyebrow">{t("auth.sub")}</span>
        <h1 style={{ fontSize: 30, fontWeight: 800, margin: "6px 0 22px" }}>{t("auth.title")}</h1>
        <div className="panel" style={{ padding: 18 }}>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--muted)", margin: "0 0 12px" }}>{t("auth.offline.body")}</p>
          <p className="faint" style={{ fontSize: 12, margin: 0 }}>{t("auth.offline.hint")}</p>
        </div>
        <p className="faint" style={{ fontSize: 12, textAlign: "center", marginTop: 16 }}>
          {t("auth.have_account")} <Link to="/welcome" style={{ color: "var(--gold)", fontWeight: 700 }}>Densen</Link>
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*                            Live sign-up form                         */
/* ------------------------------------------------------------------ */

function SignUpForm() {
  const { t, lang } = useStore();
  const nav = useNavigate();
  const signUp = useMutation(api.auth.signUp);

  const [firstName, setFirstName] = useState("");
  const [handle, setHandle] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [dob, setDob] = useState("");
  const [wantsTeacher, setWantsTeacher] = useState(false);
  const [guardian, setGuardian] = useState("");
  const [city, setCity] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState("");

  // Consents — each document is a SEPARATE checkbox. Required acceptances start
  // unchecked; optional consents (marketing/personalization) are never
  // pre-checked and marketing is not offerable to minors (server-enforced).
  const [consentTerms, setConsentTerms] = useState(false);
  const [consentPrivacy, setConsentPrivacy] = useState(false);
  const [consentGuidelines, setConsentGuidelines] = useState(false);
  const [consentMarketing, setConsentMarketing] = useState(false);

  const band = useMemo(() => ageBand(dob || undefined), [dob]);
  const serverBand = useMemo(() => (dob ? ageBandFromDob(dob, new Date()) : null), [dob]);
  const previewBand: AgeBand | null =
    serverBand && !("error" in serverBand) ? toClientBand(serverBand.band) : null;

  const needsGuardian = band === "under13";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorKey("");

    // ---- Client-side checks (UX only; the server re-validates everything) ----
    if (!firstName.trim()) return setErrorKey("invalid_first_name");
    if (!handleOk(handle)) return setErrorKey("invalid_handle");
    if (!/^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/.test(email.trim())) return setErrorKey("invalid_email");
    const pwErr = clientPasswordCheck(password);
    if (pwErr) return setErrorKey(pwErr);
    if (!dob) return setErrorKey("invalid_dob");
    if (needsGuardian && !guardian.trim()) return setErrorKey("guardian_required");
    if (!consentTerms || !consentPrivacy || !consentGuidelines) return setErrorKey("consent_required");

    setSubmitting(true);
    try {
      const res: SignUpResult = await signUp({
        firstName: firstName.trim(),
        handle: handle.trim().toLowerCase(),
        email: email.trim(),
        password, // plaintext travels only over TLS to Convex; hashed server-side
        dob,
        wantsTeacher,
        guardianName: needsGuardian ? guardian.trim() : undefined,
        city: city.trim() || undefined,
        acceptedTerms: consentTerms,
        acceptedPrivacy: consentPrivacy,
        acceptedGuidelines: consentGuidelines,
      });
      if (res.ok) {
        nav("/"); // sign-in is the next module (AUTH-PLAN.md §3); land on Home
      } else {
        setErrorKey(res.error);
      }
    } catch {
      setErrorKey("network");
    } finally {
      setSubmitting(false);
    }
  };

  const err = (which: string, msg: string) =>
    errorKey === which ? (
      <p role="alert" style={{ color: "var(--err)", fontSize: 12.5, fontWeight: 700, marginTop: 6 }}>
        ⚠ {msg}
      </p>
    ) : null;

  return (
    <div style={{ minHeight: "100dvh", background: "var(--bg)", padding: "26px 18px calc(30px + var(--sab))" }}>
      <div style={{ maxWidth: 560, margin: "0 auto" }} className="anim-fade">
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
          <Logo size={30} />
        </div>
        <span className="eyebrow">{t("auth.sub")}</span>
        <h1 style={{ fontSize: 30, fontWeight: 800, margin: "6px 0 22px" }}>{t("auth.title")}</h1>

        <form onSubmit={submit} className="panel" style={{ padding: 18, marginBottom: 14 }}>
          <label className="input-label" htmlFor="su-name">{t("auth.first_name")}</label>
          <input id="su-name" className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" maxLength={40} />
          {err("invalid_first_name", t("auth.err.name"))}

          <label className="input-label" htmlFor="su-handle" style={{ marginTop: 14 }}>
            {t("auth.handle")} <span className="optional-tag">@</span>
          </label>
          <input id="su-handle" className="input" value={handle} onChange={(e) => setHandle(e.target.value)} autoComplete="username" maxLength={24} placeholder="dancer_01" />
          {err("invalid_handle", t("auth.err.handle"))}
          {err("handle_taken", t("auth.err.handle_taken"))}

          <label className="input-label" htmlFor="su-email" style={{ marginTop: 14 }}>{t("gov.onb.email")}</label>
          <input id="su-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          {err("invalid_email", t("auth.err.email"))}
          {err("email_taken", t("auth.err.email_taken"))}

          <label className="input-label" htmlFor="su-password" style={{ marginTop: 14 }}>
            {t("auth.password")} <span className="optional-tag">{t("auth.password_hint")}</span>
          </label>
          <input id="su-password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" maxLength={128} />
          {err("password_short", t("auth.err.password_short"))}
          {err("password_letter", t("auth.err.password_letter"))}
          {err("password_digit", t("auth.err.password_digit"))}
          {err("invalid_password", t("auth.err.password_weak"))}
          {err("password_breach", t("auth.err.password_breach"))}

          <label className="input-label" htmlFor="su-dob" style={{ marginTop: 14 }}>{t("gov.onb.dob")}</label>
          <input id="su-dob" className="input" type="date" value={dob} onChange={(e) => setDob(e.target.value)} autoComplete="bday" max={new Date().toISOString().slice(0, 10)} />
          {err("invalid_dob", t("gov.onb.dobRequired"))}
          <p className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>🔒 {t("gov.safety.dobLocked")}</p>

          {/* Age preview + youth protections (informational; the server enforces) */}
          {previewBand ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
              <span className="chip"><IcShield size={13} /> {bandLabel[previewBand][lang]}</span>
              {previewBand !== "adult" ? (
                <span className="chip"><IcCheck size={13} /> {t("auth.prot.private")}</span>
              ) : null}
              <span className="chip">
                <IcCheck size={13} /> {t("auth.prot.messaging")}: {previewBand === "under13" || previewBand === "teen13_15" ? t("auth.prot.msg_none") : t("auth.prot.msg_followers")}
              </span>
            </div>
          ) : null}

          {needsGuardian ? (
            <>
              <label className="input-label" htmlFor="su-guardian" style={{ marginTop: 14 }}>
                {t("gov.safety.guardianLabel")} <span className="optional-tag">{t("gov.required")}</span>
              </label>
              <input id="su-guardian" className="input" value={guardian} onChange={(e) => setGuardian(e.target.value)} autoComplete="off" maxLength={40} />
              {err("guardian_required", t("gov.safety.guardianRequired"))}
              {err("guardian_invalid", t("auth.err.guardian_invalid"))}
              <p className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>{t("gov.safety.guardianWhy")}</p>
            </>
          ) : null}

          <label className="input-label" htmlFor="su-city" style={{ marginTop: 14 }}>
            {t("gov.profile.cityOptional")} <span className="optional-tag">{t("gov.optional")}</span>
          </label>
          <input id="su-city" className="input" value={city} onChange={(e) => setCity(e.target.value)} maxLength={60} />
          {err("invalid_city", t("auth.err.city"))}

          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 16, fontSize: 13, color: "var(--muted)", cursor: "pointer" }}>
            <input type="checkbox" checked={wantsTeacher} onChange={(e) => setWantsTeacher(e.target.checked)} disabled={band !== "adult"} style={{ marginTop: 2 }} />
            <span>
              {t("auth.teacher_intent")}
              <span className="faint" style={{ display: "block", fontSize: 11.5, marginTop: 2 }}>{t("auth.teacher_intent_sub")}</span>
            </span>
          </label>

          {/* Consent — separate checkbox per document; optional ones unchecked */}
          <div style={{ marginTop: 18, padding: "14px 0 2px", borderTop: "1px solid var(--line)" }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{t("auth.consent.title")}</div>
            {([
              ["terms", consentTerms, setConsentTerms, true, false],
              ["privacy", consentPrivacy, setConsentPrivacy, true, false],
              ["guidelines", consentGuidelines, setConsentGuidelines, true, false],
              ["marketing", consentMarketing, setConsentMarketing, false, band !== "adult"],
            ] as const).map(([key, checked, set, required, locked]) => (
              <label key={key} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 8, fontSize: 12.5, color: "var(--muted)", cursor: locked ? "default" : "pointer", opacity: locked ? 0.55 : 1 }}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={locked}
                  onChange={(e) => set(e.target.checked)}
                  style={{ marginTop: 2 }}
                  aria-label={t(`auth.consent.${key}` as never)}
                />
                <span>
                  {t(`auth.consent.${key}` as never)}{" "}
                  {required && <span className="required-tag">{t("auth.consent.required")}</span>}
                  {locked && <span className="faint" style={{ fontSize: 11 }}>· {t("privacy.live.locked")}</span>}
                </span>
              </label>
            ))}
            <p className="faint" style={{ fontSize: 11.5, margin: "2px 0 0" }}>{t("auth.consent.note")}</p>
          </div>

          <button type="submit" className="btn" disabled={submitting} style={{ width: "100%", marginTop: 18, justifyContent: "center" }}>
            {submitting ? t("auth.submitting") : t("auth.submit")}
          </button>
          {err("network", t("auth.err.network"))}
          {err("generic", t("auth.err.generic"))}
          {err("teacher_intent_minor", t("auth.err.teacher_minor"))}
          {err("consent_required", t("auth.err.consent_required"))}
        </form>

        <p className="faint" style={{ fontSize: 12, textAlign: "center" }}>
          {t("auth.have_account")} <Link to="/welcome" style={{ color: "var(--gold)", fontWeight: 700 }}>Densen</Link>
        </p>
      </div>
    </div>
  );
}

export default function Auth() {
  const convexConfigured = Boolean((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_CONVEX_URL);
  return convexConfigured ? <SignUpForm /> : <AuthOffline />;
}
