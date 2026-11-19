import { describe, expect, it } from "vitest";
import { formatTashkent } from "@taxi/shared";
import { detectOrder, normalize, type RouteCode } from "../src/modules/groups/detector.js";

// 12:00 in Tashkent
const NOW = new Date("2026-11-19T07:00:00Z");
const FK: RouteCode = "FERGANA_KOKAND";
const KF: RouteCode = "KOKAND_FERGANA";

type Expect = { route: RouteCode; passengers?: number; time?: string; now?: boolean };

const ORDERS: [string, Expect][] = [
  // ── short forms (user's first list) ──
  ["Qoqonga 2 kishi", { route: FK, passengers: 2, now: true }],
  ["Fargona qoqon 1 kishi 17:00", { route: FK, passengers: 1, time: "19.11 17:00" }],
  ["Fargonadan qoqonga hozir", { route: FK, now: true }],
  ["Qoqon 3 odam", { route: FK, passengers: 3 }],
  ["Qoqonga taksi", { route: FK }],
  ["Fargona qoqon kerak", { route: FK }],
  // ── full sentences ──
  ["Fargonadan Qoqonga 2 kishi taksi kerak", { route: FK, passengers: 2 }],
  ["Qoqondan Fargonaga 1 kishi bor, soat 18:00", { route: KF, passengers: 1, time: "19.11 18:00" }],
  ["Fargonadan Qoqonga ketaman, 3 kishimiz", { route: FK, passengers: 3 }],
  ["Qoqonga yo'lovchi bor, hozir", { route: FK, now: true }],
  ["Fargonaga 2 ta odam bor, kim ketadi", { route: KF, passengers: 2 }],
  ["Bugun soat 20:00 da Qoqonga taksi kerak", { route: FK, time: "19.11 20:00" }],
  ["Ertaga ertalab Fargonaga mashina kerak", { route: KF, time: "20.11 08:00" }],
  ["Qoqonga ketadigan mashina bormi", { route: FK }],
  ["Fargonaga poputchik kerak", { route: KF }],
  ["Qoqonga 1 kishiga joy kerak", { route: FK, passengers: 1 }],
  // ── apostrophe variants ──
  ["Farg'onadan Qo'qonga 2 kishi kerak", { route: FK, passengers: 2 }],
  ["Fargʻonadan Qoʻqonga taksi kerak", { route: FK }],
  ["Farg`ona Qo`qon 2 kishi", { route: FK, passengers: 2 }],
  // ── Uzbek Cyrillic ──
  ["Фарғонадан Қўқонга 2 киши такси керак", { route: FK, passengers: 2 }],
  ["Қўқонга 1 киши бор, ҳозир", { route: FK, passengers: 1, now: true }],
  ["Қўқонга кетадиган машина борми", { route: FK }],
  // ── Russian ──
  ["Ферганадан Кокандга 2 человека нужно такси", { route: FK, passengers: 2 }],
  ["Коканд 3 человека срочно", { route: FK, passengers: 3, now: true }],
  ["Фергана Коканд попутка есть?", { route: FK }],
  ["Кто едет в Коканд?", { route: FK }],
  ["Нужна машина в Фергану", { route: KF }],
  ["Едем в Коканд, нас двое", { route: FK, passengers: 2 }],
  ["Из Коканда в Фергану 2 человека", { route: KF, passengers: 2 }],
  // ── keyword list from the spec ──
  ["Qoqonga ketmoqchiman, tezroq", { route: FK, now: true }],
  ["Fargonaga boramiz 2 nafar", { route: KF, passengers: 2 }],
  ["Qoqonga jonayman moshin kerak", { route: FK }],
  ["Qoqonga kim bor? srochno", { route: FK, now: true }],
  ["Fargonaga ketayotgan bormi darrov", { route: KF, now: true }],
  ["Qoqonga kechqurun 1 kishi kerak", { route: FK, passengers: 1, time: "19.11 19:00" }],
  ["Qoqonga soat 5da 2 kishi", { route: FK, passengers: 2, time: "19.11 17:00" }],
  ["Fargonaga 18.30 da poputka kerak", { route: KF, time: "19.11 18:30" }],
  ["Qoqonga tushda taxi kerak", { route: FK, time: "19.11 13:00" }],
  ["Fargonaga shoshilinch mashina zarur", { route: KF, now: true }],
];

