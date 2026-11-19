import "dotenv/config";
import { SETTING_DEFAULTS } from "../packages/shared/src/settings.js";
import { createPrismaClient } from "../apps/api/src/db/client.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const db = createPrismaClient(url);

const ROUTES = [
  { code: "FERGANA_KOKAND", fromCity: "Farg'ona", toCity: "Qo'qon", sortOrder: 1 },
  { code: "KOKAND_FERGANA", fromCity: "Qo'qon", toCity: "Farg'ona", sortOrder: 2 },
];

async function main(): Promise<void> {
  for (const r of ROUTES) {
    await db.route.upsert({ where: { code: r.code }, update: {}, create: r });
  }
  for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
    // Never overwrite values the admin already changed.
    await db.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }
  console.log(`Seeded ${ROUTES.length} routes, ${Object.keys(SETTING_DEFAULTS).length} settings`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
