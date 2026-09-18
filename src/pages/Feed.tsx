import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { audios, fmt, userById, users, type Post } from "../data/store";
import { ME, useStore } from "../state/store";
import { useGov } from "../state/governance";
import { ReportModal, tx } from "../components/gov-ui";
import { ActionBtn, Avatar } from "../components/ui";
import { IcComment, IcHeart, IcMusic, IcShare } from "../components/icons";
import { scanComment, scanGrooming, rankRecommendations, canReuse, type CommentScan } from "../data/safety";

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
            <div style={{ display: "flex", gap: 10 }}>
              <input
                className="input"
                placeholder={`${t("common.comment")}…`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") tryPost();
                }}
                style={{ flex: 1 }}
                aria-label={t("common.comment")}
              />
              <button className="btn btn-primary btn-sm" onClick={tryPost}>
                {t("messages.send")}
              </button>
            </div>
            {text.trim() && (myScan.verdict !== "clean" || groom.severity !== "none") && (
              <p
                role="alert"
                style={{
                  margin: 0,
                  fontSize: 12,
                  fontWeight: 700,
                  color: myScan.verdict === "blocked" || groom.severity === "critical" ? "var(--err)" : "var(--warn)",
                }}
              >
                {groom.severity === "critical" ? `🚨 ${t("gov.comment.groomingBlocked")}` : myScan.verdict === "blocked" ? `⚠ ${t("gov.comment.blocked")}` : `👁 ${t("gov.comment.hidden")}`}
                {" — "}
                {[...myScan.matched, ...groom.matched].map((m) => tx(m, lang)).join(" · ")}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CommentRow({
  c,
  targetIsMinor,
  onHide,
  hidden,
}: {
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

function FeedCard({ post, active }: { post: Post; active: boolean }) {
  const { t, liked, toggleLike, saved, toggleSave, following, toggleFollow, toast } = useStore();
  const { submitReport: _submitReport, isBlocked } = useGov();
  const nav = useNavigate();
  const u = userById(post.userId);
  const audio = audios.find((a) => a.id === post.audioId)!;
  const [showComments, setShowComments] = useState(false);
  const [reporting, setReporting] = useState(false);
  const vidRef = useRef<HTMLVideoElement>(null);

  // Youth-safety: creators can disable duets (54). The duet button respects it.
  const duetAllowed = canReuse(users.find((x) => x.id === post.userId)?.minor ? "teen13_15" : "adult", undefined, "duet");

  useEffect(() => {
    const v = vidRef.current;
    if (!v) return;
    if (active) v.play().catch(() => undefined);
    else {
      v.pause();
      v.currentTime = 0;
    }
  }, [active]);

  // blocked users' posts never render (after all hooks — rules of hooks)
  if (isBlocked(post.userId)) return null;

  const isLiked = liked.has(post.id);
  const isSaved = saved.has(post.id);
  const isFollowing = following.has(post.userId);
  const likeCount = post.likes + (isLiked ? 1 : 0);

  return (
    <div className="feed-item" style={{ height: "100%", position: "relative", overflow: "hidden", background: "#000" }}>
      <video
        ref={vidRef}
        src={post.video}
        poster={post.cover}
        loop
        muted
        playsInline
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, transparent 22%, transparent 55%, rgba(0,0,0,0.78) 100%)" }} />

      {/* right action rail */}
      <div style={{ position: "absolute", right: 12, bottom: 110, display: "flex", flexDirection: "column", alignItems: "center", gap: 18, zIndex: 5 }}>
        <div style={{ position: "relative", marginBottom: 4 }}>
          <button onClick={() => nav(`/user/${post.userId}`)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "block" }}>
            <Avatar src={u.avatar} size={46} ring />
          </button>
          {!isFollowing && (
            <button
              onClick={() => toggleFollow(post.userId)}
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
        <p style={{ margin: "8px 0 6px", fontSize: 14, lineHeight: 1.45 }}>{post.caption}</p>
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

export default function Feed() {
  const { t, allPosts, following } = useStore();
  const { ageBandValue } = useGov();
  const [tab, setTab] = useState<"foryou" | "following">("foryou");
  const [activeIdx, setActiveIdx] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // 50: recommendations are safety-ranked — educational posts first for minors,
  // non-discoverable authors filtered (never “Dancers near you” by precise location).
  const isDiscoverable = (userId: string) => {
    const u = users.find((x) => x.id === userId);
    return !u || !u.minor || u.id === "me";
  };
  const forYou = rankRecommendations(ageBandValue, allPosts, isDiscoverable);
  const followingPosts = forYou.filter((p) => following.has(p.userId));
  const list = tab === "foryou" ? forYou : followingPosts;

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const idx = Math.round(el.scrollTop / el.clientHeight);
      setActiveIdx(idx);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
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
        {list.length === 0 ? (
          <div style={{ height: "70dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
            <span style={{ fontSize: 44 }}>👀</span>
            <p className="muted" style={{ margin: 0 }}>{t("feed.emptyFollowing")}</p>
            <NavigateDiscover />
          </div>
        ) : (
          list.map((p, i) => <FeedCard key={p.id} post={p} active={i === activeIdx} />)
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
