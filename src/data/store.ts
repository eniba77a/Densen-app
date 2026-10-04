import { AVATARS, IMG, VID } from "./media";

/* ------------------------------ types ------------------------------ */
export interface User {
  id: string;
  name: string;
  username: string;
  avatar: string;
  bio: string;
  styles: string[];
  location?: string;
  followers: number;
  following: number;
  likes: number;
  verified?: boolean;
  teacher?: boolean;
  teamId?: string;
  minor?: boolean;
}

export interface Team {
  id: string;
  name: string;
  logo: string;
  cover: string;
  styles: string[];
  members: string[];
  foundedBy: string;
  city: string;
  about: string;
  achievements: string[];
}

export interface Lesson {
  id: string;
  title: string;
  dur: number; // minutes
  video: string;
  moves: { name: string; timing: string; tip: string; atSec?: number }[];
  desc: string;
}

export interface Course {
  id: string;
  title: string;
  teacherId: string;
  style: string;
  level: "Beginner" | "Intermediate" | "Advanced" | "Kids";
  cover: string;
  lessons: Lesson[];
  enrolled: number;
  rating: number;
  about: string;
  isNew?: boolean;
  featured?: boolean;
  popular?: boolean;
  trailer: string;
}

export interface Post {
  id: string;
  userId: string;
  video: string;
  cover: string;
  style: string;
  caption: string;
  hashtags: string[];
  audioId: string;
  likes: number;
  comments: Comment[];
  shares: number;
  duetOf?: string; // post id
  choreoBy?: string; // user id of original choreographer
  lessonRef?: string; // course id for "Learn this move"
  views: number;
}

/**
 * Vertical feed video sources — distinct clips per post (Day 5).
 * All URLs verified reachable (HTTP 206). Pexels File API URLs are stable
 * direct MP4s; specs resolve per-upload, so candidates are probed before use.
 */
export const FEED_VIDEOS = [VID.portrait, VID.portrait2, VID.landscapeB, VID.landscapeA, VID.landscapeC] as const;

export interface Comment {
  id: string;
  userId: string;
  text: string;
  time: string;
  likes: number;
}

export interface Challenge {
  id: string;
  title: string;
  desc: string;
  cover: string;
  style: string;
  deadline: string;
  daysLeft: number;
  participants: number;
  status: "active" | "upcoming" | "ended";
  tutorialCourseId: string;
  featuredChoreoBy: string;
  entries: { userId: string; postId: string; votes: number }[];
  prizes: string[];
}

export interface DanceEvent {
  id: string;
  type: "Workshop" | "Competition" | "Masterclass" | "Live class" | "Audition" | "Festival";
  title: string;
  date: string;
  time: string;
  location: string;
  online?: boolean;
  hostId: string;
  participants: number;
  cover: string;
  desc: string;
  spotsLeft?: number;
}

export interface LiveClass {
  id: string;
  title: string;
  teacherId: string;
  style: string;
  startsIn: string;
  viewers?: number;
  cover: string;
  live?: boolean;
}

export interface Audio {
  id: string;
  name: string;
  artist: string;
  cover: string;
  uses: number;
  dur: string;
}

export interface ChatMessage {
  id: string;
  from: string; // user id or "me"
  text?: string;
  attachment?: { type: "lesson" | "post" | "video" | "choreo" | "challenge"; title: string; cover: string };
  time: string;
  liked?: boolean;
}

export interface Conversation {
  id: string;
  participants: string[]; // user ids
  group?: boolean;
  name?: string;
  messages: ChatMessage[];
  online?: boolean;
}

export interface AppNotification {
  id: string;
  kind: "like" | "follow" | "comment" | "challenge" | "message" | "progress" | "live" | "duet";
  actorId?: string;
  text: string;
  time: string;
  read: boolean;
}

export interface Achievement {
  id: string;
  icon: string;
  name: string;
  desc: string;
  unlocked: boolean;
  progress?: number; // 0-100 for locked ones
}

