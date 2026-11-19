// Creates MongoDB collections/indexes (idempotent). Run on first deploy and after schema changes.
import "dotenv/config";
import { createPrismaClient } from "../apps/api/src/db/client.js";
import { INDEXES, ensureIndexes } from "../apps/api/src/db/indexes.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const db = createPrismaClient(url);
try {
  await ensureIndexes(db);
  console.log(`Indexes ensured: ${INDEXES.length}`);
} finally {
  await db.$disconnect();
}
