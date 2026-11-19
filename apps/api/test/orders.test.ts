import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auth, makeActiveDriver, makeApp, makeRegisteredUser, orderBody, type TestApp } from "./app-harness.js";
import { callbackUpdate, textUpdate } from "./bot-harness.js";
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
  app.notifier.driverDmOk = true;
  routeId = (await makeRoute(db)).id;
});

const inject = (method: "GET" | "POST", url: string, headers: Record<string, string>, payload?: object) =>
  app.server.inject({ method, url, headers, ...(payload ? { payload } : {}) });

async function createOrder(client: Awaited<ReturnType<typeof makeRegisteredUser>>, extra: Record<string, unknown> = {}) {
  const res = await inject("POST", "/api/orders", auth(client), orderBody(routeId, extra));
  expect(res.statusCode).toBe(201);
  return res.json();
}

describe("order creation", () => {
  it("creates a PENDING order, posts it to the drivers group, records history", async () => {
    const client = await makeRegisteredUser(db, { phone: "+998901112233" });
    const order = await createOrder(client);
    expect(order).toMatchObject({ status: "PENDING", passengers: 2, isNow: true, source: "MINIAPP", contact: null });
    expect(order.number).toBe(1);
    expect(app.notifier.calls.map((c) => c.method)).toEqual(["orderCreated"]);
    const stored = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.contactPhone).toBe("+998901112233");
    expect(await db.orderStatusHistory.count({ where: { orderId: order.id, toStatus: "PENDING" } })).toBe(1);
  });

  it("is idempotent: the same key returns the same order (200), no second post", async () => {
    const client = await makeRegisteredUser(db);
    const body = orderBody(routeId);
    const [a, b] = await Promise.all([inject("POST", "/api/orders", auth(client), body), inject("POST", "/api/orders", auth(client), body)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
    expect(a.json().id).toBe(b.json().id);
    expect(await db.order.count()).toBe(1);
    expect(app.notifier.calls.filter((c) => c.method === "orderCreated")).toHaveLength(1);
  });

  it("validates passengers (required, 1..8), time, route and phone", async () => {
    const client = await makeRegisteredUser(db);
    const bad = async (extra: Record<string, unknown>) =>
      (await inject("POST", "/api/orders", auth(client), orderBody(routeId, extra))).json().error;
    expect(await bad({ passengers: 0 })).toBe("invalid_input");
    expect(await bad({ passengers: 9 })).toBe("invalid_input");
    expect(await bad({ passengers: undefined })).toBe("invalid_input");
    expect(await bad({ isNow: false })).toBe("invalid_input"); // departureAt missing
    expect(await bad({ isNow: false, departureAt: new Date(Date.now() - 3600_000).toISOString() })).toBe("invalid_time");
    expect(await bad({ isNow: false, departureAt: new Date(Date.now() + 8 * 86400_000).toISOString() })).toBe("invalid_time");
    expect(await bad({ routeId: "0".repeat(24) })).toBe("route_not_found");
    expect(await bad({ contactPhone: "+7 916 123 45 67" })).toBe("invalid_phone");

    const noPhone = await makeRegisteredUser(db, { phone: null });
    expect((await inject("POST", "/api/orders", auth(noPhone), orderBody(routeId))).json().error).toBe("phone_required");
  });

  it("accepts a scheduled departure time", async () => {
    const client = await makeRegisteredUser(db);
    const at = new Date(Date.now() + 3 * 3600_000).toISOString();
    const order = await createOrder(client, { isNow: false, departureAt: at });
    expect(order.isNow).toBe(false);
    expect(order.departureAt).toBe(at);
  });

  it("inactive route cannot be ordered", async () => {
    const client = await makeRegisteredUser(db);
    await db.route.update({ where: { id: routeId }, data: { isActive: false } });
    const res = await inject("POST", "/api/orders", auth(client), orderBody(routeId));
    expect(res.json().error).toBe("route_not_found");
  });
});

describe("accepting orders", () => {
  it("only one of many drivers wins; losers get already_taken", async () => {
    const client = await makeRegisteredUser(db);
    const order = await createOrder(client);
    const drivers = await Promise.all(Array.from({ length: 6 }, () => makeActiveDriver(db)));
    const results = await Promise.all(
      drivers.map((d) => inject("POST", `/api/driver/orders/${order.id}/accept`, auth(d.user))),
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409 && r.json().error === "already_taken")).toHaveLength(5);
    expect(app.notifier.calls.filter((c) => c.method === "orderAccepted")).toHaveLength(1);
  });

  it("winner sees the client contact; the others never do", async () => {
    const client = await makeRegisteredUser(db, { phone: "+998905556677", username: "client_x" });
    const order = await createOrder(client);
    const winner = await makeActiveDriver(db);
    const other = await makeActiveDriver(db);

    // Before accept: available list has no contact
    const available = (await inject("GET", "/api/driver/orders/available", auth(other.user))).json();
    expect(available).toHaveLength(1);
    expect(available[0].contact).toBeNull();
    expect(JSON.stringify(available)).not.toContain("905556677");

    const accepted = (await inject("POST", `/api/driver/orders/${order.id}/accept`, auth(winner.user))).json();
    expect(accepted.contact).toMatchObject({ phone: "+998905556677", username: "client_x" });

    const mine = (await inject("GET", "/api/driver/orders/mine", auth(winner.user))).json();
    expect(mine[0].contact.phone).toBe("+998905556677");

    // The other driver: not in "mine", history without contact, direct fetch is 404
    expect((await inject("GET", "/api/driver/orders/mine", auth(other.user))).json()).toEqual([]);
    const history = (await inject("GET", "/api/driver/orders/history", auth(other.user))).json();
    expect(history[0].driver.name).toBeTruthy();
    expect(history[0].contact).toBeNull();
    expect(JSON.stringify(history)).not.toContain("905556677");
    expect((await inject("GET", `/api/orders/${order.id}`, auth(other.user))).statusCode).toBe(404);

    // The client sees which driver took it, but the client view has no contact block
    const clientView = (await inject("GET", `/api/orders/${order.id}`, auth(client))).json();
    expect(clientView.driver).toMatchObject({ carModel: "Cobalt", carNumber: "40A123BC" });
    expect(clientView.contact).toBeNull();
  });

  it("non-drivers and deactivated drivers cannot use driver endpoints or accept", async () => {
    const client = await makeRegisteredUser(db);
    const order = await createOrder(client);
    expect((await inject("GET", "/api/driver/orders/available", auth(client))).statusCode).toBe(403);
    const d = await makeActiveDriver(db);
    await db.driver.update({ where: { id: d.driver.id }, data: { isActive: false } });
    expect((await inject("POST", `/api/driver/orders/${order.id}/accept`, auth(d.user))).statusCode).toBe(403);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");
  });

  it("group button: active driver accepts; non-driver is refused; second press says taken", async () => {
    const client = await makeRegisteredUser(db);
    const order = await createOrder(client);
    const d = await makeActiveDriver(db);
    const stranger = await makeRegisteredUser(db);

    await app.bot.handleUpdate(callbackUpdate(Number(stranger.telegramId), `accept:${order.id}`));
    let answer = app.apiCalls.filter((c) => c.method === "answerCallbackQuery").at(-1)!.payload;
    expect(answer.text).toContain("haydovchi");
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");

    await app.bot.handleUpdate(callbackUpdate(Number(d.user.telegramId), `accept:${order.id}`));
    answer = app.apiCalls.filter((c) => c.method === "answerCallbackQuery").at(-1)!.payload;
    expect(answer.text).toContain("sizniki");
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("ACCEPTED");

    await app.bot.handleUpdate(callbackUpdate(Number(d.user.telegramId), `accept:${order.id}`));
    answer = app.apiCalls.filter((c) => c.method === "answerCallbackQuery").at(-1)!.payload;
    expect(answer.text).toContain("allaqachon");
  });

  it("driver who never pressed /start cannot accept (contact could not be delivered)", async () => {
    const client = await makeRegisteredUser(db);
    const order = await createOrder(client);
    const d = await makeActiveDriver(db, { botStarted: false });
    const res = await app.deps.orders.accept(order.id, d.user.telegramId);
    expect(res).toEqual({ ok: false, error: "bot_not_started" });
  });
});

