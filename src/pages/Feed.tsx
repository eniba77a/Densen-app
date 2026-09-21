import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { audios, challenges, courseById, fmt, userById, users, type Post } from "../data/store";
import { ME, useStore } from "../state/store";
import { useGov } from "../state/governance";
import { ReportModal, tx } from "../components/gov-ui";
import { ActionBtn, Avatar } from "../components/ui";
import {
  IcComment,
  IcExpand,
  IcHeart,
  IcMusic,
  IcPlay,
  IcShare,
  IcShrink,
  IcVolume,
  IcVolumeOff,
} from "../components/icons";
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

function CommentSheet({ post, onClose }: { post: Post; onClose: () => void }) {
  const { t, lang } = useStore();
  const { toast } = useGov();
  const [text, setText] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<{ id: string; userId: string; text: string; time: string; likes: number }[]>([]);

  // Target audience matters: stricter filter when the post author is a minor.
  const targetIsMinor = Boolean(userById(post.userId).minor);
  const myScan: CommentScan = scanComment(text, targetIsMinor);
  const groom: ReturnType<typeof scanGrooming> = scanGrooming(text);

  const tryPost = () => {
    const clean = text.trim();
    if (!clean) return;
    if (groom.severity === "critical") {
      toast(`🚨 ${t("gov.comment.groomingBlocked")}`);
      return;
    }
    if (myScan.verdict === "blocked") {
      toast(`⚠ ${t("gov.comment.blocked")} — ${myScan.matched.map((m) => tx(m, lang)).join(" · ")}`);
      return;
    }
    setExtra((x) => [...x, { id: `x${Date.now()}`, userId: "me", text: clean, time: "now", likes: 0 }]);
    if (myScan.verdict === "hidden") toast(`👁 ${t("gov.comment.hidden")} — ${myScan.matched.map((m) => tx(m, lang)).join(" · ")}`);
    setText("");
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
          {fmt(post.comments.length + extra.length)} {t("common.comment")}
        </div>
        <div style={{ overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>
          {post.comments.map((c) => (
            <CommentRow key={c.id} c={c} targetIsMinor={targetIsMinor} onHide={() => setHidden((s) => new Set(s).add(c.id))} hidden={hidden.has(c.id)} />
          ))}
          {extra.map((c) => (
            <CommentRow key={c.id} c={c} targetIsMinor={targetIsMinor} onHide={() => setHidden((s) => new Set(s).add(c.id))} hidden={hidden.has(c.id)} />
          ))}
        </div>
        <div style={{ padding: "12px 16px calc(12px + var(--sab))", borderTop: "1px solid var(--line)", display: "flex", gap: 10 }}>
          <Avatar src={ME.avatar} size={34} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <input
              className="input"
              placeholder={`${t("common.comment")}…`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") tryPost();
              }}
            />
            {text.trim().length > 0 && myScan.verdict !== "clean" && (
              <div className="faint" style={{ fontSize: 12 }}>
                🛡 {myScan.verdict === "blocked" ? t("gov.comment.blocked") : t("gov.comment.hidden")}
                {myScan.matched.length > 0 && ` — ${myScan.matched.map((m) => tx(m, lang)).join(" · ")}`}
              </div>
            )}
            <button className="btn btn-primary btn-sm" onClick={tryPost} style={{ alignSelf: "flex-end" }}>
              {t("common.post")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CommentRow({ c, targetIsMinor, onHide, hidden }: {
  c: { id: string; userId: string; text: string; time: string; likes: number };
  targetIsMinor: boolean;
  onHide: () => void;
  hidden: boolean;
}) {
  const u = userById(c.userId);
  const { t, lang } = useStore();
  const { toast, isBlocked, toggleBlock, isMuted, toggleMute } = useGov();
  const [reportOpen, setReportOpen] = useState(false);

  // live moderation verdict on this comment
  const scan = scanComment(c.text, targetIsMinor);
  const autoHidden = scan.verdict !== "clean";
  const shown = hidden || autoHidden;

  const rowActions = (
    <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
      <span className="faint" style={{ fontSize: 12 }}>♥ {c.likes}</span>
      {c.userId !== "me" && (
        <>
          <button
            onClick={onHide}
            aria-label={`${t("gov.comment.hide")}`}
            title={t("gov.comment.hide")}
            style={{ background: "none", border: "none", color: "var(--ink-faint)", cursor: "pointer", fontSize: 13, padding: 4 }}
          >
            🙈
          </button>
          <button
            onClick={() => setReportOpen(true)}
            aria-label={`${t("settings.report")} @${u.username}`}
            title={t("settings.report")}
            style={{ background: "none", border: "none", color: "var(--ink-faint)", cursor: "pointer", fontSize: 13, padding: 4 }}
          >
            🚩
          </button>
          <button
            onClick={() => {
              toggleBlock(u.id);
              toast(isBlocked(u.id) ? t("gov.msg.unblocked") : t("gov.msg.blockedToast"));
            }}
            aria-label={`${t("gov.msg.block")} @${u.username}`}
            title={t("gov.msg.block")}
            style={{ background: "none", border: "none", color: "var(--ink-faint)", cursor: "pointer", fontSize: 13, padding: 4 }}
          >
            🚫
          </button>
          <button
            onClick={() => {
              toggleMute(u.id);
              toast(isMuted(u.id) ? t("gov.msg.unmuted") : t("gov.msg.muted"));
            }}
            aria-label={`${t("gov.msg.mute")} @${u.username}`}
            title={t("gov.msg.mute")}
            style={{ background: "none", border: "none", color: "var(--ink-faint)", cursor: "pointer", fontSize: 13, padding: 4 }}
          >
            🔇
          </button>
        </>
      )}
    </div>
  );

  return (
    <div style={{ display: "flex", gap: 10, opacity: shown ? 0.55 : 1 }}>
      <Avatar src={u.avatar} size={34} />
      <div style={{ flex: 1 }}>
        <div className="faint" style={{ fontSize: 12, fontWeight: 700 }}>@{u.username} · {c.time}</div>
        {shown ? (
          <div style={{ fontSize: 13, marginTop: 3, color: "var(--ink-faint)", fontStyle: "italic" }}>
            {hidden ? t("gov.comment.hiddenByYou") : `🛡 ${t("gov.comment.autoHidden")}${scan.matched.length ? ` — ${scan.matched.map((m) => tx(m, lang)).join(" · ")}` : ""}`}
          </div>
        ) : (
          <div style={{ fontSize: 14, marginTop: 3 }}>{c.text}</div>
        )}
      </div>
      {rowActions}
      {reportOpen && (
        <ReportModal open onClose={() => setReportOpen(false)} targetType="comment" targetId={c.id} targetLabel={`@${u.username}`} />
      )}
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
  const { t, liked, toggleLike, saved, toggleSave, following, toggleFollow, toast } = useStore();
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
        <ActionBtn icon={<IcHeart size={27} filled={isLiked} />} label={fmt(likeCount)} active={isLiked} onClick={() => toggleLike(post.id)} />
        <ActionBtn icon={<IcComment />} label={fmt(post.comments.length)} onClick={() => setShowComments(true)} />
        <ActionBtn icon="🔖" label={isSaved ? t("common.saved") : t("common.save")} active={isSaved} onClick={() => { toggleSave(post.id); toast(isSaved ? "Removed from saved" : t("common.saved")); }} />
        <ActionBtn icon={<IcShare />} label={fmt(post.shares)} onClick={() => toast(t("common.shareTo"))} />
        {duetAllowed ? (
          <ActionBtn icon="🤝" label={t("feed.duet")} onClick={() => nav(`/duet/${post.id}`)} />
        ) : (
          <span title={t("gov.reuse.duetOff")} style={{ opacity: 0.4, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <ActionBtn icon="🤝" label={t("gov.reuse.duetOff")} onClick={() => toast(t("gov.reuse.duetOff"))} />
          </span>
        )}
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
