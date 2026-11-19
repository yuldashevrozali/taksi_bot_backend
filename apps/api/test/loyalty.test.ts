import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auth, makeActiveDriver, makeApp, makeRegisteredUser, orderBody, type TestApp } from "./app-harness.js";
import { makeRoute, resetDb, testDb } from "./helpers.js";

const db = testDb();
let app: TestApp;
let routeId: string;

beforeAll(async () => {
  app = await makeApp(db);
});
afterAll(async () => {
  await app.server.close();
  await db.$disconnect();
});
beforeEach(async () => {
  await resetDb(db);
  app.notifier.calls = [];
  routeId = (await makeRoute(db)).id;
});

const inject = (method: "GET" | "POST", url: string, headers: Record<string, string>, payload?: object) =>
  app.server.inject({ method, url, headers, ...(payload ? { payload } : {}) });

type U = Awaited<ReturnType<typeof makeRegisteredUser>>;
type D = Awaited<ReturnType<typeof makeActiveDriver>>;

async function completeTrip(client: U, driver: D) {
  const order = (await inject("POST", "/api/orders", auth(client), orderBody(routeId))).json();
  await inject("POST", `/api/driver/orders/${order.id}/accept`, auth(driver.user));
  const done = await inject("POST", `/api/driver/orders/${order.id}/status`, auth(driver.user), { status: "COMPLETED" });
  return { order, pointsEarned: done.json().pointsEarned as number };
}

const balance = async (u: U) => (await inject("GET", "/api/loyalty", auth(u))).json().balance as number;

describe("points", () => {
  it("are granted only on COMPLETED, with a daily cap per client", async () => {
    const client = await makeRegisteredUser(db);
    const d = await makeActiveDriver(db);
    // accepted but not completed: no points
    const pending = (await inject("POST", "/api/orders", auth(client), orderBody(routeId))).json();
    await inject("POST", `/api/driver/orders/${pending.id}/accept`, auth(d.user));
    expect(await balance(client)).toBe(0);

    expect((await completeTrip(client, d)).pointsEarned).toBe(10);
    expect((await completeTrip(client, d)).pointsEarned).toBe(10);
    expect((await completeTrip(client, d)).pointsEarned).toBe(0); // cap = 2/day
    expect(await balance(client)).toBe(20);
  });

  it("settings change the amounts", async () => {
    await db.setting.create({ data: { key: "loyalty.pointsPerTrip", value: 25 } });
    const client = await makeRegisteredUser(db);
    const d = await makeActiveDriver(db);
    expect((await completeTrip(client, d)).pointsEarned).toBe(25);
  });
});

describe("referral bonus", () => {
  it("is granted once, on the referee's first completed trip", async () => {
    const referrer = await makeRegisteredUser(db);
    const referee = await makeRegisteredUser(db);
    await db.referral.create({ data: { referrerId: referrer.id, referredId: referee.id } });
    await db.user.update({ where: { id: referee.id }, data: { referredById: referrer.id } });
    const d = await makeActiveDriver(db);

    await completeTrip(referee, d);
    expect(await balance(referrer)).toBe(20);
    await completeTrip(referee, d);
    expect(await balance(referrer)).toBe(20);
    expect(app.notifier.calls.filter((c) => c.method === "referralBonus")).toHaveLength(1);
    const ref = await db.referral.findUniqueOrThrow({ where: { referredId: referee.id } });
    expect(ref.bonusGranted).toBe(true);
  });

  it("is not granted twice for the same phone number", async () => {
    const referrer = await makeRegisteredUser(db);
    const d = await makeActiveDriver(db);
    const first = await makeRegisteredUser(db, { phone: "+998909999999" });
    await db.referral.create({ data: { referrerId: referrer.id, referredId: first.id } });
    await completeTrip(first, d);
    expect(await balance(referrer)).toBe(20);

    // A second Telegram account with the same phone
    const second = await makeRegisteredUser(db, { phone: "+998909999999" });
    await db.referral.create({ data: { referrerId: referrer.id, referredId: second.id } });
    await completeTrip(second, d);
    expect(await balance(referrer)).toBe(20);
  });
});

