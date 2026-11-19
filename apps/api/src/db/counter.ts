import type { PrismaClient } from "@prisma/client";

// Atomically increments and returns the next value of a named sequence (single findAndModify).
export async function nextSequence(db: PrismaClient, key: string): Promise<number> {
  const res = (await db.$runCommandRaw({
    findAndModify: "counters",
    query: { _id: key },
    update: { $inc: { seq: 1 } },
    upsert: true,
    new: true,
  })) as { value?: { seq?: number } };
  const seq = res.value?.seq;
  if (typeof seq !== "number") throw new Error(`Counter "${key}" returned no value`);
  return seq;
}
