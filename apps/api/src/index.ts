import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEXTS, miniAppUrl } from "@taxi/bot";
import { createApp, startScheduler } from "./app.js";
import { parseEnv } from "./config/env.js";
import { createPrismaClient } from "./db/client.js";
import { WEBHOOK_PATH } from "./server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
// Values already in process.env (e.g. PUBLIC_BASE_URL from `npm run dev`) win over .env.
loadDotenv({ path: path.join(root, ".env"), quiet: true });

const env = parseEnv(process.env);
const db = createPrismaClient(env.DATABASE_URL);
const app = await createApp({
  db,
  config: {
    botToken: env.BOT_TOKEN,
    webhookSecret: env.BOT_WEBHOOK_SECRET,
    sessionSecret: env.SESSION_SECRET,
    publicBaseUrl: env.PUBLIC_BASE_URL,
    adminTelegramIds: env.ADMIN_TELEGRAM_IDS,
    driversChatId: env.DRIVERS_GROUP_CHAT_ID,
    miniAppShortName: env.MINI_APP_SHORT_NAME,
    miniAppUrl: env.MINI_APP_URL,
  },
});
const { server, bot } = app;
await server.listen({ port: env.API_PORT, host: "0.0.0.0" });
server.log.info(`Bot @${bot.botInfo.username} ready`);

const log = {
  info: (o: object, m?: string) => server.log.info(o, m),
  error: (o: object, m?: string) => server.log.error(o, m),
};
const stopScheduler = startScheduler(app, log);

// Register the webhook. A fresh quick-tunnel hostname may need some time before Telegram can resolve it.
async function registerWebhook(): Promise<void> {
  if (!env.PUBLIC_BASE_URL.startsWith("https://")) {
    server.log.warn("PUBLIC_BASE_URL is not HTTPS — webhook and Mini App are disabled. Run `npm run dev`.");
    return;
  }
  const url = `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}${WEBHOOK_PATH}`;
  for (let attempt = 1; attempt <= 24; attempt++) {
    try {
      await bot.api.setWebhook(url, {
        secret_token: env.BOT_WEBHOOK_SECRET,
        allowed_updates: ["message", "edited_message", "callback_query", "my_chat_member", "chat_member"],
      });
      server.log.info(`Webhook set: ${url}`);
      const appUrl = miniAppUrl({ publicBaseUrl: env.PUBLIC_BASE_URL, miniAppUrl: env.MINI_APP_URL });
      if (appUrl) {
        // Default "Menu" button (bottom-left in every private chat) opens the Mini App with initData.
        await bot.api.setChatMenuButton({
          menu_button: { type: "web_app", text: TEXTS.UZ_LATN.menuButton, web_app: { url: appUrl } },
        });
        server.log.info(`Mini App: ${appUrl} | Admin: ${miniAppUrl({ publicBaseUrl: env.PUBLIC_BASE_URL }, "/admin/")}`);
      }
      return;
    } catch (e) {
      server.log.warn(`setWebhook attempt ${attempt} failed: ${e instanceof Error ? e.message : String(e)}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  server.log.error("Could not set webhook. Is the tunnel running?");
}
void registerWebhook();

async function shutdown(signal: string): Promise<void> {
  server.log.info(`${signal} received, shutting down`);
  stopScheduler();
  await server.close();
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
