import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { nextSequence } from "../src/db/counter.js";
import { makeOrder, makeRoute, makeUser, resetDb, testDb } from "./helpers.js";

const db = testDb();

beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

async function makeDriver(telegramId: bigint) {
  const user = await makeUser(db, telegramId);
  return db.driver.create({ data: { userId: user.id } });
}

async function makePendingOrder() {
  const client = await makeUser(db);
  const route = await makeRoute(db);
  const order = await makeOrder(db, { clientId: client.id, routeId: route.id });
  return { client, route, order };
}

describe("schema (MongoDB)", () => {
  it("stores Telegram IDs larger than 32 bits", async () => {
    const big = 7_123_456_789n;
    await makeUser(db, big);
    const found = await db.user.findUnique({ where: { telegramId: big } });
    expect(found?.telegramId).toBe(big);
  });

  it("telegram_id is unique", async () => {
    await makeUser(db, 555n);
    await expect(makeUser(db, 555n)).rejects.toSatisfy(isUniqueViolation);
  });

  it("new order defaults to PENDING", async () => {
    const { order } = await makePendingOrder();
    expect(order.status).toBe("PENDING");
    expect(order.driverId).toBeNull();
  });

  it("order numbers are sequential and unique under concurrency", async () => {
    const nums = await Promise.all(Array.from({ length: 20 }, () => nextSequence(db, "order")));
    expect(new Set(nums).size).toBe(20);
    expect([...nums].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("atomic accept: only one of many concurrent drivers gets the order", async () => {
    const { order } = await makePendingOrder();
    const drivers = await Promise.all(Array.from({ length: 10 }, (_, i) => makeDriver(BigInt(50_000 + i))));

    const results = await Promise.all(
      drivers.map((d) =>
        db.order.updateMany({
          where: { id: order.id, status: "PENDING" },
          data: { status: "ACCEPTED", driverId: d.id, acceptedAt: new Date() },
        }),
      ),
    );

    expect(results.filter((r) => r.count === 1)).toHaveLength(1);
    expect(results.filter((r) => r.count === 0)).toHaveLength(9);
    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("ACCEPTED");
    expect(drivers.map((d) => d.id)).toContain(after.driverId);
  });

  it("idempotency key is unique per client; orders without a key don't collide", async () => {
    const { client, route } = await makePendingOrder(); // has no key
    await makeOrder(db, { clientId: client.id, routeId: route.id }); // second order without key: OK
    await makeOrder(db, { clientId: client.id, routeId: route.id, idempotencyKey: "k1" });
    await expect(
      makeOrder(db, { clientId: client.id, routeId: route.id, idempotencyKey: "k1" }),
    ).rejects.toSatisfy(isUniqueViolation);

    const other = await makeUser(db);
    await expect(makeOrder(db, { clientId: other.id, routeId: route.id, idempotencyKey: "k1" })).resolves.toBeTruthy();
  });

  it("group message (chat_id, message_id) is unique", async () => {
    const data = {
      chatId: -100123n,
      messageId: 42,
      text: "Farg'onadan Qo'qonga 2 kishi",
      confidence: "HIGH" as const,
      result: "ORDER_CREATED" as const,
    };
    await db.groupMessage.create({ data });
    await expect(db.groupMessage.create({ data })).rejects.toSatisfy(isUniqueViolation);
  });

  it("a group message links to at most one order; many unlinked messages are fine", async () => {
    const { order } = await makePendingOrder();
    const base = { chatId: -1n, text: "x", confidence: "LOW" as const, result: "UNRECOGNIZED" as const };
    await db.groupMessage.create({ data: { ...base, messageId: 1 } });
    await db.groupMessage.create({ data: { ...base, messageId: 2 } });
    await db.groupMessage.create({ data: { ...base, messageId: 3, orderId: order.id } });
    await expect(db.groupMessage.create({ data: { ...base, messageId: 4, orderId: order.id } })).rejects.toSatisfy(
      isUniqueViolation,
    );
  });

  it("voucher: concurrent apply succeeds exactly once; one voucher per order", async () => {
    const { client, route, order } = await makePendingOrder();
    const driver = await makeDriver(90_001n);
    const voucher = await db.voucher.create({ data: { userId: client.id, percent: 10, pointsSpent: 100 } });
    const order2 = await makeOrder(db, { clientId: client.id, routeId: route.id });

    const results = await Promise.allSettled(
      [order.id, order2.id, order.id].map((orderId) =>
        db.voucher.updateMany({
          where: { id: voucher.id, status: "ACTIVE" },
          data: { status: "USED", usedByDriverId: driver.id, orderId, usedAt: new Date() },
        }),
      ),
    );
    const applied = results.filter((r) => r.status === "fulfilled" && r.value.count === 1);
    expect(applied).toHaveLength(1);

    const used = await db.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
    expect(used.status).toBe("USED");
    // A second active voucher of the same client (no order) is fine...
    const v2 = await db.voucher.create({ data: { userId: client.id, percent: 10, pointsSpent: 100 } });
    // ...but cannot be attached to the order that already used one.
    await expect(
      db.voucher.update({ where: { id: v2.id }, data: { status: "USED", orderId: used.orderId } }),
    ).rejects.toSatisfy(isUniqueViolation);
  });

  it("ledger: trip points at most once per order; balance = SUM(amount)", async () => {
    const { client, order } = await makePendingOrder();
    const entry = { userId: client.id, orderId: order.id, type: "TRIP_EARN" as const, amount: 10 };
    await db.loyaltyLedger.create({ data: entry });
    await expect(db.loyaltyLedger.create({ data: entry })).rejects.toSatisfy(isUniqueViolation);

    await db.loyaltyLedger.create({ data: { userId: client.id, type: "ADMIN_ADJUST", amount: 5 } });
    await db.loyaltyLedger.create({ data: { userId: client.id, type: "ADMIN_ADJUST", amount: -3 } });
    const agg = await db.loyaltyLedger.aggregate({ where: { userId: client.id }, _sum: { amount: true } });
    expect(agg._sum.amount).toBe(12);
  });

  it("referral: a user can be referred only once", async () => {
    const a = await makeUser(db);
    const b = await makeUser(db);
    const c = await makeUser(db);
    await db.referral.create({ data: { referrerId: a.id, referredId: c.id } });
    await expect(db.referral.create({ data: { referrerId: b.id, referredId: c.id } })).rejects.toSatisfy(
      isUniqueViolation,
    );
  });

  it("route code is unique; deleting a route that has orders is blocked", async () => {
    const { route } = await makePendingOrder();
    await expect(makeRoute(db)).rejects.toSatisfy(isUniqueViolation);
    await expect(db.route.delete({ where: { id: route.id } })).rejects.toBeTruthy();
  });

  it("status history is deleted together with its order", async () => {
    const { order, client } = await makePendingOrder();
    await db.orderStatusHistory.create({
      data: { orderId: order.id, toStatus: "PENDING", changedById: client.id },
    });
    await db.order.delete({ where: { id: order.id } });
    expect(await db.orderStatusHistory.count()).toBe(0);
  });
});
