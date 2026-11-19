// Rule-based detector that turns a group chat message into a taxi order (Farg'ona <-> Qo'qon).
// Pure function: no I/O. Precision matters more than recall — a wrong order goes straight to drivers.
import { TASHKENT_OFFSET_MS, normalizeUzPhone } from "@taxi/shared";

export type City = "FERGANA" | "KOKAND";
export type RouteCode = "FERGANA_KOKAND" | "KOKAND_FERGANA";

export interface Detection {
  kind: "order" | "driver_offer" | "unrecognized" | "ignore";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  score: number;
  routeCode?: RouteCode;
  /** True when direction was inferred from a single bare city name ("Qoqon 3 odam" -> to Qo'qon). */
  routeImplied?: boolean;
  passengers?: number;
  isNow: boolean;
  departureAt?: Date;
  phone?: string;
  signals: string[];
}

// ── Normalization: Cyrillic -> Latin, drop apostrophes, lowercase ──
const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", ғ: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k",
  қ: "q", л: "l", м: "m", н: "n", о: "o", ў: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x",
  ҳ: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya",
};

export function normalize(text: string): string {
  let s = "";
  for (const ch of text.toLowerCase()) s += CYR[ch] ?? ch;
  return s
    .replace(/[’‘`ʻʼ'´"«»]/g, "") // Farg'ona / Fargʻona / Fargona -> fargona
    .replace(/[^a-z0-9:.?+\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Cities ──
type Role = "TO" | "FROM" | "AT" | "BARE";
const TO_SUFFIX = new Set(["ga", "ka", "qa", "gacha", "u"]);
const FROM_SUFFIX = new Set(["dan", "tan"]);
const AT_SUFFIX = new Set(["da", "ta", "e"]);
const BARE_SUFFIX = new Set(["", "a", "lik", "liklar", "ning"]);

function cityOf(token: string): { city: City; suffix: string } | null {
  let m = /^(fargon|fargan|fergan)(a?)([a-z]*)$/.exec(token);
  if (m) return { city: "FERGANA", suffix: m[3]! };
  m = /^(qoqon|kokon|qoqan|kokand|qoqand|qukon)([a-z]*)$/.exec(token);
  if (m) return { city: "KOKAND", suffix: m[2]! };
  return null;
}

const OTHER_CITY =
  /^(toshkent|tashkent|andijon|andijan|namangan|margilon|margilan|quvasoy|kuvasay|rishton|rishtan|beshariq|besharik|buvayda|oltiariq|samarqand|samarkand|buxoro|buhara|bukhara|yaypan|uchkoprik|uchkuprik|furqat|bagdod|toshloq|dangara|chirchiq|angren|olmaliq|jizzax|guliston|termiz|qarshi|navoiy|nukus|xorazm|moskv|rossiya)/;

function roleOf(suffix: string, prev: string | undefined): Role | null {
  if (prev && ["v", "vo", "do", "na", "k"].includes(prev)) return AT_SUFFIX.has(suffix) ? "AT" : "TO";
  if (prev && ["iz", "ot", "s"].includes(prev)) return "FROM";
  if (TO_SUFFIX.has(suffix)) return "TO";
  if (FROM_SUFFIX.has(suffix)) return "FROM";
  if (AT_SUFFIX.has(suffix)) return "AT";
  if (BARE_SUFFIX.has(suffix)) return "BARE";
  return null; // unknown word that merely starts like a city name
}

const other = (c: City): City => (c === "FERGANA" ? "KOKAND" : "FERGANA");

function resolveRoute(tokens: string[]): { code?: RouteCode; implied?: boolean; otherCity: boolean; mentioned: boolean } {
  const mentions: { city: City; role: Role }[] = [];
  let otherCity = false;
  tokens.forEach((tok, i) => {
    if (OTHER_CITY.test(tok)) otherCity = true;
    const c = cityOf(tok);
    if (!c) return;
    const role = roleOf(c.suffix, tokens[i - 1]);
    if (role && !mentions.some((m) => m.city === c.city)) mentions.push({ city: c.city, role });
  });
  const mentioned = mentions.length > 0;
  if (otherCity || !mentioned) return { otherCity, mentioned };

  const code = (from: City, to: City): RouteCode => `${from}_${to}` as RouteCode;
  const to = mentions.find((m) => m.role === "TO");
  const from = mentions.find((m) => m.role === "FROM");
  if (to && from && to.city === from.city) return { otherCity, mentioned };
  if (to) return { code: code(other(to.city), to.city), otherCity, mentioned };
  if (from) return { code: code(from.city, other(from.city)), otherCity, mentioned };

  if (mentions.length === 2) {
    // "Fargona qoqon" / "Фергана Коканд": first = from, second = to (AT counts as origin).
    return { code: code(mentions[0]!.city, mentions[1]!.city), otherCity, mentioned };
  }
  const only = mentions[0]!;
  if (only.role === "BARE") return { code: code(other(only.city), only.city), implied: true, otherCity, mentioned };
  return { otherCity, mentioned }; // only "Qo'qonda ..." — direction unclear
}

// ── Signals ──
const DRIVER_OFFER = [
  /\bjoy(i|im|lar|imiz|larim)?\s+(ham\s+)?bor\b/,
  /\b\d+\s*(ta\s*)?joy\b/,
  /\bbosh\s*joy/,
  /\bmashinam\s+bor/,
  /\bolib\s+(ket|bor)(aman|amiz)\b/,
  /\byolovchi\s+ol(aman|amiz)\b/,
  /\bpochta\s+ol/,
  /\bxizmat/,
  /\b24\s*7\b/,
  /\bmest[aoy]?\b/,
  /\bsvobodn/,
  /\b(vozmu|beru|zaberu)\b/,
  /\bzvonite\b/,
  /\bqongiroq\s+qiling/,
  /\b(buyurtma|zakaz)\w*\s+qabul/,
  /\beltib\b/,
  /\byetkazib/,
  /\bdostavk/,
];
const CLIENT_INTENT = [
  /\bkerak/,
  /\bzarur/,
  /\bketmoqchi/,
  /\b(ketaman|ketamiz|boraman|boramiz|jonayman|jonaymiz)\b/,
  /\bkim\s+(ketadi|bor|boradi)/,
  /\b(ketadigan|ketayotgan|boradigan)\s+(bormi|bor)\b/,
  /\bolib\s+keting/,
  /\b(nujna|nujen|nujno|nado)\b/,
  /\b(edu|edem|poedu|poedem|ishu|ishem)\b/,
  /\bkto\s+(edet|poedet|edut)/,
  /\best\s*\?/,
];
const VEHICLE = /\b(mashina|moshin|taksi|taxi|poputchik|poputk|poputn|tachk|avto\b)/;
const PEOPLE_WORD = /\b(kishi|odam|yolovchi|nafar|chelovek|passaj|pasaj)/;
const PEOPLE_BOR = /\b(kishi|odam|yolovchi)\w*\s+bor\b/;
const URGENT = /\b(hozir\w*|tezroq|tez|shoshilinch|srochno|darrov|seychas|bistro|bystro)\b/;

const NUM_WORDS: Record<string, number> = {
  bir: 1, ikki: 2, ikkita: 2, uch: 3, uchta: 3, tort: 4, tortta: 4, besh: 5, beshta: 5,
  odin: 1, odna: 1, dva: 2, dvoe: 2, tri: 3, troe: 3, chetyre: 4, chetvero: 4,
};

function passengersOf(s: string): number | undefined {
  const pick = (n: number) => (n >= 1 && n <= 8 ? n : undefined);
  let m = /\b(\d{1,2})\s*(ta\s*)?(kishi|odam|yolovchi|nafar|chel|pass|pasaj)/.exec(s);
  if (m) return pick(Number(m[1]));
  m = /\bnas\s+(dvoe|troe|chetvero|\d)\b/.exec(s);
  if (m) return pick(NUM_WORDS[m[1]!] ?? Number(m[1]));
  m = /\b(bir|ikki|ikkita|uch|uchta|tort|tortta|besh|beshta|odin|odna|dva|dvoe|tri|troe|chetyre|chetvero)\s*(ta\s*)?(kishi|odam|yolovchi|nafar|chel|pass)/.exec(s);
  if (m) return pick(NUM_WORDS[m[1]!]!);
  return undefined;
}

function timeOf(s: string, now: Date): { at?: Date; explicit: boolean } {
  let dayOffset: number | null = null;
  if (/\b(ertaga|zavtra)\b/.test(s)) dayOffset = 1;
  else if (/\b(indinga|poslezavtra)\b/.test(s)) dayOffset = 2;
  else if (/\b(bugun|segodnya)\b/.test(s)) dayOffset = 0;

  let part: number | null = null;
  if (/\b(ertalab|utrom|utra)\b/.test(s)) part = 8;
  else if (/\b(tushda|tushlik|dnem|obed)\b/.test(s)) part = 13;
  else if (/\b(kechqurun|kechki|vecherom|vecher)\b/.test(s)) part = 19;
  else if (/\b(kechasi|nochyu)\b/.test(s)) part = 22;

  let h: number | null = null;
  let min = 0;
  let loose = false; // hour without minutes ("soat 5da") — may need +12
  const clock = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/.exec(s);
  if (clock) {
    h = Number(clock[1]);
    min = Number(clock[2]);
  } else {
    const soat = /\bsoat\s*(\d{1,2})\b/.exec(s) ?? /\bsoat\s*(\d{1,2})\s*da/.exec(s) ?? /\bv\s*(\d{1,2})\s*(chas|chasov|ch)\b/.exec(s);
    if (soat && Number(soat[1]) <= 23) {
      h = Number(soat[1]);
      loose = true;
    }
  }
  if (h !== null && loose && h >= 1 && h <= 7 && part !== 8) h += 12;
  if (h !== null && part !== null && part >= 13 && h < 12) h += 12;
  if (h === null && part !== null) h = part;
  if (h === null && dayOffset === null) return { explicit: false };
  if (h === null) h = dayOffset === 0 ? -1 : 9; // "ertaga" alone -> 09:00; "bugun" alone -> now
  if (h < 0) return { explicit: false };

  const local = new Date(now.getTime() + TASHKENT_OFFSET_MS);
  const build = (offset: number) =>
    new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + offset, h!, min) - TASHKENT_OFFSET_MS);
  let at = build(dayOffset ?? 0);
  if (dayOffset === null && at.getTime() < now.getTime() - 30 * 60_000) at = build(1);
  return { at, explicit: true };
}

function phoneOf(raw: string): string | undefined {
  const re = /(?:\+?\s?998[\s\-.()]*)?\(?\d{2}\)?[\s\-.]*\d{3}[\s\-.]*\d{2}[\s\-.]*\d{2}/g;
  for (const m of raw.matchAll(re)) {
    const p = normalizeUzPhone(m[0]);
    if (p) return p;
  }
  return undefined;
}

export function detectOrder(raw: string, now = new Date()): Detection {
  const s = normalize(raw);
  const base = { isNow: true, score: 0, signals: [] as string[] };
  if (s.replace(/[^a-z0-9]/g, "").length < 5) return { ...base, kind: "ignore", confidence: "LOW" };

  const tokens = s.split(/[\s.?:]+/).filter(Boolean);
  const route = resolveRoute(tokens);
  const signals: string[] = [];

  // Driver offers and ads are never client orders.
  const isAd = /https?:|t\.me\/|www\./i.test(raw);
  if (isAd || DRIVER_OFFER.some((re) => re.test(s))) {
    return { ...base, kind: route.mentioned || isAd ? "driver_offer" : "ignore", confidence: "LOW", signals: ["driver_offer"] };
  }

  let score = 0;
  if (CLIENT_INTENT.some((re) => re.test(s))) {
    score += 2;
    signals.push("intent");
  }
  if (VEHICLE.test(s)) {
    score += 2;
    signals.push("vehicle");
  }
  const passengers = passengersOf(s);
  if (passengers) {
    score += 2;
    signals.push(`passengers:${passengers}`);
  } else if (PEOPLE_WORD.test(s)) {
    score += 1;
    signals.push("people");
  }
  if (PEOPLE_BOR.test(s)) {
    score += 2;
    signals.push("people_bor");
  }
  const urgent = URGENT.test(s);
  if (urgent) {
    score += 2;
    signals.push("urgent");
  }
  const time = timeOf(s, now);
  if (time.explicit) {
    score += 1;
    signals.push("time");
  }
  const phone = phoneOf(raw);
  if (phone) {
    score += 1;
    signals.push("phone");
  }

  // Scheduled only if the stated time is meaningfully in the future; otherwise "now".
  const scheduled = time.at && time.at.getTime() > now.getTime() + 30 * 60_000 && time.at.getTime() < now.getTime() + 7 * 86400_000;
  const result = {
    score,
    signals,
    isNow: !scheduled,
    ...(scheduled ? { departureAt: time.at! } : {}),
    ...(passengers ? { passengers } : {}),
    ...(phone ? { phone } : {}),
  };

  if (!route.code) {
    if (route.otherCity) signals.push("other_city");
    if (!route.mentioned && score === 0) return { ...result, kind: "ignore", confidence: "LOW" };
    return { ...result, kind: "unrecognized", confidence: route.mentioned || score >= 4 ? "MEDIUM" : "LOW" };
  }
  signals.unshift(route.implied ? "route_implied" : "route");

  // Long, multi-line texts are usually ads or chatter: never auto-create from them.
  const tooLong = raw.length > 300 || raw.split("\n").length > 6;
  const routeInfo = { routeCode: route.code, ...(route.implied ? { routeImplied: true } : {}) };
  if (score >= 2 && !tooLong) return { ...result, ...routeInfo, kind: "order", confidence: "HIGH" };
  return { ...result, ...routeInfo, kind: "unrecognized", confidence: "MEDIUM" };
}
