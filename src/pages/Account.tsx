/**
 * DENSEN — Account page (protected; Day 2).
 * ==========================================
 * Owner-only surface: the caller is the session — there is no way to edit
 * anyone else's profile from here (the backend re-checks ownership anyway).
 * Minors see the age-clamped controls disabled with an explanation.
 */
import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useStore } from "../state/store";
import { useAuth } from "../state/auth";
import { convexUp } from "./AuthFlow";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <span className="input-label">{label}</span>
      {children}
      {hint ? <p className="faint" style={{ fontSize: 11.5, margin: "4px 0 0" }}>{hint}</p> : null}
    </div>
  );
}

export default function Account() {
  const { t } = useStore();
  const { sessionToken, viewer, signOut } = useAuth();
  const nav = useNavigate();

  const me = useQuery(
    api.profiles.getMyProfile,
    sessionToken ? { sessionToken } : "skip"
  );

  const [saved, setSaved] = useState(false);
  const [formErr, setFormErr] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [city, setCity] = useState("");
  const [level, setLevel] = useState("");
  const [styles, setStyles] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [allowDuet, setAllowDuet] = useState(false);
  const [allowRemix, setAllowRemix] = useState(false);
  const [allowDownloads, setAllowDownloads] = useState(false);

  // Hydrate the form once the server profile arrives.
  const hydrated = typeof me === "object" && me !== null && "ok" in me && me.ok;
  useEffect(() => {
    if (hydrated && typeof me === "object" && me !== null && "profile" in me) {
      const p = (me as { profile: Record<string, unknown> | null }).profile;
      if (p) {
        setDisplayName(String(p.displayName ?? ""));
        setBio(String(p.bio ?? ""));
        setCity(String(p.city ?? ""));
        setLevel(String(p.level ?? ""));
        setStyles(Array.isArray(p.styles) ? p.styles.join(", ") : "");
        setIsPrivate(Boolean(p.isPrivate));
        setAllowDuet(Boolean(p.allowDuet));
        setAllowRemix(Boolean(p.allowRemix));
        setAllowDownloads(Boolean(p.allowDownloads));
      }
    }
  }, [hydrated, me]);

  const update = useMutation(api.profiles.updateProfile);
  const resend = useMutation(api.auth.resendVerificationSelf);

  const isMinor = viewer?.isMinor ?? false;

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    if (!sessionToken) return;
    setSaved(false);
    setFormErr("");
    try {
      const res = await update({
        sessionToken,
        patch: {
          displayName,
          bio,
          city: isMinor ? undefined : city,
          level,
          styles: styles.split(",").map((s) => s.trim()).filter(Boolean),
          isPrivate,
          allowDuet,
          allowRemix,
          allowDownloads,
        },
      });
      if ("ok" in res && res.ok) setSaved(true);
      else if ("error" in res) setFormErr(t("account.err.invalid"));
    } catch {
      setFormErr(t("auth.err.network"));
    }
  };

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "22px 18px calc(40px + var(--sab))" }} className="anim-fade">
      <span className="eyebrow">{t("account.eyebrow")}</span>
      <h1 style={{ fontSize: 28, fontWeight: 800, margin: "6px 0 18px" }}>{t("account.title")}</h1>
      {renderState()}
    </div>
  );

  function renderState() {
    if (!convexUp()) return <div className="panel" style={{ padding: 18 }}>{t("auth.offline.body")}</div>;
    if (me === undefined) return <p className="faint" style={{ fontSize: 13 }}>{t("account.loading")}</p>;
    if (!hydrated) return <div className="panel" style={{ padding: 18 }}>{t("account.err.invalid")}</div>;

    const data = me as {
      profile: { handle: string; followerCount: number; followingCount: number; creditBalance: number } | null;
      viewer: { role: string; emailVerified: boolean; ageBand: string };
    };

    return (
      <>
        <div className="panel" style={{ padding: 16, marginBottom: 14 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <span className="chip active">@{data.profile?.handle}</span>
            <span className="chip">{t(data.viewer.role === "teacher" ? "account.role_teacher" : data.viewer.role === "moderator" ? "account.role_moderator" : data.viewer.role === "admin" ? "account.role_admin" : "account.role_user")}</span>
            <span className="chip">{t(data.viewer.ageBand === "child_u13" ? "account.band_child_u13" : data.viewer.ageBand === "teen13_15" ? "account.band_teen13_15" : data.viewer.ageBand === "teen16_17" ? "account.band_teen16_17" : "account.band_adult")}</span>
            {data.viewer.emailVerified ? (
              <span className="chip">{t("account.verified")}</span>
            ) : (
              <button className="chip" style={{ cursor: "pointer" }} onClick={() => sessionToken && resend({ sessionToken })}>
                {t("account.resend_verify")}
              </button>
            )}
          </div>
          <p className="faint" style={{ fontSize: 12, margin: "10px 0 0" }}>
            {t("account.followers")}: {data.profile?.followerCount ?? 0} · {t("account.following")}: {data.profile?.followingCount ?? 0} · {t("account.credits")}: {data.profile?.creditBalance ?? 0}
          </p>
        </div>
        {profileForm()}
        {sessionToken ? <ChangePassword sessionToken={sessionToken} /> : null}
        <button className="btn" style={{ width: "100%", justifyContent: "center", marginTop: 14 }} onClick={doSignOut}>
          {t("account.signout")}
        </button>
      </>
    );
  }

  function profileForm() {
    return (
      <form onSubmit={saveProfile} className="panel" style={{ padding: 16, marginBottom: 14 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, margin: "0 0 4px" }}>{t("account.profile_h")}</h2>
        <p className="faint" style={{ fontSize: 11.5, margin: "0 0 6px" }}>{t("account.handle_immutable")}</p>
        <Field label={t("auth.first_name")}>
          <input className="input" value={displayName} maxLength={40} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label={t("account.bio")} hint={`${bio.length}/280`}>
          <input className="input" value={bio} maxLength={280} onChange={(e) => setBio(e.target.value)} />
        </Field>
        <Field label={t("account.styles")}>
          <input className="input" value={styles} onChange={(e) => setStyles(e.target.value)} placeholder="hip hop, contemporary" />
        </Field>
        <Field label={t("account.level")}>
          <select className="input" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">{t("account.level_unset")}</option>
            <option value="beginner">{t("learn.beginner")}</option>
            <option value="intermediate">{t("learn.intermediate")}</option>
            <option value="advanced">{t("learn.advanced")}</option>
            <option value="pro">{t("account.level_pro")}</option>
          </select>
        </Field>
        <Field label={t("gov.settings.locationCity")} hint={isMinor ? t("account.city_minor_note") : t("gov.settings.locationCitySub")}>
          <input className="input" value={city} maxLength={60} disabled={isMinor} onChange={(e) => setCity(e.target.value)} />
        </Field>
        <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--muted)" }}>
            <input type="checkbox" checked={isPrivate} disabled={isMinor} onChange={(e) => setIsPrivate(e.target.checked)} />
            {t("settings.privateAccount")} {isMinor ? `· ${t("gov.reuse.offBySafety")}` : ""}
          </label>
          {(["allowDuet", "allowRemix", "allowDownloads"] as const).map((key) => (
            <label key={key} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--muted)" }}>
              <input
                type="checkbox"
                checked={key === "allowDuet" ? allowDuet : key === "allowRemix" ? allowRemix : allowDownloads}
                disabled={isMinor}
                onChange={(e) =>
                  key === "allowDuet" ? setAllowDuet(e.target.checked) : key === "allowRemix" ? setAllowRemix(e.target.checked) : setAllowDownloads(e.target.checked)
                }
              />
              {t(key === "allowDuet" ? "gov.reuse.duet" : key === "allowRemix" ? "gov.reuse.remix" : "gov.reuse.download")}
              {isMinor ? ` · ${t("gov.reuse.offBySafety")}` : ""}
            </label>
          ))}
        </div>
        {formErr ? <p role="alert" style={{ color: "var(--err)", fontSize: 12.5, fontWeight: 700, marginTop: 10 }}>⚠ {formErr}</p> : null}
        {saved ? <p style={{ color: "var(--ok, #4ade80)", fontSize: 12.5, fontWeight: 700, marginTop: 10 }}>✓ {t("settings.saved")}</p> : null}
        <button type="submit" className="btn" style={{ width: "100%", justifyContent: "center", marginTop: 14 }}>{t("settings.save")}</button>
      </form>
    );
  }

  async function doSignOut() {
    await signOut();
    nav("/");
  }
}

