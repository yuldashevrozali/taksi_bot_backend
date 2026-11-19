import type { Driver, PrismaClient, User, Voucher } from "@prisma/client";
import { maskPhone, normalizeUzPhone, startOfTashkentDay, type VoucherDto, type VoucherLookupDto } from "@taxi/shared";
import type { Logger } from "@taxi/bot";
import type { Notifier } from "../notify/notifier.js";
import type { FullOrder } from "../orders/order.model.js";
import { getSettings } from "../settings/settings.service.js";
import { DomainError, isUniqueViolation, isWriteConflict } from "../errors.js";

export function toVoucherDto(v: Voucher): VoucherDto {
  return {
    id: v.id,
    percent: v.percent,
    status: v.status,
    createdAt: v.createdAt.toISOString(),
    usedAt: v.usedAt?.toISOString() ?? null,
  };
}

export class LoyaltyService {
  constructor(
    private readonly db: PrismaClient,
    private readonly notifier: Notifier,
    private readonly log: Logger,
  ) {}

  async balance(userId: string): Promise<number> {
    const agg = await this.db.loyaltyLedger.aggregate({ where: { userId }, _sum: { amount: true } });
    return agg._sum.amount ?? 0;
  }

  /**
   * Called once when an order becomes COMPLETED. Returns points earned by the client.
   * Anti-abuse: daily cap per client (Tashkent day), one TRIP_EARN per order (unique index).
   */
  async onOrderCompleted(order: FullOrder, now = new Date()): Promise<number> {
    const s = await getSettings(this.db);
    let earned = 0;

    if (s["loyalty.pointsPerTrip"] > 0) {
      const todayCount = await this.db.loyaltyLedger.count({
        where: { userId: order.clientId, type: "TRIP_EARN", createdAt: { gte: startOfTashkentDay(now) } },
      });
      if (todayCount < s["loyalty.maxEarningTripsPerDay"]) {
        try {
          await this.db.loyaltyLedger.create({
            data: { userId: order.clientId, orderId: order.id, type: "TRIP_EARN", amount: s["loyalty.pointsPerTrip"] },
          });
          earned = s["loyalty.pointsPerTrip"];
        } catch (e) {
          if (!isUniqueViolation(e)) throw e; // already awarded for this order
        }
      }
    }

    await this.grantReferralBonus(order, s["referral.bonusPoints"]);
    return earned;
  }

  /** Bonus goes to the referrer only on the referee's FIRST completed order, once, once per phone. */
  private async grantReferralBonus(order: FullOrder, bonus: number): Promise<void> {
    const referral = await this.db.referral.findUnique({ where: { referredId: order.clientId } });
    if (!referral || referral.bonusGranted) return;
    const completed = await this.db.order.count({ where: { clientId: order.clientId, status: "COMPLETED" } });
    if (completed !== 1) return;

    const phone = order.client.phone ?? (order.contactPhone ? normalizeUzPhone(order.contactPhone) : null);
    if (phone) {
      const samePhone = await this.db.referral.findFirst({ where: { referredPhone: phone, bonusGranted: true } });
      if (samePhone) {
        this.log.info({ referralId: referral.id, phone: maskPhone(phone) }, "referral bonus skipped: phone already used");
        return;
      }
    }
    const claimed = await this.db.referral.updateMany({
      where: { id: referral.id, bonusGranted: false },
      data: { bonusGranted: true, bonusOrderId: order.id, grantedAt: new Date(), referredPhone: phone },
    });
    if (claimed.count !== 1 || bonus <= 0) return;
    await this.db.loyaltyLedger.create({
      data: { userId: referral.referrerId, referralId: referral.id, type: "REFERRAL_BONUS", amount: bonus },
    });
    const referrer = await this.db.user.findUnique({ where: { id: referral.referrerId } });
    if (referrer?.botStarted) await this.notifier.referralBonus(referrer.telegramId, referrer.language, bonus);
  }

