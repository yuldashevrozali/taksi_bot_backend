import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLoginToken } from "../src/modules/auth/session.js";
import { ENV_ADMIN_ID, auth, makeActiveDriver, makeApp, makeRegisteredUser, orderBody, type TestApp } from "./app-harness.js";
import { textUpdate } from "./bot-harness.js";
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

const inject = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, headers: Record<string, string>, payload?: object) =>
  app.server.inject({ method, url, headers, ...(payload ? { payload } : {}) });

describe("admin RBAC", () => {
  it("clients and drivers get 403 on every admin endpoint", async () => {
    const client = await makeRegisteredUser(db);
    const { user: driver } = await makeActiveDriver(db);
    for (const u of [client, driver]) {
      for (const url of ["/api/admin/stats", "/api/admin/orders", "/api/admin/drivers", "/api/admin/users", "/api/admin/settings"]) {
        expect((await inject("GET", url, auth(u))).statusCode).toBe(403);
      }
      expect((await inject("POST", "/api/admin/drivers", auth(u), { telegramId: "123456" })).statusCode).toBe(403);
    }
  });

  it("admin can read stats and orders with contacts", async () => {
    const admin = await makeRegisteredUser(db, { role: "ADMIN" });
    const client = await makeRegisteredUser(db, { phone: "+998901010101" });
    await inject("POST", "/api/orders", auth(client), orderBody(routeId));
    const stats = (await inject("GET", "/api/admin/stats", auth(admin))).json();
    expect(stats.today.orders).toBe(1);
    expect(stats.pendingNow).toBe(1);
    expect(stats.bySource.MINIAPP).toBe(1);
    expect(stats.last7Days).toHaveLength(7);
    const orders = (await inject("GET", "/api/admin/orders?status=PENDING", auth(admin))).json();
    expect(orders.total).toBe(1);
    expect(orders.items[0].contact.phone).toBe("+998901010101");
  });
});

describe("admin: drivers", () => {
  it("adding requires the person to have pressed /start", async () => {
    const admin = await makeRegisteredUser(db, { role: "ADMIN" });
    const res = await inject("POST", "/api/admin/drivers", auth(admin), { telegramId: "77777777" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("user_must_start_bot");
  });

  it("add -> can accept; deactivate -> cannot accept; reactivate works", async () => {
    const admin = await makeRegisteredUser(db, { role: "ADMIN" });
    const person = await makeRegisteredUser(db);
    const add = await inject("POST", "/api/admin/drivers", auth(admin), {
      telegramId: person.telegramId.toString(),
      carModel: "Nexia",
      carNumber: "01B777AA",
    });
    expect(add.statusCode).toBe(201);
    expect((await db.user.findUniqueOrThrow({ where: { id: person.id } })).role).toBe("DRIVER");
    expect(app.notifier.calls.some((c) => c.method === "driverAdded")).toBe(true);
    expect(await db.auditLog.count({ where: { action: "driver.add" } })).toBe(1);

    const list = (await inject("GET", "/api/admin/drivers", auth(admin))).json();
    expect(list[0]).toMatchObject({ carModel: "Nexia", isActive: true });

    const client = await makeRegisteredUser(db);
    const order = (await inject("POST", "/api/orders", auth(client), orderBody(routeId))).json();
    await inject("PATCH", `/api/admin/drivers/${add.json().id}`, auth(admin), { isActive: false });
    expect((await inject("POST", `/api/driver/orders/${order.id}/accept`, auth(person))).statusCode).toBe(403);

    // re-adding reactivates the same driver record
    await inject("POST", "/api/admin/drivers", auth(admin), { telegramId: person.telegramId.toString() });
    expect(await db.driver.count()).toBe(1);
    expect((await inject("POST", `/api/driver/orders/${order.id}/accept`, auth(person))).statusCode).toBe(200);
  });
});

describe("admin: orders, settings, loyalty, admins", () => {
  it("admin changes status with audit; cancel notifies", async () => {
    const admin = await makeRegisteredUser(db, { role: "ADMIN" });
    const client = await makeRegisteredUser(db);
    const order = (await inject("POST", "/api/orders", auth(client), orderBody(routeId))).json();
    const noDriver = await inject("POST", `/api/admin/orders/${order.id}/status`, auth(admin), { status: "COMPLETED" });
    expect(noDriver.json().error).toBe("driver_required");
    const res = await inject("POST", `/api/admin/orders/${order.id}/status`, auth(admin), { status: "CANCELLED", reason: "test" });
    expect(res.json().status).toBe("CANCELLED");
    expect(app.notifier.calls.at(-1)).toMatchObject({ method: "orderCancelled", args: ["admin"] });
    const hist = (await inject("GET", `/api/admin/orders/${order.id}/history`, auth(admin))).json();
    expect(hist.map((h: { toStatus: string }) => h.toStatus)).toEqual(["PENDING", "CANCELLED"]);
  });

  it("settings are validated and persisted", async () => {
    const admin = await makeRegisteredUser(db, { role: "ADMIN" });
    const bad = await inject("PUT", "/api/admin/settings", auth(admin), { "loyalty.voucherPercent": 150 });
    expect(bad.statusCode).toBe(400);
    const ok = await inject("PUT", "/api/admin/settings", auth(admin), { "loyalty.voucherPercent": 15, "support.contact": "+998 90 000 00 00" });
    expect(ok.json()["loyalty.voucherPercent"]).toBe(15);
    expect((await inject("GET", "/api/admin/settings", auth(admin))).json()["support.contact"]).toBe("+998 90 000 00 00");
  });

  it("points adjustment is audited and reflected in the users list", async () => {
    const admin = await makeRegisteredUser(db, { role: "ADMIN" });
    const client = await makeRegisteredUser(db);
    await inject("POST", "/api/admin/loyalty/adjust", auth(admin), { userId: client.id, amount: 30, note: "bonus" });
    await inject("POST", "/api/admin/loyalty/adjust", auth(admin), { userId: client.id, amount: -10, note: "soxta safar" });
    const users = (await inject("GET", `/api/admin/users?q=${client.username}`, auth(admin))).json();
    expect(users.items[0].points).toBe(20);
    expect(await db.auditLog.count({ where: { action: "loyalty.adjust" } })).toBe(2);
  });

  it("admins: add/remove; cannot remove self or env admins", async () => {
    const admin = await makeRegisteredUser(db, { role: "ADMIN" });
    const envAdmin = await makeRegisteredUser(db, { role: "ADMIN", telegramId: ENV_ADMIN_ID });
    const person = await makeRegisteredUser(db);
    await inject("POST", "/api/admin/admins", auth(admin), { telegramId: person.telegramId.toString() });
    expect((await db.user.findUniqueOrThrow({ where: { id: person.id } })).role).toBe("ADMIN");
    expect((await inject("DELETE", `/api/admin/admins/${admin.id}`, auth(admin))).json().error).toBe("cannot_remove_self");
    expect((await inject("DELETE", `/api/admin/admins/${envAdmin.id}`, auth(admin))).json().error).toBe("admin_from_env");
    expect((await inject("DELETE", `/api/admin/admins/${person.id}`, auth(admin))).statusCode).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: person.id } })).role).toBe("CLIENT");
  });
});

