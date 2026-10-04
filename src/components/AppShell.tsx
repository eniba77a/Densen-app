import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { conversations, notifications } from "../data/store";
import { ME, useStore } from "../state/store";
import { useAuth } from "../state/auth";
import { effectiveMode, type AppMode } from "../lib/mode";
import { Avatar, Logo, ToastHost } from "./ui";
import {
  IcBell,
  IcCompass,
  IcFlame,
  IcHome,
  IcLearn,
  IcMessage,
  IcPlus,
  IcSearch,
  IcSettings,
  IcShield,
  IcTrophy,
  IcUser,
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

/**
 * Day 23 — the active experience. The PREFERENCE is a client setting; the
 * PERMISSION is the server session role. effectiveMode never lets a dancer
 * render Teacher Mode, and switching modes never grants any role.
 */
function useMode(): AppMode {
  const { viewer } = useAuth();
  const { settings } = useStore();
  return effectiveMode(settings.mode, viewer);
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
/**
 * Day 22 simplification: the main navigation is the same five sections on
 * mobile and desktop (Home · Learn · Create · Messages · Profile). Everything
 * else stays reachable one level inside those sections — Arcade lives in
 * Learn, credits in Profile/Account, challenges & events from Home quick
 * actions — instead of being permanent top-level destinations.
 */
/**
 * Day 23 — mode-specific navigation, ≤5 primary destinations each:
 *   Dancer:  Home · Explore · Learn · Messages · Profile
 *   Teacher: Dashboard · My Lessons · Create · Messages · Profile
 * Secondary features live one level inside these sections (Home quick
 * actions, Profile, sidebar “more” links) — never as extra tabs.
 */
type NavItem = { to: string; icon: (p: { size?: number; filled?: boolean }) => JSX.Element; key: TKey; exact?: boolean };

const DANCER_SIDE: NavItem[] = [
  { to: "/", icon: IcHome, key: "nav.home", exact: true },
  { to: "/discover", icon: IcCompass, key: "nav.explore" },
  { to: "/learn", icon: IcLearn, key: "nav.learn" },
  { to: "/messages", icon: IcMessage, key: "nav.messages" },
  { to: "/profile", icon: IcUser, key: "nav.profile" },
];

const TEACHER_SIDE: NavItem[] = [
  { to: "/studio", icon: IcFlame, key: "nav.dashboard", exact: true },
  { to: "/studio/lessons", icon: IcLearn, key: "nav.myLessons" },
  { to: "/messages", icon: IcMessage, key: "nav.messages" },
  { to: "/profile", icon: IcUser, key: "nav.profile" },
];

const SIDE_MORE_LINKS: NavItem[] = [
  { to: "/arcade", icon: IcTrophy, key: "nav.arcade" },
  { to: "/progress", icon: IcFlame, key: "nav.progress" },
];

function Sidebar() {
  const t = useTKey();
  const nav = useNavigate();
  const mode = useMode();
  const links = mode === "teacher" ? TEACHER_SIDE : DANCER_SIDE;
  const createTo = mode === "teacher" ? "/studio/new" : "/create";
  const createLabel = mode === "teacher" ? t("studio.create") : t("nav.create");
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
      {links.map(({ to, icon: Icon, key }) => (
        <SideLink key={key} to={to} icon={<Icon size={21} />} label={t(key)} />
      ))}
      <button
        onClick={() => nav(createTo)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          margin: "4px 0 10px",
          padding: "10px 12px",
          borderRadius: 13,
          border: "none",
          background: "linear-gradient(135deg, #f0c75e, var(--gold) 55%, var(--gold-deep))",
          color: "var(--gold-ink)",
          fontWeight: 800,
          fontSize: 14,
          cursor: "pointer",
        }}
      >
        <IcPlus size={18} /> {createLabel}
      </button>
      {SIDE_MORE_LINKS.map(({ to, icon: Icon, key }) => (
        <SideLink key={to} to={to} icon={<Icon size={21} />} label={t(key)} />
      ))}
      <div style={{ flex: 1 }} />
      <SideLink to="/moderation" icon={<IcShield size={21} />} label={t("mod.title")} />
      <SideLink to="/admin" icon={<IcShield size={21} />} label={t("nav.admin")} />
      <SideLink to="/settings" icon={<IcSettings size={21} />} label={t("nav.settings")} />
    </aside>
  );
}

/**
 * Sidebar link with Day 23 query-aware active state (Dashboard vs My Lessons
 * are both on /studio — the ?view param decides which one highlights).
 */
function SideLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  const { pathname, search } = useLocation();
  const [basePath, query = ""] = to.split("?");
  const active = query
    ? pathname === basePath && search.includes(query)
    : basePath === "/"
      ? pathname === "/"
      : pathname === basePath || pathname.startsWith(basePath + "/");
  return (
    <NavLink
      to={to}
      end={basePath === "/"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "11px 12px",
        borderRadius: 13,
        textDecoration: "none",
        color: active ? "var(--gold)" : "var(--ink-dim)",
        background: active ? "var(--gold-soft)" : "transparent",
        fontWeight: 700,
        fontSize: 14,
        transition: "all 0.18s ease",
      }}
    >
      {icon}
      {label}
    </NavLink>
  );
}

/* ---------------- mobile bottom nav ---------------- */
/**
 * Day 23 — five primary destinations per mode:
 *   Dancer:  Home · Explore · Learn · Messages · Profile
 *   Teacher: Dashboard · My Lessons · Create · Messages · Profile
 * Everything else lives one level inside these sections.
 */
function BottomNav() {
  const t = useTKey();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const mode = useMode();
  const item = (to: string, icon: React.ReactNode, label: string, center?: boolean) => {
    const active = pathname === to;
    return (
      <button
        key={to}
        onClick={() => nav(to)}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        style={{
          flex: center ? "0 0 auto" : 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 3,
          background: "none",
          border: "none",
          color: active ? "var(--gold)" : "var(--ink-faint)",
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
          padding: "6px 0 4px",
          minHeight: 52,
        }}
      >
        {center ? (
          <span
            aria-hidden="true"
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
          <span aria-hidden="true" style={{ display: "flex" }}>{icon}</span>
        )}
        <span>{label}</span>
      </button>
    );
  };

  return (
    <nav
      className="hide-desktop"
      aria-label={t("nav.home")}
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
      {mode === "teacher" ? (
        <>
          {item("/studio", <IcFlame size={22} />, t("nav.dashboard"))}
          {item("/studio/lessons", <IcLearn size={22} />, t("nav.myLessons"))}
          {item("/studio/new", <IcPlus size={26} />, t("studio.create"), true)}
          {item("/messages", <IcMessage size={22} />, t("nav.messages"))}
          {item("/profile", <IcUser size={22} />, t("nav.profile"))}
        </>
      ) : (
        <>
          {item("/", <IcHome size={22} />, t("nav.home"))}
          {item("/discover", <IcCompass size={22} />, t("nav.explore"))}
          {item("/learn", <IcLearn size={22} />, t("nav.learn"), true)}
          {item("/messages", <IcMessage size={22} />, t("nav.messages"))}
          {item("/profile", <IcUser size={22} />, t("nav.profile"))}
        </>
      )}
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
