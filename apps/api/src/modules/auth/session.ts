import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { PrismaClient, User } from "@prisma/client";

const LOGIN_TOKEN_TTL_MS = 5 * 60 * 1000;
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** One-time browser login token (sent by the bot). Only its hash is stored. */
export async function createLoginToken(db: PrismaClient, userId: string): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await db.loginToken.create({
    data: { userId, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + LOGIN_TOKEN_TTL_MS) },
  });
  return raw;
}

/** Atomically consumes a login token. Returns the user, or null if invalid/expired/used. */
export async function consumeLoginToken(db: PrismaClient, raw: string): Promise<User | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(raw)) return null;
  const tokenHash = sha256(raw);
  const res = await db.loginToken.updateMany({
    // MongoDB: an unset optional field may be null OR missing.
    where: { tokenHash, expiresAt: { gt: new Date() }, OR: [{ usedAt: null }, { usedAt: { isSet: false } }] },
    data: { usedAt: new Date() },
  });
  if (res.count !== 1) return null;
  const token = await db.loginToken.findUnique({ where: { tokenHash }, include: { user: true } });
  return token?.user ?? null;
}

/** Stateless signed session: base64url(payload).hmac */
export function signSession(userId: string, secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: now + SESSION_TTL_MS })).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySession(token: string, secret: string, now = Date.now()): string | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { uid: string; exp: number };
    return typeof uid === "string" && typeof exp === "number" && exp > now ? uid : null;
  } catch {
    return null;
  }
}
