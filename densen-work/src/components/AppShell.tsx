import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { conversations, notifications } from "../data/store";
import { ME, useStore } from "../state/store";
import { useAuth } from "../state/auth";
import { Avatar, Logo, ToastHost } from "./ui";
import {
  IcBell,
  IcCalendar,
  IcCompass,
  IcFlame,
  IcPractice,
  IcHome,
  IcLearn,
  IcMessage,
  IcPlay,
  IcPlus,
  IcSearch,
  IcSettings,
  IcShield,
  IcTrophy,
  IcUser,
  IcUsers,
} from "./icons";
import type { TKey } from "../i18n";

const unreadNotifs = notifications.filter((n) => !n.read).length;
const unreadChats = conversations.length;

/**
 * Day 16 — live unread counts from the server when signed in; the prototype
 * mirrors stay the guest fallback. Bell + chat dots are real state now.
 */
function useLiveBadges(sessionToken: string | null): { notifs: number; chats: number } {
  const notifData = useQuery(
    api.notificationsWire.listMyNotifications,
    sessionToken ? { sessionToken, limit: 1 } : "skip"
  );
  const convoData = useQuery(
    api.messagingWire.listMyConversations,
    sessionToken ? { sessionToken } : "skip"
  );
  if (!sessionToken) return { notifs: unreadNotifs, chats: unreadChats };
  const notifs = notifData && typeof notifData === "object" && "ok" in notifData && notifData.ok ? notifData.unread : 0;
  const chats =
    convoData && typeof convoData === "object" && "ok" in convoData && convoData.ok
      ? (convoData.conversations as { unread: number }[]).reduce((n, c) => n + c.unread, 0)
      : 0;
  return { notifs, chats };
}

function useTKey() {
  const { t } = useStore();
  return t;
}

/* ---------------- top bar ---------------- */
function TopBar() {
  const t = useTKey();
  const nav = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const { sessionToken } = useAuth();
  const badges = useLiveBadges(sessionToken);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        background: scrolled ? "rgba(11,13,16,0.86)" : "transparent",
        backdropFilter: scrolled ? "blur(16px)" : undefined,
        borderBottom: scrolled ? "1px solid var(--line)" : "1px solid transparent",
        transition: "background 0.25s ease, border-color 0.25s ease",
      }}
    >
      <div
        style={{
          maxWidth: 1160,
          margin: "0 auto",
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <NavLink to="/" style={{ textDecoration: "none", color: "inherit" }}>
          <Logo />
        </NavLink>
        <div style={{ flex: 1 }} />
        <button
          className="btn btn-icon btn-ghost"
          onClick={() => nav("/discover")}
          aria-label={t("common.search")}
        >
          <IcSearch />
        </button>
        <button
          className="btn btn-icon btn-ghost"
          onClick={() => nav("/messages")}
          aria-label={t("nav.messages")}
          style={{ position: "relative" }}
        >
          <IcMessage />
          {badges.chats > 0 && <RedDot />}
        </button>
        <button
          className="btn btn-icon btn-ghost"
          onClick={() => nav("/notifications")}
          aria-label={t("nav.notifications")}
          style={{ position: "relative" }}
        >
          <IcBell />
          {badges.notifs > 0 && <RedDot />}
        </button>
        <button onClick={() => nav("/profile")} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
          <Avatar src={ME.avatar} size={34} ring />
        </button>
        <AuthStatus />
      </div>
    </header>
  );
}

/** Real authentication state in the chrome: account chip when signed in, sign-in link when not. */
function AuthStatus() {
  const { t } = useStore();
  const nav = useNavigate();
  const { viewer } = useAuth();
  if (!viewer) {
    return (
      <button className="btn" style={{ padding: "6px 12px", fontSize: 12.5 }} onClick={() => nav("/login?returnTo=%2Faccount")}>
        {t("login.submit")}
      </button>
    );
  }
  return (
    <button className="chip active" style={{ cursor: "pointer" }} onClick={() => nav("/account")} title={t("account.title")}>
      @{viewer.handle ?? t("account.title")}
    </button>
  );
}

const RedDot = () => (
  <span
    style={{
      position: "absolute",
      top: 7,
      right: 7,
      width: 8,
      height: 8,
      borderRadius: "50%",
      background: "var(--gold)",
      border: "2px solid var(--bg)",
    }}
  />
);

/* ---------------- desktop sidebar ---------------- */
const SIDE_LINKS: { to: string; icon: (p: { size?: number; filled?: boolean }) => JSX.Element; key: TKey }[] = [
  { to: "/", icon: IcHome, key: "nav.home" },
  { to: "/discover", icon: IcCompass, key: "nav.discover" },
  { to: "/learn", icon: IcLearn, key: "nav.learn" },
  { to: "/challenges", icon: IcTrophy, key: "nav.challenges" },
  { to: "/events", icon: IcCalendar, key: "nav.events" },
  { to: "/teams", icon: IcUsers, key: "nav.teams" },
  { to: "/progress", icon: IcFlame, key: "nav.progress" },
  { to: "/practice", icon: IcPractice, key: "nav.practice" },
  { to: "/arcade", icon: IcTrophy, key: "nav.arcade" },
  { to: "/profile", icon: IcUser, key: "nav.profile" },
  { to: "/studio", icon: IcLearn, key: "studio.title" },
];