describe("vouchers", () => {
  async function clientWithPoints(points: number) {
    const client = await makeRegisteredUser(db);
    await db.loyaltyLedger.create({ data: { userId: client.id, type: "ADMIN_ADJUST", amount: points } });
    return client;
  }

  it("redeem spends points immediately and creates a voucher", async () => {
    const client = await clientWithPoints(150);
    const res = await inject("POST", "/api/loyalty/redeem", auth(client));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ percent: 10, status: "ACTIVE" });
    expect(await balance(client)).toBe(50);
    const again = await inject("POST", "/api/loyalty/redeem", auth(client));
    expect(again.json().error).toBe("not_enough_points");
  });

  it("concurrent redeems cannot overspend", async () => {
    const client = await clientWithPoints(100);
    const results = await Promise.all(Array.from({ length: 5 }, () => inject("POST", "/api/loyalty/redeem", auth(client))));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(await db.voucher.count({ where: { userId: client.id } })).toBe(1);
    expect(await balance(client)).toBe(0);
  });

  it("driver looks up by username/phone and applies once, only to own order of that client", async () => {
    const client = await clientWithPoints(200);
    await db.user.update({ where: { id: client.id }, data: { username: "Vali_K", phone: "+998931234567" } });
    const v1 = (await inject("POST", "/api/loyalty/redeem", auth(client))).json();
    const d = await makeActiveDriver(db);
    const other = await makeActiveDriver(db);
    const { order } = await completeTrip(client, d);

    // lookup by @username (case-insensitive) and by phone
    const byName = (await inject("GET", "/api/driver/vouchers/lookup?q=@vali_k", auth(d.user))).json();
    expect(byName.vouchers.map((v: { id: string }) => v.id)).toEqual([v1.id]);
    expect(byName.eligibleOrders.map((o: { id: string }) => o.id)).toEqual([order.id]);
    expect(byName.client.phoneMasked).toBe("+99893*****67");
    const byPhone = (await inject("GET", "/api/driver/vouchers/lookup?q=93%20123%2045%2067", auth(d.user))).json();
    expect(byPhone.client.id).toBe(client.id);

    // another driver cannot apply it to this order
    const foreign = await inject("POST", `/api/driver/vouchers/${v1.id}/apply`, auth(other.user), { orderId: order.id });
    expect(foreign.json().error).toBe("not_your_order");

    // concurrent apply: exactly one wins
    const tries = await Promise.all(
      [1, 2, 3].map(() => inject("POST", `/api/driver/vouchers/${v1.id}/apply`, auth(d.user), { orderId: order.id })),
    );
    expect(tries.filter((r) => r.statusCode === 200)).toHaveLength(1);
    const used = await db.voucher.findUniqueOrThrow({ where: { id: v1.id } });
    expect(used).toMatchObject({ status: "USED", orderId: order.id, usedByDriverId: d.driver.id });
    expect(await db.auditLog.count({ where: { action: "voucher.apply" } })).toBe(1);

    // a second voucher cannot go on the same order
    const v2 = (await inject("POST", "/api/loyalty/redeem", auth(client))).json();
    const second = await inject("POST", `/api/driver/vouchers/${v2.id}/apply`, auth(d.user), { orderId: order.id });
    expect(second.json().error).toBe("order_already_has_voucher");
    expect((await db.voucher.findUniqueOrThrow({ where: { id: v2.id } })).status).toBe("ACTIVE");
  });

  it("voucher of client A cannot be applied to client B's order", async () => {
    const a = await clientWithPoints(100);
    const b = await makeRegisteredUser(db);
    const va = (await inject("POST", "/api/loyalty/redeem", auth(a))).json();
    const d = await makeActiveDriver(db);
    const { order } = await completeTrip(b, d);
    const res = await inject("POST", `/api/driver/vouchers/${va.id}/apply`, auth(d.user), { orderId: order.id });
    expect(res.json().error).toBe("voucher_not_for_this_client");
  });

  it("referral link is returned in the loyalty view", async () => {
    const client = await makeRegisteredUser(db);
    const view = (await inject("GET", "/api/loyalty", auth(client))).json();
    expect(view.referralLink).toBe(`https://t.me/test_bot?start=ref_${client.referralCode}`);
  });
});
