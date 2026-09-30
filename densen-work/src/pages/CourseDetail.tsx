import { useState } from "react";
import { useMutation } from "convex/react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Avatar, Bar, LevelBadge } from "../components/ui";
import { IcCheck, IcPlay, IcVerified } from "../components/icons";
import { useStore } from "../state/store";
import { useGov } from "../state/governance";
import { useAuth } from "../state/auth";
import { courseById, fmt, userById } from "../data/store";
import { useCatalogCourse } from "../data/useCatalogCourse";
import { courseMinutes, pricingOf, whatYouLearn } from "../data/learning";
import { money } from "../data/governance";
import { Empty, Page } from "../components/ui";
import { Modal, StatusPill } from "../components/gov-ui";
import { averageRating, reviewsFor, refundStatusNote } from "../data/governance";

export default function CourseDetail() {
  const { courseId } = useParams();
  const savePractice = useMutation(api.practiceWire.saveItem);
  const nav = useNavigate();
  const { t, lang, isLessonDone, following, toggleFollow, saved, toggleSave, toast } = useStore();
  const gov = useGov();
  const auth = useAuth();
  // Day 8 — resolve seed catalog ids instantly; Studio-published ids resolve
  // through the live public catalog (reactive, guest-browsable).
  const catalogItem = useCatalogCourse(courseId);
  const c = catalogItem?.course ?? (courseId ? courseById(courseId) : undefined);
  const [playing, setPlaying] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [spending, setSpending] = useState(false);
  // Day 14 — real checkout state. `provider_not_configured` is the HONEST
  // outcome until a payment provider is registered; the message says exactly
  // that and nothing becomes paid.
  const [buying, setBuying] = useState(false);
  const [buyMsg, setBuyMsg] = useState<string | null>(null);

  // Day 10 — real Dance-Credits unlock: the button below spends from the
  // server-authoritative ledger (never local state). Replay-safe via the
  // ledger's refId probe; balance and history are reactive subscriptions.
  const spendCredits = useMutation(api.creditsWire.spendCredits);
  // Day 14 — real purchase intent + server-owned entitlement + receipt history.
  const startPurchase = useMutation(api.paymentsWire.startPurchase);
  const myPurchases = useQuery(
    api.paymentsWire.listMyPurchases,
    auth.sessionToken ? { sessionToken: auth.sessionToken } : "skip"
  );
  const serverPurchaseOwned =
    myPurchases?.ok === true &&
    Array.isArray(myPurchases.purchases) &&
    myPurchases.purchases.some((p: { classId?: string; status?: string }) => p.classId === c?.id && p.status === "paid");
  const myCredits = useQuery(
    api.creditsWire.getMyCredits,
    auth.sessionToken ? { sessionToken: auth.sessionToken } : "skip"
  );

  // Day 7 — live server progress: completion status and the % bar are a
  // reactive Convex subscription, so a completed lesson updates here and on
  // Progress instantly, no refresh. Local store state remains the signed-out
  // preview source.
  const serverProgress = useQuery(
    api.learningWire.getCourseProgress,
    auth.sessionToken && c
      ? { sessionToken: auth.sessionToken, courseKey: c.id, lessonKeys: c.lessons.map((l) => l.id) }
      : "skip"
  );
  const serverLive = Boolean(
    serverProgress && typeof serverProgress === "object" && "ok" in serverProgress && serverProgress.ok
  );
  const doneSet: Set<string> = serverLive
    ? new Set((serverProgress as { completed: string[] }).completed)
    : new Set();
  const isDone = (lessonId: string) => (serverLive ? doneSet.has(lessonId) : isLessonDone(lessonId));
  const pct = c
    ? serverLive
      ? (serverProgress as { pct: number }).pct
      : Math.round((c.lessons.filter((l) => isLessonDone(l.id)).length / c.lessons.length) * 100)
    : 0;

  if (!c) return <Page><Empty icon="🔍" text="Course not found" /></Page>;

  // Seed rows resolve their teacher from the store; Studio-published rows
  // carry the server's public teacher projection.
  const teacher = catalogItem?.teacher ?? userById(c.teacherId);
  const isFollowing = following.has(teacher.id);
  const isSaved = saved.has(c.id);
  const nextLesson = c.lessons.find((l) => !isDone(l.id)) ?? c.lessons[0];
  const priced = catalogItem?.pricing ?? pricingOf(c.id)!;
  const owned = gov.owns(c.id);
  // Day 10 — server-side unlock state: a recorded credit spend for this
  // class in the ledger means unlocked, regardless of local mirrors.
  // Day 14 — a verified PAID purchase on the server also means unlocked.
  const serverOwned =
    (myCredits?.ok === true &&
      Array.isArray(myCredits.history) &&
      myCredits.history.some((h) => h.refId === `class:${c.id}` && h.amount < 0)) ||
    serverPurchaseOwned;
  const unlocked = owned || serverOwned;
  const creditBalance = myCredits?.ok === true ? myCredits.balance : null;
  const reviews = reviewsFor(c.id);
  const avg = averageRating(c.id);
  const minutes = courseMinutes(c);
  const outcomes = whatYouLearn(c);
  const access = priced.accessModel;
  const courseComplete = pct === 100;

  return (
    <Page>
      <button onClick={() => nav(-1)} className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }}>
        ← {t("common.back")}
      </button>

      {/* trailer */}
      <div className="video-stage" style={{ marginBottom: 18 }}>
        {playing ? (
          <video src={c.trailer} poster={c.cover} autoPlay controls loop muted aria-label={`Trailer: ${c.title}, ${c.style} course by ${teacher.name}`} />
        ) : (
          <>
            <img src={c.cover} alt={`Dancer performing ${c.style.toLowerCase()} choreography — cover of the course ${c.title} by ${teacher.name}`} className="media-cover" />
            <button
              onClick={() => setPlaying(true)}
              aria-label={`${t("common.watchTrailer")}: ${c.title}`}
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(0,0,0,0.3)",
                border: "none",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  width: 74,
                  height: 74,
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #f0c75e, var(--gold) 55%, #cf9a35)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#171204",
                  boxShadow: "0 10px 34px rgba(227,179,65,0.45)",
                  transition: "transform 0.2s ease",
                }}
              >
                <IcPlay size={30} />
              </span>
            </button>
          </>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <LevelBadge level={c.level} />
        <span className="chip" style={{ fontSize: 11.5, padding: "4px 11px" }}>{c.style}</span>
        {/* Day 7 — access model chip: FREE / PAID / CREDITS / PAID+CREDITS */}
        <span
          className="chip"
          style={{
            fontSize: 11.5,
            padding: "4px 11px",
            fontWeight: 800,
            ...(access === "free" ? { color: "var(--gold)", borderColor: "var(--gold-line)" } : {}),
          }}
        >
          {access === "free" && `✦ ${t("learn.access.free")}`}
          {access === "paid" && money(priced.priceCents)}
          {access === "credits" && `${priced.creditPrice} ✦ ${t("learn.credits")}`}
          {access === "paid_credits" && `${money(priced.priceCents)} · ${t("learn.or")} ${priced.creditPrice} ✦`}
        </span>
        {avg !== null ? (
          <span className="faint" style={{ fontSize: 12.5 }}>★ {avg} · {fmt(c.enrolled)} {t("learn.enrolled")}</span>
        ) : (
          <span className="faint" style={{ fontSize: 12.5 }}>{fmt(c.enrolled)} {t("learn.enrolled")} · No reviews yet</span>
        )}
      </div>

      <h1 style={{ fontSize: 25, fontWeight: 800, marginBottom: 14 }}>{c.title}</h1>

      {/* teacher */}
      <div className="panel" style={{ padding: 14, display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <Avatar src={teacher.avatar} size={46} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, display: "flex", alignItems: "center", gap: 6 }}>
            {teacher.name} {teacher.verified && <IcVerified />}
          </div>
          <div className="muted" style={{ fontSize: 12.5 }}>{t("learn.teacher")} · @{teacher.username}</div>
        </div>
        <button className={`btn btn-sm ${isFollowing ? "" : "btn-primary"}`} onClick={() => toggleFollow(teacher.id)}>
          {isFollowing ? t("common.following") : t("common.follow")}
        </button>
      </div>

      {/* CTA */}
      <div style={{ display: "flex", gap: 10, marginBottom: 22, flexWrap: "wrap" }}>
        <button className="btn btn-primary" style={{ flex: 1, minWidth: 200 }} onClick={() => nav(`/lesson/${c.id}/${nextLesson.id}`)}>
          {pct > 0 ? t("learn.continueCourse") : t("learn.startCourse")} <IcPlay size={15} />
        </button>
        <button
          className="btn"
          onClick={() => {
            toggleSave(c.id);
            // Day 12 — the bookmark also creates the real MY PRACTICE item
            // (idempotent per contentRef) with the class step plan.
            if (auth.sessionToken && !isSaved) {
              void savePractice({
                sessionToken: auth.sessionToken,
                kind: "class",
                title: c.title,
                style: c.style,
                difficulty: c.level,
                contentRef: c.id,
                href: `/course/${c.id}`,
              });
              toast(`${t("practice.loggedPractice")} 🎯`);
            }
          }}
        >
          {isSaved ? "🔖" : "📑"} {isSaved ? t("common.saved") : t("common.save")}
        </button>
      </div>

      {/* Day 7 — pricing architecture: FREE / PAID / CREDITS / PAID+CREDITS.
          No fake payments: PAID shows an honest "checkout coming soon" state;
          CREDITS are real (ledger-backed) and unlock today. */}
      <div className="panel" style={{ padding: 16, marginBottom: 22, borderColor: unlocked || access === "free" ? "rgba(74,222,128,0.35)" : "var(--gold-line)" }}>
        {access === "free" && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <StatusPill status="pass" label={t("learn.access.free")} />
            <span className="faint" style={{ fontSize: 12.5 }}>{t("learn.freeForever")}</span>
          </div>
        )}
        {access !== "free" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 20 }}>
                {access !== "credits" ? money(priced.priceCents) : ""}
                {access === "paid_credits" && <span className="faint" style={{ fontSize: 13, fontWeight: 600 }}> {t("learn.or")} </span>}
                {access !== "paid" && <span className="gold-text">{priced.creditPrice} ✦ {t("learn.credits")}</span>}
              </strong>
              <span className="faint" style={{ fontSize: 12 }}>{t("gov.buy.fees")}: {t("gov.buy.feesValue")}</span>
            </div>
            {unlocked ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                <StatusPill status="pass" label={t("gov.owned")} />
                <button className="btn btn-sm" onClick={() => nav("/settings#purchases")}>↩️ {t("gov.refund.request")}</button>
              </div>
            ) : (
              <>
                {access !== "credits" && (
                  <button className="btn btn-primary" style={{ width: "100%", marginTop: 12 }} onClick={() => setCheckout(true)}>
                    🛒 {t("gov.buy.confirm")} — {money(priced.priceCents)}
                  </button>
                )}
                {access !== "paid" && (
                  <button
                    className="btn"
                    style={{ width: "100%", marginTop: 10, borderColor: "var(--gold-line)" }}
                    disabled={spending || creditBalance === null}
                    onClick={async () => {
                      if (!auth.sessionToken || creditBalance === null) return;
                      setSpending(true);
                      try {
                        const r = await spendCredits({
                          sessionToken: auth.sessionToken,
                          amount: priced.creditPrice,
                          courseKey: c.id,
                        });
                        if (r.ok) {
                          gov.buyCourse(c.id); // client mirror (purchase terms consent flow)
                          toast(`${t("learn.unlockedToast")} ✦`);
                        } else if (r.error === "insufficient_credits") {
                          toast(t("learn.err.insufficient"));
                        } else if (r.error === "duplicate_unlock") {
                          toast(t("learn.err.duplicate"));
                        } else {
                          toast(t("common.error"));
                        }
                      } finally {
                        setSpending(false);
                      }
                    }}
                  >
                    {spending ? t("learn.unlocking") : `✦ ${t("learn.unlockCredits")} — ${priced.creditPrice} ${t("learn.credits")}`}
                  </button>
                )}
                {creditBalance !== null && (
                  <p className="faint" style={{ fontSize: 11.5, marginTop: 10 }}>
                    ✦ {t("learn.yourCredits")}: <strong className="gold-text">{creditBalance}</strong>
                  </p>
                )}
                <p className="faint" style={{ fontSize: 11.5, marginTop: 10 }}>
                  {t("learn.checkoutSoon")} · {t("gov.buy.refundDesc")} <button onClick={() => nav("/legal/refunds")} style={{ background: "none", border: "none", color: "var(--gold)", fontWeight: 700, cursor: "pointer", padding: 0, fontSize: 11.5 }}>{t("gov.buy.refund")} →</button>
                </p>
              </>
            )}
          </>
        )}
      </div>

      {/* Day 7 — completion status: live from the server progress rows */}
      {courseComplete && (
        <div className="panel" style={{ padding: 14, marginBottom: 22, borderColor: "rgba(74,222,128,0.35)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <StatusPill status="pass" label={t("learn.courseComplete")} />
          <span className="faint" style={{ fontSize: 12.5 }}>{t("learn.certNote")}</span>
        </div>
      )}

      {/* Day 7 — what you learn, derived from the course's own lessons */}
      <section style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 17, marginBottom: 10 }}>{t("learn.whatYouLearn")}</h2>
        <div style={{ display: "grid", gap: 8 }}>
          {outcomes.map((o) => (
            <div key={o} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
              <span style={{ color: "var(--gold)", fontWeight: 800, flexShrink: 0 }}>✓</span>
              <span className="muted" style={{ fontSize: 14, lineHeight: 1.55 }}>{o}</span>
            </div>
          ))}
        </div>
      </section>

      {pct > 0 && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
            <span>{t("learn.inProgress")}</span>
            <span className="gold-text">{pct}%</span>
          </div>
          <Bar pct={pct} lg />
        </div>
      )}

      {/* about */}
      <section style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 17, marginBottom: 10 }}>{t("learn.about")}</h2>
        <p className="muted" style={{ margin: 0, lineHeight: 1.65, fontSize: 14.5 }}>{c.about}</p>
      </section>

      {/* curriculum — checkmarks live from server progress (Day 7) */}
      <section>
        <h2 style={{ fontSize: 17, marginBottom: 12 }}>
          {t("learn.curriculum")} · {c.lessons.length} {t("learn.lessons")} · {minutes} {t("common.min")}
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {c.lessons.map((l, i) => {
            const done = isDone(l.id);
            return (
              <button
                key={l.id}
                onClick={() => nav(`/lesson/${c.id}/${l.id}`)}
                className="panel panel-hover"
                style={{ display: "flex", alignItems: "center", gap: 13, padding: 13, cursor: "pointer", textAlign: "left", color: "inherit", width: "100%" }}
              >
                <span
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 11,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: done ? "var(--gold-soft)" : "rgba(255,255,255,0.06)",
                    color: done ? "var(--gold)" : "var(--ink-dim)",
                    fontSize: 15,
                    fontWeight: 800,
                  }}
                >
                  {done ? <IcCheck size={18} /> : i + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{l.title}</div>
                  <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>{l.dur} {t("common.min")}</div>
                </div>
                <IcPlay size={16} />
              </button>
            );
          })}
        </div>
      </section>

      {/* authentic reviews only — no seeded ratings for courses without UGC */}
      <section style={{ marginTop: 26 }}>
        <h2 style={{ fontSize: 17, marginBottom: 12 }}>💬 {lang === "sq" ? "Vlerësime" : "Reviews"} {avg !== null && <span className="faint" style={{ fontSize: 13 }}>· ★ {avg} · {reviews.length}</span>}</h2>
        {reviews.length === 0 ? (
          <p className="faint" style={{ fontSize: 13.5 }}>No reviews yet{lang === "sq" ? " — akoma pa vlerësime" : ""}. Only dancers who took this class can review it.</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {reviews.map((r) => {
              const ru = userById(r.userId);
              return (
                <div key={r.id} className="panel" style={{ padding: 13 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <Avatar src={ru.avatar} size={30} />
                    <strong style={{ fontSize: 13 }}>@{ru.username}</strong>
                    <span className="faint" style={{ fontSize: 12 }}>★ {r.rating}</span>
                    <span className="faint" style={{ fontSize: 11, marginLeft: "auto" }}>{r.ts}</span>
                  </div>
                  <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.6 }}>{r.text}</p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* checkout modal — price transparency before any confirmation */}
      {checkout && access !== "free" && (
        <Modal open onClose={() => setCheckout(false)} title={t("gov.buy.title")}>
          <p className="muted" style={{ fontSize: 13, marginBottom: 4 }}>{c.title}</p>
          {access !== "credits" && (
            <>
              <div style={{ borderBottom: "1px solid var(--line)", padding: "10px 0", display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span>{t("gov.buy.price")}</span>
                <strong>{money(priced.priceCents)}</strong>
              </div>
              <div style={{ borderBottom: "1px solid var(--line)", padding: "10px 0", display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span>{t("gov.buy.fees")}</span>
                <strong>0.00 EUR</strong>
              </div>
            </>
          )}
          {access !== "paid" && (
            <div style={{ borderBottom: "1px solid var(--line)", padding: "10px 0", display: "flex", justifyContent: "space-between", fontSize: 14 }}>
              <span>{t("learn.unlockCredits")}</span>
              <strong className="gold-text">{priced.creditPrice} ✦</strong>
            </div>
          )}
          <div style={{ padding: "12px 0", display: "flex", justifyContent: "space-between", fontSize: 16 }}>
            <strong>{t("gov.buy.total")}</strong>
            <strong className="gold-text" style={{ fontSize: 18 }}>{money(priced.priceCents)}</strong>
          </div>
          <div className="panel" style={{ padding: 13, background: "var(--panel-2)", fontSize: 13, lineHeight: 1.7 }}>
            <div>🎁 <strong>{t("gov.buy.get")}:</strong> {t("gov.buy.getDesc")}</div>
            <div style={{ marginTop: 6 }}>↩️ <strong>{t("gov.buy.refund")}:</strong> {t("gov.buy.refundDesc")}</div>
            <div style={{ marginTop: 6 }}>🏢 {t("gov.businessInfo")}: <button onClick={() => { setCheckout(false); nav("/business"); }} style={{ background: "none", border: "none", color: "var(--gold)", cursor: "pointer", padding: 0, fontSize: 12.5, fontWeight: 700 }}>densen.app/business</button></div>
          </div>
          <p className="faint" style={{ fontSize: 12, marginTop: 10 }}>{t("gov.buy.terms")}</p>
          {!auth.sessionToken && (
            <p className="faint" style={{ fontSize: 11.5, marginTop: 6, color: "var(--gold)" }}>ℹ {t("pay.demoNote")}</p>
          )}
          <p className="faint" style={{ fontSize: 11.5, marginTop: 6, color: "var(--warn)" }}>⚠ {t("gov.buy.demo")}</p>
          {buyMsg && (
            <p className="faint" style={{ fontSize: 12, marginTop: 8, color: "var(--warn)" }}>{buyMsg}</p>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button className="btn" style={{ flex: 1 }} onClick={() => setCheckout(false)}>{t("common.cancel")}</button>
            {auth.sessionToken ? (
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={buying}
                onClick={async () => {
                  setBuying(true);
                  setBuyMsg(null);
                  try {
                    const r = await startPurchase({
                      sessionToken: auth.sessionToken!,
                      classId: c.id,
                      seedPriceCents: priced.priceCents,
                      seedCreditPrice: priced.creditPrice,
                    });
                    if (r.ok) {
                      // Real provider session minted — hand off to the provider's
                      // checkout page. The purchase stays pending until the
                      // provider's verified event confirms payment.
                      setCheckout(false);
                      toast(t("pay.startCheckout"));
                      window.location.href = r.checkoutUrl;
                    } else {
                      // Honest failure mapping — nothing is ever marked paid here.
                      if (r.error === "provider_not_configured") setBuyMsg(t("pay.err.provider_not_configured"));
                      else if (r.error === "already_owned") setBuyMsg(t("pay.err.already_owned"));
                      else if (r.error === "already_pending") setBuyMsg(t("pay.err.already_pending"));
                      else if (r.error === "unauthenticated") setBuyMsg(t("pay.err.unauthenticated"));
                      else if (r.error === "free_class" || r.error === "not_purchasable") setBuyMsg(t("common.error"));
                      else setBuyMsg(t("common.error"));
                    }
                  } finally {
                    setBuying(false);
                  }
                }}
              >
                {buying ? "…" : `🛒 ${t("pay.startCheckout")}${access !== "credits" ? ` · ${money(priced.priceCents)}` : ""}`}
              </button>
            ) : (
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={() => {
                  gov.buyCourse(c.id);
                  setCheckout(false);
                  toast(t("gov.buy.done"));
                }}
              >
                {t("gov.buy.confirm")}{access !== "credits" ? ` · ${money(priced.priceCents)}` : ""}
              </button>
            )}
          </div>
        </Modal>
      )}

      {/* review composer — genuine UGC only, one per dancer */}
      {access === "free" && <ReviewComposer courseId={c.id} />}
    </Page>
  );
}

function ReviewComposer({ courseId }: { courseId: string }) {
  const { t } = useStore();
  const { addReview, reviews, toast } = useGov();
  const already = reviews.some((r) => r.courseId === courseId);
  const [rating, setRating] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  const [text, setText] = useState("");
  if (already) return null;
  return (
    <section style={{ marginTop: 20 }}>
      <h2 style={{ fontSize: 15, marginBottom: 10 }}>✍️ {t("common.comment")}</h2>
      <div className="panel" style={{ padding: 14 }}>
        <div role="radiogroup" aria-label="Rating" style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {([1, 2, 3, 4, 5] as const).map((n) => (
            <button
              key={n}
              role="radio"
              aria-checked={rating === n}
              onClick={() => setRating(n)}
              style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: rating >= n ? "var(--gold)" : "var(--ink-faint)", padding: 2 }}
            >
              ★<span style={{ fontSize: 11, marginLeft: 2 }}>{n}</span>
            </button>
          ))}
        </div>
        <textarea className="input" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("gov.report.details")} aria-label={t("common.comment")} />
        <button
          className="btn btn-primary btn-sm"
          style={{ marginTop: 10 }}
          disabled={!rating || !text.trim()}
          onClick={() => {
            if (rating !== 0) addReview(courseId, rating, text.trim());
            toast("Review posted ✓");
          }}
        >
          {t("messages.send")}
        </button>
      </div>
    </section>
  );
}
// refundStatusNote remains available for purchase rows rendered in Settings
void refundStatusNote;
