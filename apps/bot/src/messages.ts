// Notification message builders (HTML parse mode). Group texts are Latin; personal ones follow user language.
import type { Language } from "@prisma/client";
import { formatTashkent } from "@taxi/shared";

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface OrderView {
  number: number;
  fromCity: string;
  toCity: string;
  pickup: string | null;
  dropoff: string | null;
  passengers: number;
  passengersUnknown: boolean;
  isParcel: boolean;
  isNow: boolean;
  departureAt: Date | null;
  comment: string | null;
  source: string;
}

export interface ContactView {
  name: string | null;
  phone: string | null;
  username: string | null;
  telegramId: bigint | null;
  sourceText: string | null;
}

const L = {
  UZ_LATN: {
    order: "Buyurtma",
    from: "Qayerdan",
    to: "Qayerga",
    passengers: "Yo'lovchilar",
    parcel: "📦 Pochta (yuk)",
    unknown: "aniqlanmagan",
    time: "Vaqt",
    now: "Hozir / tez",
    comment: "Izoh",
    client: "Mijoz",
    phone: "Telefon",
    write: "Yozish",
    original: "Asl xabar",
    accepted: (n: number) => `✅ Buyurtma #${n} qabul qilindi.`,
    acceptedClient: (n: number, driver: string, car: string) =>
      `✅ Buyurtmangiz #${n} qabul qilindi!\n🚖 Haydovchi: <b>${driver}</b>${car ? `\n🚗 ${car}` : ""}\n📞 Haydovchi tez orada siz bilan bog'lanadi.`,
    created: (n: number) =>
      `📝 Buyurtmangiz #${n} haydovchilarga yuborildi.\n⏳ Holati: <b>Kutilmoqda</b>\nHaydovchi qabul qilishi bilan sizga xabar beramiz.`,
    pointsEarned: (points: number) => `🎁 Safaringiz uchun +${points} ball qo'shildi. Rahmat!`,
    cancelledByAdmin: (n: number) => `❌ Buyurtma #${n} administrator tomonidan bekor qilindi.`,
    clientCancelled: (n: number) => `❌ Mijoz buyurtma #${n} ni bekor qildi.`,
    driverAdded: "🚖 Siz haydovchi sifatida qo'shildingiz! /start bosing — haydovchi menyusi ochiladi.",
    referralBonus: (points: number) => `🎉 Siz taklif qilgan do'stingiz birinchi safarini yakunladi. +${points} ball!`,
  },
  UZ_CYRL: {
    order: "Буюртма",
    from: "Қаердан",
    to: "Қаерга",
    passengers: "Йўловчилар",
    parcel: "📦 Почта (юк)",
    unknown: "аниқланмаган",
    time: "Вақт",
    now: "Ҳозир / тез",
    comment: "Изоҳ",
    client: "Мижоз",
    phone: "Телефон",
    write: "Ёзиш",
    original: "Асл хабар",
    accepted: (n: number) => `✅ Буюртма #${n} қабул қилинди.`,
    acceptedClient: (n: number, driver: string, car: string) =>
      `✅ Буюртмангиз #${n} қабул қилинди!\n🚖 Ҳайдовчи: <b>${driver}</b>${car ? `\n🚗 ${car}` : ""}\n📞 Ҳайдовчи тез орада сиз билан боғланади.`,
    created: (n: number) =>
      `📝 Буюртмангиз #${n} ҳайдовчиларга юборилди.\n⏳ Ҳолати: <b>Кутилмоқда</b>\nҲайдовчи қабул қилиши билан сизга хабар берамиз.`,
    pointsEarned: (points: number) => `🎁 Сафарингиз учун +${points} балл қўшилди. Раҳмат!`,
    cancelledByAdmin: (n: number) => `❌ Буюртма #${n} администратор томонидан бекор қилинди.`,
    clientCancelled: (n: number) => `❌ Мижоз буюртма #${n} ни бекор қилди.`,
    driverAdded: "🚖 Сиз ҳайдовчи сифатида қўшилдингиз! /start босинг — ҳайдовчи менюси очилади.",
    referralBonus: (points: number) => `🎉 Сиз таклиф қилган дўстингиз биринчи сафарини якунлади. +${points} балл!`,
  },
} as const;