/* ------------------------------ users ------------------------------ */
export const users: User[] = [
  {
    id: "u_sara",
    name: "Sara Krasniqi",
    username: "sara.moves",
    avatar: AVATARS.sara,
    bio: "Hip Hop & Commercial 🔥 | Choreographer | Tirana → Berlin\nBookings: sara@densen.app",
    styles: ["Hip Hop", "Commercial"],
    location: "Berlin, DE",
    followers: 128400,
    following: 312,
    likes: 2100000,
    verified: true,
    teacher: true,
  },
  {
    id: "u_alex",
    name: "Alex Duran",
    username: "alexdrills",
    avatar: AVATARS.alex,
    bio: "B-boy. Footwork over everything. Teaching the foundations the right way.",
    styles: ["Hip Hop", "Breaking"],
    location: "Barcelona, ES",
    followers: 64200,
    following: 208,
    likes: 890000,
    teacher: true,
  },
  {
    id: "u_maria",
    name: "Maria Efthymiou",
    username: "maria.contemporary",
    avatar: AVATARS.maria,
    bio: "Contemporary dancer & teacher. Movement is a language — let's speak it.",
    styles: ["Contemporary", "Jazz"],
    location: "Athens, GR",
    followers: 45800,
    following: 190,
    likes: 610000,
    verified: true,
    teacher: true,
  },
  {
    id: "u_denisa",
    name: "Denisa Hoxha",
    username: "denisa",
    avatar: AVATARS.denis,
    bio: "Latin soul 💃 Salsa • Bacha• Cha-cha. Prishtinë",
    styles: ["Latin"],
    location: "Prishtinë, XK",
    followers: 23100,
    following: 340,
    likes: 318000,
    teacher: true,
  },
  {
    id: "u_jona",
    name: "Jona Marku",
    username: "jona.m",
    avatar: AVATARS.jona,
    bio: "15 🎓 Densen Academy student | Commercial & Hip Hop | challenge addict",
    styles: ["Commercial", "Hip Hop"],
    location: "Tirana, AL",
    followers: 4120,
    following: 512,
    likes: 38400,
    minor: true,
    teamId: "t_urban",
  },
  {
    id: "u_kejsi",
    name: "Kejsi Tola",
    username: "kejsi.dances",
    avatar: AVATARS.kejsi,
    bio: "Jazz hands, real feelings. Adjudicator at DenFest '25.",
    styles: ["Jazz"],
    location: "Tirana, AL",
    followers: 18700,
    following: 230,
    likes: 240000,
    teacher: true,
  },
  {
    id: "u_luan",
    name: "Luan Berisha",
    username: "luan.hoops",
    avatar: AVATARS.luan,
    bio: "Street styles historian. Popping since 2009.",
    styles: ["Hip Hop"],
    followers: 9840,
    following: 120,
    likes: 120000,
    teamId: "t_golden",
  },
  {
    id: "u_elsa",
    name: "Elsa Haderi",
    username: "elsaflex",
    avatar: AVATARS.elsa,
    bio: "Contemporary • floorwork lover • cat mom 🐈",
    styles: ["Contemporary"],
    location: "Shkodër, AL",
    followers: 7740,
    following: 301,
    likes: 88400,
    teamId: "t_motion",
  },
  {
    id: "u_arben",
    name: "Arben Kola",
    username: "arbenbaila",
    avatar: AVATARS.arben,
    bio: "Salsa On1. If it's not musical, it's just steps.",
    styles: ["Latin"],
    followers: 5320,
    following: 187,
    likes: 61200,
  },
  {
    id: "u_noa",
    name: "Noa Rama",
    username: "noarocks",
    avatar: AVATARS.noa,
    bio: "12 ✨ Kids Hip Hop | future champion",
    styles: ["Hip Hop", "Kids"],
    followers: 2310,
    following: 98,
    likes: 21400,
    minor: true,
    teamId: "t_urban",
  },
  {
    id: "u_maya",
    name: "Maya Santos",
    username: "mayamoves",
    avatar: AVATARS.maya,
    bio: "Commercial • heels • saudade",
    styles: ["Commercial"],
    location: "Lisbon, PT",
    followers: 33900,
    following: 410,
    likes: 540000,
    verified: true,
    teacher: true,
  },
  {
    id: "u_luca",
    name: "Luca Vitale",
    username: "lucav",
    avatar: AVATARS.luca,
    bio: "All-styles competitor. Battle me at DenFest.",
    styles: ["Hip Hop", "Latin"],
    location: "Milan, IT",
    followers: 15200,
    following: 260,
    likes: 210000,
  },
];

export const ME: User = {
  id: "me",
  name: "Bledi Gashi",
  username: "bledi.dances",
  avatar: AVATARS.me,
  bio: "Learning something new every day 💛 Hip Hop & Commercial. Densen since day one.",
  styles: ["Hip Hop", "Commercial"],
  location: "Tirana, AL",
  followers: 1240,
  following: 348,
  likes: 18900,
  teamId: "t_urban",
};

export const userById = (id: string): User =>
  id === "me" ? ME : users.find((u) => u.id === id) ?? users[0];

/* ------------------------------ teams ------------------------------ */
export const teams: Team[] = [
  {
    id: "t_urban",
    name: "Urban Pulse",
    logo: AVATARS.team,
    cover: IMG.extra7,
    styles: ["Hip Hop", "Commercial"],
    members: ["u_jona", "u_noa", "me", "u_luan"],
    foundedBy: "u_sara",
    city: "Tirana, AL",
    about: "Tirana's youth collective. We train Tuesdays, we post Fridays, we win Saturdays.",
    achievements: ["DenFest Battle '25 — Finalists", "30-Day Challenge — Most Consistent Team"],
  },
  {
    id: "t_golden",
    name: "Golden Hour",
    logo: AVATARS.team2,
    cover: IMG.extra11,
    styles: ["Contemporary", "Jazz"],
    members: ["u_maria", "u_elsa", "u_kejsi"],
    foundedBy: "u_maria",
    city: "Athens, GR",
    about: "Contemporary crew focused on storytelling and stage craft.",
    achievements: ["Best Group Piece — Athens Dance Week"],
  },
  {
    id: "t_motion",
    name: "Motion Labs",
    logo: AVATARS.team3,
    cover: IMG.extra21,
    styles: ["Commercial", "Contemporary"],
    members: ["u_maya", "u_elsa", "u_luca"],
    foundedBy: "u_maya",
    city: "Lisbon, PT",
    about: "Lab-style team. We experiment, we film, we share.",
    achievements: ["1M views on 'Saudade' piece"],
  },
  {
    id: "t_street",
    name: "Street Theory",
    logo: AVATARS.team4,
    cover: IMG.extra19,
    styles: ["Hip Hop"],
    members: ["u_alex", "u_luan", "u_luca"],
    foundedBy: "u_alex",
    city: "Barcelona, ES",
    about: "Foundations, history, cyphers. Street styles done properly.",
    achievements: ["BBB Battle '24 — Crew Winners"],
  },
];

export const teamById = (id?: string) => teams.find((t) => t.id === id);

