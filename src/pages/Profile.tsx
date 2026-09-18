import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Avatar, Bar, Empty, LevelBadge, Page } from "../components/ui";
import { IcMapPin, IcPlay, IcSettings, IcVerified } from "../components/icons";
import { ME, useStore } from "../state/store";
import { useGov } from "../state/governance";
import { tx } from "../components/gov-ui";
import { teacherVerificationOf } from "../data/safety";
import { ReportModal } from "../components/gov-ui";
import { courses, fmt, teamById, teams, userById, users } from "../data/store";
import { IMG } from "../data/media";

/* ---------------- shared profile bits ---------------- */
type Tab = "videos" | "choreos" | "achievements" | "courses" | "saved";

function Stat({ v, label }: { v: string | number; label: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontFamily: "Sora", fontWeight: 800, fontSize: 17 }}>{v}</div>
      <div className="faint" style={{ fontSize: 11.5 }}>{label}</div>
    </div>
  );
}

function ProfileHeader({ userId }: { userId: string }) {
  const { t, following, toggleFollow, toast, lang } = useStore();
  const { toggleBlock, isBlocked, toggleMute, isMuted } = useGov();
  const [reporting, setReporting] = useState(false);
  const nav = useNavigate();
  const isMe = userId === "me";
  const u = isMe ? ME : userById(userId);
  const isFollowing = following.has(u.id);
  const team = teamById(u.teamId);

  // 52/56: profile field policy — minors' city is never shown; verified-teacher badge is evidence-backed
  const showCity = Boolean(u.location) && !u.minor;
  const teacherStatus = u.teacher ? teacherVerificationOf(u.id) : undefined;

  return (
    <>
      {/* cover */}
      <div style={{ height: 130, borderRadius: "var(--radius-lg)", overflow: "hidden", position: "relative", marginBottom: -44 }}>
        <img src={profileCover(u.id)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <span style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(11,13,16,0.15), rgba(11,13,16,0.75))" }} />
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", gap: 14, padding: "0 18px", marginBottom: 14 }}>
        <div style={{ marginTop: -44, border: "4px solid var(--bg)", borderRadius: "50%", lineHeight: 0 }}>
          <Avatar src={u.avatar} size={86} ring={u.teacher} />
        </div>
        <div style={{ flex: 1, paddingBottom: 6 }}>
          {team && (
            <button onClick={() => nav(`/team/${team.id}`)} className="chip" style={{ fontSize: 11, padding: "3px 10px", marginBottom: 5 }}>
              🛡️ {team.name}
            </button>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 21, fontWeight: 800 }}>{u.name}</h1>
            {u.verified && <IcVerified size={18} />}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>@{u.username} {u.teacher && <>· ⭐ {teacherStatus?.status === "verified" ? t("gov.profile.verifiedTeacher") : t("gov.profile.verificationPending")}</>}</div>
        </div>
      </div>

      <div style={{ padding: "0 18px" }}>
        <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.6, margin: "0 0 10px", whiteSpace: "pre-line" }}>{u.bio}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {u.styles.map((s) => (
            <span key={s} className="chip" style={{ fontSize: 11.5 }}>{s}</span>
          ))}
          {showCity && (
            <span className="chip" style={{ fontSize: 11.5 }}>
              <IcMapPin size={12} /> {u.location}
            </span>
          )}
        </div>
        {u.teacher && teacherStatus && (
          <p className="faint" style={{ fontSize: 11.5, margin: "0 0 10px", lineHeight: 1.6 }}>
            {teacherStatus.status === "verified" ? "✓ " : "⏳ "}
            {tx(teacherStatus.checked, lang)}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", maxWidth: 420, margin: "14px 0 16px" }}>
          <Stat v={fmt(u.followers)} label={t("profile.followers")} />
          <Stat v={fmt(u.following)} label={t("profile.following")} />
          <Stat v={fmt(u.likes)} label={t("profile.likes")} />
          <Stat v={u.teacher ? "12" : "4"} label={t("profile.courses")} />
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
          {isMe ? (
            <>
              <button className="btn btn-sm" onClick={() => nav("/settings")}>
                <IcSettings size={16} /> {t("profile.settings")}
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => nav("/create")}>
                ➕ {t("create.title")}
              </button>
            </>
          ) : (
            <>
              <button className={`btn btn-sm ${isFollowing ? "" : "btn-primary"}`} onClick={() => toggleFollow(u.id)}>
                {isFollowing ? t("common.following") : t("common.follow")}
              </button>
              <button className="btn btn-sm" onClick={() => nav("/messages/cv1")}>
                ✉️ {t("profile.message")}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => toast(t("common.copied"))}>
                🔗 {t("profile.share")}
              </button>
              <button
                className="btn btn-sm btn-ghost"
                aria-label={`${t("settings.report")} @${u.username}`}
                onClick={() => {
                  if (window.confirm(`${t("settings.report")} @${u.username}?`)) {
                    setReporting(true);
                  }
                }}
              >
                🚩 {t("settings.report")}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => { toggleMute(u.id); toast(isMuted(u.id) ? t("gov.unmute") : "🔇 " + t("settings.mute")); }}>
                {isMuted(u.id) ? "🔔" : "🔇"} {isMuted(u.id) ? t("gov.unmute") : t("settings.mute")}
              </button>
              <button className="btn btn-sm btn-danger" onClick={() => { toggleBlock(u.id); toast(isBlocked(u.id) ? t("gov.unblock") : t("settings.block")); }}>
                🚫 {isBlocked(u.id) ? t("gov.unblock") : t("settings.block")}
              </button>
            </>
          )}
        </div>
      </div>

      {reporting && (
        <ReportModal
          open
          onClose={() => setReporting(false)}
          targetType="user"
          targetId={u.id}
          targetLabel={`@${u.username}`}
        />
      )}
    </>
  );
}