/* ---------------------- Change password (authenticated) ---------------------- */

function ChangePassword({ sessionToken }: { sessionToken: string }) {
  const { t } = useStore();
  const changePw = useMutation(api.auth.changePassword);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg("");
    setOk(false);
    if (next !== confirm) {
      setMsg(t("reset.err.mismatch"));
      return;
    }
    setBusy(true);
    try {
      const res = await changePw({ sessionToken, currentPassword: current, newPassword: next });
      if ("ok" in res && res.ok) {
        setOk(true);
        setMsg(t("reset.done"));
        setCurrent("");
        setNext("");
        setConfirm("");
      } else if ("error" in res) {
        setMsg(res.error === "wrong_current" ? t("account.pw_wrong_current") : t("auth.err.password_weak"));
      }
    } catch {
      setMsg(t("auth.err.network"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="panel" style={{ padding: 16, marginBottom: 14 }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, margin: "0 0 4px" }}>{t("account.pw_h")}</h2>
      <p className="faint" style={{ fontSize: 11.5, margin: "0 0 6px" }}>{t("account.pw_sub")}</p>
      <Field label={t("account.pw_current")}>
        <input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
      </Field>
      <Field label={t("auth.password")} hint={t("auth.password_hint")}>
        <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
      </Field>
      <Field label={t("reset.confirm")}>
        <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </Field>
      {msg ? (
        <p role={ok ? undefined : "alert"} style={{ color: ok ? "var(--ok, #4ade80)" : "var(--err)", fontSize: 12.5, fontWeight: 700, marginTop: 10 }}>
          {ok ? "✓ " : "⚠ "}{msg}
        </p>
      ) : null}
      <button type="submit" className="btn" disabled={busy} style={{ width: "100%", justifyContent: "center", marginTop: 14 }}>
        {busy ? t("login.busy") : t("account.pw_submit")}
      </button>
    </form>
  );
}
