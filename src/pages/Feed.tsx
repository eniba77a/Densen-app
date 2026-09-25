import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { audios, challenges, courseById, fmt, userById, users, type Post } from "../data/store";
import { useAuth } from "../state/auth";
import { ME, useStore } from "../state/store";
import { useGov } from "../state/governance";
import { ReportModal, tx } from "../components/gov-ui";
import { ActionBtn, Avatar } from "../components/ui";
import {
  IcBoost,
  IcChallenge,
  IcClean,
  IcDuet,
  IcEnergy,
  IcExpand,
  IcInsane,
  IcMove,
  IcMusic,
  IcOnPoint,
  IcPlay,
  IcPower,
  IcPractice,
  IcRemix,
  IcShrink,
  IcTalk,
  IcVibe,
  IcVolume,
  IcVolumeOff,
} from "../components/icons";
import { QUICK_REACTIONS, type QuickReaction } from "../../convex/interactions";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  scanComment,
  scanGrooming,
  canReuse,
  type CommentScan,
} from "../data/safety";
import {
  buildForYou,
  buildFollowing,
  FEED_PAGE_SIZE,
  paginate,
  type CourseLevel,
  type FeedReasonKind,
  type FeedSignals,
  type FeedPostInput,
} from "../data/feedCore";
import type { TKey } from "../i18n";

/* ============================ For-You signals ============================ */

/**
 * Real viewer signals — every input comes from actual state the viewer
 * generated (likes, follows, progress, recents, saves, joined challenges).
 * The derived course styles feed the recommendation core; nothing here is
 * hardcoded preference data.
 */
function useFeedSignals(): FeedSignals {
  const { liked, saved, following, joinedChallenges, recent, courseProgress, allPosts } = useStore();

  return useMemo(() => {
    const byId = new Map(allPosts.map((p) => [p.id, p]));
    const styles = new Set<string>(ME.styles);
    // styles of posts the viewer actually liked (engagement signal)
    for (const id of liked) {
      const p = byId.get(id);
      if (p) styles.add(p.style);
    }
    // styles of saved courses + saved posts
    for (const id of saved) {
      const course = courseById(id);
      if (course) styles.add(course.style);
      const post = byId.get(id);
      if (post) styles.add(post.style);
    }
    // in-progress + recently opened courses (classes watched / practice activity)
    const inProgress = new Set<string>();
    const recentCourses = new Set<string>();
    for (const r of recent) {
      recentCourses.add(r.courseId);
      if (courseProgress(r.courseId) > 0) inProgress.add(r.courseId);
    }
    for (const id of inProgress) {
      const c = courseById(id);
      if (c) styles.add(c.style);
    }
    // styles of challenges the viewer joined
    const challengeStyles = new Set<string>();
    for (const chId of joinedChallenges) {
      const ch = challengeById(chId);
      if (ch) challengeStyles.add(ch.style);
    }
    return {
      viewerStyleIds: [...styles],
      followedUserIds: following,
      joinedChallengeStyles: [...challengeStyles],
      inProgressCourseIds: inProgress,
      recentCourseIds: recentCourses,
    };
  }, [liked, saved, following, joinedChallenges, recent, courseProgress, allPosts]);
}

const challengesById = new Map(challenges.map((c) => [c.id, c]));
const challengeById = (id: string) => challengesById.get(id);

/* ============================ comments ============================ */

const AVATAR_FALLBACK = ME.avatar;

/**
 * 💬 TALK — reactive comment count for the dance, straight from the Convex
 * `comments` table (visible rows only). Updates the moment any comment is
 * committed — no refresh, no local mirror.
 */
function TalkCountButton({ postId, fallback, onOpen }: { postId: string; fallback: number; onOpen: () => void }) {
  const { t } = useStore();
  const data = useQuery(api.content.listComments, { postId });
  const count =
    data && typeof data === "object" && "ok" in data && data.ok
      ? (data.comments as unknown[]).length
      : fallback;
  return <ActionBtn icon={<IcTalk size={24} />} label={fmt(count)} onClick={onOpen} aria-label={t("act.talk")} />;
}

/**
 * One row of the live Convex-backed comment thread: DENSEN Talk content with
 * the 6-reaction quick sheet anchored to the ✦ button (server-persisted).
 */
