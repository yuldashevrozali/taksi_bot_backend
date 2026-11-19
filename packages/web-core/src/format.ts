import { TASHKENT_OFFSET_MS } from "@taxi/shared";

const pad = (n: number) => String(n).padStart(2, "0");

function local(iso: string | Date): Date {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Date(d.getTime() + TASHKENT_OFFSET_MS);
}

/** "20:30" Tashkent time */
export function hhmm(iso: string | Date): string {
  const d = local(iso);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "19.11.2026" */
export function ddmmyyyy(iso: string | Date): string {
  const d = local(iso);
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

/** "19.11 20:30" */
export function dateTime(iso: string | Date): string {
  const d = local(iso);
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Builds an ISO instant from a Tashkent calendar day offset (0 = today) and "HH:MM". */
export function tashkentInstant(dayOffset: number, time: string, now = new Date()): string {
  const [h, m] = time.split(":").map(Number) as [number, number];
  const today = local(now);
  const utc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + dayOffset, h, m) - TASHKENT_OFFSET_MS;
  return new Date(utc).toISOString();
}

/** Current Tashkent time rounded up to the next 15 minutes, as "HH:MM". */
export function nextQuarterHour(now = new Date()): string {
  const d = local(new Date(now.getTime() + 20 * 60_000));
  const mins = Math.ceil(d.getUTCMinutes() / 15) * 15;
  const h = (d.getUTCHours() + Math.floor(mins / 60)) % 24;
  return `${pad(h)}:${pad(mins % 60)}`;
}

export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

export function tgHref(c: { username: string | null; telegramId: string | null }): string | null {
  if (c.username) return `https://t.me/${c.username}`;
  if (c.telegramId) return `tg://user?id=${c.telegramId}`;
  return null;
}
