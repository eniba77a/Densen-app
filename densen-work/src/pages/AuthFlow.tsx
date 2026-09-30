/**
 * DENSEN — Auth flow pages (Day 2): login, forgot, reset, verify-email.
 * ======================================================================
 * All flows call the real backend mutations. Errors are generic where the
 * server is deliberately vague (anti-enumeration). When the backend is not
 * connected, AuthGate renders an honest offline notice — never fake auth.
 */
import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useStore } from "../state/store";
import { useAuth } from "../state/auth";
import { Logo } from "../components/ui";

export function convexUp(): boolean {
  return Boolean((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_CONVEX_URL);
}

function AuthChrome({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <div style={{ minHeight: "100dvh", background: "var(--bg)", padding: "26px 18px calc(30px + var(--sab))" }}>
      <div style={{ maxWidth: 460, margin: "0 auto" }} className="anim-fade">
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
          <Logo size={30} />
        </div>
        <span className="eyebrow">{eyebrow}</span>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: "6px 0 22px" }}>{title}</h1>
        {children}
      </div>
    </div>
  );
}

function Err({ msg }: { msg: string }) {
  if (!msg) return null;
  return (
    <p role="alert" style={{ color: "var(--err)", fontSize: 12.5, fontWeight: 700, marginTop: 6 }}>
      ⚠ {msg}
    </p>
  );
}

function OfflineNotice() {
  const { t } = useStore();
  return (
    <AuthChrome eyebrow={t("auth.sub")} title={t("auth.title")}>
      <div className="panel" style={{ padding: 18 }}>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--muted)", margin: "0 0 12px" }}>{t("auth.offline.body")}</p>
        <p className="faint" style={{ fontSize: 12, margin: 0 }}>{t("auth.offline.hint")}</p>
      </div>
      <p className="faint" style={{ fontSize: 12, textAlign: "center", marginTop: 16 }}>
        <Link to="/" style={{ color: "var(--gold)", fontWeight: 700 }}>← {t("login.back_home")}</Link>
      </p>
    </AuthChrome>
  );
}

/** Route-level gate: renders the page only when the backend is connected. */
export function AuthGate({ children }: { children: ReactNode }) {
  return convexUp() ? <>{children}</> : <OfflineNotice />;
}

/** Login may render without the gate (it degrades gracefully via useAuth). */
export function redirectSafe(returnTo: string): string {
  return returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
}

/* ------------------------------ Login ------------------------------ */

export function Login() {
  const { t } = useStore();
  const { signIn, viewer } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const returnTo = redirectSafe(params.get("returnTo") || "/");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Already signed in → straight to the intended destination.
  useEffect(() => {
    if (viewer) nav(returnTo, { replace: true });
  }, [viewer, returnTo, nav]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.trim() || !password) {
      setError(t("login.err.required"));
      return;
    }
    setBusy(true);
    const res = await signIn(email.trim(), password);
    setBusy(false);
    if (!res.ok) setError(t("login.err.invalid"));
    else nav(returnTo, { replace: true });
  };

  return (
    <AuthChrome eyebrow={t("auth.sub")} title={t("login.title")}>
      <form onSubmit={submit} className="panel" style={{ padding: 18, marginBottom: 14 }}>
        <label className="input-label" htmlFor="li-email">{t("gov.onb.email")}</label>
        <input id="li-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <label className="input-label" htmlFor="li-password" style={{ marginTop: 14 }}>{t("auth.password")}</label>
        <input id="li-password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        <Err msg={error} />
        <button type="submit" className="btn" disabled={busy} style={{ width: "100%", marginTop: 16, justifyContent: "center" }}>
          {busy ? t("login.busy") : t("login.submit")}
        </button>
      </form>
      <p className="faint" style={{ fontSize: 12, textAlign: "center" }}>
        <Link to="/forgot" style={{ color: "var(--gold)", fontWeight: 700 }}>{t("login.forgot")}</Link>
        {" · "}
        <Link to="/register" style={{ color: "var(--gold)", fontWeight: 700 }}>{t("login.no_account")}</Link>
      </p>
      <p className="faint" style={{ fontSize: 12, textAlign: "center", marginTop: 8 }}>
        <Link to="/" style={{ color: "var(--gold)", fontWeight: 700 }}>← {t("login.back_home")}</Link>
      </p>
    </AuthChrome>
  );
}

/* ------------------------------ Forgot ------------------------------ */

