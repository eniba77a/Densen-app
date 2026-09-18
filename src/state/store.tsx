import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  achievements as allAchievements,
  courses,
  initialCompletedLessons,
  initialRecentlyWatched,
  ME,
  posts as seedPosts,
  users,
  type Post,
} from "../data/store";
import type { Lang, TKey } from "../i18n";
import { dictionaries } from "../i18n";

const LS = "densen_state_v1";

interface Persisted {
  lang: Lang;
  liked: string[];
  saved: string[];
  following: string[];
  joinedChallenges: string[];
  completed: string[];
  recent: { courseId: string; lessonId: string; at: string }[];
  registeredEvents: string[];
  xp: number;
  streak: number;
  userPosts: Post[];
  sentMessages: Record<string, { from: string; text?: string; attachmentTitle?: string; attachmentType?: string; attachmentCover?: string; time: string }[]>;
  settings: {
    privateAccount: boolean;
    showLocation: boolean;
    allowDuet: boolean;
    messagesFrom: "everyone" | "followers" | "none";
    commentFilter: boolean;
  };
}

const defaults: Persisted = {
  lang: "en",
  liked: ["p1", "p5"],
  saved: ["c_contemp1", "p3"],
  following: ["u_sara", "u_maria", "u_alex", "u_jona"],
  joinedChallenges: ["ch1"],
  completed: initialCompletedLessons,
  recent: initialRecentlyWatched,
  registeredEvents: ["e1"],
  xp: 2480,
  streak: 12,
  userPosts: [],
  sentMessages: {},
  settings: {
    privateAccount: false,
    showLocation: true,
    allowDuet: true,
    messagesFrom: "everyone",
    commentFilter: true,
  },
};

function load(): Persisted {
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return defaults;
    return { ...defaults, ...(JSON.parse(raw) as Partial<Persisted>) };
  } catch {
    return defaults;
  }
}

interface Toast {
  id: number;
  text: string;
}

interface StoreShape {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: TKey, vars?: Record<string, string | number>) => string;
  // social
  liked: Set<string>;
  toggleLike: (id: string) => void;
  saved: Set<string>;
  toggleSave: (id: string) => void;
  following: Set<string>;
  toggleFollow: (id: string) => void;
  joinedChallenges: Set<string>;
  joinChallenge: (id: string) => void;
  registeredEvents: Set<string>;
  toggleRegister: (id: string) => void;
  // learn
  completed: Set<string>;
  completeLesson: (courseId: string, lessonId: string) => void;
  isLessonDone: (lessonId: string) => boolean;
  courseProgress: (courseId: string) => number;
  recent: { courseId: string; lessonId: string; at: string }[];
  touchLesson: (courseId: string, lessonId: string) => void;
  // gamification
  xp: number;
  streak: number;
  level: number;
  xpIntoLevel: number;
  xpForLevel: number;
  achievements: typeof allAchievements;
  // posts
  allPosts: Post[];
  addPost: (p: Post) => void;
  postById: (id: string) => Post | undefined;
  // messages
  sendMessage: (convId: string, msg: { text?: string; attachmentTitle?: string; attachmentType?: string; attachmentCover?: string }) => void;
  sentMessages: Persisted["sentMessages"];
  // settings
  settings: Persisted["settings"];
  setSettings: (s: Partial<Persisted["settings"]>) => void;
  // ui
  toasts: Toast[];
  toast: (text: string) => void;
}

const Ctx = createContext<StoreShape | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Persisted>(load);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    try {
      localStorage.setItem(LS, JSON.stringify(state));
    } catch {
      /* ignore quota errors */
    }
  }, [state]);

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts, { id, text }]);
    window.setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 2400);
  }, []);

  const toggleIn = (key: "liked" | "saved" | "following" | "joinedChallenges" | "registeredEvents") => (id: string) =>
    setState((s) => {
      const set = new Set(s[key]);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...s, [key]: [...set] };
    });

  const store: StoreShape = useMemo(() => {
    const liked = new Set(state.liked);
    const saved = new Set(state.saved);
    const following = new Set(state.following);
    const joined = new Set(state.joinedChallenges);
    const registered = new Set(state.registeredEvents);
    const completed = new Set(state.completed);
    const level = Math.floor(state.xp / 1000) + 1;
    const xpIntoLevel = state.xp % 1000;

    return {
      lang: state.lang,
      setLang: (lang) => setState((s) => ({ ...s, lang })),
      t: (k, vars) => {
        let out: string = dictionaries[state.lang][k] ?? dictionaries.en[k] ?? k;
        if (vars) for (const [kk, v] of Object.entries(vars)) out = out.replace(`{${kk}}`, String(v));
        return out;
      },
      liked,
      toggleLike: (id) => {
        toggleIn("liked")(id);
        if (!liked.has(id)) setState((s) => ({ ...s, xp: s.xp + 5 }));
      },
      saved,
      toggleSave: toggleIn("saved"),
      following,
      toggleFollow: toggleIn("following"),
      joinedChallenges: joined,
      joinChallenge: (id) => {
        toggleIn("joinedChallenges")(id);
        if (!joined.has(id)) setState((s) => ({ ...s, xp: s.xp + 100 }));
      },
      registeredEvents: registered,
      toggleRegister: toggleIn("registeredEvents"),
      completed,
      completeLesson: (courseId, lessonId) => {
        setState((s) => {
          if (s.completed.includes(lessonId)) return s;
          return { ...s, completed: [...s.completed, lessonId], xp: s.xp + 150 };
        });
        void courseId;
      },
      isLessonDone: (lessonId) => completed.has(lessonId),
      courseProgress: (courseId) => {
        const c = courses.find((x) => x.id === courseId);
        if (!c || c.lessons.length === 0) return 0;
        const done = c.lessons.filter((l) => completed.has(l.id)).length;
        return Math.round((done / c.lessons.length) * 100);
      },
      recent: state.recent,
      touchLesson: (courseId, lessonId) => {
        setState((s) => {
          const rest = s.recent.filter((r) => r.lessonId !== lessonId);
          return { ...s, recent: [{ courseId, lessonId, at: "Just now" }, ...rest].slice(0, 6) };
        });
      },
      xp: state.xp,
      streak: state.streak,
      level,
      xpIntoLevel,
      xpForLevel: 1000,
      achievements: allAchievements,
      allPosts: [...state.userPosts, ...seedPosts],
      addPost: (p) => setState((s) => ({ ...s, userPosts: [p, ...s.userPosts], xp: s.xp + 200 })),
      postById: (id) => [...state.userPosts, ...seedPosts].find((p) => p.id === id),
      sendMessage: (convId, msg) =>
        setState((s) => ({
          ...s,
          sentMessages: {
            ...s.sentMessages,
            [convId]: [
              ...(s.sentMessages[convId] ?? []),
              { from: "me", text: msg.text, attachmentTitle: msg.attachmentTitle, attachmentType: msg.attachmentType, attachmentCover: msg.attachmentCover, time: "Now" },
            ],
          },
        })),
      sentMessages: state.sentMessages,
      settings: state.settings,
      setSettings: (patch) => setState((s) => ({ ...s, settings: { ...s.settings, ...patch } })),
      toasts,
      toast,
    };
  }, [state, toasts, toast]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): StoreShape {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside provider");
  return s;
}

export { ME, users };