/* ------------------------------ audio ------------------------------ */
export const audios: Audio[] = [
  { id: "a1", name: "Mëso Vallëzimin", artist: "MC Dhoma", cover: IMG.music, uses: 42100, dur: "0:22" },
  { id: "a2", name: "Golden Hour", artist: "Ivy Reese", cover: IMG.music2, uses: 28900, dur: "0:30" },
  { id: "a3", name: "Balkan Bounce", artist: "DJ Ilir", cover: IMG.music3, uses: 19800, dur: "0:18" },
  { id: "a4", name: "Slow Burn", artist: "Nova & The Fog", cover: IMG.extra16, uses: 12400, dur: "0:45" },
  { id: "a5", name: "Timberline", artist: "OAKS", cover: IMG.extra17, uses: 9800, dur: "0:26" },
];

export const audioById = (id: string) => audios.find((a) => a.id === id) ?? audios[0];

/* ------------------------------ courses ------------------------------ */
const lesson = (
  id: string,
  title: string,
  dur: number,
  moves: Lesson["moves"],
  desc: string,
  video = VID.landscapeA
): Lesson => ({ id, title, dur, video, moves, desc });

export const courses: Course[] = [
  {
    id: "c_hiphop1",
    title: "Hip Hop Foundations",
    teacherId: "u_alex",
    style: "Hip Hop",
    level: "Beginner",
    cover: IMG.catHipHop,
    trailer: VID.landscapeA,
    featured: true,
    popular: true,
    enrolled: 48200,
    rating: 4.9,
    about:
      "Build real hip hop foundations: groove, bounce, isolation and timing. Every drill comes from authentic street styles and is broken down step by step so absolute beginners can follow along.",
    lessons: [
      lesson("l_h1", "The Bounce & Basic Groove", 12, [
        { name: "Two-step bounce", timing: "Counts 1–2", tip: "Stay low, knees soft, chest relaxed." },
        { name: "Shoulder groove", timing: "Counts 3–4", tip: "Let the shoulders answer the beat." },
        { name: "Full body groove", timing: "Counts 5–8", tip: "Imagine the music is moving you, not the other way." },
      ], "Everything in hip hop sits on top of the groove. We start with the two-step bounce and grow it into a full-body foundation groove you can use in any song."),
      lesson("l_h2", "Isolations: Head, Chest, Hips", 14, [
        { name: "Head isolation", timing: "4 × 8 counts", tip: "Move one thing at a time — check in a mirror." },
        { name: "Chest pop & circles", timing: "4 × 8 counts", tip: "Exhale on the pop for extra sharpness." },
        { name: "Hip figure-8", timing: "4 × 8 counts", tip: "Knees slightly bent gives you the range." },
      ], "Isolations are your vocabulary. Master moving one body part independently and combinations stop feeling impossible."),
      lesson("l_h3", "Your First 8-Count Combination", 16, [
        { name: "Step-touch pivot", timing: "Counts 1–4", tip: "Pivot from the ball of the foot." },
        { name: "Body roll to freeze", timing: "Counts 5–8", tip: "Hit the freeze exactly on the snare." },
        { name: "Full combo at 75%", timing: "2 × 8 counts", tip: "Clean beats fast. Speed comes later." },
      ], "Time to chain it together. We learn a beginner 8-count combination at half speed, then clean it up before adding energy."),
      lesson("l_h4", "Grooving Through a Whole Song", 18, [
        { name: "Transition drill", timing: "Loop 8 counts", tip: "Never stop moving between hits." },
        { name: "Freestyle prompts", timing: "4 × 16 counts", tip: "Use one new element per phrase." },
      ], "The final test: keep your groove alive for a full track. We practice transitions and simple freestyle prompts so you never stand still."),
    ],
  },
  {
    id: "c_commercial1",
    title: "Commercial Choreography: Stage Ready",
    teacherId: "u_sara",
    style: "Commercial",
    level: "Intermediate",
    cover: IMG.catCommercial,
    trailer: VID.landscapeB,
    featured: true,
    isNew: true,
    enrolled: 31400,
    rating: 4.8,
    about:
      "Learn a full commercial routine built for the camera. Lines, texture, performance energy — this is the course that makes your videos look professional.",
    lessons: [
      lesson("l_c1", "Camera Lines & Angles", 13, [
        { name: "Straight-line reach", timing: "8 counts", tip: "Extend through the fingertips, not the elbow." },
        { name: "Diagonal walk", timing: "8 counts", tip: "Cross slightly downstage for depth." },
      ], "Commercial dance lives on camera. We map the frame and learn where your lines read strongest."),
      lesson("l_c2", "Texture: Sharp vs Smooth", 15, [
        { name: "Staccato hits", timing: "8 counts", tip: " Imagine hitting a wall and stopping instantly." },
        { name: "Melt transitions", timing: "8 counts", tip: "Let one movement pour into the next." },
      ], "Texture is what separates dancers who execute steps from dancers who perform."),
      lesson("l_c3", "The Full Routine", 22, [
        { name: "Verse 1 combo", timing: "16 counts", tip: "Film yourself — the camera sees what you miss." },
        { name: "Chorus drop", timing: "16 counts", tip: "Energy up, but stay controlled." },
        { name: "Performance run", timing: "Full track", tip: "Give 110% like the camera is your best friend." },
      ], "The complete routine, built section by section, then performed full-out with performance notes."),
    ],
  },
  {
    id: "c_contemp1",
    title: "Contemporary: Floorwork & Flow",
    teacherId: "u_maria",
    style: "Contemporary",
    level: "Intermediate",
    cover: IMG.catContemporary,
    trailer: VID.landscapeA,
    featured: true,
    enrolled: 22700,
    rating: 4.9,
    about:
      "Fluid floorwork, breath-driven phrasing and safe falling techniques. Contemporary that feels like water and lands like thunder.",
    lessons: [
      lesson("l_f1", "Safe Falling & Weight", 14, [
        { name: "Back slide fall", timing: "8 counts", tip: "Release the head last, land on flesh not bone." },
        { name: "Shoulder roll", timing: "8 counts", tip: "Round like a ball, never flat." },
      ], "Floorwork starts with trust in the floor. We learn weight release and how to fall safely and beautifully."),
      lesson("l_f2", "Breath & Phrasing", 16, [
        { name: "Sigh swing", timing: "8 counts", tip: "Inhale up, exhale down." },
        { name: "Sustained curve", timing: "16 counts", tip: "Move through the music's breath, not its beat." },
      ], "Contemporary phrasing is breath made visible. Learn to ride the score instead of counting it."),
      lesson("l_f3", "Fluid Combination", 20, [
        { name: "Floor-to-stand spiral", timing: "16 counts", tip: "Push the floor away, spiral up." },
        { name: "Traveling phrase", timing: "32 counts", tip: "Cover space with intention." },
      ], "A complete contemporary phrase combining floorwork, rises and traveling movement."),
    ],
  },
  {
    id: "c_jazz1",
    title: "Jazz Technique & Style",
    teacherId: "u_kejsi",
    style: "Jazz",
    level: "Beginner",
    cover: IMG.catJazz,
    trailer: VID.landscapeB,
    popular: true,
    enrolled: 18900,
    rating: 4.7,
    about:
      "Turns, kicks, lines and that unmistakable jazz attitude. A technique course dressed in performance.",
    lessons: [
      lesson("l_j1", "Jazz Walks & Posture", 12, [
        { name: "Basic jazz walk", timing: "8 counts", tip: "Roll through the foot, chest proud." },
        { name: "Contrast walk", timing: "8 counts", tip: "Big shape change on every step." },
      ], "The jazz walk is your signature. We build it from posture and attitude."),
      lesson("l_j2", "Pirouette Prep & Turns", 16, [
        { name: "Passé balance", timing: "4 × 8", tip: "Spot your focal point on every turn." },
        { name: "Double pirouette", timing: "4 attempts", tip: "Push the floor, don't spin the floor." },
      ], "Clean turning technique: spot, passé, and the release that makes doubles happen."),
    ],
  },
  {
    id: "c_latin1",
    title: "Latin Rhythms: Salsa & Bachata",
    teacherId: "u_denisa",
    style: "Latin",
    level: "Beginner",
    cover: IMG.catLatin,
    trailer: VID.landscapeA,
    popular: true,
    enrolled: 26100,
    rating: 4.8,
    about:
      "Find the rhythm, find a partner, find the joy. Salsa On1 basics and bachata sensuality, broken down with musicality first.",
    lessons: [
      lesson("l_l1", "Salsa Basic On1", 12, [
        { name: "Forward-back basic", timing: "Counts 1–2–3, 5–6–7", tip: "The 4 and 8 are for weight transfer, pause and feel it." },
        { name: "Side basic", timing: "8 counts", tip: "Small steps, big rhythm." },
      ], "Musicality before steps. We find the clave, then learn the On1 basic with proper weight transfer."),
      lesson("l_l2", "Bachata Box & Hip Accent", 14, [
        { name: "Box step", timing: "8 counts", tip: "Lift the heel on 4 and 8 for the hip pop." },
        { name: "Turn signal basics", timing: "8 counts", tip: "Lead with intention, follow with soft arms." },
      ], "The bachata box plus the signature hip accent that makes it look effortless."),
    ],
  },
  {
    id: "c_kids1",
    title: "Kids Hip Hop: Fun Foundations",
    teacherId: "u_sara",
    style: "Kids",
    level: "Kids",
    cover: IMG.catKids,
    trailer: VID.landscapeB,
    popular: true,
    enrolled: 35600,
    rating: 5.0,
    about:
      "A safe, playful introduction to hip hop for dancers aged 6–12. Games, grooves and a routine to show the family. Parental controls respected throughout.",
    lessons: [
      lesson("l_k1", "Animal Grooves", 10, [
        { name: "Frog bounce", timing: "8 counts", tip: "Big jump, soft landing!" },
        { name: "Snake arms", timing: "8 counts", tip: "Wiggle one arm at a time." },
      ], "We learn grooves by pretending to be animals. Parents: this one gets silly."),
      lesson("l_k2", "My First Routine", 12, [
        { name: "Clap combo", timing: "16 counts", tip: "Claps land exactly with the beat." },
        { name: "Freeze dance", timing: "Game", tip: "When the music stops — statue!" },
      ], "A super-fun mini routine kids can perform after one session."),
    ],
  },
  {
    id: "c_begin1",
    title: "Absolute Beginners: First Steps",
    teacherId: "u_maria",
    style: "Beginners",
    level: "Beginner",
    cover: IMG.catBeginners,
    trailer: VID.landscapeA,
    isNew: true,
    enrolled: 41200,
    rating: 4.9,
    about:
      "Never danced before? Perfect. This course assumes zero experience and builds rhythm, coordination and confidence in 20 minutes a day.",
    lessons: [
      lesson("l_b1", "Finding the Beat", 10, [
        { name: "Clap on 2 & 4", timing: "8 counts", tip: "The snare is your anchor." },
        { name: "March & bounce", timing: "8 counts", tip: "Small bounces wake up the body." },
      ], "Rhythm is a skill, not a gift. We train your ears and your feet together."),
      lesson("l_b2", "Coordination Basics", 12, [
        { name: "Opposite arm & foot", timing: "8 counts", tip: "Go slow — accuracy first." },
        { name: "Cross-crawl step", timing: "8 counts", tip: "This wires your brain for choreography." },
      ], "Simple coordination drills that make every future class easier."),
      lesson("l_b3", "Confidence Combo", 14, [
        { name: "8-count combo", timing: "16 counts", tip: "Smile — it changes your movement." },
      ], "Your first real combination, built for confidence and filmed for memories."),
    ],
  },
  {
    id: "c_adv1",
    title: "Advanced: Performance Intensive",
    teacherId: "u_sara",
    style: "Advanced",
    level: "Advanced",
    cover: IMG.catAdvanced,
    trailer: VID.landscapeB,
    isNew: true,
    enrolled: 9800,
    rating: 4.9,
    about:
      "For experienced dancers: complex choreography, stamina conditioning and the performance mindset that wins jobs and battles.",
    lessons: [
      lesson("l_a1", "Complex Phrasing", 18, [
        { name: "Polyrhythm layers", timing: "16 counts", tip: "Count one rhythm, dance another." },
        { name: "Directional shifts", timing: "16 counts", tip: "Commit or it reads as a mistake." },
      ], "Hard counting, quick changes, no safety nets. This is where technique becomes artistry."),
      lesson("l_a2", "Stamina & Full-Out Runs", 20, [
        { name: "3-run circuit", timing: "Full routine ×3", tip: "The last run should be your best." },
      ], "Conditioning for dancers: perform full-out three times without losing shape or face."),
    ],
  },
];

