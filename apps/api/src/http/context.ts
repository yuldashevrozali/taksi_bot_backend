import type { FastifyReply, FastifyRequest } from "fastify";
import type { Driver, PrismaClient, User } from "@prisma/client";
import type { z } from "zod";
import { DomainError } from "../modules/errors.js";
import type { LoyaltyService } from "../modules/loyalty/loyalty.service.js";
import type { Notifier } from "../modules/notify/notifier.js";
import type { OrderService } from "../modules/orders/order.service.js";
import { InitDataError, verifyInitData } from "../auth/telegram-init-data.js";
import { verifySession } from "../modules/auth/session.js";

export interface AppDeps {
  db: PrismaClient;
  orders: OrderService;
  loyalty: LoyaltyService;
  notifier: Notifier;
  botToken: string;
  botUsername: string;
  sessionSecret: string;
  publicBaseUrl: string;
  adminTelegramIds: ReadonlySet<bigint>;
}

declare module "fastify" {
  interface FastifyRequest {
    user: User | null;
    driver: Driver | null;
  }
}

export function currentUser(req: FastifyRequest): User {
  if (!req.user) throw new DomainError("unauthorized", 401);
  return req.user;
}

export function currentDriver(req: FastifyRequest): Driver {
  if (!req.driver) throw new DomainError("not_a_driver", 403);
  return req.driver;
}

export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw Object.assign(new DomainError("invalid_input", 400), {
      details: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return r.data;
}

/**
 * Accepts either a Mini App launch (`Authorization: tma <initData>`) or an admin browser session
 * (`Authorization: Bearer <session>`). The user must exist (pressed /start in the bot).
 */
export async function authenticate(req: FastifyRequest, deps: AppDeps): Promise<User> {
  const header = req.headers.authorization ?? "";
  const space = header.indexOf(" ");
  const scheme = header.slice(0, space);
  const value = header.slice(space + 1);
  if (space < 0 || !value) throw new DomainError("unauthorized", 401);

  if (scheme === "tma") {
    let telegramId: bigint;
    try {
      telegramId = BigInt(verifyInitData(value, deps.botToken).user.id);
    } catch (e) {
      if (e instanceof InitDataError) throw new DomainError("unauthorized", 401);
      throw e;
    }
    const user = await deps.db.user.findUnique({ where: { telegramId } });
    if (!user) throw new DomainError("not_registered", 403);
    return user;
  }
  if (scheme === "Bearer") {
    const userId = verifySession(value, deps.sessionSecret);
    if (!userId) throw new DomainError("unauthorized", 401);
    const user = await deps.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new DomainError("unauthorized", 401);
    return user;
  }
  throw new DomainError("unauthorized", 401);
}

export async function requireDriver(req: FastifyRequest, deps: AppDeps): Promise<void> {
  const user = currentUser(req);
  const driver = await deps.db.driver.findFirst({ where: { userId: user.id, isActive: true } });
  if (!driver) throw new DomainError("not_a_driver", 403);
  req.driver = driver;
}

export async function requireAdmin(req: FastifyRequest): Promise<void> {
  if (currentUser(req).role !== "ADMIN") throw new DomainError("forbidden", 403);
}

export function idParam(req: FastifyRequest): string {
  const id = (req.params as { id?: string }).id ?? "";
  if (!/^[a-f0-9]{24}$/.test(id)) throw new DomainError("not_found", 404);
  return id;
}

export type Reply = FastifyReply;
