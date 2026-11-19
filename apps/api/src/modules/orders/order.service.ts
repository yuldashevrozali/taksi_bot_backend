import type { Driver, OrderSource, OrderStatus, Prisma, PrismaClient, User } from "@prisma/client";
import { normalizeUzPhone, type CreateOrderInput } from "@taxi/shared";
import type { Logger } from "@taxi/bot";
import { nextSequence } from "../../db/counter.js";
import { DomainError, isUniqueViolation } from "../errors.js";
import type { LoyaltyService } from "../loyalty/loyalty.service.js";
import type { Notifier } from "../notify/notifier.js";
import type { Detection } from "../groups/detector.js";
import { displayName, orderInclude, type FullOrder } from "./order.model.js";

const MAX_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;
const PAST_TOLERANCE_MS = 5 * 60 * 1000;

// MongoDB: an unset optional field may be stored as null OR be missing.
const notAlerted = { OR: [{ adminAlertedAt: null }, { adminAlertedAt: { isSet: false } }] } satisfies Prisma.OrderWhereInput;

export type AcceptError = "not_found" | "not_driver" | "bot_not_started" | "already_taken";
export type AcceptResult = { ok: true; order: FullOrder; driverDmOk: boolean } | { ok: false; error: AcceptError };

const timestampFor: Partial<Record<OrderStatus, "acceptedAt" | "startedAt" | "completedAt" | "cancelledAt">> = {
  ACCEPTED: "acceptedAt",
  IN_PROGRESS: "startedAt",
  COMPLETED: "completedAt",
  CANCELLED: "cancelledAt",
};

export class OrderService {
  constructor(
    private readonly db: PrismaClient,
    private readonly notifier: Notifier,
    private readonly loyalty: LoyaltyService,
    private readonly log: Logger,
  ) {}

  load(id: string): Promise<FullOrder | null> {
    if (!/^[a-f0-9]{24}$/.test(id)) return Promise.resolve(null);
    return this.db.order.findUnique({ where: { id }, include: orderInclude });
  }

  private async loadOrThrow(id: string): Promise<FullOrder> {
    const o = await this.load(id);
    if (!o) throw new DomainError("order_not_found", 404);
    return o;
  }

  private history(orderId: string, from: OrderStatus | null, to: OrderStatus, by: string | null, note?: string) {
    return this.db.orderStatusHistory.create({
      data: { orderId, fromStatus: from, toStatus: to, changedById: by, note: note ?? null },
    });
  }

  async create(
    user: User,
    input: CreateOrderInput,
    source: OrderSource,
    now = new Date(),
  ): Promise<{ order: FullOrder; created: boolean }> {
    const existing = await this.db.order.findFirst({
      where: { clientId: user.id, idempotencyKey: input.idempotencyKey },
      include: orderInclude,
    });
    if (existing) return { order: existing, created: false };

    let contactPhone = user.phone;
    if (input.contactPhone) {
      contactPhone = normalizeUzPhone(input.contactPhone);
      if (!contactPhone) throw new DomainError("invalid_phone");
    }
    if (!contactPhone) throw new DomainError("phone_required");

    const route = await this.db.route.findUnique({ where: { id: input.routeId } });
    if (!route || !route.isActive) throw new DomainError("route_not_found", 404);

    let departureAt: Date | null = null;
    if (!input.isNow) {
      departureAt = new Date(input.departureAt!);
      const delta = departureAt.getTime() - now.getTime();
      if (Number.isNaN(delta) || delta < -PAST_TOLERANCE_MS || delta > MAX_AHEAD_MS) {
        throw new DomainError("invalid_time");
      }
    }

    let orderId: string;
    try {
      const order = await this.db.order.create({
        data: {
          number: await nextSequence(this.db, "order"),
          clientId: user.id,
          routeId: route.id,
          pickup: input.pickup,
          dropoff: input.dropoff,
          passengers: input.passengers,
          isNow: input.isNow,
          departureAt,
          comment: input.comment || null,
          contactName: input.contactName,
          contactPhone,
          source,
          idempotencyKey: input.idempotencyKey,
        },
      });
      orderId = order.id;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      // A parallel request with the same idempotency key won.
      const winner = await this.db.order.findFirst({
        where: { clientId: user.id, idempotencyKey: input.idempotencyKey },
        include: orderInclude,
      });
      if (winner) return { order: winner, created: false };
      throw e;
    }

    await this.history(orderId, null, "PENDING", user.id);
    const order = await this.loadOrThrow(orderId);
    await this.notifier.orderCreated(order);
    return { order: (await this.load(orderId)) ?? order, created: true };
  }

