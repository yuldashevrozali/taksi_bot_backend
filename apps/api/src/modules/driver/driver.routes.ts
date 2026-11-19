import type { FastifyInstance } from "fastify";
import { ApplyVoucherInput, DriverStatusInput } from "@taxi/shared";
import { currentDriver, currentUser, idParam, parse, requireDriver, type AppDeps } from "../../http/context.js";
import { DomainError } from "../errors.js";
import { toVoucherDto } from "../loyalty/loyalty.service.js";
import { orderInclude, toOrderDto } from "../orders/order.model.js";

const ACCEPT_ERRORS = {
  not_found: 404,
  not_driver: 403,
  bot_not_started: 409,
  already_taken: 409,
} as const;

export async function driverRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const { db, orders, loyalty } = deps;
  app.addHook("preHandler", async (req) => requireDriver(req, deps));

  /** Open orders anyone can take. Never contains client contact data. */
  app.get("/orders/available", async () => {
    const list = await db.order.findMany({
      where: { status: "PENDING" },
      include: orderInclude,
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    return list.map((o) => toOrderDto(o, { withContact: false }));
  });

  /** One order (opened from the drivers-group link). Contact only after I accepted it. */
  app.get("/orders/:id", async (req) => {
    const order = await orders.load(idParam(req));
    if (!order) throw new DomainError("order_not_found", 404);
    return toOrderDto(order, { withContact: order.driverId === currentDriver(req).id });
  });

  app.post("/orders/:id/accept", async (req) => {
    const result = await orders.accept(idParam(req), currentUser(req).telegramId);
    if (!result.ok) throw new DomainError(result.error, ACCEPT_ERRORS[result.error]);
    return toOrderDto(result.order, { withContact: true });
  });

  /** My active orders — WITH client contact (I accepted them). */
  app.get("/orders/mine", async (req) => {
    const list = await db.order.findMany({
      where: { driverId: currentDriver(req).id, status: { in: ["ACCEPTED", "IN_PROGRESS"] } },
      include: orderInclude,
      orderBy: { acceptedAt: "asc" },
    });
    return list.map((o) => toOrderDto(o, { withContact: true }));
  });

  app.post("/orders/:id/status", async (req) => {
    const { status } = parse(DriverStatusInput, req.body);
    const { order, pointsEarned } = await orders.driverSetStatus(idParam(req), currentDriver(req), currentUser(req).id, status);
    return { order: toOrderDto(order, { withContact: true }), pointsEarned };
  });

  /** Everyone's order history: route, time, driver, status. Contact only for my own orders. */
  app.get("/orders/history", async (req) => {
    const driver = currentDriver(req);
    const list = await db.order.findMany({
      where: { status: { in: ["ACCEPTED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] } },
      include: orderInclude,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return list.map((o) => toOrderDto(o, { withContact: o.driverId === driver.id }));
  });

  app.get("/vouchers/lookup", async (req) => {
    const q = String((req.query as { q?: string }).q ?? "");
    if (q.trim().length < 3) throw new DomainError("invalid_input", 400);
    return loyalty.lookup(currentDriver(req), q);
  });

  app.post("/vouchers/:id/apply", async (req) => {
    const { orderId } = parse(ApplyVoucherInput, req.body);
    const voucher = await loyalty.applyVoucher(currentDriver(req), currentUser(req).id, idParam(req), orderId);
    return toVoucherDto(voucher);
  });
}