export const courseById = (id: string) => courses.find((c) => c.id === id);

export const courseCategories = [
  { id: "Hip Hop", label: "Hip Hop", cover: IMG.catHipHop },
  { id: "Commercial", label: "Commercial", cover: IMG.catCommercial },
  { id: "Contemporary", label: "Contemporary", cover: IMG.catContemporary },
  { id: "Jazz", label: "Jazz", cover: IMG.catJazz },
  { id: "Latin", label: "Latin", cover: IMG.catLatin },
  { id: "Kids", label: "Kids", cover: IMG.catKids },
  { id: "Beginners", label: "Beginners", cover: IMG.catBeginners },
  { id: "Advanced", label: "Advanced", cover: IMG.catAdvanced },
];

/* ------------------------------ posts (feed) ------------------------------ */
export const posts: Post[] = [
  {
    id: "p1",
    userId: "u_sara",
    video: FEED_VIDEOS[1],
    cover: IMG.catHipHop,
    style: "Hip Hop",
    caption: "8-count groove after class today 🎧 feel the bounce, forget the steps",
    hashtags: ["#hiphop", "#groove", "#densen"],
    audioId: "a1",
    likes: 8420,
    shares: 310,
    views: 128000,
    choreoBy: "u_sara",
    lessonRef: "c_hiphop1",
    comments: [
      { id: "cm1", userId: "u_jona", text: "the bounce is INSANE 🔥", time: "2h", likes: 84 },
      { id: "cm2", userId: "u_luan", text: "groove tutorial when? 👀", time: "1h", likes: 41 },
      { id: "cm3", userId: "u_elsa", text: "this flow is buttery", time: "45m", likes: 12 },
    ],
  },
  {
    id: "p2",
    userId: "u_jona",
    video: FEED_VIDEOS[2],
    cover: IMG.catCommercial,
    style: "Commercial",
    caption: "finished week 3 of Stage Ready!! swipe up to learn it too 💫",
    hashtags: ["#commercial", "#stageready", "#teamurbanpulse"],
    audioId: "a2",
    likes: 2140,
    shares: 96,
    views: 34200,
    duetOf: "p1",
    choreoBy: "u_sara",
    lessonRef: "c_commercial1",
    comments: [
      { id: "cm4", userId: "u_sara", text: "so proud of this growth 😭", time: "3h", likes: 210 },
      { id: "cm5", userId: "u_noa", text: "teach me teach me 🙌", time: "2h", likes: 18 },
    ],
  },
  {
    id: "p3",
    userId: "u_maria",
    video: FEED_VIDEOS[3],
    cover: IMG.catContemporary,
    style: "Contemporary",
    caption: "breath is the metronome. floorwork phrase from this week's lab.",
    hashtags: ["#contemporary", "#floorwork", "#motion"],
    audioId: "a4",
    likes: 5310,
    shares: 240,
    views: 87600,
    choreoBy: "u_maria",
    lessonRef: "c_contemp1",
    comments: [
      { id: "cm6", userId: "u_elsa", text: "watching on repeat, the exhale on the fall 😮‍💨", time: "5h", likes: 77 },
    ],
  },
  {
    id: "p4",
    userId: "u_luca",
    video: FEED_VIDEOS[4],
    cover: IMG.catLatin,
    style: "Latin",
    caption: "salsa footwork drill — no partner needed, just timing 👟",
    hashtags: ["#salsa", "#footwork", "#latin"],
    audioId: "a3",
    likes: 1890,
    shares: 64,
    views: 22400,
    lessonRef: "c_latin1",
    comments: [
      { id: "cm7", userId: "u_denisa", text: "that weight transfer though 👏", time: "8h", likes: 39 },
    ],
  },
  {
    id: "p5",
    userId: "u_maya",
    video: FEED_VIDEOS[0],
    cover: IMG.catCommercial,
    style: "Commercial",
    caption: "heels class能量 → 'Slow Burn' audio is trending, go use it 🔥",
    hashtags: ["#heels", "#commercial", "#trending"],
    audioId: "a4",
    likes: 6720,
    shares: 402,
    views: 143000,
    lessonRef: "c_commercial1",
    comments: [
      { id: "cm8", userId: "u_sara", text: "queen behavior 👑", time: "1d", likes: 156 },
      { id: "cm9", userId: "u_kejsi", text: "the control!! how", time: "22h", likes: 61 },
    ],
  },
  {
    id: "p6",
    userId: "u_noa",
    video: FEED_VIDEOS[1],
    cover: IMG.catKids,
    style: "Kids",
    caption: "my first routine!!! mom filmed it 🥹 #kidshiphop",
    hashtags: ["#kids", "#hiphop", "#firstroutine"],
    audioId: "a3",
    likes: 980,
    shares: 41,
    views: 12100,
    lessonRef: "c_kids1",
    comments: [
      { id: "cm10", userId: "u_jona", text: "future champion right here 🏆", time: "4h", likes: 88 },
    ],
  },
  {
    id: "p7",
    userId: "u_alex",
    video: FEED_VIDEOS[2],
    cover: IMG.catBattle,
    style: "Hip Hop",
    caption: "foundations first. bounce → isolation → combo. full course on Densen.",
    hashtags: ["#hiphop", "#foundations", "#bboy"],
    audioId: "a5",
    likes: 3410,
    shares: 188,
    views: 56800,
    lessonRef: "c_hiphop1",
    comments: [
      { id: "cm11", userId: "u_luca", text: "drills don't lie 💯", time: "1d", likes: 52 },
    ],
  },
  {
    id: "p8",
    userId: "u_elsa",
    video: FEED_VIDEOS[3],
    cover: IMG.catFreestyle,
    style: "Contemporary",
    caption: "duet attempt on maria's phrase — side by side version 🤍",
    hashtags: ["#contemporary", "#duet", "#collab"],
    audioId: "a4",
    likes: 1420,
    shares: 58,
    views: 18700,
    duetOf: "p3",
    choreoBy: "u_maria",
    lessonRef: "c_contemp1",
    comments: [
      { id: "cm12", userId: "u_maria", text: "you added a variation on the rise — beautiful", time: "6h", likes: 94 },
    ],
  },
];

