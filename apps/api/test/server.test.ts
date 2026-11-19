import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { signInitData } from "../src/auth/telegram-init-data.js";
import { WEBHOOK_PATH } from "../src/server.js";
import { TEST_TOKEN, textUpdate } from "./bot-harness.js";
import { SECRET, auth, makeApp, makeRegisteredUser, type TestApp } from "./app-harness.js";
import { resetDb, testDb } from "./helpers.js";

const db = testDb();
let app: TestApp;

beforeAll(async () => {
  app = await makeApp(db);
});
afterAll(async () => {
  await app.server.close();
  await db.$disconnect();
});
beforeEach(() => resetDb(db));

describe("server basics", () => {
  it("GET /health pings the database", async () => {
    const res = await app.server.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("webhook rejects requests without the secret header", async () => {
    const res = await app.server.inject({ method: "POST", url: WEBHOOK_PATH, payload: textUpdate(1, "/start") });
    expect(res.statusCode).toBe(401);
    expect(await db.user.count()).toBe(0);
  });

  it("webhook with the right secret is handled by the bot", async () => {
    const res = await app.server.inject({
      method: "POST",
      url: WEBHOOK_PATH,
      headers: { "x-telegram-bot-api-secret-token": SECRET },
      payload: textUpdate(4242, "/start"),
    });
    expect(res.statusCode).toBe(200);
    expect(await db.user.count({ where: { telegramId: 4242n } })).toBe(1);
  });

  it("webhook returns 200 even when Telegram calls fail (no redelivery loop)", async () => {
    app.bot.api.config.use(async () => ({ ok: false, error_code: 400, description: "Bad Request: query is too old" }) as any);
    const res = await app.server.inject({
      method: "POST",
      url: WEBHOOK_PATH,
      headers: { "x-telegram-bot-api-secret-token": SECRET },
      payload: textUpdate(4343, "/start"),
    });
    expect(res.statusCode).toBe(200);
    // restore a working API for the remaining tests
    app = await makeApp(db);
  });

  it("/api/me: 401 without auth or with forged initData; 403 when not registered", async () => {
    expect((await app.server.inject({ method: "GET", url: "/api/me" })).statusCode).toBe(401);
    const forged = signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: '{"id":1,"first_name":"A"}' }, "999:forged_forged_forged_forged_forged");
    expect((await app.server.inject({ method: "GET", url: "/api/me", headers: { authorization: `tma ${forged}` } })).statusCode).toBe(401);
    const res = await app.server.inject({ method: "GET", url: "/api/me", headers: auth({ telegramId: 5n }) });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "not_registered" });
  });

  it("/api/me returns the profile incl. own phone and bot username", async () => {
    const u = await makeRegisteredUser(db, { phone: "+998901234567" });
    const res = await app.server.inject({ method: "GET", url: "/api/me", headers: auth(u) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ role: "CLIENT", hasPhone: true, phone: "+998901234567", isDriver: false, botUsername: "test_bot" });
  });

  it("validation errors return 400 invalid_input with details", async () => {
    const u = await makeRegisteredUser(db);
    const res = await app.server.inject({ method: "POST", url: "/api/orders", headers: auth(u), payload: { routeId: "x" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_input");
    expect(res.json().details.length).toBeGreaterThan(0);
  });

  it("malformed JSON returns 400, not 500", async () => {
    const u = await makeRegisteredUser(db);
    const res = await app.server.inject({
      method: "POST",
      url: "/api/orders",
      headers: { ...auth(u), "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
  });
});

void TEST_TOKEN;
