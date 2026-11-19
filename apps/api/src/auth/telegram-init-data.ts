import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// Verifies Telegram Mini App initData:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

const InitDataUser = z.object({
  id: z.number().int(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
});

export type InitDataUser = z.infer<typeof InitDataUser>;

export interface VerifiedInitData {
  user: InitDataUser;
  authDate: Date;
}

export class InitDataError extends Error {}

export function verifyInitData(
  initData: string,
  botToken: string,
  { maxAgeSeconds = 24 * 60 * 60, now = new Date() }: { maxAgeSeconds?: number; now?: Date } = {},
): VerifiedInitData {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) throw new InitDataError("missing hash");
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(dataCheckString).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, "hex"))) throw new InitDataError("bad signature");

  const authDateSec = Number(params.get("auth_date"));
  if (!Number.isFinite(authDateSec) || authDateSec <= 0) throw new InitDataError("missing auth_date");
  const ageSec = now.getTime() / 1000 - authDateSec;
  if (ageSec > maxAgeSeconds) throw new InitDataError("initData expired");
  if (ageSec < -60) throw new InitDataError("auth_date in the future");

  const rawUser = params.get("user");
  if (!rawUser) throw new InitDataError("missing user");
  const user = InitDataUser.safeParse(JSON.parse(rawUser));
  if (!user.success) throw new InitDataError("invalid user");

  return { user: user.data, authDate: new Date(authDateSec * 1000) };
}

/** Test/dev helper: builds a correctly signed initData string. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const params = new URLSearchParams(fields);
  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  params.set("hash", createHmac("sha256", secret).update(dataCheckString).digest("hex"));
  return params.toString();
}