export const comments = posts.flatMap((p) => p.comments);

/* ------------------------------ challenges ------------------------------ */
export const challenges: Challenge[] = [
  {
    id: "ch1",
    title: "Densen Weekly Challenge",
    desc: "Each week a new 8-count combination drops. Learn it, film your version, and the community votes. Winners get featured across Densen.",
    cover: IMG.catBattle,
    style: "Hip Hop",
    deadline: "Sun, Sep 20",
    daysLeft: 3,
    participants: 4218,
    status: "active",
    tutorialCourseId: "c_hiphop1",
    featuredChoreoBy: "u_sara",
    prizes: ["Featured on Densen home", "1 month Densen Pro", "DenFest wildcard"],
    entries: [
      { userId: "u_jona", postId: "p2", votes: 1840 },
      { userId: "u_luan", postId: "p7", votes: 1290 },
      { userId: "u_kejsi", postId: "p5", votes: 980 },
      { userId: "u_elsa", postId: "p8", votes: 740 },
    ],
  },
  {
    id: "ch2",
    title: "30 Day Hip Hop Challenge",
    desc: "One drill a day for 30 days. Foundations to full combos. The most consistent dancers unlock the 'Disciplined' badge.",
    cover: IMG.catHipHop,
    style: "Hip Hop",
    deadline: "Oct 15",
    daysLeft: 28,
    participants: 12800,
    status: "active",
    tutorialCourseId: "c_hiphop1",
    featuredChoreoBy: "u_alex",
    prizes: ["Disciplined badge", "Featured on leaderboard"],
    entries: [
      { userId: "u_luca", postId: "p4", votes: 2210 },
      { userId: "u_noa", postId: "p6", votes: 1650 },
      { userId: "u_arben", postId: "p4", votes: 640 },
    ],
  },
  {
    id: "ch3",
    title: "Learn This Combination",
    desc: "Maria's floorwork phrase, taught step by step. Submit your interpretation — musicality over perfection.",
    cover: IMG.catContemporary,
    style: "Contemporary",
    deadline: "Sep 30",
    daysLeft: 13,
    participants: 1870,
    status: "active",
    tutorialCourseId: "c_contemp1",
    featuredChoreoBy: "u_maria",
    prizes: ["Masterclass invite", "Golden Hour team audition"],
    entries: [
      { userId: "u_elsa", postId: "p8", votes: 1420 },
      { userId: "u_kejsi", postId: "p5", votes: 890 },
    ],
  },
  {
    id: "ch4",
    title: "DenFest Challenge",
    desc: "The official warm-up for DenFest '26. Winners open the main stage battle. All styles welcome.",
    cover: IMG.catStage,
    style: "Commercial",
    deadline: "Nov 1",
    daysLeft: 45,
    participants: 6400,
    status: "upcoming",
    tutorialCourseId: "c_commercial1",
    featuredChoreoBy: "u_maya",
    prizes: ["Open DenFest main stage", "Film a Densen masterclass"],
    entries: [],
  },
  {
    id: "ch5",
    title: "Latin Fire: Salsa Shines",
    desc: "Show your best 20-second salsa shines. Ended — congratulations to Luca!",
    cover: IMG.catLatin,
    style: "Latin",
    deadline: "Aug 31",
    daysLeft: 0,
    participants: 3120,
    status: "ended",
    tutorialCourseId: "c_latin1",
    featuredChoreoBy: "u_denisa",
    prizes: ["Featured on Densen home"],
    entries: [
      { userId: "u_luca", postId: "p4", votes: 4210 },
      { userId: "u_denisa", postId: "p4", votes: 2100 },
    ],
  },
];