describe("drivers-group link -> Mini App", () => {
  it("/start order_<id>: active driver gets a Web App button for that order", async () => {
    const client = await makeRegisteredUser(db);
    const order = await createOrder(client);
    const d = await makeActiveDriver(db);
    await app.bot.handleUpdate(textUpdate(Number(d.user.telegramId), `/start order_${order.id}`));
    const msg = app.apiCalls.filter((c) => c.method === "sendMessage").at(-1)!.payload;
    expect(msg.text).toContain(`#${order.number}`);
    expect(msg.reply_markup.inline_keyboard[0][0].web_app.url).toBe(`https://taxi.example.com/app/?order=${order.id}`);
  });

  it("/start order_<id>: non-driver is refused; taken order says so", async () => {
    const client = await makeRegisteredUser(db);
    const order = await createOrder(client);
    await app.bot.handleUpdate(textUpdate(Number(client.telegramId), `/start order_${order.id}`));
    expect(app.apiCalls.filter((c) => c.method === "sendMessage").at(-1)!.payload.text).toContain("haydovchi");

    const d1 = await makeActiveDriver(db);
    const d2 = await makeActiveDriver(db);
    await inject("POST", `/api/driver/orders/${order.id}/accept`, auth(d1.user));
    await app.bot.handleUpdate(textUpdate(Number(d2.user.telegramId), `/start order_${order.id}`));
    expect(app.apiCalls.filter((c) => c.method === "sendMessage").at(-1)!.payload.text).toContain("allaqachon");
  });

  it("GET /api/driver/orders/:id: no contact until I accept; other drivers never see it", async () => {
    const client = await makeRegisteredUser(db, { phone: "+998907776655" });
    const order = await createOrder(client);
    const d1 = await makeActiveDriver(db);
    const d2 = await makeActiveDriver(db);
    const before = (await inject("GET", `/api/driver/orders/${order.id}`, auth(d1.user))).json();
    expect(before.status).toBe("PENDING");
    expect(before.contact).toBeNull();
    await inject("POST", `/api/driver/orders/${order.id}/accept`, auth(d1.user));
    expect((await inject("GET", `/api/driver/orders/${order.id}`, auth(d1.user))).json().contact.phone).toBe("+998907776655");
    const other = (await inject("GET", `/api/driver/orders/${order.id}`, auth(d2.user))).json();
    expect(other.contact).toBeNull();
    expect(JSON.stringify(other)).not.toContain("907776655");
    expect((await inject("GET", `/api/driver/orders/${order.id}`, auth(client))).statusCode).toBe(403);
  });
});