describe("admin browser login", () => {
  it("one-time token -> session; token cannot be reused; session works with Bearer", async () => {
    const admin = await makeRegisteredUser(db, { role: "ADMIN" });
    const token = await createLoginToken(db, admin.id);
    const ok = await inject("POST", "/api/auth/exchange", {}, { token });
    expect(ok.statusCode).toBe(200);
    const session = ok.json().session as string;
    expect((await inject("POST", "/api/auth/exchange", {}, { token })).statusCode).toBe(401);
    const me = await inject("GET", "/api/admin/stats", { authorization: `Bearer ${session}` });
    expect(me.statusCode).toBe(200);
    expect((await inject("GET", "/api/admin/stats", { authorization: `Bearer ${session}x` })).statusCode).toBe(401);
  });

  it("non-admin tokens and expired tokens are rejected", async () => {
    const client = await makeRegisteredUser(db);
    const t1 = await createLoginToken(db, client.id);
    expect((await inject("POST", "/api/auth/exchange", {}, { token: t1 })).statusCode).toBe(401);
    const admin = await makeRegisteredUser(db, { role: "ADMIN" });
    const t2 = await createLoginToken(db, admin.id);
    await db.loginToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await inject("POST", "/api/auth/exchange", {}, { token: t2 })).statusCode).toBe(401);
  });

  it("bot /admin sends the Mini App button and a one-time browser link to admins only", async () => {
    const admin = await makeRegisteredUser(db, { role: "ADMIN" });
    await app.bot.handleUpdate(textUpdate(Number(admin.telegramId), "/admin"));
    const msg = app.apiCalls.filter((c) => c.method === "sendMessage").at(-1)!.payload;
    const buttons = msg.reply_markup.inline_keyboard.flat();
    expect(buttons[0].web_app.url).toBe("https://taxi.example.com/admin/");
    expect(buttons[1].url).toMatch(/^https:\/\/taxi\.example\.com\/admin\/\?login=[A-Za-z0-9_-]{40,}$/);
    expect(await db.loginToken.count()).toBe(1);

    const client = await makeRegisteredUser(db);
    await app.bot.handleUpdate(textUpdate(Number(client.telegramId), "/admin"));
    expect(app.apiCalls.filter((c) => c.method === "sendMessage").at(-1)!.payload.text).toContain("ruxsat");
    expect(await db.loginToken.count()).toBe(1);
  });
});