  /**
   * Order detected in a public group. Defaults (we cannot ask the client): passengers "1 (aniqlanmagan)",
   * time "now". Contact = phone from the text if present, else the sender's Telegram account.
   */
  async createFromGroup(args: {
    client: User;
    routeId: string;
    groupMessageId: string;
    detection: Detection;
    contactName: string | null;
  }): Promise<FullOrder> {
    const d = args.detection;
    const order = await this.db.order.create({
      data: {
        number: await nextSequence(this.db, "order"),
        clientId: args.client.id,
        routeId: args.routeId,
        passengers: d.passengers ?? 1,
        passengersUnknown: !d.passengers,
        isNow: d.isNow,
        departureAt: d.departureAt ?? null,
        contactName: args.contactName,
        contactPhone: d.phone ?? null,
        source: "GROUP",
      },
    });
    await this.db.groupMessage.update({ where: { id: args.groupMessageId }, data: { orderId: order.id } });
    await this.history(order.id, null, "PENDING", null, "group message");
    const full = await this.loadOrThrow(order.id);
    await this.notifier.orderCreated(full);
    return (await this.load(order.id)) ?? full;
  }

  /** "Qabul qilish": only an ACTIVE driver; exactly one concurrent accept wins (single atomic update). */
  async accept(orderId: string, driverTelegramId: bigint): Promise<AcceptResult> {
    const user = await this.db.user.findUnique({ where: { telegramId: driverTelegramId } });
    const driver = user ? await this.db.driver.findFirst({ where: { userId: user.id, isActive: true } }) : null;
    if (!user || !driver) return { ok: false, error: "not_driver" };
    if (!user.botStarted) return { ok: false, error: "bot_not_started" };
    if (!/^[a-f0-9]{24}$/.test(orderId)) return { ok: false, error: "not_found" };

    const res = await this.db.order.updateMany({
      where: { id: orderId, status: "PENDING" },
      data: { status: "ACCEPTED", driverId: driver.id, acceptedAt: new Date() },
    });
    if (res.count !== 1) {
      const exists = await this.db.order.count({ where: { id: orderId } });
      return { ok: false, error: exists ? "already_taken" : "not_found" };
    }

    await this.history(orderId, "PENDING", "ACCEPTED", user.id);
    const order = await this.loadOrThrow(orderId);
    this.log.info({ orderNumber: order.number, driverId: driver.id }, "order accepted");
    const driverDmOk = await this.notifier.orderAccepted(order);
    return { ok: true, order, driverDmOk };
  }

  /** Driver marks "Yo'lda" (IN_PROGRESS) or "Yakunlandi" (COMPLETED) on their own order. */
  async driverSetStatus(
    orderId: string,
    driver: Driver,
    actorUserId: string,
    status: "IN_PROGRESS" | "COMPLETED",
  ): Promise<{ order: FullOrder; pointsEarned: number }> {
    const current = await this.loadOrThrow(orderId);
    if (current.driverId !== driver.id) throw new DomainError("not_your_order", 403);
    const allowedFrom: OrderStatus[] = status === "IN_PROGRESS" ? ["ACCEPTED"] : ["ACCEPTED", "IN_PROGRESS"];
    if (!allowedFrom.includes(current.status)) throw new DomainError("invalid_transition", 409);

    const now = new Date();
    const res = await this.db.order.updateMany({
      where: { id: orderId, driverId: driver.id, status: current.status },
      data: { status, ...(status === "IN_PROGRESS" ? { startedAt: now } : { completedAt: now }) },
    });
    if (res.count !== 1) throw new DomainError("conflict_try_again", 409);
    await this.history(orderId, current.status, status, actorUserId);
    const order = await this.loadOrThrow(orderId);
    const pointsEarned = status === "COMPLETED" ? await this.loyalty.onOrderCompleted(order) : 0;
    await this.notifier.statusChanged(order, pointsEarned);
    return { order, pointsEarned };
  }

