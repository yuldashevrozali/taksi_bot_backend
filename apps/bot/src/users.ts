import { randomBytes } from "node:crypto";
import { Prisma, type PrismaClient, type User } from "@prisma/client";

export interface TelegramProfile {
  id: number;
  first_name: string;
  last_name?: string | undefined;
  username?: string | undefined;
}

const REFERRAL_PAYLOAD = /^ref_([A-Za-z0-9_-]{4,32})$/;

function newReferralCode(): string {
  return randomBytes(6).toString("base64url"); // 8 chars
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export interface StartResult {
  user: User;
  isNew: boolean;
}

/**
 * Creates or refreshes the user who pressed /start.
 * - `startPayload` "ref_<code>" links a NEW user to the referrer (never an existing user, never self).
 * - Telegram IDs listed in `adminTelegramIds` are promoted to ADMIN.
 */
export async function registerStart(
  db: PrismaClient,
  profile: TelegramProfile,
  startPayload: string,
  adminTelegramIds: ReadonlySet<bigint>,
): Promise<StartResult> {
  const telegramId = BigInt(profile.id);
  const isAdmin = adminTelegramIds.has(telegramId);
  const profileData = {
    firstName: profile.first_name,
    lastName: profile.last_name ?? null,
    username: profile.username ?? null,
    botStarted: true,
  };

  const existing = await db.user.findUnique({ where: { telegramId } });
  if (existing) {
    const user = await db.user.update({
      where: { id: existing.id },
      data: { ...profileData, ...(isAdmin && existing.role !== "ADMIN" ? { role: "ADMIN" as const } : {}) },
    });
    return { user, isNew: false };
  }

  const referrerCode = REFERRAL_PAYLOAD.exec(startPayload)?.[1];
  const referrer = referrerCode ? await db.user.findUnique({ where: { referralCode: referrerCode } }) : null;
  const referredById = referrer && referrer.telegramId !== telegramId ? referrer.id : null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const user = await db.user.create({
        data: {
          telegramId,
          ...profileData,
          role: isAdmin ? "ADMIN" : "CLIENT",
          referralCode: newReferralCode(),
          referredById,
        },
      });
      if (referredById) {
        await db.referral.create({ data: { referrerId: referredById, referredId: user.id } });
      }
      return { user, isNew: true };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      // Either a parallel /start created the same user, or a referral code collided — retry/reuse.
      const raced = await db.user.findUnique({ where: { telegramId } });
      if (raced) return { user: raced, isNew: false };
    }
  }
  throw new Error("Could not allocate a unique referral code");
}

export async function findActiveDriver(db: PrismaClient, userId: string) {
  return db.driver.findFirst({ where: { userId, isActive: true } });
}
