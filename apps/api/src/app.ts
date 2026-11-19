// Composition root: wires DB, bot, notifier, services and HTTP server. Used by index.ts and tests.
import type { FastifyInstance } from "fastify";
import { Bot } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { PrismaClient } from "@prisma/client";
import { miniAppUrl, registerHandlers, type BotServices, type Logger } from "@taxi/bot";
import type { AppDeps } from "./http/context.js";
import { createLoginToken } from "./modules/auth/session.js";
import { LoyaltyService } from "./modules/loyalty/loyalty.service.js";
import { TelegramNotifier, type Notifier } from "./modules/notify/notifier.js";
import { OrderService } from "./modules/orders/order.service.js";
import { GroupService } from "./modules/groups/group.service.js";
import { getSettings } from "./modules/settings/settings.service.js";
import { buildServer } from "./server.js";

export interface AppConfig {
  botToken: string;
  webhookSecret: string;
  sessionSecret: string;
  publicBaseUrl: string;
  adminTelegramIds: ReadonlySet<bigint>;
  driversChatId: bigint | undefined;
  /** Mini App hosted on another origin (Vercel). Enables CORS for it and is used by bot buttons. */
  miniAppUrl?: string | undefined;
  /** Optional BotFather Mini App short name: group button then opens the Mini App directly. */
  miniAppShortName?: string | undefined;
}

export interface CreateAppOptions {
  db: PrismaClient;
  config: AppConfig;
  logger?: Logger;
  httpLogger?: boolean;
  /** Tests: skip getMe. */
  botInfo?: UserFromGetMe;
  /** Tests: replace Telegram side effects. */
  notifier?: Notifier;
  serveStatic?: boolean;
}

export interface App {
  server: FastifyInstance;
  bot: Bot;
  deps: AppDeps;
  groups: GroupService;
}

const consoleLogger: Logger = {
  info: (o, m) => console.log(m ?? "", JSON.stringify(o)),
  error: (o, m) => console.error(m ?? "", JSON.stringify(o)),
};

export async function createApp(opts: CreateAppOptions): Promise<App> {
  const { db, config } = opts;
  const log = opts.logger ?? consoleLogger;
  const bot = new Bot(config.botToken, opts.botInfo ? { botInfo: opts.botInfo } : {});
  if (!opts.botInfo) await bot.init();

  const notifier =
    opts.notifier ??
    new TelegramNotifier(bot.api, db, config.driversChatId, log, {
      botUsername: bot.botInfo.username,
      miniAppShortName: config.miniAppShortName,
    });
  const loyalty = new LoyaltyService(db, notifier, log);
  const orders = new OrderService(db, notifier, loyalty, log);
  const groups = new GroupService(
    db,
    orders,
    config.driversChatId,
    async (chatId) => {
      const m = await bot.api.getChatMember(chatId.toString(), bot.botInfo.id);
      return { status: m.status, canDelete: m.status === "administrator" && Boolean(m.can_delete_messages) };
    },
    log,
  );

  const services: BotServices = {
    acceptOrder: async (orderId, telegramId) => {
      const r = await orders.accept(orderId, telegramId);
      return r.ok ? { ok: true, driverDmOk: r.driverDmOk } : r;
    },
    cancelOrder: async (orderId, telegramId) => {
      const user = await db.user.findUnique({ where: { telegramId } });
      if (!user) return "not_found";
      try {
        await orders.cancelByClient(orderId, user);
        return "ok";
      } catch (e) {
        const code = (e as { code?: string }).code;
        return code === "cannot_cancel" || code === "conflict_try_again" ? "cannot_cancel" : "not_found";
      }
    },
    createAdminLoginUrl: async (telegramId) => {
      const user = await db.user.findUnique({ where: { telegramId } });
      const base = miniAppUrl({ publicBaseUrl: config.publicBaseUrl }, "/admin/");
      if (!user || user.role !== "ADMIN" || !base) return null;
      return `${base}?login=${await createLoginToken(db, user.id)}`;
    },
    supportContact: async () => (await getSettings(db))["support.contact"],
    handleGroupMessage: (msg) => groups.handleMessage(msg),
    groupMembershipChanged: (e) => groups.membershipChanged(e),
  };
  registerHandlers(bot, {
    db,
    config: { publicBaseUrl: config.publicBaseUrl, miniAppUrl: config.miniAppUrl, adminTelegramIds: config.adminTelegramIds },
    services,
    logger: log,
  });

  const deps: AppDeps = {
    db,
    orders,
    loyalty,
    notifier,
    botToken: config.botToken,
    botUsername: bot.botInfo.username,
    sessionSecret: config.sessionSecret,
    publicBaseUrl: config.publicBaseUrl,
    adminTelegramIds: config.adminTelegramIds,
  };
  const server = await buildServer({
    deps,
    bot,
    webhookSecret: config.webhookSecret,
    corsOrigins: config.miniAppUrl ? [new URL(config.miniAppUrl).origin] : [],
    logger: opts.httpLogger ?? true,
    serveStatic: opts.serveStatic ?? true,
  });
  return { server, bot, deps, groups };
}

/** Postgres-free, Redis-free scheduler: a simple interval that is safe to run on one instance. */
export function startScheduler(app: App, log: Logger, intervalMs = 60_000): () => void {
  const tick = async () => {
    try {
      const minutes = (await getSettings(app.deps.db))["orders.unacceptedAlertMinutes"];
      const sent = await app.deps.orders.alertUnaccepted(minutes);
      if (sent) log.info({ sent }, "unaccepted order alerts sent");
    } catch (e) {
      log.error({ error: e instanceof Error ? e.message : String(e) }, "scheduler tick failed");
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  void tick();
  return () => clearInterval(timer);
}
