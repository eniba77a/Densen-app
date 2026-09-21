// Central registry of verified placeholder media (all URLs checked HTTP 200/206).
const img = (id: string, w = 900, q = 78) =>
  `https://images.unsplash.com/photo-${id}?w=${w}&q=${q}&auto=format&fit=crop`;

export const IMG = {
  hero: img("1547153760-18fc86324498", 1600),
  heroAlt: img("1524594152303-9fd13543fe6e", 1600),
  catHipHop: img("1535525153412-5a42439a210d"),
  catCommercial: img("1508807526345-15e9b5f4eaff"),
  catContemporary: img("1518609878373-06d740f60d8b"),
  catJazz: img("1512909006721-3d6018887383"),
  catLatin: img("1543487945-139a97f387d5"),
  catKids: img("1516131206008-dd041a9764fd"),
  catBeginners: img("1524368535928-5b5e00ddc76b"),
  catAdvanced: img("1526218626217-dc65a29bb444"),
  catChoreo: img("1492684223066-81342ee5ff30"),
  catStage: img("1530103862676-de8c9debad1d"),
  catBattle: img("1470225620780-dba8ba36b745"),
  catStudio: img("1429962714451-bb934ecdc4ec"),
  catFreestyle: img("1459749411175-04bf5292ceea"),
  extra1: img("1526392060695-57858b8be5d8"),
  extra2: img("1470229722913-7c0e2dbbafd3"),
  extra3: img("1516450360452-9312f5e86fc7"),
  extra4: img("1521337581100-8ca9a73a5f79"),
  extra5: img("1520095972714-909e91b038e5"),
  extra6: img("1518459031867-a89b944bffe4"),
  extra7: img("1571330735066-03aaa9429d89"),
  extra8: img("1519671482749-fd09be7ccebf"),
  extra9: img("1543807535-eceef0bc6599"),
  extra10: img("1529156069898-49953e39b3ac"),
  extra11: img("1508700929628-666bc8bd84ea"),
  extra12: img("1517841905240-472988babdf9"),
  extra13: img("1543965170-4c01a586684e"),
  extra14: img("1541101767792-f9b2b1c4f127"),
  extra15: img("1521119989659-a83eee488004"),
  extra16: img("1493225457124-a3eb161ffa5f"),
  extra17: img("1514320291840-2e0a9bf2a9ae"),
  extra18: img("1511671782779-c97d3d27a1d4"),
  extra19: img("1550745165-9bc0b252726f"),
  extra20: img("1614850523459-c2f4c699c52e"),
  extra21: img("1550684848-fac1c5b4e853"),
  music: img("1511671782779-c97d3d27a1d4", 400),
  music2: img("1493225457124-a3eb161ffa5f", 400),
  music3: img("1550745165-9bc0b252726f", 400),
} as const;

const V = (id: string, spec: string) => `https://videos.pexels.com/video-files/${id}/${id}-${spec}.mp4`;

export const VID = {
  portrait: V("2785536", "hd_1080_1920_25fps"), // vertical dance clip
  portrait2: V("2795409", "hd_1080_1920_25fps"), // vertical dance clip (studio solo)
  landscapeA: V("3195394", "hd_1920_1080_25fps"), // landscape dance clip
  landscapeB: V("3209828", "hd_1920_1080_25fps"), // landscape dance clip
  landscapeC: V("4114797", "hd_1280_720_25fps"), // landscape dance clip
} as const;

const av = (id: string) => `https://i.pravatar.cc/300?u=densen-${id}`;

export const AVATARS = {
  me: av("me"),
  sara: av("sara-k"),
  alex: av("alex-d"),
  maria: av("maria-e"),
  denis: av("denis-densen"),
  jona: av("jona-m"),
  kejsi: av("kejsi-t"),
  luan: av("luan-b"),
  elsa: av("elsa-h"),
  arben: av("arben-k"),
  noa: av("noa-r"),
  maya: av("maya-s"),
  luca: av("luca-v"),
  ana: av("ana-t"),
  dril: av("drill-q"),
  team: av("team-urban"),
  team2: av("team-gold"),
  team3: av("team-motion"),
  team4: av("team-street"),
} as const;