/* ------------------------------ events ------------------------------ */
export const events: DanceEvent[] = [
  {
    id: "e1",
    type: "Festival",
    title: "DenFest '26",
    date: "Nov 14–16",
    time: "All weekend",
    location: "Tirana, Albania",
    hostId: "u_sara",
    participants: 8400,
    cover: IMG.catStage,
    desc: "The biggest Densen gathering of the year: three days of battles, workshops, showcases and open cyphers.",
    spotsLeft: 320,
  },
  {
    id: "e2",
    type: "Workshop",
    title: "Commercial Choreo Lab",
    date: "Sep 26",
    time: "18:00",
    location: "Berlin, DE",
    hostId: "u_sara",
    participants: 240,
    cover: IMG.catCommercial,
    desc: "Learn a full routine in one evening. Filmed on the spot — leave with your own video.",
    spotsLeft: 18,
  },
  {
    id: "e3",
    type: "Competition",
    title: "Balkan All-Styles Battle",
    date: "Oct 4",
    time: "16:00",
    location: "Prishtinë, XK",
    hostId: "u_luca",
    participants: 480,
    cover: IMG.catBattle,
    desc: "1v1 all styles, judged by foundation. Qualifier for the DenFest main battle.",
    spotsLeft: 64,
  },
  {
    id: "e4",
    type: "Masterclass",
    title: "Contemporary: The Emotional Line",
    date: "Oct 11",
    time: "19:00",
    location: "Online",
    online: true,
    hostId: "u_maria",
    participants: 1200,
    cover: IMG.catContemporary,
    desc: "A two-hour deep dive into phrasing, breath and emotional storytelling on camera.",
  },
  {
    id: "e5",
    type: "Audition",
    title: "Golden Hour — New Members",
    date: "Oct 18",
    time: "11:00",
    location: "Athens, GR",
    hostId: "u_maria",
    participants: 150,
    cover: IMG.extra11,
    desc: "Open audition for Golden Hour contemporary crew. Prepare one minute of solo material.",
    spotsLeft: 30,
  },
];

