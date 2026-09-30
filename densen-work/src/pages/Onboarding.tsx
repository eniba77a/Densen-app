import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "../state/store";
import { useGov } from "../state/governance";
import { ageBand, bandLabel, detectRegion, MIN_ACCOUNT_AGE } from "../data/governance";
import { effectiveDefaults, regionRuleFor } from "../data/safety";
import { IcCheck, IcShield } from "../components/icons";
import { Logo } from "../components/ui";

/**
 * Onboarding = the compliance moment:
 *   Terms + Community (mandatory, one checkbox) — Privacy acknowledged by link —
 *   DOB collected once for age-aware protections (never displayed) —
 *   marketing strictly optional, unchecked by default, never required.
 * Every acceptance is stored with user, version, timestamp, region and source.
 */
export default function Onboarding() {
  const { t, lang } = useStore();
  const { completeOnboarding, cookieConsent, setGuardianName } = useGov();
  const nav = useNavigate();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [dob, setDob] = useState("");
  const [terms, setTerms] = useState(false);
  const [marketing, setMarketing] = useState(false); // never pre-checked
  const [guardian, setGuardian] = useState("");
  const [error, setError] = useState<"" | "terms" | "name" | "dob" | "guardian">("");

  const band = useMemo(() => ageBand(dob || undefined), [dob]);
  const region = useMemo(() => detectRegion(), []);
  const protections = useMemo(() => effectiveDefaults(band, region), [band, region]);
  const regionRule = regionRuleFor(region);
  const needsGuardian = band !== "adult" && protections.parentalConsentRequired;
  const showProtections = dob !== "";

  const submit = (exploreOnly: boolean) => {
    if (exploreOnly) {
      nav("/");
      return;
    }
    if (!name.trim()) return setError("name");
    if (!dob) return setError("dob");
    if (!terms) return setError("terms");
    if (needsGuardian && !guardian.trim()) return setError("guardian");
    setError("");
    completeOnboarding({ name: name.trim(), email: email.trim(), dob, marketing, region: detectRegion() });
    if (needsGuardian) setGuardianName(guardian.trim());
    nav("/");
  };

  void MIN_ACCOUNT_AGE; // region rules drive the floor now (see parentalConsentUnder)

  const dobLockedHint = showProtections ? (
    <p className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>
      🔒 {t("gov.safety.dobLocked")}
    </p>
  ) : null;

  const err = (which: typeof error, msg: string) =>
    error === which ? (
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
        <span className="eyebrow">{t("gov.onb.sub")}</span>
        <h1 style={{ fontSize: 30, fontWeight: 800, margin: "6px 0 22px" }}>{t("gov.onb.title")}</h1>

        <div className="panel" style={{ padding: 18, marginBottom: 14 }}>
          <label className="input-label" htmlFor="onb-name">{t("gov.onb.name")}</label>
          <input id="onb-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" />
          {err("name", t("gov.onb.nameRequired"))}

          <label className="input-label" htmlFor="onb-email" style={{ marginTop: 14 }}>
            {t("gov.onb.email")} <span className="optional-tag">{t("gov.optional")}</span>
          </label>
          <input id="onb-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />

          <label className="input-label" htmlFor="onb-dob" style={{ marginTop: 14 }}>{t("gov.onb.dob")}</label>
          <input
            id="onb-dob"
            className="input"
            type="date"
            value={dob}
            max={new Date().toISOString().slice(0, 10)}
            min={new Date(new Date().setFullYear(new Date().getFullYear() - 100)).toISOString().slice(0, 10)}
            onChange={(e) => setDob(e.target.value)}
            aria-describedby="onb-dob-why"
          />
          <p id="onb-dob-why" className="faint" style={{ fontSize: 12, marginTop: 6 }}>{t("gov.onb.dobWhy")}</p>
          {err("dob", t("gov.onb.dobRequired"))}
          {showProtections && dobLockedHint}

          {showProtections && (
            <div className="panel" style={{ marginTop: 14, padding: 13, borderColor: "var(--gold-line)", background: "var(--gold-soft)" }} aria-live="polite">
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <IcShield size={16} />
                <strong style={{ fontSize: 13 }}>{bandLabel[band][lang]}</strong>
              </div>
              {band !== "adult" && band === "under13" && Number(dob.slice(0, 4)) > new Date().getFullYear() - MIN_ACCOUNT_AGE && (
                <p style={{ fontSize: 12.5, marginBottom: 6 }}>👨‍👩‍👧 {t("gov.safety.parents")}</p>
              )}
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--ink-dim)", display: "grid", gap: 4 }}>
                <li>{protections.privateAccount ? "🔒 " + t("settings.privateAccount") : "🌐 " + t("create.visibilityPublic")}</li>
                <li>💬 {t("settings.allowMessages")}: {protections.messagesFrom === "none" ? t("settings.noOne") : protections.messagesFrom === "followers" ? t("settings.followersOnly") : t("settings.everyone")}</li>
                {!protections.allowDuetFromStrangers && <li>🤝 {t("settings.allowDuet")} — {t("settings.followersOnly")}</li>}
                {!protections.allowLocation && <li>📍 {t("settings.showLocation")} — {t("gov.disabled")}</li>}
                {protections.commentApproval && <li>✅ {t("settings.comments")}</li>}
                <li>🚫 {t("gov.email.promotions")}: {t("gov.disabled")}</li>
                <li>🌍 {t("gov.safety.regionNote")}: {regionRule.label[lang]}</li>
              </ul>
            </div>
          )}
        </div>

        <div className="panel" style={{ padding: 18, marginBottom: 14 }}>
          <div className="checkbox-row">
            <input id="onb-terms" type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
            <label htmlFor="onb-terms">
              {t("gov.onb.terms")}{" "}
              <Link to="/legal/terms" style={{ color: "var(--gold)", fontWeight: 700 }}>{t("gov.readTerms")}</Link>
              {" · "}
              <Link to="/legal/privacy" style={{ color: "var(--gold)", fontWeight: 700 }}>{t("gov.readPrivacy")}</Link>
            </label>
          </div>
          {err("terms", t("gov.onb.termsRequired"))}

          {needsGuardian && (
            <div style={{ marginTop: 14, padding: 13, borderRadius: 12, border: "1px solid var(--gold-line)", background: "var(--gold-soft)" }}>
              <label className="input-label" htmlFor="onb-guardian" style={{ marginTop: 0 }}>
                👨‍👩‍👧 {t("gov.safety.guardianLabel")}
              </label>
              <input
                id="onb-guardian"
                className="input"
                value={guardian}
                onChange={(e) => setGuardian(e.target.value)}
                placeholder={t("gov.safety.guardianPlaceholder")}
                aria-describedby="onb-guardian-why"
              />
              <p id="onb-guardian-why" className="faint" style={{ fontSize: 12, marginTop: 6 }}>
                {t("gov.safety.guardianWhy")}
              </p>
              {err("guardian", t("gov.safety.guardianRequired"))}
            </div>
          )}
          <div className="checkbox-row">
            <input id="onb-marketing" type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
            <label htmlFor="onb-marketing">
              {t("gov.onb.marketing")} <span className="optional-tag">{t("gov.optional")}</span>
            </label>
          </div>
        </div>

        <button className="btn btn-primary" style={{ width: "100%", minHeight: 50, fontSize: 15 }} onClick={() => submit(false)}>
          <IcCheck size={18} /> {t("gov.onb.create")}
        </button>
        <button className="btn btn-ghost" style={{ width: "100%", marginTop: 10 }} onClick={() => submit(true)}>
          {t("gov.onb.explore")}
        </button>

        {!cookieConsent && (
          <p className="faint" style={{ fontSize: 11.5, textAlign: "center", marginTop: 14 }}>
            🍪 {t("gov.cookie.title")} — {t("gov.cookie.manage")}
          </p>
        )}
      </div>
    </div>
  );
}