function LiveCommentRow({ c, targetIsMinor, onReacted }: { c: LiveComment; targetIsMinor: boolean; onReacted: () => void }) {
  const { t, lang } = useStore();
  const { toast, isBlocked, toggleBlock } = useGov();
  const { sessionToken } = useAuth();
  const serverBlock = useMutation(api.moderationWire.blockUser);
  const [quickOpen, setQuickOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  void targetIsMinor; // verdicts are server-side; kept for parity with previews

  // Day 15 — real server block when signed in; local toggle otherwise.
  const doBlock = () => {
    toggleBlock(c.author.handle);
    if (sessionToken && c.author.userId) {
      void serverBlock({ sessionToken, targetUserId: c.author.userId }).catch(() => undefined);
    }
    toast(isBlocked(c.author.handle) ? t("gov.msg.unblocked") : t("gov.msg.blockedToast"));
    onReacted();
  };

  // Blocked authors' rows collapse (report/block always available).
  if (isBlocked(c.author.handle)) {
    return (
      <div style={{ display: "flex", gap: 10, opacity: 0.55 }}>
        <Avatar src={c.author.avatarUrl ?? AVATAR_FALLBACK} size={34} />
        <div style={{ flex: 1 }}>
          <div className="faint" style={{ fontSize: 12, fontWeight: 700 }}>@{c.author.handle}</div>
          <div style={{ fontSize: 13, color: "var(--ink-faint)", fontStyle: "italic" }}>🛡 {t("gov.comment.autoHidden")}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 10 }}>
      <Avatar src={c.author.avatarUrl ?? AVATAR_FALLBACK} size={34} />
      <div style={{ flex: 1 }}>
        <div className="faint" style={{ fontSize: 12, fontWeight: 700 }}>@{c.author.handle} · {relTime(c.createdAt, lang)}</div>
        <div style={{ fontSize: 14, marginTop: 3 }}>{c.body}</div>
      </div>
      <div style={{ display: "flex", gap: 2, alignItems: "flex-start", position: "relative" }}>
        <button
          onClick={() => setQuickOpen((o) => !o)}
          aria-label={t("act.energy")}
          title={t("act.energy")}
          style={{ background: "none", border: "none", color: "var(--ink-faint)", cursor: "pointer", fontSize: 12, padding: 4 }}
        >
          ✦
        </button>
        <button
          onClick={() => setReporting(true)}
          aria-label={`${t("settings.report")} @${c.author.handle}`}
          title={t("settings.report")}
          style={{ background: "none", border: "none", color: "var(--ink-faint)", cursor: "pointer", fontSize: 12, padding: 4 }}
        >
          🚩
        </button>
        <button onClick={doBlock} aria-label={`${t("gov.msg.block")} @${c.author.handle}`} title={t("gov.msg.block")} style={{ background: "none", border: "none", color: "var(--ink-faint)", cursor: "pointer", fontSize: 13, padding: 4 }}>
          🚫
        </button>
        {quickOpen && <QuickReactionBar commentId={c.id} onDone={() => setQuickOpen(false)} />}
        {reporting && (
          <ReportModal open onClose={() => setReporting(false)} targetType="comment" targetId={c.id} targetLabel={`@${c.author.handle}`} />
        )}
      </div>
    </div>
  );
}

interface LiveComment {
  id: string;
  body: string;
  createdAt: number;
  author: { handle: string; displayName: string; avatarUrl?: string; userId?: string };
}

function relTime(ts: number, lang: string): string {
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60_000);
  if (lang === "sq") return m < 1 ? "tani" : m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
  return m < 1 ? "now" : m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
}

/**
 * Dance-specific comment feed (Talk layer) — backed by the Convex `comments`
 * table for the active dance. Live via useQuery; submission persists through
 * `content.createComment` (server scan is the gate) and appears immediately
 * via the reactive subscription. Guest mode reads the thread but cannot post.
 */