/* ------------------------------ live classes ------------------------------ */
export const liveClasses: LiveClass[] = [
  {
    id: "lv1",
    title: "Hip Hop Groove — Open Level",
    teacherId: "u_alex",
    style: "Hip Hop",
    startsIn: "Live now",
    viewers: 2140,
    cover: IMG.catHipHop,
    live: true,
  },
  {
    id: "lv2",
    title: "Latin Partnerwork Basics",
    teacherId: "u_denisa",
    style: "Latin",
    startsIn: "in 2h 30m",
    cover: IMG.catLatin,
  },
  {
    id: "lv3",
    title: "Commercial: Camera Ready",
    teacherId: "u_maya",
    style: "Commercial",
    startsIn: "Tomorrow 18:00",
    cover: IMG.catCommercial,
  },
  {
    id: "lv4",
    title: "Kids Saturday Special",
    teacherId: "u_sara",
    style: "Kids",
    startsIn: "Sat 10:00",
    cover: IMG.catKids,
  },
];

/* ------------------------------ conversations ------------------------------ */
export const conversations: Conversation[] = [
  {
    id: "cv1",
    participants: ["u_sara"],
    online: true,
    messages: [
      { id: "m1", from: "u_sara", text: "saw your practice video — the bounce is finally clicking 👏", time: "09:41" },
      { id: "m2", from: "me", text: "thank you!! been drilling the foundations course every morning", time: "09:44" },
      {
        id: "m3",
        from: "u_sara",
        attachment: { type: "lesson", title: "Hip Hop Foundations — Lesson 3", cover: IMG.catHipHop },
        text: "do lesson 3 before Thursday, we'll build on it",
        time: "09:45",
      },
      { id: "m4", from: "me", text: "on it 🔥", time: "09:47" },
    ],
  },
  {
    id: "cv2",
    participants: ["u_jona", "u_noa"],
    group: true,
    name: "Urban Pulse 🔥",
    messages: [
      { id: "m5", from: "u_jona", text: "team practice friday 18:00, don't be late", time: "Yesterday" },
      { id: "m6", from: "u_noa", text: "bringing my cousin, he wants to join the challenge", time: "Yesterday" },
      {
        id: "m7",
        from: "u_jona",
        attachment: { type: "challenge", title: "Densen Weekly Challenge", cover: IMG.catBattle },
        time: "Yesterday",
        text: "this week's combo — we all submit",
      },
    ],
  },
  {
    id: "cv3",
    participants: ["u_maria"],
    online: true,
    messages: [
      {
        id: "m8",
        from: "u_maria",
        attachment: { type: "choreo", title: "Floorwork phrase — side by side", cover: IMG.catContemporary },
        time: "Mon",
        text: "your duet interpretation was lovely",
      },
      { id: "m9", from: "me", text: "that means a lot, coming from you 🙏", time: "Mon" },
    ],
  },
  {
    id: "cv4",
    participants: ["u_luca"],
    messages: [
      { id: "m10", from: "u_luca", text: "battles at DenFest this year?", time: "Sun" },
      { id: "m11", from: "me", text: "registering this week 💪", time: "Sun" },
    ],
  },
  {
    id: "cv5",
    participants: ["u_elsa"],
    online: true,
    messages: [
      { id: "m12", from: "u_elsa", text: "did you see the new bachata course?", time: "Sat" },
      { id: "m13", from: "me", text: "starting it tonight!", time: "Sat" },
    ],
  },
];