export function msg(lang: Language) {
  return L[lang];
}

function orderLines(o: OrderView, lang: Language): string[] {
  const m = L[lang];
  const lines = [`🚕 <b>${m.order} #${o.number}</b>`, `📍 <b>${esc(o.fromCity)} → ${esc(o.toCity)}</b>`];
  if (o.pickup) lines.push(`🅰️ ${m.from}: ${esc(o.pickup)}`);
  if (o.dropoff) lines.push(`🅱️ ${m.to}: ${esc(o.dropoff)}`);
  lines.push(o.isParcel ? m.parcel : `👥 ${m.passengers}: ${o.passengers}${o.passengersUnknown ? ` (${m.unknown})` : ""}`);
  lines.push(`🕐 ${m.time}: ${o.isNow || !o.departureAt ? m.now : formatTashkent(o.departureAt)}`);
  if (o.comment) lines.push(`💬 ${m.comment}: ${esc(o.comment)}`);
  return lines;
}

/** Posted to the drivers group. Contains NO client contact data. */
export function groupOrderText(o: OrderView): string {
  const lines = [`🆕 <b>Yangi mijoz!</b>  <i>#${o.number}</i>`, "", `📍 <b>${esc(o.fromCity)} → ${esc(o.toCity)}</b>`];
  if (o.pickup) lines.push(`🅰️ Qayerdan: ${esc(o.pickup)}`);
  if (o.dropoff) lines.push(`🅱️ Qayerga: ${esc(o.dropoff)}`);
  lines.push(`🕐 Vaqt: <b>${o.isNow || !o.departureAt ? "Hozir / tez" : formatTashkent(o.departureAt)}</b>`);
  lines.push(o.isParcel ? "📦 <b>Pochta (yuk)</b>" : `👥 Yo'lovchilar: ${o.passengers}${o.passengersUnknown ? " (aniqlanmagan)" : ""}`);
  if (o.comment) lines.push(`💬 Izoh: ${esc(o.comment)}`);
  if (o.source === "GROUP") lines.push("📢 Manba: guruh");
  return lines.join("\n");
}

export const ORDER_START_PREFIX = "order_";

/**
 * Link for the "Buyurtmani olish" button in the drivers group. Web App buttons are not allowed in
 * groups, so we use a t.me link: a registered Mini App (opens directly) or the bot deep link
 * (bot replies in private with a Web App button).
 */
export function takeOrderLink(botUsername: string, orderId: string, miniAppShortName?: string): string {
  const param = `${ORDER_START_PREFIX}${orderId}`;
  return miniAppShortName
    ? `https://t.me/${botUsername}/${miniAppShortName}?startapp=${param}`
    : `https://t.me/${botUsername}?start=${param}`;
}

export function groupAcceptedText(o: OrderView, driverName: string): string {
  return `${groupOrderText(o)}\n\n✅ <b>Qabul qildi: ${esc(driverName)}</b>`;
}

export function groupCancelledText(o: OrderView): string {
  return `<s>${groupOrderText(o)}</s>\n\n❌ <b>Bekor qilindi</b>`;
}

export function contactLink(c: ContactView): string | null {
  if (c.username) return `https://t.me/${c.username}`;
  if (c.telegramId) return `tg://user?id=${c.telegramId}`;
  return null;
}

/** Sent privately to the driver who accepted the order. */
export function driverContactText(o: OrderView, c: ContactView, lang: Language): string {
  const m = L[lang];
  const lines = [m.accepted(o.number), "", ...orderLines(o, lang), ""];
  lines.push(`👤 ${m.client}: ${esc(c.name ?? "—")}`);
  if (c.phone) lines.push(`📞 ${m.phone}: ${esc(c.phone)}`);
  const link = contactLink(c);
  if (c.username) lines.push(`💬 @${esc(c.username)}`);
  else if (link) lines.push(`💬 <a href="${link}">${m.write}</a>`);
  if (c.sourceText) lines.push("", `📝 ${m.original}:`, `<i>${esc(c.sourceText.slice(0, 1000))}</i>`);
  return lines.join("\n");
}

export function adminAlertText(o: OrderView, minutes: number): string {
  return `⏰ <b>${minutes} daqiqadan beri hech kim olmadi</b>\n\n${groupOrderText(o)}`;
}