  /** Client may cancel before the trip starts. If a driver had accepted, the driver is notified. */
  async cancelByClient(orderId: string, user: User, reason?: string): Promise<FullOrder> {
    const current = await this.loadOrThrow(orderId);
    if (current.clientId !== user.id) throw new DomainError("order_not_found", 404);
    if (current.status !== "PENDING" && current.status !== "ACCEPTED") throw new DomainError("cannot_cancel", 409);
    const res = await this.db.order.updateMany({
      where: { id: orderId, status: current.status },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason ?? null },
    });
    if (res.count !== 1) throw new DomainError("conflict_try_again", 409);
    await this.history(orderId, current.status, "CANCELLED", user.id, reason);
    const order = await this.loadOrThrow(orderId);
    await this.notifier.orderCancelled(order, "client");
    return order;
  }

  /** Admin can move an order to any status (with history + audit). */
  async adminSetStatus(orderId: string, admin: User, status: OrderStatus, reason?: string): Promise<FullOrder> {
    const current = await this.loadOrThrow(orderId);
    if (current.status === status) return current;
    if (["ACCEPTED", "IN_PROGRESS", "COMPLETED"].includes(status) && !current.driverId) {
      throw new DomainError("driver_required", 409);
    }
    const stamp = timestampFor[status];
    const data =
      status === "PENDING"
        ? { status, driverId: null, acceptedAt: null, startedAt: null, completedAt: null, cancelledAt: null }
        : { status, ...(stamp ? { [stamp]: new Date() } : {}), ...(status === "CANCELLED" ? { cancelReason: reason ?? null } : {}) };
    const res = await this.db.order.updateMany({ where: { id: orderId, status: current.status }, data });
    if (res.count !== 1) throw new DomainError("conflict_try_again", 409);
    await this.history(orderId, current.status, status, admin.id, reason);
    await this.db.auditLog.create({
      data: {
        actorId: admin.id,
        action: "order.status",
        entityType: "order",
        entityId: orderId,
        data: { from: current.status, to: status, reason: reason ?? null },
      },
    });
    const order = await this.loadOrThrow(orderId);
    if (status === "CANCELLED") await this.notifier.orderCancelled(order, "admin");
    if (status === "IN_PROGRESS") await this.notifier.statusChanged(order, 0);
    if (status === "COMPLETED") await this.notifier.statusChanged(order, await this.loyalty.onOrderCompleted(order));
    return order;
  }

  /** Scheduler: alert admins once per order that stayed PENDING for `minutes`. */
  async alertUnaccepted(minutes: number, now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - minutes * 60_000);
    const stale = await this.db.order.findMany({
      where: { status: "PENDING", createdAt: { lte: cutoff }, ...notAlerted },
      include: orderInclude,
      take: 50,
    });
    let sent = 0;
    for (const order of stale) {
      const claimed = await this.db.order.updateMany({
        where: { id: order.id, status: "PENDING", ...notAlerted },
        data: { adminAlertedAt: now },
      });
      if (claimed.count !== 1) continue;
      await this.notifier.unacceptedAlert(order, minutes);
      sent++;
    }
    return sent;
  }

  driverName(order: FullOrder): string | null {
    return order.driver ? displayName(order.driver.user) : null;
  }
}