function CommentSheet({ post, onClose }: { post: Post; onClose: () => void }) {
  const { t, lang } = useStore();
  const { toast } = useGov();
  const { sessionToken, viewer } = useAuth();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  // LIVE comment feed for this dance from Convex.
  const data = useQuery(api.content.listComments, { postId: post.id });
  const liveComments: LiveComment[] =
    data && typeof data === "object" && "ok" in data && data.ok
      ? (data.comments as (LiveComment & { authorUserId?: string })[]).map((c) => ({
          ...c,
          author: { ...c.author, userId: c.authorUserId },
        }))
      : [];

  // Seed comments from the demo data still render (prototype parity), merged
  // under the live thread — real Convex rows are the source of truth.
  const seedComments = post.comments.map((c) => ({
    id: c.id,
    body: c.text,
    createdAt: Date.now(),
    author: (() => {
      const u = userById(c.userId);
      return { handle: u.username, displayName: u.name, avatarUrl: u.avatar };
    })(),
    mine: c.userId === "me",
  }));

  const createComment = useMutation(api.content.createComment);

  // Target audience matters: stricter filter when the post author is a minor.
  const targetIsMinor = Boolean(userById(post.userId).minor);
  const myScan: CommentScan = scanComment(text, targetIsMinor);
  const groom: ReturnType<typeof scanGrooming> = scanGrooming(text);

  const tryPost = async () => {
    const clean = text.trim();
    if (!clean || sending) return;
    if (groom.severity === "critical") {
      toast(`🚨 ${t("gov.comment.groomingBlocked")}`);
      return;
    }
    if (myScan.verdict === "blocked") {
      toast(`⚠ ${t("gov.comment.blocked")} — ${myScan.matched.map((m) => tx(m, lang)).join(" · ")}`);
      return;
    }
    if (!sessionToken) {
      toast(t("comment.signInToPost"));
      return;
    }
    setSending(true);
    try {
      const res = (await createComment({ sessionToken, postId: post.id, body: clean })) as {
        ok: boolean;
        status?: string;
        error?: string;
      };
      if (!res.ok) {
        const map: Record<string, string> = {
          unauthenticated: "comment.signInToPost",
          blocked: "act.blocked",
          author_privacy: "comment.authorPrivacy",
          post_unavailable: "act.denied",
          caller_restricted: "act.denied",
          invalid_body: "act.denied",
        };
        const key = (res.error && map[res.error]) || "act.denied";
        toast(t(key as TKey));
      } else {
        if (res.status === "hidden") toast(`👁 ${t("gov.comment.hidden")} — ${myScan.matched.map((m) => tx(m, lang)).join(" · ")}`);
        else toast(t("comment.posted"));
        setText("");
      }
    } catch {
      toast(t("act.denied"));
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 150, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="anim-rise"
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          maxHeight: "70dvh",
          background: "var(--panel)",
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          borderTop: "1px solid var(--line-strong)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ padding: "16px 18px 10px", textAlign: "center", fontWeight: 700, borderBottom: "1px solid var(--line)" }}>
          {fmt(seedComments.length + liveComments.length)} {t("common.comment")}
        </div>
        <div style={{ overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>
          {seedComments.map((c) => (
            <div key={c.id} style={{ display: "flex", gap: 10 }}>
              <Avatar src={c.author.avatarUrl} size={34} />
              <div style={{ flex: 1 }}>
                <div className="faint" style={{ fontSize: 12, fontWeight: 700 }}>@{c.author.handle} · {t("common.now")}</div>
                <div style={{ fontSize: 14, marginTop: 3 }}>{c.body}</div>
              </div>
            </div>
          ))}
          {data === undefined && <div className="faint" style={{ textAlign: "center", fontSize: 12.5 }}>…</div>}
          {liveComments.map((c) => (
            <LiveCommentRow key={c.id} c={c} targetIsMinor={targetIsMinor} onReacted={() => undefined} />
          ))}
          {data && typeof data === "object" && "ok" in data && data.ok && liveComments.length === 0 && seedComments.length === 0 && (
            <div className="faint" style={{ textAlign: "center", fontSize: 13, padding: "18px 0" }}>{t("comment.empty")}</div>
          )}
        </div>
        <div style={{ padding: "12px 16px calc(12px + var(--sab))", borderTop: "1px solid var(--line)", display: "flex", gap: 10 }}>
          <Avatar src={viewer?.avatarUrl || ME.avatar} size={34} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <input
              className="input"
              placeholder={sessionToken ? `${t("common.comment")}…` : t("comment.signInToPost")}
              value={text}
              disabled={!sessionToken || sending}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void tryPost();
              }}
            />
            {text.trim().length > 0 && myScan.verdict !== "clean" && (
              <div className="faint" style={{ fontSize: 12 }}>
                🛡 {myScan.verdict === "blocked" ? t("gov.comment.blocked") : t("gov.comment.hidden")}
                {myScan.matched.length > 0 && ` — ${myScan.matched.map((m) => tx(m, lang)).join(" · ")}`}
              </div>
            )}
            <button className="btn btn-primary btn-sm" onClick={() => void tryPost()} disabled={!sessionToken || sending || !text.trim()} style={{ alignSelf: "flex-end", opacity: !sessionToken || sending || !text.trim() ? 0.55 : 1 }}>
              {sending ? "…" : t("common.post")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


/* ============================ video surface ============================ */

const LEVEL_KEY: Record<CourseLevel, TKey> = {
  Beginner: "learn.beginner",
  Intermediate: "learn.intermediate",
  Advanced: "learn.advanced",
  Kids: "learn.kids",
};

const WHY_KEY: Record<FeedReasonKind, TKey> = {
  style_match: "feed.why.style_match",
  teacher_followed: "feed.why.teacher_followed",
  challenge_mate: "feed.why.challenge_mate",
  course_connection: "feed.why.course_connection",
  trending: "feed.why.trending",
};

function WhyChip({ kind, style, t }: { kind: FeedReasonKind; style?: string; t: (k: TKey, v?: Record<string, string | number>) => string }) {
  const label = t(WHY_KEY[kind], kind === "style_match" ? { style: style ?? "" } : undefined);
  return (
    <span
      className="faint"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11.5,
        fontWeight: 700,
        color: "var(--gold)",
        background: "rgba(227,179,65,0.12)",
        border: "1px solid rgba(227,179,65,0.25)",
        padding: "3px 9px",
        borderRadius: 999,
        marginBottom: 8,
      }}
    >
      ✦ {label}
    </span>
  );
}

/**
 * DENSEN feed surface: the video fills the stage; chrome recedes until you
 * interact. First tap anywhere plays with sound (mobile autoplay policy),
 * the controls are gold-ringed, and the level chip comes from the linked
 * course when the post teaches a move.
 */
function FeedCard({
  post,
  active,
  near,
  reasons,
  level,
}: {
  post: Post;
  active: boolean;
  /** True when the card sits inside the lazy-mount window around the viewport. */
  near: boolean;
  reasons: FeedReasonKind[];
  level?: CourseLevel;
}) {
  const { t, liked, saved, following, toggleFollow, toast } = useStore();
  const { isBlocked } = useGov();
  const nav = useNavigate();
  const u = userById(post.userId);
  const audio = audios.find((a) => a.id === post.audioId)!;
  const [showComments, setShowComments] = useState(false);
  const [reporting, setReporting] = useState(false);
  const vidRef = useRef<HTMLVideoElement>(null);
  const [sound, setSound] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [fs, setFs] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  // Youth-safety: creators can disable duets. The duet button respects it.
  const duetAllowed = canReuse(users.find((x) => x.id === post.userId)?.minor ? "teen13_15" : "adult", undefined, "duet");

  const { sessionToken } = useAuth();
  const interact = useMutation(api.interactionsWire.interact);
  // Day 12 — the PRACTICE action also creates the real MY PRACTICE item
  // (idempotent server-side per contentRef) so saves live in the workspace.
  const savePractice = useMutation(api.practiceWire.saveItem);

  // REACTIVE DENSEN counters + my active interactions — a live Convex
  // subscription. Any interaction by anyone (this device or another) updates
  // these counts immediately, no page refresh, no local mirrors.
  const liveData = useQuery(
    api.interactionsWire.getPostInteractions,
    sessionToken ? { sessionToken, postId: post.id } : "skip"
  );
  const liveCounts: Record<string, number> =
    liveData && typeof liveData === "object" && "ok" in liveData && liveData.ok
      ? (liveData.counts as Record<string, number>)
      : {};
  const mineSet: Set<string> =
    liveData && typeof liveData === "object" && "ok" in liveData && liveData.ok
      ? new Set(liveData.mine as string[])
      : new Set();

  /**
   * Fire a DENSEN interaction at the server (anti-spam/anti-farm live there).
   * The reactive subscription above re-renders the counts the moment the
   * mutation commits — no local state mirroring. XP toasts only when the
   * server actually granted first-time XP.
   */
  const doAction = async (action: "energy" | "move" | "practice" | "boost" | "challenge", okToast: string, deniedToast?: string) => {
    if (!sessionToken) {
      toast(t("act.denied"));
      return;
    }
    try {
      const res = (await interact({ sessionToken, postId: post.id, action })) as {
        ok: boolean;
        error?: string;
        active?: boolean;
        xpGranted?: number;
      };
      if (!res.ok) {
        if (res.error === "boost_daily_limit" && deniedToast) toast(deniedToast);
        else if (res.error === "blocked") toast(t("act.blocked"));
        else if (res.error === "rate_limited") toast(t("act.rateLimited"));
        else toast(t("act.denied"));
        return;
      }
      if (res.xpGranted && res.xpGranted > 0) toast(t("act.xp", { n: res.xpGranted }));
      toast(okToast);
    } catch {
      toast(t("act.denied"));
    }
  };

  // Autoplay when visible; pause + rewind when leaving the viewport.
  useEffect(() => {
    const v = vidRef.current;
    if (!v || !near) return;
    if (active) {
      v.muted = !sound;
      v.play().then(
        () => setPlaying(true),
        () => setPlaying(false)
      );
    } else {
      v.pause();
      v.currentTime = 0;
      setPlaying(false);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    }
    // sound intentionally excluded: the muted-flag effect below owns it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, near]);

  // Keep the muted flag in sync without restarting playback.
  useEffect(() => {
    const v = vidRef.current;
    if (v) v.muted = !sound;
  }, [sound]);

  // Fullscreen state lives in the DOM; mirror it so the icon can swap.
  useEffect(() => {
    const onFs = () => setFs(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Blocked users' posts never render — after every hook (rules of hooks).
  if (isBlocked(post.userId)) return null;

  const isLiked = liked.has(post.id);
  const isSaved = saved.has(post.id);
  const isFollowing = following.has(post.userId);
  const likeCount = post.likes + (isLiked ? 1 : 0);

  const togglePlay = () => {
    const v = vidRef.current;
    if (!v) return;
    if (v.paused) {
      v.muted = !sound;
      v.play().then(
        () => setPlaying(true),
        () => setPlaying(false)
      );
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  const toggleFullscreen = () => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
    } else {
      el.requestFullscreen?.().catch(() => undefined);
    }
  };

  return (
    <div
      ref={stageRef}
      className="feed-item"
      style={{ height: "100%", position: "relative", overflow: "hidden", background: "#000" }}
    >
      {/* poster layer: shown until the video can paint (lazy-load cover) */}
      {!loaded && (
        <img
          src={post.cover}
          alt=""
          loading="lazy"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}
      {/* Lazy loading: far cards keep the poster only (preload none + no
          decoded video); the browser fetches the stream as the card nears
          the viewport. */}
      <video
        ref={vidRef}
        src={near ? post.video : undefined}
        poster={post.cover}
        loop
        muted
        playsInline
        preload={active ? "auto" : near ? "metadata" : "none"}
        onLoadedData={() => setLoaded(true)}
        onClick={togglePlay}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      {!playing && (
        <button
          onClick={togglePlay}
          aria-label={t("common.play")}
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.18)",
            border: "none",
            cursor: "pointer",
            zIndex: 3,
          }}
        >
          <span
            style={{
              width: 74,
              height: 74,
              borderRadius: "50%",
              background: "rgba(19,16,7,0.55)",
              border: "2px solid var(--gold)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--gold)",
              backdropFilter: "blur(2px)",
            }}
          >
            <IcPlay size={30} />
          </span>
        </button>
      )}
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, transparent 22%, transparent 55%, rgba(0,0,0,0.78) 100%)", pointerEvents: "none" }} />

      {/* player controls: sound + fullscreen */}
      <div style={{ position: "absolute", top: 66, right: 12, display: "flex", flexDirection: "column", gap: 8, zIndex: 6 }}>
        <button
          onClick={() => setSound((s) => !s)}
          aria-label={sound ? t("feed.soundOn") : t("feed.soundOff")}
          title={sound ? t("feed.soundOn") : t("feed.soundOff")}
          style={{
            width: 38,
            height: 38,
            borderRadius: "50%",
            background: "rgba(19,16,7,0.55)",
            border: "1px solid rgba(255,255,255,0.22)",
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          {sound ? <IcVolume size={18} filled /> : <IcVolumeOff size={18} />}
        </button>
        <button
          onClick={toggleFullscreen}
          aria-label={fs ? t("feed.exitFullscreen") : t("feed.fullscreen")}
          title={fs ? t("feed.exitFullscreen") : t("feed.fullscreen")}
          style={{
            width: 38,
            height: 38,
            borderRadius: "50%",
            background: "rgba(19,16,7,0.55)",
            border: "1px solid rgba(255,255,255,0.22)",
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          {fs ? <IcShrink size={18} /> : <IcExpand size={18} />}
        </button>
      </div>

      {/* right action rail */}
      <div style={{ position: "absolute", right: 12, bottom: 110, display: "flex", flexDirection: "column", alignItems: "center", gap: 18, zIndex: 5 }}>
        <div style={{ position: "relative", marginBottom: 4 }}>
          <button onClick={() => nav(`/user/${post.userId}`)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "block" }}>
            <Avatar src={u.avatar} size={46} ring />
          </button>
          {!isFollowing && (
            <button
              onClick={() => toggleFollow(post.userId)}
              aria-label={t("feed.follow")}
              style={{
                position: "absolute",
                left: "50%",
                bottom: -9,
                transform: "translateX(-50%)",
                width: 21,
                height: 21,
                borderRadius: "50%",
                background: "var(--gold)",
                color: "#131007",
                border: "none",
                fontWeight: 900,
                fontSize: 15,
                lineHeight: 1,
                cursor: "pointer",
              }}
            >
              +
            </button>
          )}
        </div>
        {/* PRIMARY: 🔥 ENERGY — reactive count (server rows, live) */}
        <ActionBtn icon={<IcEnergy size={26} filled={mineSet.has("energy") || isLiked} />} label={fmt(likeCount + (liveCounts.energy ?? 0))} active={mineSet.has("energy") || isLiked} onClick={() => void doAction("energy", t("act.energyDesc"))} />
        {/* PRIMARY: 💬 TALK — reactive count (Convex comments table, live) */}
        <TalkCountButton postId={post.id} fallback={post.comments.length} onOpen={() => setShowComments(true)} />
        {/* PRIMARY: 💃 MOVE — reactive count (server rows, live) */}
        <ActionBtn icon={<IcMove size={24} />} label={fmt((post.shares ?? 0) + (liveCounts.move ?? 0))} onClick={() => void doAction("move", t("act.moved"))} />
        {/* PRIMARY: 🎯 PRACTICE — reactive count (server rows, live) */}
        <ActionBtn
          icon={<IcPractice size={24} filled={mineSet.has("practice") || isSaved} />}
          label={fmt(liveCounts.practice ?? 0)}
          active={mineSet.has("practice") || isSaved}
          onClick={() => {
            const removing = mineSet.has("practice");
            void doAction("practice", removing ? t("act.practiceRemoved") : t("act.practiced"));
            if (!removing && sessionToken) {
              void savePractice({
                sessionToken,
                kind: "choreography",
                title: post.caption.slice(0, 80) || "Dance video",
                style: post.style,
                contentRef: post.id,
                href: "/feed",
              });
            }
          }}
        />
        {/* SECONDARY: 🔁 REMIX · 👯 DUET · ⚡ BOOST · 🏆 CHALLENGE */}
        <ActionBtn icon={<IcRemix size={23} />} label={t("act.remix")} onClick={() => nav(`/remix/${post.id}`)} />
        {duetAllowed ? (
          <ActionBtn icon={<IcDuet size={23} />} label={t("act.duet")} onClick={() => nav(`/duet/${post.id}`)} />
        ) : (
          <span title={t("gov.reuse.duetOff")} style={{ opacity: 0.4, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <ActionBtn icon={<IcDuet size={23} />} label={t("gov.reuse.duetOff")} onClick={() => toast(t("gov.reuse.duetOff"))} />
          </span>
        )}
        <ActionBtn icon={<IcBoost size={23} filled={mineSet.has("boost")} />} label={fmt(liveCounts.boost ?? 0)} active={mineSet.has("boost")} onClick={() => void doAction("boost", t("act.boosted"), t("act.boostLimit"))} />
        <ActionBtn icon={<IcChallenge size={23} />} label={fmt(liveCounts.challenge ?? 0)} active={mineSet.has("challenge")} onClick={() => void doAction("challenge", t("act.challenged"))} />
        {/* moderation hooks: report + block always available */}
        <ActionBtn icon="🚩" label={t("settings.report")} onClick={() => setReporting(true)} />
      </div>

      {/* bottom info */}
      <div style={{ position: "absolute", left: 0, right: 74, bottom: 0, padding: "0 16px 108px", zIndex: 4 }}>
        <button onClick={() => nav(`/user/${post.userId}`)} style={{ background: "none", border: "none", color: "white", cursor: "pointer", padding: 0, display: "block", textAlign: "left" }}>
          <span style={{ fontWeight: 800, fontFamily: "Sora", fontSize: 15.5 }}>@{u.username}</span>
          {post.duetOf && (
            <span className="faint" style={{ display: "block", fontSize: 12, marginTop: 2 }}>
              {t("feed.performedBy")} @{userById(post.userId).username} · {t("feed.originalBy")} @{userById(post.choreoBy ?? post.userId).username}
            </span>
          )}
        </button>

        {/* DENSEN why-chip: honest, real-signal reason this post is here */}
        {reasons.length > 0 && active && <WhyChip kind={reasons[0]} style={post.style} t={t} />}

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: "6px 0" }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              color: "#131007",
              background: "var(--gold)",
              padding: "2px 8px",
              borderRadius: 999,
            }}
          >
            {post.style}
          </span>
          {level && (
            <span
              title={`${t("feed.difficulty")}: ${t(LEVEL_KEY[level])}`}
              style={{
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: 0.4,
                textTransform: "uppercase",
                color: "white",
                background: "rgba(255,255,255,0.14)",
                border: "1px solid rgba(255,255,255,0.25)",
                padding: "2px 8px",
                borderRadius: 999,
              }}
            >
              {t(LEVEL_KEY[level])}
            </span>
          )}
        </div>

        <p style={{ margin: "4px 0 6px", fontSize: 14, lineHeight: 1.45 }}>{post.caption}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {post.hashtags.map((h) => (
            <button key={h} onClick={() => nav(`/discover?q=${encodeURIComponent(h)}`)} style={{ background: "none", border: "none", color: "var(--gold)", fontWeight: 700, fontSize: 12.5, cursor: "pointer", padding: 0 }}>
              {h}
            </button>
          ))}
        </div>
        <button
          onClick={() => nav("/audio")}
          style={{ background: "none", border: "none", color: "white", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600 }}
        >
          <IcMusic size={14} /> {audio.name} — {audio.artist} · {fmt(audio.uses)} {t("audio.videos")}
        </button>
        <button
          onClick={() => post.lessonRef && nav(`/course/${post.lessonRef}`)}
          className="btn btn-primary btn-sm"
          style={{ marginTop: 14 }}
        >
          🎓 {t("feed.learnThisMove")}
        </button>
      </div>

      {showComments && <CommentSheet post={post} onClose={() => setShowComments(false)} />}
      {reporting && (
        <ReportModal
          open
          onClose={() => setReporting(false)}
          targetType="post"
          targetId={post.id}
          targetLabel={`@${u.username}`}
        />
      )}
    </div>
  );
}

/* ============================ the feed ============================ */

const WINDOW = 5; // mounted videos around the active index (lazy loading)

/* ============================ DENSEN action rail ============================ */

const QUICK_ICONS: Record<QuickReaction, (p: { size?: number; filled?: boolean }) => JSX.Element> = {
  energy: IcEnergy,
  on_point: IcOnPoint,
  vibe: IcVibe,
  insane: IcInsane,
  clean: IcClean,
  power: IcPower,
};

/**
 * The 6 DENSEN quick reactions as a fan-out sheet. One tap fires the server
 * mutation (one row per user+comment+kind); the emoji chips are presentation
 * only — the identity lives in the reaction id.
 */
function QuickReactionBar({
  commentId,
  onDone,
}: {
  commentId: string;
  onDone: () => void;
}) {
  const { t, toast } = useStore();
  const { sessionToken } = useAuth();
  const react = useMutation(api.interactionsWire.reactToComment);
  const [busy, setBusy] = useState(false);

  const fire = async (r: QuickReaction) => {
    if (!sessionToken || busy) return;
    setBusy(true);
    try {
      const res = (await react({ sessionToken, commentId, reaction: r })) as { ok: boolean; error?: string };
      if (!res.ok) toast(t(res.error === "rate_limited" ? "act.rateLimited" : "act.denied"));
    } catch {
      toast(t("act.denied"));
    } finally {
      setBusy(false);
      onDone();
    }
  };

  return (
    <div
      className="anim-rise"
      style={{
        position: "absolute",
        bottom: "calc(100% + 6px)",
        right: 0,
        display: "flex",
        gap: 6,
        background: "var(--panel)",
        border: "1px solid var(--line-strong)",
        borderRadius: 999,
        padding: "6px 10px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
        zIndex: 60,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {QUICK_REACTIONS.map((r) => {
        const Icon = QUICK_ICONS[r];
        return (
          <button
            key={r}
            onClick={() => void fire(r)}
            title={t(`qr.${r}` as never)}
            aria-label={t(`qr.${r}` as never)}
            style={{ background: "none", border: "none", cursor: busy ? "wait" : "pointer", fontSize: 17, padding: 2, lineHeight: 1 }}
          >
            <Icon size={19} />
          </button>
        );
      })}
    </div>
  );
}

export default function Feed() {
  const { t, allPosts } = useStore();
  const { ageBandValue } = useGov();
  const [tab, setTab] = useState<"foryou" | "following">("foryou");
  const [activeIdx, setActiveIdx] = useState(0);
  const [visibleCount, setVisibleCount] = useState(FEED_PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const nearEndRef = useRef(false);

  const signals = useFeedSignals();

  const ranked = useMemo(() => {
    const opts = {
      includePost: (p: FeedPostInput) => {
        const u = users.find((x) => x.id === p.userId);
        return !u || !u.minor || p.userId === "me"; // non-discoverable authors never rank
      },
      courseLevel: (courseId: string | undefined) => (courseId ? courseById(courseId)?.level : undefined),
      isTeacher: (userId: string) => Boolean(users.find((x) => x.id === userId)?.teacher),
      // Day-1 youth rule: minors get an educational-first feed
      educationalFirst: ageBandValue !== "adult",
    };
    const inputs = allPosts.map((p) => ({ ...p }));
    const fy = buildForYou(inputs, signals, opts);
    const fl = buildFollowing(inputs, signals, opts);
    return { foryou: fy, following: fl };
  }, [allPosts, signals, ageBandValue]);

  const fullList = tab === "foryou" ? ranked.foryou : ranked.following;

  const { items, hasMore } = useMemo(() => paginate(fullList, visibleCount), [fullList, visibleCount]);

  useEffect(() => {
    setActiveIdx(0);
    setVisibleCount(FEED_PAGE_SIZE);
    scrollerRef.current?.scrollTo({ top: 0 });
  }, [tab]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const idx = Math.round(el.scrollTop / el.clientHeight);
      setActiveIdx(idx);
      // infinite loading: one page before the end of the mounted list
      if (idx >= visibleCount - 2 && !nearEndRef.current) {
        nearEndRef.current = true;
        setLoadingMore(true);
        window.setTimeout(() => {
          setVisibleCount((n) => n + FEED_PAGE_SIZE);
          setLoadingMore(false);
          nearEndRef.current = false;
        }, 350);
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [visibleCount]);

  const loadMore = useCallback(() => {
    setVisibleCount((n) => n + FEED_PAGE_SIZE);
  }, []);

  return (
    <div className="anim-fade">
      {/* feed tabs */}
      <div style={{ position: "sticky", top: 57, zIndex: 50, display: "flex", justifyContent: "center", padding: "10px 0", background: "linear-gradient(180deg, rgba(11,13,16,0.9), transparent)", pointerEvents: "none" }}>
        <div className="seg gold" style={{ pointerEvents: "auto" }}>
          <button className={tab === "foryou" ? "active" : ""} onClick={() => setTab("foryou")}>
            {t("feed.forYou")}
          </button>
          <button className={tab === "following" ? "active" : ""} onClick={() => setTab("following")}>
            {t("feed.following")}
          </button>
        </div>
      </div>

      <div ref={scrollerRef} className="feed-scroll">
        {items.length === 0 ? (
          <div style={{ height: "70dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
            <span style={{ fontSize: 44 }}>👀</span>
            <p className="muted" style={{ margin: 0 }}>{t("feed.emptyFollowing")}</p>
            <NavigateDiscover />
          </div>
        ) : (
          items.map((s, i) => (
            <FeedCard
              key={s.post.id}
              post={s.post}
              active={i === activeIdx}
              near={Math.abs(i - activeIdx) <= WINDOW}
              reasons={s.reasons}
              level={s.level}
            />
          ))
        )}
        {loadingMore && hasMore && (
          <div style={{ position: "absolute", bottom: 84, left: 0, right: 0, textAlign: "center", zIndex: 2, pointerEvents: "none" }}>
            <span className="faint" style={{ fontSize: 12.5, background: "rgba(19,16,7,0.6)", padding: "6px 14px", borderRadius: 999 }}>
              {t("feed.loadingMore")}
            </span>
          </div>
        )}
        {!hasMore && items.length > 0 && (
          <div style={{ position: "absolute", bottom: 84, left: 0, right: 0, textAlign: "center", zIndex: 2, pointerEvents: "none" }}>
            <span className="faint" style={{ fontSize: 12.5, background: "rgba(19,16,7,0.6)", padding: "6px 14px", borderRadius: 999 }}>
              {t("feed.endOfFeed")}
            </span>
          </div>
        )}
        {hasMore && activeIdx >= items.length - 1 && (
          <button className="btn btn-sm" onClick={loadMore} style={{ position: "absolute", bottom: 120, left: "50%", transform: "translateX(-50%)", zIndex: 4 }}>
            <IcPlay size={14} /> {t("feed.loadingMore")}
          </button>
        )}
      </div>
    </div>
  );
}

function NavigateDiscover() {
  const nav = useNavigate();
  const { t } = useStore();
  return (
    <button className="btn btn-primary btn-sm" onClick={() => nav("/discover")}>
      {t("feed.discoverMore")}
    </button>
  );
}