describe("status flow and cancellation", () => {
  async function acceptedOrder() {
    const client = await makeRegisteredUser(db);
    const order = await createOrder(client);
    const d = await makeActiveDriver(db);
    await inject("POST", `/api/driver/orders/${order.id}/accept`, auth(d.user));
    return { client, order, d };
  }

  it("ACCEPTED -> IN_PROGRESS -> COMPLETED, client notified each time, history recorded", async () => {
    const { order, d } = await acceptedOrder();
    const r1 = await inject("POST", `/api/driver/orders/${order.id}/status`, auth(d.user), { status: "IN_PROGRESS" });
    expect(r1.json().order.status).toBe("IN_PROGRESS");
    const r2 = await inject("POST", `/api/driver/orders/${order.id}/status`, auth(d.user), { status: "COMPLETED" });
    expect(r2.json().order.status).toBe("COMPLETED");
    expect(r2.json().pointsEarned).toBe(10);
    const notes = app.notifier.calls.filter((c) => c.method === "statusChanged").map((c) => c.args?.[0]);
    expect(notes).toEqual(["IN_PROGRESS", "COMPLETED"]);
    const hist = await db.orderStatusHistory.findMany({ where: { orderId: order.id }, orderBy: { createdAt: "asc" } });
    expect(hist.map((h) => h.toStatus)).toEqual(["PENDING", "ACCEPTED", "IN_PROGRESS", "COMPLETED"]);
  });

  it("rejects invalid transitions and other drivers' orders", async () => {
    const { order, d } = await acceptedOrder();
    const other = await makeActiveDriver(db);
    expect((await inject("POST", `/api/driver/orders/${order.id}/status`, auth(other.user), { status: "IN_PROGRESS" })).statusCode).toBe(403);
    await inject("POST", `/api/driver/orders/${order.id}/status`, auth(d.user), { status: "COMPLETED" });
    const again = await inject("POST", `/api/driver/orders/${order.id}/status`, auth(d.user), { status: "IN_PROGRESS" });
    expect(again.json().error).toBe("invalid_transition");
  });

  it("client cancels a PENDING order", async () => {
    const client = await makeRegisteredUser(db);
    const order = await createOrder(client);
    const res = await inject("POST", `/api/orders/${order.id}/cancel`, auth(client), {});
    expect(res.json().status).toBe("CANCELLED");
    expect(app.notifier.calls.at(-1)).toMatchObject({ method: "orderCancelled", args: ["client"] });
  });

  it("client cancels after acceptance -> driver is notified; cannot cancel in progress", async () => {
    const { client, order, d } = await acceptedOrder();
    const res = await inject("POST", `/api/orders/${order.id}/cancel`, auth(client), {});
    expect(res.json().status).toBe("CANCELLED");
    expect(app.notifier.calls.some((c) => c.method === "orderCancelled")).toBe(true);

    const second = await acceptedOrder();
    await inject("POST", `/api/driver/orders/${second.order.id}/status`, auth(second.d.user), { status: "IN_PROGRESS" });
    const blocked = await inject("POST", `/api/orders/${second.order.id}/cancel`, auth(second.client), {});
    expect(blocked.json().error).toBe("cannot_cancel");
    void d;
  });

  it("a client cannot cancel or view someone else's order", async () => {
    const owner = await makeRegisteredUser(db);
    const order = await createOrder(owner);
    const intruder = await makeRegisteredUser(db);
    expect((await inject("POST", `/api/orders/${order.id}/cancel`, auth(intruder), {})).statusCode).toBe(404);
    expect((await inject("GET", `/api/orders/${order.id}`, auth(intruder))).statusCode).toBe(404);
  });

  it("bot cancel button cancels the client's order", async () => {
    const client = await makeRegisteredUser(db);
    const order = await createOrder(client);
    await app.bot.handleUpdate(callbackUpdate(Number(client.telegramId), `cancel:${order.id}`));
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CANCELLED");
  });
});

describe("unaccepted order alert", () => {
  it("alerts admins once per order after N minutes", async () => {
    const client = await makeRegisteredUser(db);
    const order = await createOrder(client);
    const later = new Date(Date.now() + 16 * 60_000);
    expect(await app.deps.orders.alertUnaccepted(15, new Date())).toBe(0);
    expect(await app.deps.orders.alertUnaccepted(15, later)).toBe(1);
    expect(await app.deps.orders.alertUnaccepted(15, later)).toBe(0);
    expect(app.notifier.calls.filter((c) => c.method === "unacceptedAlert")).toHaveLength(1);
    void order;
  });

  it("does not alert for accepted orders", async () => {
    const client = await makeRegisteredUser(db);
    const order = await createOrder(client);
    const d = await makeActiveDriver(db);
    await inject("POST", `/api/driver/orders/${order.id}/accept`, auth(d.user));
    expect(await app.deps.orders.alertUnaccepted(15, new Date(Date.now() + 60 * 60_000))).toBe(0);
  });
});
