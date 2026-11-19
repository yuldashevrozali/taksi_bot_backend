import { inject } from "vitest";
import { createPrismaClient, type Db } from "../src/db/client.js";
import { nextSequence } from "../src/db/counter.js";

export function testDb(): Db {
  return createPrismaClient(inject("databaseUrl"));
}

// Clears documents but keeps collections and indexes.
export async function resetDb(db: Db): Promise<void> {
  const res = (await db.$runCommandRaw({ listCollections: 1, nameOnly: true })) as {
    cursor: { firstBatch: { name: string }[] };
  };
  for (const { name } of res.cursor.firstBatch) {
    if (name.startsWith("system.")) continue;
    await db.$runCommandRaw({ delete: name, deletes: [{ q: {}, limit: 0 }] });
  }
}

let seq = 0;
export async function makeUser(db: Db, telegramId?: bigint) {
  seq += 1;
  return db.user.create({
    data: { telegramId: telegramId ?? BigInt(1000 + seq), referralCode: `ref${seq}`, firstName: `U${seq}` },
  });
}

export async function makeRoute(db: Db) {
  return db.route.create({ data: { code: "FERGANA_KOKAND", fromCity: "Farg'ona", toCity: "Qo'qon" } });
}

export async function makeOrder(db: Db, data: { clientId: string; routeId: string; idempotencyKey?: string }) {
  return db.order.create({
    data: { ...data, number: await nextSequence(db, "order"), source: "MINIAPP", passengers: 2, isNow: true },
  });
}
