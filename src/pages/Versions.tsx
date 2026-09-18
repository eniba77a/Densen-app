import { useNavigate, useParams } from "react-router-dom";
import { Avatar, Empty, Page } from "../components/ui";
import { IcPlay } from "../components/icons";
import { useStore } from "../state/store";
import { fmt, posts, userById } from "../data/store";

export default function Versions() {
  const { postId } = useParams();
  const nav = useNavigate();
  const { t, following, toggleFollow } = useStore();
  const original = posts.find((p) => p.id === postId);
  const root = original?.duetOf ? posts.find((p) => p.id === original.duetOf) : original;

  if (!root) return <Page><Empty icon="🎬" text="Choreography not found" /></Page>;

  const creator = userById(root.choreoBy ?? root.userId);
  const versions = [root, ...posts.filter((p) => p.duetOf === root.id)];
  const totalLikes = versions.reduce((n, v) => n + v.likes, 0);

  return (
    <Page>
      <button onClick={() => nav(-1)} className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }}>← {t("common.back")}</button>

      <span className="eyebrow">{t("profile.choreographies")}</span>
      <h1 style={{ fontSize: 23, fontWeight: 800, margin: "6px 0 2px" }}>{root.hashtags[0]?.replace("#", "") ?? "Choreography"} — {root.style}</h1>
      <p className="muted" style={{ fontSize: 13.5, margin: "0 0 18px" }}>
        {t("feed.originalBy")} <strong className="gold-text">@{creator.username}</strong> · {versions.length} {t("feed.versions")} · {fmt(totalLikes)} ♥
      </p>

      {/* original */}
      <div className="panel" style={{ padding: 14, display: "flex", gap: 13, alignItems: "center", marginBottom: 18, borderColor: "var(--gold-line)" }}>
        <button onClick={() => nav(`/user/${creator.id}`)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
          <Avatar src={creator.avatar} size={48} ring />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>{creator.name}</div>
          <div className="faint" style={{ fontSize: 12.5 }}>@{creator.username} · original</div>
        </div>
        {!following.has(creator.id) && (
          <button className="btn btn-primary btn-sm" onClick={() => toggleFollow(creator.id)}>{t("common.follow")}</button>
        )}
      </div>

      {/* versions grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
        {versions.map((v) => {
          const u = userById(v.userId);
          return (
            <button key={v.id} onClick={() => nav("/")} className="panel panel-hover" style={{ position: "relative", aspectRatio: "9/16", borderRadius: 16, overflow: "hidden", padding: 0, cursor: "pointer", border: "1px solid var(--line)", background: "var(--panel-2)", textAlign: "left" }}>
              <img src={v.cover} alt="" className="media-cover" loading="lazy" />
              <span style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 45%, rgba(0,0,0,0.75))" }} />
              <span style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 40, height: 40, borderRadius: "50%", background: "rgba(227,179,65,0.9)", color: "#171204", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <IcPlay size={17} />
              </span>
              <span style={{ position: "absolute", left: 10, bottom: 10, right: 10, color: "#fff" }}>
                <span style={{ display: "block", fontWeight: 800, fontSize: 12 }}>@{u.username}</span>
                <span className="faint" style={{ display: "block", fontSize: 10.5, color: "rgba(255,255,255,0.75)" }}>
                  {v.duetOf ? `duet · ${fmt(v.likes)} ♥` : `original · ${fmt(v.likes)} ♥`}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <button className="btn btn-primary" style={{ width: "100%", marginTop: 18, padding: "13px 20px" }} onClick={() => nav(`/duet/${root.id}`)}>
        🤝 {t("feed.duet")} — {t("create.record")}
      </button>
    </Page>
  );
}
