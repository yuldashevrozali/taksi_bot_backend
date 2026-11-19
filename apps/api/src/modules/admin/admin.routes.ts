import type { FastifyInstance } from "fastify";
import type { OrderSource, OrderStatus, Prisma } from "@prisma/client";
import {
  AddDriverInput,
  AdjustPointsInput,
  AdminStatusInput,
  BROADCAST_AUDIENCES,
  BroadcastInput,
  ORDER_SOURCES,
  ORDER_STATUSES,
  SettingsUpdateInput,
  TelegramIdInput,
  UpdateDriverInput,
  startOfTashkentDay,
  tashkentDateKey,
  type AdminDriverDto,
  type AdminStatsDto,
  type AdminUserDto,
  type GroupMessageDto,
  type Page,
} from "@taxi/shared";
import { currentUser, idParam, parse, requireAdmin, type AppDeps } from "../../http/context.js";
import { DomainError } from "../errors.js";
import { displayName, orderInclude, toOrderDto } from "../orders/order.model.js";
import { getSettings, updateSettings } from "../settings/settings.service.js";
import { toBroadcastDto } from "../broadcast/broadcast.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function pageParams(query: unknown, defaultSize = 20): { page: number; pageSize: number; skip: number } {
  const q = query as { page?: string; pageSize?: string };
  const page = Math.max(1, Number.parseInt(q.page ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(q.pageSize ?? String(defaultSize), 10) || defaultSize));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export async function adminRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const { db, orders, notifier } = deps;
  app.addHook("preHandler", async (req) => requireAdmin(req));

  const audit = (actorId: string, action: string, entityType: string, entityId: string | null, data?: Prisma.InputJsonValue) =>
    db.auditLog.create({ data: { actorId, action, entityType, entityId, data: data ?? {} } });

  // ── Dashboard ──
  app.get("/stats", async (): Promise<AdminStatsDto> => {
    const now = new Date();
    const today = startOfTashkentDay(now);
    const weekStart = new Date(today.getTime() - 6 * DAY_MS);
    const [todayOrders, completed, cancelled, newClients, pendingNow, activeDrivers, totalClients, week] = await Promise.all([
      db.order.count({ where: { createdAt: { gte: today } } }),
      db.order.count({ where: { completedAt: { gte: today }, status: "COMPLETED" } }),
      db.order.count({ where: { cancelledAt: { gte: today }, status: "CANCELLED" } }),
      db.user.count({ where: { createdAt: { gte: today }, role: "CLIENT" } }),
      db.order.count({ where: { status: "PENDING" } }),
      db.driver.count({ where: { isActive: true } }),
      db.user.count({ where: { role: "CLIENT" } }),
      db.order.findMany({ where: { createdAt: { gte: weekStart } }, select: { createdAt: true, status: true, source: true } }),
    ]);
    const bySource = Object.fromEntries(ORDER_SOURCES.map((s) => [s, 0])) as Record<OrderSource, number>;
    const days = new Map<string, { orders: number; completed: number }>();
    for (let i = 0; i < 7; i++) days.set(tashkentDateKey(new Date(weekStart.getTime() + i * DAY_MS)), { orders: 0, completed: 0 });
    for (const o of week) {
      if (o.createdAt >= today) bySource[o.source]++;
      const d = days.get(tashkentDateKey(o.createdAt));
      if (d) {
        d.orders++;
        if (o.status === "COMPLETED") d.completed++;
      }
    }
    return {
      today: { orders: todayOrders, completed, cancelled, newClients },
      pendingNow,
      activeDrivers,
      totalClients,
      bySource,
      last7Days: [...days.entries()].map(([date, v]) => ({ date, ...v })),
    };
  });

  // ── Orders ──
  app.get("/orders", async (req) => {
    const q = req.query as { status?: string; source?: string; q?: string };
    const { page, pageSize, skip } = pageParams(req.query);
    const where: Prisma.OrderWhereInput = {};
    if (q.status && (ORDER_STATUSES as readonly string[]).includes(q.status)) where.status = q.status as OrderStatus;
    if (q.source && (ORDER_SOURCES as readonly string[]).includes(q.source)) where.source = q.source as OrderSource;
    if (q.q && /^\d+$/.test(q.q.trim())) where.number = Number(q.q.trim());
    const [items, total] = await Promise.all([
      db.order.findMany({ where, include: orderInclude, orderBy: { createdAt: "desc" }, skip, take: pageSize }),
      db.order.count({ where }),
    ]);
    return { items: items.map((o) => toOrderDto(o, { withContact: true })), total, page, pageSize };
  });

  app.get("/orders/:id/history", async (req) => {
    const rows = await db.orderStatusHistory.findMany({
      where: { orderId: idParam(req) },
      include: { changedBy: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((h) => ({
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      by: h.changedBy ? displayName(h.changedBy) : "Tizim",
      note: h.note,
      createdAt: h.createdAt.toISOString(),
    }));
  });

  app.post("/orders/:id/status", async (req) => {
    const { status, reason } = parse(AdminStatusInput, req.body);
    const order = await orders.adminSetStatus(idParam(req), currentUser(req), status, reason);
    return toOrderDto(order, { withContact: true });
  });

  // ── Drivers ──
  app.get("/drivers", async (): Promise<AdminDriverDto[]> => {
    const drivers = await db.driver.findMany({ include: { user: true }, orderBy: { createdAt: "desc" } });
    const counts = await db.order.groupBy({ by: ["driverId", "status"], where: { driverId: { in: drivers.map((d) => d.id) } }, _count: { _all: true } });
    const count = (driverId: string, statuses: OrderStatus[]) =>
      counts.filter((c) => c.driverId === driverId && statuses.includes(c.status)).reduce((s, c) => s + c._count._all, 0);
    return drivers.map((d) => ({
      id: d.id,
      userId: d.userId,
      telegramId: d.user.telegramId.toString(),
      name: displayName(d.user),
      username: d.user.username,
      phone: d.user.phone,
      carModel: d.carModel,
      carNumber: d.carNumber,
      carColor: d.carColor,
      isActive: d.isActive,
      botStarted: d.user.botStarted,
      completedOrders: count(d.id, ["COMPLETED"]),
      activeOrders: count(d.id, ["ACCEPTED", "IN_PROGRESS"]),
      createdAt: d.createdAt.toISOString(),
    }));
  });

  /** Adds (or re-activates) a driver by Telegram ID. The person must have pressed /start first. */
  app.post("/drivers", async (req, reply) => {
    const admin = currentUser(req);
    const input = parse(AddDriverInput, req.body);
    const user = await db.user.findUnique({ where: { telegramId: BigInt(input.telegramId) } });
    if (!user) throw new DomainError("user_must_start_bot", 404);
    const car = { carModel: input.carModel ?? null, carNumber: input.carNumber ?? null, carColor: input.carColor ?? null };
    const driver = await db.driver.upsert({
      where: { userId: user.id },
      update: { isActive: true, ...car },
      create: { userId: user.id, addedById: admin.id, ...car },
    });
    if (user.role === "CLIENT") await db.user.update({ where: { id: user.id }, data: { role: "DRIVER" } });
    await audit(admin.id, "driver.add", "driver", driver.id, { telegramId: input.telegramId });
    await notifier.driverAdded(user.telegramId, user.language);
    return reply.status(201).send({ id: driver.id });
  });

  app.patch("/drivers/:id", async (req) => {
    const admin = currentUser(req);
    const input = parse(UpdateDriverInput, req.body);
    const driver = await db.driver.findUnique({ where: { id: idParam(req) }, include: { user: true } });
    if (!driver) throw new DomainError("not_found", 404);
    await db.driver.update({ where: { id: driver.id }, data: input });
    if (input.isActive === false && driver.user.role === "DRIVER") {
      await db.user.update({ where: { id: driver.userId }, data: { role: "CLIENT" } });
    }
    if (input.isActive === true && driver.user.role === "CLIENT") {
      await db.user.update({ where: { id: driver.userId }, data: { role: "DRIVER" } });
    }
    await audit(admin.id, input.isActive === false ? "driver.deactivate" : "driver.update", "driver", driver.id, input);
    return { ok: true };
  });

  // ── Users ──
  app.get("/users", async (req): Promise<Page<AdminUserDto>> => {
    const { page, pageSize, skip } = pageParams(req.query, 30);
    const q = String((req.query as { q?: string }).q ?? "").trim();
    const where: Prisma.UserWhereInput = q
      ? {
          OR: [
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { username: { contains: q.replace(/^@/, ""), mode: "insensitive" } },
            { phone: { contains: q.replace(/\D/g, "") || q } },
            ...(/^\d{3,20}$/.test(q) ? [{ telegramId: BigInt(q) }] : []),
          ],
        }
      : {};
    const [users, total] = await Promise.all([
      db.user.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: pageSize }),
      db.user.count({ where }),
    ]);
    const ids = users.map((u) => u.id);
    const [points, orderCounts] = await Promise.all([
      db.loyaltyLedger.groupBy({ by: ["userId"], where: { userId: { in: ids } }, _sum: { amount: true } }),
      db.order.groupBy({ by: ["clientId"], where: { clientId: { in: ids } }, _count: { _all: true } }),
    ]);
    return {
      items: users.map((u) => ({
        id: u.id,
        telegramId: u.telegramId.toString(),
        name: displayName(u),
        username: u.username,
        phone: u.phone,
        role: u.role,
        language: u.language,
        points: points.find((p) => p.userId === u.id)?._sum.amount ?? 0,
        ordersCount: orderCounts.find((c) => c.clientId === u.id)?._count._all ?? 0,
        createdAt: u.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  });

  // ── Admins ──
  app.get("/admins", async () => {
    const admins = await db.user.findMany({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } });
    return admins.map((u) => ({
      id: u.id,
      telegramId: u.telegramId.toString(),
      name: displayName(u),
      username: u.username,
      fromEnv: deps.adminTelegramIds.has(u.telegramId),
    }));
  });

  app.post("/admins", async (req) => {
    const admin = currentUser(req);
    const { telegramId } = parse(TelegramIdInput, req.body);
    const user = await db.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
    if (!user) throw new DomainError("user_must_start_bot", 404);
    await db.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
    await audit(admin.id, "admin.add", "user", user.id);
    return { ok: true };
  });

  app.delete("/admins/:id", async (req) => {
    const admin = currentUser(req);
    const user = await db.user.findUnique({ where: { id: idParam(req) } });
    if (!user || user.role !== "ADMIN") throw new DomainError("not_found", 404);
    if (user.id === admin.id) throw new DomainError("cannot_remove_self", 409);
    if (deps.adminTelegramIds.has(user.telegramId)) throw new DomainError("admin_from_env", 409);
    const isDriver = await db.driver.count({ where: { userId: user.id, isActive: true } });
    await db.user.update({ where: { id: user.id }, data: { role: isDriver ? "DRIVER" : "CLIENT" } });
    await audit(admin.id, "admin.remove", "user", user.id);
    return { ok: true };
  });

  // ── Routes ──
  app.get("/routes", async () => {
    const routes = await db.route.findMany({ orderBy: { sortOrder: "asc" } });
    return routes.map((r) => ({ id: r.id, code: r.code, fromCity: r.fromCity, toCity: r.toCity, isActive: r.isActive }));
  });

  app.patch("/routes/:id", async (req) => {
    const { isActive } = parse(UpdateDriverInput.pick({ isActive: true }).required(), req.body);
    const res = await db.route.updateMany({ where: { id: idParam(req) }, data: { isActive } });
    if (res.count === 0) throw new DomainError("not_found", 404);
    await audit(currentUser(req).id, "route.update", "route", idParam(req), { isActive });
    return { ok: true };
  });

  // ── Settings & loyalty ──
  app.get("/settings", async () => getSettings(db));
  app.put("/settings", async (req) => updateSettings(db, parse(SettingsUpdateInput, req.body), currentUser(req).id));

  app.get("/loyalty/stats", async () => {
    const [issued, spent, active, used, referrals] = await Promise.all([
      db.loyaltyLedger.aggregate({ where: { amount: { gt: 0 } }, _sum: { amount: true } }),
      db.loyaltyLedger.aggregate({ where: { amount: { lt: 0 } }, _sum: { amount: true } }),
      db.voucher.count({ where: { status: "ACTIVE" } }),
      db.voucher.count({ where: { status: "USED" } }),
      db.referral.count({ where: { bonusGranted: true } }),
    ]);
    return {
      pointsIssued: issued._sum.amount ?? 0,
      pointsSpent: -(spent._sum.amount ?? 0),
      vouchersActive: active,
      vouchersUsed: used,
      referralBonusesGranted: referrals,
    };
  });

  /** Manual correction / revoking points from a fake trip. Always audited. */
  app.post("/loyalty/adjust", async (req) => {
    const admin = currentUser(req);
    const input = parse(AdjustPointsInput, req.body);
    const user = await db.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new DomainError("not_found", 404);
    const entry = await db.loyaltyLedger.create({
      data: {
        userId: user.id,
        amount: input.amount,
        type: input.amount < 0 ? "ADMIN_REVERSAL" : "ADMIN_ADJUST",
        note: input.note,
        createdById: admin.id,
      },
    });
    await audit(admin.id, "loyalty.adjust", "user", user.id, { amount: input.amount, note: input.note });
    return { id: entry.id };
  });

  // ── Groups ──
  app.get("/groups", async () => {
    const groups = await db.monitoredGroup.findMany({ orderBy: { createdAt: "asc" } });
    return groups.map((g) => ({
      id: g.id,
      chatId: g.chatId.toString(),
      title: g.title,
      isActive: g.isActive,
      botIsAdmin: g.botIsAdmin,
      canDelete: g.canDelete,
      lastMessageAt: g.lastMessageAt?.toISOString() ?? null,
    }));
  });

  app.patch("/groups/:id", async (req) => {
    const { isActive } = parse(UpdateDriverInput.pick({ isActive: true }).required(), req.body);
    const res = await db.monitoredGroup.updateMany({ where: { id: idParam(req) }, data: { isActive } });
    if (res.count === 0) throw new DomainError("not_found", 404);
    await audit(currentUser(req).id, "group.update", "group", idParam(req), { isActive });
    return { ok: true };
  });

  app.get("/groups/messages", async (req): Promise<Page<GroupMessageDto>> => {
    const { page, pageSize, skip } = pageParams(req.query, 30);
    const RESULTS = ["UNRECOGNIZED", "ORDER_CREATED", "DRIVER_OFFER", "DUPLICATE"] as const;
    const q = String((req.query as { result?: string }).result ?? "UNRECOGNIZED");
    const result = (RESULTS as readonly string[]).includes(q) ? (q as (typeof RESULTS)[number]) : "UNRECOGNIZED";
    const where: Prisma.GroupMessageWhereInput = { result };
    const [items, total] = await Promise.all([
      db.groupMessage.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: pageSize }),
      db.groupMessage.count({ where }),
    ]);
    return {
      items: items.map((m) => ({
        id: m.id,
        chatId: m.chatId.toString(),
        text: m.text,
        senderUsername: m.senderUsername,
        senderName: m.senderName,
        confidence: m.confidence,
        result: m.result,
        createdAt: m.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  });

  // ── Broadcasts ("Reklama") ──
  app.get("/broadcasts", async () => {
    const rows = await db.broadcast.findMany({ include: { createdBy: true }, orderBy: { createdAt: "desc" }, take: 30 });
    return rows.map(toBroadcastDto);
  });

  app.get("/broadcasts/recipients", async (req) => {
    const audience = String((req.query as { audience?: string }).audience ?? "ALL");
    if (!(BROADCAST_AUDIENCES as readonly string[]).includes(audience)) throw new DomainError("invalid_input", 400);
    return { count: await deps.broadcasts.countRecipients(audience as (typeof BROADCAST_AUDIENCES)[number]) };
  });

  app.post("/broadcasts/test", async (req) => {
    await deps.broadcasts.sendTest(parse(BroadcastInput, req.body), currentUser(req));
    return { ok: true };
  });

  app.post("/broadcasts", async (req, reply) => {
    const b = await deps.broadcasts.create(parse(BroadcastInput, req.body), currentUser(req));
    return reply.status(201).send(toBroadcastDto(b));
  });

  app.post("/broadcasts/:id/cancel", async (req) => {
    await deps.broadcasts.cancel(idParam(req), currentUser(req));
    return { ok: true };
  });

  // ── Audit ──
  app.get("/audit", async () => {
    const rows = await db.auditLog.findMany({ include: { actor: true }, orderBy: { createdAt: "desc" }, take: 100 });
    return rows.map((r) => ({
      id: r.id,
      actor: r.actor ? displayName(r.actor) : "Tizim",
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      data: r.data,
      createdAt: r.createdAt.toISOString(),
    }));
  });
}
