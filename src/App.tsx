import { Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { StoreProvider, useStore } from "./state/store";
import { GovernanceProvider, useGov } from "./state/governance";
import { CookieBanner } from "./components/gov-ui";
import Home from "./pages/Home";
import Feed from "./pages/Feed";
import Discover from "./pages/Discover";
import Learn from "./pages/Learn";
import CourseDetail from "./pages/CourseDetail";
import Lesson from "./pages/Lesson";
import ProgressPage from "./pages/Progress";
import { ChallengesPage, ChallengeDetail } from "./pages/Challenges";
import { EventsPage, LivePage, LeaderboardsPage } from "./pages/EventsLive";
import { MessagesPage, ChatPage, NotificationsPage } from "./pages/Messages";
import { UserProfilePage, TeamsPage, TeamDetailPage } from "./pages/Profile";
import Create, { Duet } from "./pages/Create";
import Settings from "./pages/Settings";
import Admin from "./pages/Admin";
import Versions from "./pages/Versions";
import Audio from "./pages/Audio";
import Onboarding from "./pages/Onboarding";
import { PrivacyCenter, LegalPage, SafetyCenter, BusinessPage, UnsubscribePage } from "./pages/Governance";

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

  // First visit: the consent moment. Legal/footer pages stay reachable.
  const isGovernanceRoute = ["/welcome", "/legal", "/privacy", "/safety", "/business", "/unsubscribe"].some((p) => pathname.startsWith(p));
  if (!onboarded && !isGovernanceRoute) {
    return <Onboarding />;
  }

  return (
    <AppShell banner={<CookieBanner />} footer>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/welcome" element={<Onboarding />} />
        <Route path="/feed" element={<Feed />} />
        <Route path="/discover" element={<Discover />} />
        <Route path="/learn" element={<Learn />} />
        <Route path="/course/:courseId" element={<CourseDetail />} />
        <Route path="/lesson/:courseId/:lessonId" element={<Lesson />} />
        <Route path="/progress" element={<ProgressPage />} />
        <Route path="/challenges" element={<ChallengesPage />} />
        <Route path="/challenge/:challengeId" element={<ChallengeDetail />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/live" element={<LivePage />} />
        <Route path="/leaderboards" element={<LeaderboardsPage />} />
        <Route path="/messages" element={<MessagesPage />} />
        <Route path="/messages/:convId" element={<ChatPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/user/:userId" element={<UserProfilePage />} />
        <Route path="/profile" element={<UserProfilePage />} />
        <Route path="/teams" element={<TeamsPage />} />
        <Route path="/team/:teamId" element={<TeamDetailPage />} />
        <Route path="/create" element={<Create />} />
        <Route path="/duet/:postId" element={<Duet />} />
        <Route path="/versions/:postId" element={<Versions />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/audio" element={<Audio />} />
        <Route path="/legal/:docId" element={<LegalPage />} />
        <Route path="/privacy" element={<PrivacyCenter />} />
        <Route path="/safety" element={<SafetyCenter />} />
        <Route path="/business" element={<BusinessPage />} />
        <Route path="/unsubscribe" element={<UnsubscribePage />} />
        <Route path="*" element={<Feed />} />
      </Routes>
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