/* ------------------------------ notifications ------------------------------ */
export const notifications: AppNotification[] = [
  { id: "n1", kind: "like", actorId: "u_sara", text: "liked your video.", time: "2m", read: false },
  { id: "n2", kind: "follow", actorId: "u_alex", text: "started following you.", time: "18m", read: false },
  { id: "n3", kind: "comment", actorId: "u_maria", text: "commented on your choreography: \"the rise was beautiful\"", time: "1h", read: false },
  { id: "n4", kind: "challenge", text: "You have been invited to the Densen Weekly Challenge.", time: "3h", read: true },
  { id: "n5", kind: "message", actorId: "u_jona", text: "sent you a message.", time: "5h", read: true },
  { id: "n6", kind: "progress", text: "Your course progress reached 80% in Hip Hop Foundations.", time: "Yesterday", read: true },
  { id: "n7", kind: "duet", actorId: "u_elsa", text: "posted a duet with your video.", time: "Yesterday", read: true },
  { id: "n8", kind: "live", actorId: "u_alex", text: "is live now: Hip Hop Groove — Open Level.", time: "1d", read: true },
];

/* ------------------------------ achievements ------------------------------ */
export const achievements: Achievement[] = [
  { id: "ach1", icon: "🎬", name: "First Class", desc: "Complete your first class", unlocked: true },
  { id: "ach2", icon: "📹", name: "First Video", desc: "Post your first dance video", unlocked: true },
  { id: "ach3", icon: "❤️", name: "100 Likes", desc: "Receive 100 likes total", unlocked: true },
  { id: "ach4", icon: "🔥", name: "7 Day Streak", desc: "Practice 7 days in a row", unlocked: true },
  { id: "ach5", icon: "⚡", name: "30 Day Streak", desc: "Practice 30 days in a row", unlocked: false, progress: 60 },
  { id: "ach6", icon: "🏆", name: "First Challenge", desc: "Join your first challenge", unlocked: true },
  { id: "ach7", icon: "👑", name: "Challenge Winner", desc: "Win any weekly challenge", unlocked: false, progress: 45 },
  { id: "ach8", icon: "🎓", name: "10 Classes Completed", desc: "Complete 10 classes", unlocked: true },
  { id: "ach9", icon: "💎", name: "50 Classes Completed", desc: "Complete 50 classes", unlocked: false, progress: 38 },
  { id: "ach10", icon: "🌟", name: "100 Followers", desc: "Reach 100 followers", unlocked: false, progress: 92 },
  { id: "ach11", icon: "🤝", name: "First Duet", desc: "Post your first duet", unlocked: true },
  { id: "ach12", icon: "🥇", name: "Leaderboard Top 10", desc: "Reach a leaderboard top 10", unlocked: false, progress: 74 },
];

/* ------------------------------ leaderboard ------------------------------ */
export interface LeaderRow {
  userId: string;
  xp: number;
  delta: string;
  metric: string;
}

export const leaderboardCategory = (cat: "dancers" | "creators" | "improved" | "challenge" | "consistent" | "teachers", period: string): LeaderRow[] => {
  const base: Record<string, string[]> = {
    dancers: ["u_sara", "u_luca", "u_maya", "u_alex", "u_jona", "me", "u_elsa", "u_luan", "u_kejsi", "u_noa"],
    creators: ["u_maya", "u_sara", "u_maria", "u_alex", "u_jona", "u_elsa", "me", "u_luca", "u_denisa", "u_kejsi"],
    improved: ["me", "u_jona", "u_noa", "u_elsa", "u_luan", "u_arben", "u_luca", "u_kejsi", "u_maya", "u_sara"],
    challenge: ["u_jona", "u_luca", "u_luan", "u_sara", "me", "u_noa", "u_elsa", "u_kejsi", "u_maya", "u_alex"],
    consistent: ["u_noa", "me", "u_jona", "u_sara", "u_alex", "u_maria", "u_elsa", "u_luan", "u_arben", "u_luca"],
    teachers: ["u_sara", "u_maria", "u_alex", "u_maya", "u_denisa", "u_kejsi"],
  };
  const mult = period === "Weekly" ? 1 : period === "Monthly" ? 4.2 : 36;
  return (base[cat] ?? base.dancers).map((userId, i) => ({
    userId,
    xp: Math.round((4200 - i * 310 + (i % 3) * 80) * mult),
    delta: i % 2 === 0 ? `+${120 - i * 9}` : `-${(i * 7) % 40}`,
    metric: cat === "teachers" ? "4.9★" : `${Math.round((820 - i * 61) * (mult / 4))} ${cat === "creators" ? "videos" : "likes"}`,
  }));
};

/* ------------------------------ search index ------------------------------ */
export const hashtags = [
  { tag: "#hiphop", posts: 48200 },
  { tag: "#commercial", posts: 31800 },
  { tag: "#contemporary", posts: 26400 },
  { tag: "#densenchallenge", posts: 18900 },
  { tag: "#duet", posts: 14200 },
  { tag: "#kidshiphop", posts: 9800 },
  { tag: "#bachata", posts: 7600 },
  { tag: "#floorwork", posts: 6400 },
];

/* ------------------------------ current user state ------------------------------ */
export const initialCompletedLessons = ["l_b1", "l_b2", "l_h1", "l_h2", "l_h3", "l_c1"];
export const initialRecentlyWatched = [
  { courseId: "c_hiphop1", lessonId: "l_h3", at: "Today" },
  { courseId: "c_begin1", lessonId: "l_b2", at: "Yesterday" },
  { courseId: "c_commercial1", lessonId: "l_c1", at: "2 days ago" },
  { courseId: "c_latin1", lessonId: "l_l1", at: "3 days ago" },
];

export const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