describe("detector: messages that must become orders", () => {
  it.each(ORDERS)("%s", (text, exp) => {
    const d = detectOrder(text, NOW);
    expect(d.kind, JSON.stringify(d)).toBe("order");
    expect(d.confidence).toBe("HIGH");
    expect(d.routeCode).toBe(exp.route);
    if (exp.passengers) expect(d.passengers).toBe(exp.passengers);
    if (exp.time) {
      expect(d.isNow).toBe(false);
      expect(formatTashkent(d.departureAt!)).toBe(exp.time);
    }
    if (exp.now) expect(d.isNow).toBe(true);
  });

  it("no passengers stated -> undefined (caller marks '1 (aniqlanmagan)'), no time -> now", () => {
    const d = detectOrder("Qoqonga taksi kerak", NOW);
    expect(d.passengers).toBeUndefined();
    expect(d.isNow).toBe(true);
  });

  it("extracts a phone number in any common format", () => {
    for (const t of [
      "Qoqonga 2 kishi +998 90 123 45 67",
      "Qoqonga 2 kishi 90-123-45-67",
      "Qoqonga 2 kishi tel: (90) 1234567",
      "Qoqonga 2 kishi 998901234567",
    ]) {
      expect(detectOrder(t, NOW).phone, t).toBe("+998901234567");
    }
  });

  it("a time already passed today without a day word means tomorrow", () => {
    const d = detectOrder("Qoqonga 2 kishi 09:00", NOW);
    expect(formatTashkent(d.departureAt!)).toBe("20.11 09:00");
  });
});

describe("detector: driver offers are never orders", () => {
  it.each([
    "Toshkentga ketaman, joy bor",
    "Qoqonga ketyapman 3 ta joy bor",
    "Qo'qonga ketaman, joyim bor 2 ta",
    "Fargonadan Qoqonga boraman bosh joy bor",
    "Фергана - Коканд, есть 3 места",
    "Кокандга кетаман бўш жой бор",
    "Qoqonga olib ketaman 2 kishini",
    "Farg'ona Qo'qon taksi xizmati 24/7",
    "Qoqonga pochta olaman",
    "Возьму 2 пассажиров до Коканда",
    "Qoqon taksi https://t.me/qoqon_taxi",
  ])("%s", (text) => {
    const d = detectOrder(text, NOW);
    expect(d.kind).not.toBe("order");
  });

  it("'joy bor' variants are classified as driver_offer when a city is mentioned", () => {
    expect(detectOrder("Qoqonga ketyapman 3 ta joy bor", NOW).kind).toBe("driver_offer");
  });
});

describe("detector: ambiguous / unrelated messages are not orders", () => {
  it.each([
    ["Salom hammaga", "ignore"],
    ["Rahmat", "ignore"],
    ["Qo'qonda havo qanday?", "unrecognized"],
    ["Qo'qonda ish kerak", "unrecognized"], // location only, no direction
    ["Fargona qoqon yo'li yopiq ekan", "unrecognized"],
    ["Qoqondan Toshkentga 2 kishi kerak", "unrecognized"], // other city -> not our route
    ["Toshkentga taksi kerak", "unrecognized"],
    ["Taksi kerak", "unrecognized"], // no route
    ["Qoqonga", "unrecognized"],
  ])("%s -> %s", (text, kind) => {
    const d = detectOrder(text, NOW);
    expect(d.kind, JSON.stringify(d)).toBe(kind);
  });

  it("very long messages are never auto-orders", () => {
    const long = `Qoqonga 2 kishi kerak. ${"Batafsil ma'lumot. ".repeat(20)}`;
    expect(detectOrder(long, NOW).kind).toBe("unrecognized");
  });
});

describe("normalize", () => {
  it("transliterates Cyrillic and drops apostrophes", () => {
    expect(normalize("Фарғона – Қўқон")).toBe("fargona qoqon");
    expect(normalize("Farg‘ona, Qoʻqon!")).toBe("fargona qoqon");
    expect(normalize("Нужно ТАКСИ")).toBe("nujno taksi");
  });
});
