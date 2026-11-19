import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { webhookCallback, type Bot } from "grammy";
import { z } from "zod";
import { authenticate, parse, type AppDeps } from "./http/context.js";
import { RateLimiter } from "./http/rate-limit.js";
import { adminRoutes } from "./modules/admin/admin.routes.js";
import { consumeLoginToken, signSession } from "./modules/auth/session.js";
import { clientRoutes } from "./modules/client/client.routes.js";
import { driverRoutes } from "./modules/driver/driver.routes.js";
import { DomainError } from "./modules/errors.js";

export const WEBHOOK_PATH = "/telegram/webhook";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const STATIC_DIRS = {
  app: path.join(root, "apps/web/dist"),
  admin: path.join(root, "apps/admin/dist"),
};

export interface ServerOptions {
  deps: AppDeps;
  bot: Bot;
  webhookSecret: string;
  logger?: boolean;
  serveStatic?: boolean;
  /** Exact origins allowed to call /api from a browser (the separately hosted Mini App). */
  corsOrigins?: string[];
}

const loginLimiter = new RateLimiter(10, 60_000);

const notBuiltPage = (name: string) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<body style="font-family:system-ui;padding:24px"><h3>${name} hali build qilinmagan</h3><p>Ishga tushiring: <code>npm run build</code> yoki <code>npm run dev</code>.</p></body>`;

export async function buildServer({
  deps,
  bot,
  webhookSecret,
  logger = true,
  serveStatic = true,
  corsOrigins = [],
}: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger
      ? {
          // Never log auth headers (initData / sessions) or webhook secrets.
          redact: ["req.headers.authorization", 'req.headers["x-telegram-bot-api-secret-token"]'],
        }
      : false,
    trustProxy: true,
    bodyLimit: 64 * 1024,
  });
  app.decorateRequest("user", null);
  app.decorateRequest("driver", null);

  // CORS: only for /api and only for configured origins. Auth is a header (no cookies), so no credentials.
  const allowed = new Set(corsOrigins);
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (!origin || !allowed.has(origin) || !req.url.startsWith("/api/")) return;
    reply.header("Access-Control-Allow-Origin", origin);
    reply.header("Vary", "Origin");
    if (req.method === "OPTIONS") {
      reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      reply.header("Access-Control-Allow-Headers", "authorization,content-type");
      reply.header("Access-Control-Max-Age", "600");
      return reply.status(204).send();
    }
  });

  app.addHook("onSend", async (_req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof DomainError) {
      const details = (err as DomainError & { details?: unknown }).details;
      return reply.status(err.statusCode).send({ error: err.code, ...(details ? { details } : {}) });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.status(status).send({ error: "bad_request" });
    // Log only name/message: error objects may carry context with secrets (e.g. grammY ctx.api.token).
    const safe = err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) };
    app.log.error({ error: safe }, "unhandled error");
    return reply.status(500).send({ error: "internal_error" });
  });

  app.get("/health", async () => {
    await deps.db.$runCommandRaw({ ping: 1 });
    return { ok: true };
  });

  // grammY validates the X-Telegram-Bot-Api-Secret-Token header and answers 401 on mismatch.
  app.post(WEBHOOK_PATH, webhookCallback(bot, "fastify", { secretToken: webhookSecret }));

  // Public: lets the admin login page build the "Login via Telegram" link.
  app.get("/api/public/config", async () => ({ botUsername: deps.botUsername }));

  // ── Public auth endpoint: exchanges the bot's one-time token for an admin browser session ──
  app.post("/api/auth/exchange", async (req) => {
    if (!loginLimiter.take(req.ip)) throw new DomainError("too_many_requests", 429);
    const { token } = parse(z.object({ token: z.string().max(200) }), req.body);
    const user = await consumeLoginToken(deps.db, token);
    if (!user || user.role !== "ADMIN") throw new DomainError("invalid_or_expired_link", 401);
    return { session: signSession(user.id, deps.sessionSecret) };
  });

  // ── Authenticated API ──
  await app.register(
    async (api) => {
      api.addHook("preHandler", async (req) => {
        req.user = await authenticate(req, deps);
      });
      await api.register(async (r) => clientRoutes(r, deps));
      await api.register(async (r) => driverRoutes(r, deps), { prefix: "/driver" });
      await api.register(async (r) => adminRoutes(r, deps), { prefix: "/admin" });
    },
    { prefix: "/api" },
  );

  // ── Frontends (built by Vite) ──
  if (serveStatic) {
    for (const [name, dir] of Object.entries(STATIC_DIRS)) {
      const prefix = `/${name}/`;
      if (existsSync(path.join(dir, "index.html"))) {
        await app.register(fastifyStatic, { root: dir, prefix, decorateReply: false, index: "index.html", maxAge: "1h" });
      } else {
        app.get(`/${name}/*`, async (_req, reply) => reply.type("text/html; charset=utf-8").send(notBuiltPage(name)));
      }
      app.get(`/${name}`, async (_req, reply) => reply.redirect(prefix));
    }
  }

  return app;
}