const profileCover = (id: string) =>
  ({
    u_sara: IMG.extra3,
    u_alex: IMG.extra19,
    u_maria: IMG.catContemporary,
    u_denisa: IMG.catLatin,
    u_kejsi: IMG.catJazz,
    u_maya: IMG.extra21,
    me: IMG.extra7,
    u_jona: IMG.catCommercial,
    u_luca: IMG.catBattle,
    u_elsa: IMG.catFreestyle,
    u_noa: IMG.catKids,
    u_luan: IMG.extra19,
    u_arben: IMG.catLatin,
  })[id] ?? IMG.extra7;

/* ---------------- generic user profile ---------------- */
export function UserProfilePage() {
  const { userId } = useParams();
  const { t, achievements, saved } = useStore();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("videos");

  if (!userId) return null;
  const isMe = userId === "me";
  const tabs: { id: Tab; label: string }[] = isMe
    ? [
        { id: "videos", label: t("profile.videos") },
        { id: "achievements", label: t("profile.achievements") },
        { id: "courses", label: t("profile.courses") },
        { id: "saved", label: t("profile.saved") },
      ]
    : [
        { id: "videos", label: t("profile.videos") },
        { id: "choreos", label: t("profile.choreographies") },
        { id: "achievements", label: t("profile.achievements") },
        { id: "courses", label: t("profile.courses") },
      ];

  const myCourses = courses.slice(0, 3);

  return (
    <Page>
      <ProfileHeader userId={userId} />

      <div className="no-scrollbar" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "0 18px 14px", borderBottom: "1px solid var(--line)", marginBottom: 16 }}>
        {tabs.map((tb) => (
          <button key={tb.id} className={`chip${tab === tb.id ? " active" : ""}`} onClick={() => setTab(tb.id)}>
            {tb.label}
          </button>
        ))}
      </div>

      <div style={{ padding: "0 2px" }}>
        {tab === "videos" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
            {["p1", "p3", "p5", "p7"].map((pid, i) => (
              <button
                key={pid}
                onClick={() => nav("/")}
                style={{ position: "relative", aspectRatio: "9/14", borderRadius: 14, overflow: "hidden", border: "1px solid var(--line)", cursor: "pointer", padding: 0, background: "var(--panel-2)" }}
              >
                <img src={[IMG.catHipHop, IMG.catContemporary, IMG.catCommercial, IMG.catBattle][i]} alt="" className="media-cover" loading="lazy" />
                <span style={{ position: "absolute", left: 8, bottom: 8, fontSize: 11.5, fontWeight: 700, textShadow: "0 1px 6px rgba(0,0,0,0.9)" }}>
                  ▶ {fmt([128, 87, 143, 56][i])}K
                </span>
              </button>
            ))}
          </div>
        )}

        {tab === "choreos" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {["8-Count Groove Combo", "Floorwork Phrase No. 4", "Heels Warm-up Flow"].map((name, i) => (
              <div key={name} className="panel" style={{ display: "flex", gap: 12, padding: 13, alignItems: "center" }}>
                <img src={[IMG.catHipHop, IMG.catContemporary, IMG.catCommercial][i]} alt="" style={{ width: 84, height: 58, borderRadius: 10, objectFit: "cover" }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{name}</div>
                  <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>{[42, 18, 27][i]} {t("feed.versions")}</div>
                </div>
                <IcPlay size={17} />
              </div>
            ))}
          </div>
        )}

        {tab === "achievements" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
            {achievements.map((a) => (
              <div
                key={a.id}
                className="panel"
                style={{
                  padding: 14,
                  textAlign: "center",
                  opacity: a.unlocked ? 1 : 0.55,
                  borderColor: a.unlocked ? "var(--gold-line)" : "var(--line)",
                }}
              >
                <div style={{ fontSize: 28, marginBottom: 6 }}>{a.icon}</div>
                <div style={{ fontWeight: 700, fontSize: 12.5 }}>{a.name}</div>
                <div className="faint" style={{ fontSize: 11, marginTop: 3 }}>{a.desc}</div>
                {!a.unlocked && a.progress !== undefined && (
                  <div style={{ marginTop: 8 }}>
                    <Bar pct={a.progress} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {(tab === "courses") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {myCourses.map((c) => (
              <button
                key={c.id}
                onClick={() => nav(`/course/${c.id}`)}
                className="panel panel-hover"
                style={{ display: "flex", gap: 12, padding: 12, alignItems: "center", cursor: "pointer", textAlign: "left", color: "inherit", width: "100%" }}
              >
                <img src={c.cover} alt="" style={{ width: 96, height: 62, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>{c.title}</div>
                  <div className="faint" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                    <LevelBadge level={c.level} /> {c.lessons.length} {t("learn.lessons")}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {tab === "saved" && isMe && (
          <>
            {saved.size === 0 ? (
              <Empty icon="🔖" text={t("profile.savedEmpty")} />
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
                {[...saved].map((sid) => {
                  const c = courses.find((x) => x.id === sid);
                  return (
                    <button
                      key={sid}
                      onClick={() => nav(c ? `/course/${c.id}` : "/")}
                      className="panel panel-hover"
                      style={{ position: "relative", aspectRatio: c ? "16/10" : "9/14", borderRadius: 14, overflow: "hidden", padding: 0, cursor: "pointer", border: "1px solid var(--line)", background: "var(--panel-2)" }}
                    >
                      {c ? (
                        <>
                          <img src={c.cover} alt="" className="media-cover" />
                          <span style={{ position: "absolute", left: 9, bottom: 9, right: 9, fontWeight: 700, fontSize: 11.5, textAlign: "left", textShadow: "0 1px 6px rgba(0,0,0,0.9)" }}>{c.title}</span>
                        </>
                      ) : (
                        <img src={IMG.extra5} alt="" className="media-cover" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </Page>
  );
}

/* ---------------- teams ---------------- */
export function TeamsPage() {
  const { t, following, toggleFollow } = useStore();
  return (
    <Page>
      <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 4 }}>{t("teams.title")}</h1>
      <p className="muted" style={{ margin: "0 0 20px", fontSize: 14 }}>{t("teams.subtitle")}</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {teams.map((team) => (
          <button
            key={team.id}
            onClick={() => (window.location.pathname = `/team/${team.id}`)}
            className="panel panel-hover"
            style={{ textAlign: "left", padding: 0, overflow: "hidden", cursor: "pointer", color: "inherit", width: "100%" }}
          >
            <div style={{ position: "relative", height: 110 }}>
              <img src={team.cover} alt="" className="media-cover" loading="lazy" />
              <span style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 20%, rgba(11,13,16,0.85))" }} />
            </div>
            <div style={{ padding: "12px 16px 16px", display: "flex", gap: 12, alignItems: "center", marginTop: -34 }}>
              <img src={team.logo} alt="" style={{ width: 48, height: 48, borderRadius: 14, border: "3px solid var(--bg)", objectFit: "cover" }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontFamily: "Sora", fontSize: 15.5 }}>{team.name}</div>
                <div className="faint" style={{ fontSize: 12.5 }}>
                  {team.city} · {team.members.length} {t("common.members")} · {team.styles.join(" · ")}
                </div>
              </div>
              <span
                className="btn btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFollow(team.id);
                }}
              >
                {following.has(team.id) ? `✓ ${t("teams.joined")}` : t("teams.join")}
              </span>
            </div>
          </button>
        ))}
      </div>
    </Page>
  );
}

export function TeamDetailPage() {
  const { teamId } = useParams();
  const { t, following, toggleFollow } = useStore();
  const nav = useNavigate();
  const team = teams.find((x) => x.id === teamId);
  if (!team) return <Page><Empty icon="🛡️" text="Team not found" /></Page>;
  const joined = following.has(team.id);

  return (
    <Page>
      <button onClick={() => nav("/teams")} className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }}>← {t("nav.teams")}</button>

      <div style={{ height: 170, borderRadius: "var(--radius-lg)", overflow: "hidden", position: "relative", marginBottom: 14 }}>
        <img src={team.cover} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <span style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 30%, rgba(11,13,16,0.9))" }} />
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 12 }}>
        <img src={team.logo} alt="" style={{ width: 64, height: 64, borderRadius: 18, border: "3px solid var(--bg)", objectFit: "cover", marginTop: -40, position: "relative", zIndex: 2 }} />
        <div>
          <h1 style={{ fontSize: 23, fontWeight: 800 }}>{team.name}</h1>
          <div className="muted" style={{ fontSize: 13 }}>
            {team.city} · {team.members.length} {t("common.members")} · {t("teams.createdBy")} {userById(team.foundedBy).name}
          </div>
        </div>
      </div>

      <p className="muted" style={{ fontSize: 14, lineHeight: 1.65, margin: "0 0 14px" }}>{team.about}</p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {team.styles.map((s) => <span key={s} className="chip">{s}</span>)}
      </div>

      <button className={`btn ${joined ? "" : "btn-primary"}`} style={{ width: "100%", marginBottom: 20 }} onClick={() => toggleFollow(team.id)}>
        {joined ? `✓ ${t("teams.joined")}` : t("teams.join")}
      </button>

      <section style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>{t("common.members")}</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
          {team.members.map((mid) => {
            const mu = users.find((x) => x.id === mid);
            const m = mid === "me" ? ME : mu;
            if (!m) return null;
            return (
              <button key={mid} onClick={() => nav(`/user/${mid}`)} className="panel panel-hover" style={{ padding: 13, textAlign: "center", cursor: "pointer", color: "inherit", display: "flex", flexDirection: "column", alignItems: "center", gap: 7 }}>
                <Avatar src={m.avatar} size={46} />
                <div style={{ fontWeight: 700, fontSize: 12.5 }}>{m.name}</div>
              </button>
            );
          })}
        </div>
      </section>

      <section style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, marginBottom: 10 }}>🏆 {t("profile.achievements")}</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {team.achievements.map((a) => <span key={a} className="chip">{a}</span>)}
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>🎥 {t("teams.teamVideos")}</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
          {[IMG.extra7, IMG.catHipHop, IMG.catCommercial].map((img, i) => (
            <button key={i} onClick={() => nav("/")} style={{ position: "relative", aspectRatio: "9/14", borderRadius: 14, overflow: "hidden", border: "1px solid var(--line)", cursor: "pointer", padding: 0, background: "var(--panel-2)" }}>
              <img src={img} alt="" className="media-cover" />
            </button>
          ))}
        </div>
      </section>
    </Page>
  );
}