export function Forgot() {
  const { t } = useStore();
  const request = useMutation(api.auth.requestPasswordReset);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.trim()) {
      setError(t("login.err.required"));
      return;
    }
    setBusy(true);
    try {
      await request({ email: email.trim() }); // identical response either way
      setDone(true);
    } catch {
      setError(t("auth.err.network"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthChrome eyebrow={t("auth.sub")} title={t("forgot.title")}>
      {done ? (
        <div className="panel" style={{ padding: 18 }}>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--muted)", margin: 0 }}>{t("forgot.sent")}</p>
        </div>
      ) : (
        <form onSubmit={submit} className="panel" style={{ padding: 18 }}>
          <p className="faint" style={{ fontSize: 12.5, marginTop: 0 }}>{t("forgot.sub")}</p>
          <label className="input-label" htmlFor="fg-email">{t("gov.onb.email")}</label>
          <input id="fg-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          <Err msg={error} />
          <button type="submit" className="btn" disabled={busy} style={{ width: "100%", marginTop: 16, justifyContent: "center" }}>
            {busy ? t("login.busy") : t("forgot.submit")}
</button>
        </form>
      )}
      <p className="faint" style={{ fontSize: 12, textAlign: "center", marginTop: 16 }}>
        <Link to="/login" style={{ color: "var(--gold)", fontWeight: 700 }}>← {t("login.back_to_login")}</Link>
      </p>
    </AuthChrome>
  );
}

/* ------------------------------ Reset ------------------------------ */

export function Reset() {
  const { t } = useStore();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const reset = useMutation(api.auth.resetPassword);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError(t("reset.err.mismatch"));
      return;
    }
    setBusy(true);
    try {
      const res = await reset({ token, newPassword: password });
      if (res?.ok) setDone(true);
      else setError(res?.error === "invalid_password" ? t("auth.err.password_weak") : t("reset.err.invalid"));
    } catch {
      setError(t("auth.err.network"));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AuthChrome eyebrow={t("auth.sub")} title={t("reset.title")}>
        <div className="panel" style={{ padding: 18 }}>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--muted)", margin: 0 }}>{t("reset.done")}</p>
          <button className="btn" style={{ width: "100%", justifyContent: "center", marginTop: 12 }} onClick={() => nav("/login")}>
            {t("login.back_to_login")}
          </button>
        </div>
      </AuthChrome>
    );
  }

  return (
    <AuthChrome eyebrow={t("auth.sub")} title={t("reset.title")}>
      {!token ? (
        <div className="panel" style={{ padding: 18 }}>
          <p style={{ fontSize: 14, color: "var(--muted)", margin: 0 }}>{t("reset.missing_token")}</p>
        </div>
      ) : (
        <form onSubmit={submit} className="panel" style={{ padding: 18 }}>
          <label className="input-label" htmlFor="rp-password">{t("auth.password")} <span className="optional-tag">{t("auth.password_hint")}</span></label>
          <input id="rp-password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          <label className="input-label" htmlFor="rp-confirm" style={{ marginTop: 14 }}>{t("reset.confirm")}</label>
          <input id="rp-confirm" className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          <Err msg={error} />
          <button type="submit" className="btn" disabled={busy} style={{ width: "100%", marginTop: 16, justifyContent: "center" }}>
            {busy ? t("login.busy") : t("reset.submit")}
          </button>
        </form>
      )}
      <p className="faint" style={{ fontSize: 12, textAlign: "center", marginTop: 16 }}>
        <Link to="/login" style={{ color: "var(--gold)", fontWeight: 700 }}>← {t("login.back_to_login")}</Link>
      </p>
    </AuthChrome>
  );
}

/* ---------------------------- VerifyEmail ---------------------------- */

export function VerifyEmail() {
  const { t } = useStore();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const verify = useMutation(api.auth.verifyEmail);
  const [state, setState] = useState<"working" | "ok" | "invalid" | "no_token">("working");

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setState("no_token");
      return;
    }
    verify({ token })
      .then((res) => {
        if (cancelled) return;
        setState(res?.ok ? "ok" : "invalid");
      })
      .catch(() => {
        if (!cancelled) setState("invalid");
      });
    return () => {
      cancelled = true;
    };
  }, [token, verify]);

  return (
    <AuthChrome eyebrow={t("auth.sub")} title={t("verify.title")}>
      <div className="panel" style={{ padding: 18 }}>
        <p style={{ fontSize: 14, color: "var(--muted)", margin: 0 }}>
          {state === "ok" ? t("verify.done") : state === "invalid" ? t("verify.invalid") : state === "no_token" ? t("verify.no_token") : t("verify.working")}
        </p>
        <p className="faint" style={{ fontSize: 12, marginTop: 10 }}>{t("verify.sub")}</p>
        {state === "ok" || state === "invalid" ? (
          <Link to="/login" className="btn" style={{ display: "inline-flex", marginTop: 14, justifyContent: "center" }}>
            {t("login.back_to_login")}
          </Link>
        ) : null}
      </div>
    </AuthChrome>
  );
}