function Sidebar() {
  const t = useTKey();
  const nav = useNavigate();
  return (
    <aside
      className="show-desktop"
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        bottom: 0,
        width: 232,
        flexDirection: "column",
        padding: "20px 14px",
        borderRight: "1px solid var(--line)",
        background: "var(--bg-soft)",
        zIndex: 90,
        gap: 2,
      }}
    >
      <NavLink to="/" style={{ padding: "6px 10px 18px", textDecoration: "none", color: "inherit" }}>
        <Logo size={22} />
      </NavLink>
      {SIDE_LINKS.map(({ to, icon: Icon, key }) => (
        <SideLink key={to} to={to} icon={<Icon size={21} />} label={t(key)} />
      ))}
      <div style={{ flex: 1 }} />
      <SideLink to="/moderation" icon={<IcShield size={21} />} label={t("mod.title")} />
      <SideLink to="/admin" icon={<IcShield size={21} />} label={t("nav.admin")} />
      <SideLink to="/settings" icon={<IcSettings size={21} />} label={t("nav.settings")} />
      <button
        className="btn btn-primary"
        style={{ marginTop: 10, width: "100%" }}
        onClick={() => nav("/create")}
      >
        <IcPlus size={18} /> {t("nav.create")}
      </button>
    </aside>
  );
}

function SideLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      style={({ isActive }) => ({
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "11px 12px",
        borderRadius: 13,
        textDecoration: "none",
        color: isActive ? "var(--gold)" : "var(--ink-dim)",
        background: isActive ? "var(--gold-soft)" : "transparent",
        fontWeight: 700,
        fontSize: 14,
        transition: "all 0.18s ease",
      })}
    >
      {icon}
      {label}
    </NavLink>
  );
}

/* ---------------- mobile bottom nav ---------------- */
function BottomNav() {
  const t = useTKey();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const item = (to: string, icon: React.ReactNode, label: string, center?: boolean) => {
    const active = center ? pathname === to : pathname === to;
    return (
      <button
        key={to}
        onClick={() => nav(to)}
        style={{
          flex: center ? "0 0 auto" : 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 3,
          background: "none",
          border: "none",
          color: active ? "var(--gold)" : "var(--ink-faint)",
          fontSize: 10,
          fontWeight: 700,
          cursor: "pointer",
          padding: 0,
        }}
      >
        {center ? (
          <span
            style={{
              width: 52,
              height: 52,
              marginTop: -26,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #f0c75e, var(--gold) 55%, #cf9a35)",
              color: "#171204",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 8px 24px rgba(227,179,65,0.4)",
              border: "3px solid var(--bg)",
            }}
          >
            {icon}
          </span>
        ) : (
          icon
        )}
        <span>{label}</span>
      </button>
    );
  };

  return (
    <nav
      className="hide-desktop"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "flex-end",
        padding: "10px 10px calc(10px + var(--sab))",
        background: "rgba(11,13,16,0.92)",
        backdropFilter: "blur(18px)",
        borderTop: "1px solid var(--line)",
      }}
    >
      {item("/", <IcHome size={22} />, t("nav.home"))}
      {item("/feed", <IcPlay size={22} />, "Feed")}
      {item("/create", <IcPlus size={26} />, t("nav.create"), true)}
      {item("/discover", <IcCompass size={22} />, t("nav.discover"))}
      {item("/profile", <IcUser size={22} />, t("nav.profile"))}
    </nav>
  );
}

/* ---------------- legal footer ---------------- */
function GovFooter() {
  const { t, lang } = useStore();
  const nav = useNavigate();
  const links: [string, string][] = [
    ["/legal/terms", t("gov.readTerms")],
    ["/legal/privacy", t("gov.readPrivacy")],
    ["/legal/cookies", t("gov.cookie.prefsTitle")],
    ["/legal/refunds", "Refunds"],
    ["/privacy", t("gov.privacyCenter")],
    ["/safety", t("gov.safetyCenter")],
    ["/business", t("gov.businessInfo")],
  ];
  return (
    <footer
      className="hide-desktop"
      style={{ borderTop: "1px solid var(--line)", padding: "18px 16px calc(90px + var(--sab))", background: "var(--bg-soft)" }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {links.map(([to, label]) => (
          <button key={to} className="chip" style={{ fontSize: 11.5, padding: "5px 10px" }} onClick={() => nav(to)}>
            {label}
          </button>
        ))}
        <button className="chip" style={{ fontSize: 11.5, padding: "5px 10px" }} onClick={() => nav("/unsubscribe")}>
          ✉️ {lang === "sq" ? "Çregjistrohu" : "Unsubscribe"}
        </button>
      </div>
      <p className="faint" style={{ fontSize: 11, lineHeight: 1.6, marginTop: 12 }}>{t("gov.footer.note")}</p>
    </footer>
  );
}

/* ---------------- shell ---------------- */
export function AppShell({
  children,
  banner,
  footer,
}: {
  children: React.ReactNode;
  banner?: React.ReactNode;
  footer?: boolean;
}) {
  const { pathname } = useLocation();
  const isFeed = pathname === "/";

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div style={{ minHeight: "100dvh", background: "var(--bg)" }}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <TopBar />
      <Sidebar />
      {banner}
      <main
        id="main-content"
        style={{
          maxWidth: isFeed ? undefined : 1160,
          margin: "0 auto",
        }}
      >
        {children}
      </main>
      {footer && <GovFooter />}
      <BottomNav />
      <ToastHost />
    </div>
  );
}
