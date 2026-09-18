import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Page, SectionHeader } from "../components/ui";
import { IcMusic } from "../components/icons";
import { useStore } from "../state/store";
import { audios, fmt, posts } from "../data/store";

export default function Audio() {
  const { t, toast } = useStore();
  const nav = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <Page>
      <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 4 }}>{t("audio.title")}</h1>
      <p className="muted" style={{ margin: "0 0 22px", fontSize: 14 }}>{t("audio.trendingWith")}</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 30 }}>
        {audios.map((a) => {
          const using = posts.filter((p) => p.audioId === a.id);
          const open = selected === a.id;
          return (
            <div key={a.id} className="panel" style={{ overflow: "hidden" }}>
              <button
                onClick={() => setSelected(open ? null : a.id)}
                style={{ display: "flex", gap: 14, padding: 14, alignItems: "center", width: "100%", background: "none", border: "none", cursor: "pointer", color: "inherit", textAlign: "left" }}
              >
                <div style={{ position: "relative", width: 64, height: 64, borderRadius: 14, overflow: "hidden", flexShrink: 0 }}>
                  <img src={a.cover} alt="" className="media-cover" />
                  <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.4)" }}>
                    <IcMusic size={20} />
                  </span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>{a.name}</div>
                  <div className="muted" style={{ fontSize: 13 }}>{a.artist} · {a.dur}</div>
                  <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>
                    {fmt(a.uses)} {t("audio.videos")}
                  </div>
                </div>
                <span className={`btn btn-sm ${open ? "" : "btn-primary"}`}>{open ? "▲" : t("audio.use")}</span>
              </button>
              {open && (
                <div style={{ padding: "0 14px 14px", borderTop: "1px solid var(--line)" }}>
                  <SectionHeader title={t("audio.trendingWith")} />
                  <div className="no-scrollbar" style={{ display: "flex", gap: 10, overflowX: "auto" }}>
                    {using.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => nav("/")}
                        style={{ flex: "0 0 108px", position: "relative", aspectRatio: "9/16", borderRadius: 12, overflow: "hidden", border: "1px solid var(--line)", padding: 0, cursor: "pointer", background: "var(--panel-2)" }}
                      >
                        <img src={p.cover} alt="" className="media-cover" />
                      </button>
                    ))}
                    {using.length === 0 && <p className="faint" style={{ fontSize: 13 }}>—</p>}
                  </div>
                  <button className="btn btn-primary btn-sm" style={{ marginTop: 14, width: "100%" }} onClick={() => { toast(`${t("audio.use")} — ${a.name}`); nav("/create"); }}>
                    🎵 {t("audio.use")}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Page>
  );
}
