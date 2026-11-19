import type { FastifyInstance } from "fastify";
import {
  CancelInput,
  CreateOrderInput,
  FavoriteInput,
  LanguageInput,
  type FavoriteDto,
  type LoyaltyDto,
  type MeDto,
  type RouteDto,
} from "@taxi/shared";
import { RateLimiter } from "../../http/rate-limit.js";
import { currentUser, idParam, parse, type AppDeps } from "../../http/context.js";
import { DomainError, isUniqueViolation } from "../errors.js";
import { toVoucherDto } from "../loyalty/loyalty.service.js";
import { orderInclude, toOrderDto } from "../orders/order.model.js";
import { getSettings } from "../settings/settings.service.js";

const orderLimiter = new RateLimiter(10, 60_000);

export async function clientRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const { db, orders, loyalty } = deps;

  app.get("/me", async (req): Promise<MeDto> => {
    const user = currentUser(req);
    const driver = await db.driver.findFirst({ where: { userId: user.id, isActive: true } });
    return {
      id: user.id,
      firstName: user.firstName,
      username: user.username,
      role: user.role,
      language: user.language,
      hasPhone: Boolean(user.phone),
      phone: user.phone, // the user's own phone
      isDriver: Boolean(driver),
      isAdmin: user.role === "ADMIN",
      referralCode: user.referralCode,
      botUsername: deps.botUsername,
    };
  });

  app.patch("/me", async (req) => {
    const { language } = parse(LanguageInput, req.body);
    await db.user.update({ where: { id: currentUser(req).id }, data: { language } });
    return { ok: true };
  });

  app.get("/routes", async (): Promise<RouteDto[]> => {
    const routes = await db.route.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
    return routes.map((r) => ({ id: r.id, code: r.code, fromCity: r.fromCity, toCity: r.toCity, isActive: r.isActive }));
  });

  // ── Orders ──
  app.post("/orders", async (req, reply) => {
    const user = currentUser(req);
    if (!orderLimiter.take(user.id)) throw new DomainError("too_many_requests", 429);
    const input = parse(CreateOrderInput, req.body);
    const { order, created } = await orders.create(user, input, "MINIAPP");
    return reply.status(created ? 201 : 200).send(toOrderDto(order, { withContact: false }));
  });

  app.get("/orders", async (req) => {
    const user = currentUser(req);
    const list = await db.order.findMany({
      where: { clientId: user.id },
      include: orderInclude,
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return list.map((o) => toOrderDto(o, { withContact: false }));
  });

  app.get("/orders/:id", async (req) => {
    const user = currentUser(req);
    const order = await orders.load(idParam(req));
    if (!order) throw new DomainError("order_not_found", 404);
    const driver = await db.driver.findFirst({ where: { userId: user.id } });
    const isOwner = order.clientId === user.id;
    const isAcceptingDriver = Boolean(driver && order.driverId === driver.id);
    const isAdmin = user.role === "ADMIN";
    if (!isOwner && !isAcceptingDriver && !isAdmin) throw new DomainError("order_not_found", 404);
    return toOrderDto(order, { withContact: isAcceptingDriver || isAdmin });
  });

  app.post("/orders/:id/cancel", async (req) => {
    const { reason } = parse(CancelInput, req.body ?? {});
    const order = await orders.cancelByClient(idParam(req), currentUser(req), reason);
    return toOrderDto(order, { withContact: false });
  });

  // ── Loyalty ──
  app.get("/loyalty", async (req): Promise<LoyaltyDto> => {
    const user = currentUser(req);
    const [balance, s, vouchers, ledger, referralsCount] = await Promise.all([
      loyalty.balance(user.id),
      getSettings(db),
      db.voucher.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 }),
      db.loyaltyLedger.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 30 }),
      db.referral.count({ where: { referrerId: user.id } }),
    ]);
    return {
      balance,
      pointsPerVoucher: s["loyalty.pointsPerVoucher"],
      voucherPercent: s["loyalty.voucherPercent"],
      pointsPerTrip: s["loyalty.pointsPerTrip"],
      referralBonus: s["referral.bonusPoints"],
      referralLink: `https://t.me/${deps.botUsername}?start=ref_${user.referralCode}`,
      referralsCount,
      vouchers: vouchers.map(toVoucherDto),
      ledger: ledger.map((l) => ({ id: l.id, amount: l.amount, type: l.type, note: l.note, createdAt: l.createdAt.toISOString() })),
    };
  });

  app.post("/loyalty/redeem", async (req, reply) => {
    const voucher = await loyalty.redeem(currentUser(req));
    return reply.status(201).send(toVoucherDto(voucher));
  });

  // ── Favorite routes ──
  app.get("/favorites", async (req): Promise<FavoriteDto[]> => {
    const favs = await db.favoriteRoute.findMany({
      where: { userId: currentUser(req).id },
      include: { route: true },
      orderBy: { createdAt: "desc" },
    });
    return favs.map((f) => ({
      id: f.id,
      route: { id: f.route.id, fromCity: f.route.fromCity, toCity: f.route.toCity },
      pickup: f.pickup,
      dropoff: f.dropoff,
      label: f.label,
    }));
  });

  app.post("/favorites", async (req, reply) => {
    const user = currentUser(req);
    const input = parse(FavoriteInput, req.body);
    if ((await db.favoriteRoute.count({ where: { userId: user.id } })) >= 20) throw new DomainError("too_many_favorites", 409);
    const route = await db.route.findUnique({ where: { id: input.routeId } });
    if (!route) throw new DomainError("route_not_found", 404);
    try {
      const fav = await db.favoriteRoute.create({ data: { userId: user.id, ...input, label: input.label ?? null } });
      return reply.status(201).send({ id: fav.id });
    } catch (e) {
      if (isUniqueViolation(e)) throw new DomainError("favorite_exists", 409);
      throw e;
    }
  });

  app.delete("/favorites/:id", async (req) => {
    const res = await db.favoriteRoute.deleteMany({ where: { id: idParam(req), userId: currentUser(req).id } });
    if (res.count === 0) throw new DomainError("not_found", 404);
    return { ok: true };
  });
}
