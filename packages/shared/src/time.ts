// Uzbekistan is UTC+5 all year (no DST).
export const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfTashkentDay(now: Date = new Date()): Date {
  const local = now.getTime() + TASHKENT_OFFSET_MS;
  return new Date(Math.floor(local / DAY_MS) * DAY_MS - TASHKENT_OFFSET_MS);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "19.11 20:00" in Tashkent time. */
export function formatTashkent(date: Date): string {
  const d = new Date(date.getTime() + TASHKENT_OFFSET_MS);
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "YYYY-MM-DD" of the Tashkent calendar day. */
export function tashkentDateKey(date: Date): string {
  const d = new Date(date.getTime() + TASHKENT_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