  /** Exchanges points for a one-time voucher. Concurrent redeems cannot overspend (transaction + user lock). */
  async redeem(user: User): Promise<Voucher> {
    const s = await getSettings(this.db);
    const cost = s["loyalty.pointsPerVoucher"];
    try {
      return await this.db.$transaction(async (tx) => {
        // Touch the user document: concurrent transactions for the same user now conflict.
        await tx.user.update({ where: { id: user.id }, data: { updatedAt: new Date() } });
        const agg = await tx.loyaltyLedger.aggregate({ where: { userId: user.id }, _sum: { amount: true } });
        if ((agg._sum.amount ?? 0) < cost) throw new DomainError("not_enough_points", 409);
        const voucher = await tx.voucher.create({
          data: { userId: user.id, percent: s["loyalty.voucherPercent"], pointsSpent: cost },
        });
        await tx.loyaltyLedger.create({
          data: { userId: user.id, voucherId: voucher.id, type: "VOUCHER_REDEEM", amount: -cost },
        });
        return voucher;
      });
    } catch (e) {
      if (isWriteConflict(e)) throw new DomainError("busy_try_again", 409);
      throw e;
    }
  }

  /** Driver looks up a client by @username or phone to see active vouchers. */
  async lookup(driver: Driver, query: string): Promise<VoucherLookupDto> {
    const q = query.trim();
    let client: User | null = null;
    const phone = normalizeUzPhone(q);
    if (phone) {
      client = await this.db.user.findFirst({ where: { phone } });
    } else {
      const username = q.replace(/^@/, "");
      if (/^[A-Za-z0-9_]{3,32}$/.test(username)) {
        client = await this.db.user.findFirst({ where: { username: { equals: username, mode: "insensitive" } } });
      }
    }
    if (!client) throw new DomainError("client_not_found", 404);

    const [vouchers, orders] = await Promise.all([
      this.db.voucher.findMany({ where: { userId: client.id, status: "ACTIVE" }, orderBy: { createdAt: "asc" } }),
      this.db.order.findMany({
        where: { clientId: client.id, driverId: driver.id, status: { in: ["ACCEPTED", "IN_PROGRESS", "COMPLETED"] } },
        include: { vouchers: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);
    return {
      client: {
        id: client.id,
        name: [client.firstName, client.lastName].filter(Boolean).join(" ") || null,
        username: client.username,
        phoneMasked: maskPhone(client.phone),
      },
      vouchers: vouchers.map(toVoucherDto),
      eligibleOrders: orders
        .filter((o) => o.vouchers.length === 0)
        .map((o) => ({ id: o.id, number: o.number, status: o.status, createdAt: o.createdAt.toISOString() })),
    };
  }

  /** Atomic: a voucher works once, only on an order this driver accepted for the voucher's owner. */
  async applyVoucher(driver: Driver, actorUserId: string, voucherId: string, orderId: string): Promise<Voucher> {
    const [voucher, order] = await Promise.all([
      this.db.voucher.findUnique({ where: { id: voucherId } }),
      this.db.order.findUnique({ where: { id: orderId } }),
    ]);
    if (!voucher) throw new DomainError("voucher_not_found", 404);
    if (!order) throw new DomainError("order_not_found", 404);
    if (order.driverId !== driver.id) throw new DomainError("not_your_order", 403);
    if (order.clientId !== voucher.userId) throw new DomainError("voucher_not_for_this_client", 409);
    if (order.status === "CANCELLED" || order.status === "PENDING") throw new DomainError("order_not_eligible", 409);

    try {
      const res = await this.db.voucher.updateMany({
        where: { id: voucherId, status: "ACTIVE" },
        data: { status: "USED", usedByDriverId: driver.id, orderId, usedAt: new Date() },
      });
      if (res.count !== 1) throw new DomainError("voucher_already_used", 409);
    } catch (e) {
      if (isUniqueViolation(e)) throw new DomainError("order_already_has_voucher", 409);
      throw e;
    }
    await this.db.auditLog.create({
      data: { actorId: actorUserId, action: "voucher.apply", entityType: "voucher", entityId: voucherId, data: { orderId } },
    });
    return this.db.voucher.findUniqueOrThrow({ where: { id: voucherId } });
  }
}
