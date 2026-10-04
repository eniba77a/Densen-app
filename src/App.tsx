import { Suspense, lazy, useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { AppShell } from "./components/AppShell";
import { StoreProvider, useStore } from "./state/store";
import { GovernanceProvider, useGov } from "./state/governance";
import { CookieBanner } from "./components/gov-ui";
import Home from "./pages/Home";
import Onboarding from "./pages/Onboarding";
import Auth from "./pages/Auth";
import { AuthGate, Login, Forgot, Reset, VerifyEmail } from "./pages/AuthFlow";
import { useAuth } from "./state/auth";

/**
 * Day 22 code splitting (spec §10): the first screen ships Home + core
 * navigation + authentication only. Every other feature — the video feed,
 * editor/upload tools, Arcade, AI Help, admin surfaces — is a separate chunk
 * fetched the first time its route is opened, so the app opens fast and stays
 * light in memory. Same routes, same pages: nothing was removed.
 */
const Feed = lazy(() => import("./pages/Feed"));
const Discover = lazy(() => import("./pages/Discover"));
const Learn = lazy(() => import("./pages/Learn"));
const CourseDetail = lazy(() => import("./pages/CourseDetail"));
const Lesson = lazy(() => import("./pages/Lesson"));
const ProgressPage = lazy(() => import("./pages/Progress"));
const Practice = lazy(() => import("./pages/Practice"));
const Arcade = lazy(() => import("./pages/Arcade"));
const ChallengesPage = lazy(() => import("./pages/Challenges").then((m) => ({ default: m.ChallengesPage })));
const ChallengeDetail = lazy(() => import("./pages/Challenges").then((m) => ({ default: m.ChallengeDetail })));
const EventsPage = lazy(() => import("./pages/EventsLive").then((m) => ({ default: m.EventsPage })));
const LivePage = lazy(() => import("./pages/EventsLive").then((m) => ({ default: m.LivePage })));
const LeaderboardsPage = lazy(() => import("./pages/EventsLive").then((m) => ({ default: m.LeaderboardsPage })));
const MessagesPage = lazy(() => import("./pages/Messages").then((m) => ({ default: m.MessagesPage })));
const ChatPage = lazy(() => import("./pages/Messages").then((m) => ({ default: m.ChatPage })));
const NewChatPage = lazy(() => import("./pages/Messages").then((m) => ({ default: m.NewChatPage })));
const ComposeToUserPage = lazy(() => import("./pages/Messages").then((m) => ({ default: m.ComposeToUserPage })));
const NotificationsRoute = lazy(() => import("./pages/Messages").then((m) => ({ default: m.NotificationsRoute })));
const HelpChatPage = lazy(() => import("./pages/Messages").then((m) => ({ default: m.HelpChatPage })));
const PrivacyCenterLive = lazy(() => import("./pages/PrivacyCenterLive"));
const ModerationCenter = lazy(() => import("./pages/ModerationCenter"));
const UserProfilePage = lazy(() => import("./pages/Profile").then((m) => ({ default: m.UserProfilePage })));
const TeamsPage = lazy(() => import("./pages/Profile").then((m) => ({ default: m.TeamsPage })));
const TeamDetailPage = lazy(() => import("./pages/Profile").then((m) => ({ default: m.TeamDetailPage })));
const Create = lazy(() => import("./pages/Create"));
const Duet = lazy(() => import("./pages/Create").then((m) => ({ default: m.Duet })));
const Remix = lazy(() => import("./pages/Create").then((m) => ({ default: m.Remix })));
const Settings = lazy(() => import("./pages/Settings"));
const Admin = lazy(() => import("./pages/Admin"));
const Studio = lazy(() => import("./pages/Studio"));
const Versions = lazy(() => import("./pages/Versions"));
const Audio = lazy(() => import("./pages/Audio"));
const Account = lazy(() => import("./pages/Account"));
const AdminVerification = lazy(() => import("./pages/AdminVerification"));
const PrivacyCenter = lazy(() => import("./pages/Governance").then((m) => ({ default: m.PrivacyCenter })));
const LegalPage = lazy(() => import("./pages/Governance").then((m) => ({ default: m.LegalPage })));
const SafetyCenter = lazy(() => import("./pages/Governance").then((m) => ({ default: m.SafetyCenter })));
const BusinessPage = lazy(() => import("./pages/Governance").then((m) => ({ default: m.BusinessPage })));
const UnsubscribePage = lazy(() => import("./pages/Governance").then((m) => ({ default: m.UnsubscribePage })));

/** Route chunk fallback: quiet skeleton, never a full-screen loading screen. */
function RouteFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      style={{ minHeight: "55dvh", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <span className="route-loading" aria-hidden="true" style={{ color: "var(--gold)", fontSize: 22, letterSpacing: 4 }}>
        ●●●
      </span>
    </div>
  );
}

/** Signed-in users get the server-backed Privacy Center; guests keep the hub. */
function PrivacyRoute() {
  const { viewer } = useAuth();
  return viewer ? <PrivacyCenterLive /> : <PrivacyCenter />;
}

/** GovernanceProvider sits inside StoreProvider so it can reuse the toast host. */
function Providers({ children }: { children: React.ReactNode }) {
  const { toast, toasts } = useStore();
  return (
    <GovernanceProvider toast={toast} toasts={toasts}>
      {children}
    </GovernanceProvider>
  );
}

function Shell() {
  const { pathname } = useLocation();
  const { onboarded } = useGov();

  // Day 11 — one idempotent platform bootstrap per load: seeds the
  // achievements catalog and the platform challenge rows (queries cannot
  // write in Convex, so seeding is a mutation the shell fires).
  // Day 13 — also seeds the DENSEN-approved music-records starter catalog
  // (idempotent; staff edits always win over the seed).
  const bootstrapPlatform = useMutation(api.challengesWire.bootstrapPlatform);
  const bootstrapMusicRights = useMutation(api.musicRightsWire.bootstrapMusicRights);
  useEffect(() => {
    void bootstrapPlatform({});
    void bootstrapMusicRights({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // First visit: the consent moment. Legal/footer pages stay reachable.
  const isGovernanceRoute = ["/welcome", "/legal", "/privacy", "/safety", "/business", "/unsubscribe"].some((p) => pathname.startsWith(p));
  if (!onboarded && !isGovernanceRoute) {
    return <Onboarding />;
  }

  return (
    <AppShell banner={<CookieBanner />} footer>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/welcome" element={<Onboarding />} />
          <Route path="/register" element={<Auth />} />
          <Route path="/login" element={<Login />} />
          <Route path="/forgot" element={<AuthGate><Forgot /></AuthGate>} />
          <Route path="/reset-password" element={<AuthGate><Reset /></AuthGate>} />
          <Route path="/verify-email" element={<AuthGate><VerifyEmail /></AuthGate>} />
          <Route path="/account" element={<Account />} />
          <Route path="/admin/verification" element={<AdminVerification />} />
          <Route path="/feed" element={<Feed />} />
          <Route path="/discover" element={<Discover />} />
          <Route path="/learn" element={<Learn />} />
          <Route path="/course/:courseId" element={<CourseDetail />} />
          <Route path="/lesson/:courseId/:lessonId" element={<Lesson />} />
          <Route path="/progress" element={<ProgressPage />} />
          <Route path="/practice" element={<Practice />} />
          <Route path="/arcade" element={<Arcade />} />
          <Route path="/challenges" element={<ChallengesPage />} />
          <Route path="/challenge/:challengeId" element={<ChallengeDetail />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/live" element={<LivePage />} />
          <Route path="/leaderboards" element={<LeaderboardsPage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/messages/help" element={<HelpChatPage />} />
          <Route path="/messages/new" element={<NewChatPage />} />
          <Route path="/messages/to/:userId" element={<ComposeToUserPage />} />
          <Route path="/messages/:convId" element={<ChatPage />} />
          <Route path="/notifications" element={<NotificationsRoute />} />
          <Route path="/user/:userId" element={<UserProfilePage />} />
          <Route path="/profile" element={<UserProfilePage />} />
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/team/:teamId" element={<TeamDetailPage />} />
          <Route path="/create" element={<Create />} />
          <Route path="/duet/:postId" element={<Duet />} />
          <Route path="/remix/:postId" element={<Remix />} />
          <Route path="/versions/:postId" element={<Versions />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/studio" element={<Studio />} />
          {/* Day 23 — Teacher Mode destinations: My Lessons + Create */}
          <Route path="/studio/lessons" element={<Studio initialView="lessons" />} />
          <Route path="/studio/new" element={<Studio initialNew="class" />} />
          <Route path="/audio" element={<Audio />} />
          <Route path="/legal/:docId" element={<LegalPage />} />
          <Route path="/privacy" element={<PrivacyRoute />} />
          <Route path="/moderation" element={<ModerationCenter />} />
          <Route path="/safety" element={<SafetyCenter />} />
          <Route path="/business" element={<BusinessPage />} />
          <Route path="/unsubscribe" element={<UnsubscribePage />} />
          <Route path="*" element={<Feed />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Providers>
        <Shell />
      </Providers>
    </StoreProvider>
  );
}
