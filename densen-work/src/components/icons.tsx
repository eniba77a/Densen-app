import type { CSSProperties } from "react";

type P = { size?: number; style?: CSSProperties; filled?: boolean };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const IcHome = ({ size = 22, style, filled }: P) => (
  <svg {...base(size)} style={style} fill={filled ? "currentColor" : "none"}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
  </svg>
);

export const IcCompass = ({ size = 22, style, filled }: P) => (
  <svg {...base(size)} style={style}>
    <circle cx="12" cy="12" r="9" fill={filled ? "rgba(227,179,65,0.2)" : "none"} />
    <path d="m15.5 8.5-2 5-5 2 2-5z" fill={filled ? "currentColor" : "none"} />
  </svg>
);

export const IcPlus = ({ size = 22, style }: P) => (
  <svg {...base(size)} style={style} strokeWidth={2.4}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IcLearn = ({ size = 22, style, filled }: P) => (
  <svg {...base(size)} style={style} fill={filled ? "currentColor" : "none"}>
    <path d="m12 3 9 5-9 5-9-5z" />
    <path d="M5 10.5v5c0 1.7 3.1 3.5 7 3.5s7-1.8 7-3.5v-5" />
  </svg>
);

export const IcUser = ({ size = 22, style, filled }: P) => (
  <svg {...base(size)} style={style} fill={filled ? "currentColor" : "none"}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
  </svg>
);

export const IcSearch = ({ size = 20, style }: P) => (
  <svg {...base(size)} style={style}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const IcBell = ({ size = 20, style }: P) => (
  <svg {...base(size)} style={style}>
    <path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </svg>
);

export const IcHeart = ({ size = 22, style, filled }: P) => (
  <svg {...base(size)} style={style} fill={filled ? "currentColor" : "none"}>
    <path d="M12 21s-7.5-4.7-9.5-9C1 8.5 3 5 6.5 5c2.2 0 3.7 1.2 4.5 2.5h2C13.8 6.2 15.3 5 17.5 5 21 5 23 8.5 21.5 12c-2 4.3-9.5 9-9.5 9z" transform="scale(0.92) translate(1,0.6)" />
  </svg>
);

export const IcComment = ({ size = 22, style }: P) => (
  <svg {...base(size)} style={style}>
    <path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z" />
  </svg>
);

export const IcShare = ({ size = 22, style }: P) => (
  <svg {...base(size)} style={style}>
    <path d="m12 3 7 7h-4v7h-6v-7H5z" />
    <path d="M5 21h14" />
  </svg>
);

export const IcBookmark = ({ size = 22, style, filled }: P) => (
  <svg {...base(size)} style={style} fill={filled ? "currentColor" : "none"}>
    <path d="M6 3h12v18l-6-4.5L6 21z" />
  </svg>
);

export const IcMusic = ({ size = 22, style }: P) => (
  <svg {...base(size)} style={style}>
    <circle cx="7" cy="18" r="3" />
    <path d="M10 18V5l10-2v13" />
    <circle cx="17" cy="16" r="3" />
  </svg>
);

export const IcTrophy = ({ size = 22, style }: P) => (
  <svg {...base(size)} style={style}>
    <path d="M8 4h8v6a4 4 0 0 1-8 0z" />
    <path d="M8 5H4c0 4 1.5 6 4 6M16 5h4c0 4-1.5 6-4 6" />
    <path d="M12 14v4M8 21h8M9 18h6" />
  </svg>
);

export const IcFlame = ({ size = 22, style }: P) => (
  <svg {...base(size)} style={style}>
    <path d="M12 3s5 4.5 5 9.5a5 5 0 0 1-10 0C7 9.5 9 7.5 9 7.5s0 2 1.5 3C11 8 12 3 12 3z" />
  </svg>
);

export const IcPlay = ({ size = 22, style }: P) => (
  <svg {...base(size)} style={style} fill="currentColor" stroke="none">
    <path d="M7 4.5v15l13-7.5z" />
  </svg>
);

export const IcPause = ({ size = 22, style }: P) => (
  <svg {...base(size)} style={style} fill="currentColor" stroke="none">
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
);

export const IcArrowLeft = ({ size = 22, style }: P) => (
  <svg {...base(size)} style={style}>
    <path d="M19 12H5M11 18l-6-6 6-6" />
  </svg>
);

export const IcMessage = ({ size = 22, style, filled }: P) => (
  <svg {...base(size)} style={style} fill={filled ? "currentColor" : "none"}>
    <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.4 0-2.7-.3-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5z" />
  </svg>
);

export const IcCalendar = ({ size = 22, style }: P) => (
  <svg {...base(size)} style={style}>
    <rect x="3" y="5" width="18" height="16" rx="3" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);

export const IcMapPin = ({ size = 22, style }: P) => (
  <svg {...base(size)} style={style}>
    <path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z" />
    <circle cx="12" cy="10" r="2.6" />
  </svg>
);

export const IcCheck = ({ size = 22, style }: P) => (
  <svg {...base(size)} style={style} strokeWidth={2.4}>
    <path d="m4 12.5 5 5L20 6.5" />
  </svg>
);

export const IcVerified = ({ size = 16, style }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={style} fill="var(--gold)">
    <path d="M12 1.7 14.8 4l3.6-.3.9 3.5 3 2-1.5 3.3 1.5 3.3-3 2-.9 3.5-3.6-.3L12 23.3 9.2 21l-3.6.3-.9-3.5-3-2L3.2 12.5 1.7 9.2l3-2 .9-3.5 3.6.3z" />
    <path d="m8.5 12.5 2.5 2.5 4.5-5" stroke="#131007" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IcUsers = ({ size = 22, style }: P) => (
  <svg {...base(size)} style={style}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5" />
    <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M17.5 14.7c2.4.6 4 2.3 4 5.3" />
  </svg>
);

export const IcGlobe = ({ size = 20, style }: P) => (
  <svg {...base(size)} style={style}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.5 3.8 5.6 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.6-3.8-9S9.5 5.5 12 3z" />
  </svg>
);

export const IcShield = ({ size = 22, style }: P) => (
  <svg {...base(size)} style={style}>
    <path d="M12 2 4.5 5v6c0 5 3.2 8.6 7.5 11 4.3-2.4 7.5-6 7.5-11V5z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </svg>
);

export const IcSettings = ({ size = 22, style }: P) => (
  <svg {...base(size)} style={style}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5c.06-.4.1-.8.1-1.2z" />
  </svg>
);

export const IcSend = ({ size = 20, style }: P) => (
  <svg {...base(size)} style={style} fill="currentColor" stroke="none">
    <path d="M3 11.5 21 3l-8.5 18-2.2-7.3z" />
  </svg>
);

export const IcFilm = ({ size = 22, style }: P) => (
  <svg {...base(size)} style={style}>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4" />
  </svg>
);

export const IcSparkles = ({ size = 22, style }: P) => (
  <svg {...base(size)} style={style}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
  </svg>
);

export const IcVolume = ({ size = 20, style, filled }: P) => (
  <svg {...base(size)} style={style}>
    <path d="M4 9v6h4l5 4V5L8 9H4z" fill={filled ? "currentColor" : "none"} />
    <path d="M16.5 8.5a5 5 0 0 1 0 7" />
    <path d="M19 6a8.5 8.5 0 0 1 0 12" />
  </svg>
);

export const IcVolumeOff = ({ size = 20, style }: P) => (
  <svg {...base(size)} style={style}>
    <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
    <path d="m17 9 4 6M21 9l-4 6" />
  </svg>
);

export const IcExpand = ({ size = 20, style }: P) => (
  <svg {...base(size)} style={style}>
    <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
  </svg>
);

export const IcShrink = ({ size = 20, style }: P) => (
  <svg {...base(size)} style={style}>
    <path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5" />
  </svg>
);

/* ================= DENSEN interaction vocabulary (Day 6) =================
 * Custom marks for the dancer's own language — deliberately NOT the
 * heart/comment/share/share-bookmark clones of generic social apps.
 * Each glyph reads at 20–28px on dark video surfaces.
 * ======================================================================== */

const GOLD_FILL = (filled?: boolean) => ({ fill: filled ? "var(--gold)" : "none" });

/** 🔥 ENERGY — a dancer's flame with a beat-line, not a heart. */
export const IcEnergy = ({ size = 22, style, filled }: P) => (
  <svg {...base(size)} style={style}>
    <path
      d="M12 2.6c1.2 2.8.4 4.5-.9 6.2-1.1 1.5-2.3 3-2.3 5.2a5.2 5.2 0 0 0 10.4 0c0-1.9-.8-3.4-1.8-4.8-.3 1-.9 1.8-1.7 2.3.3-3.4-1.3-6.6-3.7-8.9z"
      {...GOLD_FILL(filled)}
      stroke="currentColor"
    />
    <path d="M8.5 21.4h7" strokeWidth={2} />
  </svg>
);

/** 💬 TALK — two overlapping speech bubbles in a call-and-response. */
export const IcTalk = ({ size = 22, style, filled }: P) => (
  <svg {...base(size)} style={style}>
    <path
      d="M3.5 5.5h11a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H8l-3.4 2.7a.5.5 0 0 1-.8-.4V7a1.5 1.5 0 0 1 1.5-1.5z"
      {...GOLD_FILL(filled)}
    />
    <path d="M19 9.5h1a1.5 1.5 0 0 1 1.5 1.5v5.4a.5.5 0 0 1-.8.4L18.6 15H14" />
  </svg>
);

/** 💃 MOVE — a dancer mid-turn with a motion trail, not an arrow. */
export const IcMove = ({ size = 22, style, filled }: P) => (
  <svg {...base(size)} style={style}>
    <circle cx="13.4" cy="4.6" r="1.7" fill="currentColor" stroke="none" />
    <path
      d="M13.2 7.2c-2.1.5-3.4 2-3.9 4.1-.3 1.4 0 2.7.6 3.9l-2.3 5M13.2 7.2c1.7.9 2.7 2.3 2.9 4.2l.6 3.4 2.6 4.9"
      {...GOLD_FILL(filled)}
    />
    <path d="M9.9 11.5 8 8.2M9.9 15.2h4.4" />
  </svg>
);

/** 🎯 PRACTICE — target with a metronome pendulum. */
export const IcPractice = ({ size = 22, style, filled }: P) => (
  <svg {...base(size)} style={style}>
    <circle cx="12" cy="12" r="8.6" {...GOLD_FILL(filled)} />
    <circle cx="12" cy="12" r="4.6" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <path d="M12 3.4V1.6" strokeWidth={2} />
  </svg>
);

/** 🔁 REMIX — two offset loop arrows forming an S. */
export const IcRemix = ({ size = 22, style }: P) => (
  <svg {...base(size)} style={style}>
    <path d="M6.5 8.5h9.2a3.3 3.3 0 0 1 0 6.6h-1.2" />
    <path d="m12.7 12.9 2.4 2.2-2.4 2.2" />
    <path d="M17.5 15.5H8.3a3.3 3.3 0 0 1 0-6.6h1.2" />
    <path d="m11.3 4.7-2.4 2.2 2.4 2.2" transform="translate(0 -0.4)" />
  </svg>
);

/** 👯 DUET — two mirrored dancers sharing one beat. */
export const IcDuet = ({ size = 22, style, filled }: P) => (
  <svg {...base(size)} style={style}>
    <circle cx="7.4" cy="4.9" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="16.6" cy="4.9" r="1.6" fill="currentColor" stroke="none" />
    <path d="M7.2 7.6c-1.8.8-2.7 2.2-2.9 4L4 15.5l2.6 5" {...GOLD_FILL(filled)} />
    <path d="M16.8 7.6c1.8.8 2.7 2.2 2.9 4l.3 3.9-2.6 5" {...GOLD_FILL(filled)} />
    <path d="M12 6.8v5.4M9.4 9.4h5.2" strokeWidth={1.6} />
  </svg>
);

/** ⚡ BOOST — lightning bolt inside a rising spotlight beam. */
export const IcBoost = ({ size = 22, style, filled }: P) => (
  <svg {...base(size)} style={style}>
    <path d="m13.4 2.8-7 10h4.4l-1.6 8.4 7.2-10.6h-4.5z" {...GOLD_FILL(filled)} />
  </svg>
);

/** 🏆 CHALLENGE — trophy cup over a battle bracket. */
export const IcChallenge = ({ size = 22, style, filled }: P) => (
  <svg {...base(size)} style={style}>
    <path d="M8 4h8v5.4a4 4 0 0 1-8 0z" {...GOLD_FILL(filled)} />
    <path d="M8 5H4.6c0 3.4 1.4 5.2 3.9 5.6M16 5h3.4c0 3.4-1.4 5.2-3.9 5.6" />
    <path d="M12 13.4v3M8.6 20.6h6.8M9.8 17.6h4.4" />
  </svg>
);

/* -------- quick comment reactions (6 one-tap energies) -------- */

export const IcOnPoint = ({ size = 20, style, filled }: P) => (
  <svg {...base(size)} style={style}>
    <circle cx="12" cy="12" r="8.4" {...GOLD_FILL(filled)} />
    <circle cx="12" cy="12" r="4.4" />
    <path d="M12 3.6V1.8M12 22.2v-1.8M3.6 12H1.8M22.2 12h-1.8" strokeWidth={2} />
  </svg>
);

export const IcVibe = ({ size = 20, style, filled }: P) => (
  <svg {...base(size)} style={style}>
    <circle cx="12" cy="12" r="8.6" {...GOLD_FILL(filled)} />
    <path d="M5.6 7.4c3.8 2.6 9 2.6 12.8 0M5.6 16.6c3.8-2.6 9-2.6 12.8 0" strokeWidth={1.5} />
  </svg>
);

export const IcInsane = ({ size = 20, style, filled }: P) => (
  <svg {...base(size)} style={style}>
    <path d="M13.2 2.4 5.4 13h4.6l-1.4 8.6L16.8 10h-4.8z" {...GOLD_FILL(filled)} />
  </svg>
);

export const IcClean = ({ size = 20, style }: P) => (
  <svg {...base(size)} style={style}>
    <path d="M6.2 12.4V5.6a1.4 1.4 0 0 1 2.8 0v5M9 10.4V4.2a1.4 1.4 0 0 1 2.8 0v6M11.8 10.6V5a1.4 1.4 0 0 1 2.8 0v6.2" />
    <path d="M14.6 11.4V6.8a1.4 1.4 0 0 1 2.8 0v6.4c0 4.2-2.4 7-6.2 7-3.2 0-5-1.8-6.4-4.8L3.6 12.6c-.6-1.2.8-2.4 1.9-1.6l1.7 1.4" />
  </svg>
);

export const IcPower = ({ size = 20, style, filled }: P) => (
  <svg {...base(size)} style={style}>
    <path d="M12 3.2a8.8 8.8 0 1 0 8.8 8.8" {...GOLD_FILL(filled)} />
    <path d="M12 3.2a8.8 8.8 0 0 1 8.8 8.8" strokeWidth={3.4} />
    <path d="M12 1.6v5.2" strokeWidth={2.2} />
  </svg>
);
