import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { TestProject } from "vitest/node";
import { createPrismaClient } from "../src/db/client.js";
import { ensureIndexes } from "../src/db/indexes.js";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

// Starts an in-memory MongoDB replica set (Prisma needs a replica set, like Atlas),
// applies indexes exactly as production does (npm run db:setup).
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  const databaseUrl = replSet.getUri("taxi_test");
  const db = createPrismaClient(databaseUrl);
  await ensureIndexes(db);
  await db.$disconnect();

  project.provide("databaseUrl", databaseUrl);
  return async () => {
    await replSet.stop();
  };
}
