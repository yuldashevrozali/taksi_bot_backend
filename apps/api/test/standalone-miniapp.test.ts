import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { miniAppUrl } from "@taxi/bot";
import { auth, makeActiveDriver, makeApp, makeRegisteredUser, orderBody, type TestApp } from "./app-harness.js";
import { textUpdate } from "./bot-harness.js";
import { makeRoute, resetDb, testDb } from "./helpers.js";

const db = testDb();
const VERCEL = "https://taxi-miniapp.vercel.app";
let app: TestApp;

beforeAll(async () => {
  app = await makeApp(db, { miniAppUrl: VERCEL });
});
afterAll(async () => {
  await app.server.close();
  await db.$disconnect();
});
beforeEach(() => resetDb(db));

describe("Mini App hosted on another origin (Vercel)", () => {
  it("miniAppUrl maps /app/ links to MINI_APP_URL, keeps /admin/ on the backend", () => {
    const cfg = { publicBaseUrl: "https://api.example.com", miniAppUrl: VERCEL };
    expect(miniAppUrl(cfg)).toBe(`${VERCEL}/`);
    expect(miniAppUrl(cfg, "/app/?order=abc")).toBe(`${VERCEL}/?order=abc`);
    expect(miniAppUrl(cfg, "/admin/")).toBe("https://api.example.com/admin/");
    expect(miniAppUrl({ publicBaseUrl: "https://api.example.com" }, "/app/?mode=driver")).toBe("https://api.example.com/app/?mode=driver");
  });

  it("CORS preflight is allowed for the Mini App origin only", async () => {
    const ok = await app.server.inject({
      method: "OPTIONS",
      url: "/api/orders",
      headers: { origin: VERCEL, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" },
    });
    expect(ok.statusCode).toBe(204);
    expect(ok.headers["access-control-allow-origin"]).toBe(VERCEL);
    expect(String(ok.headers["access-control-allow-headers"])).toContain("authorization");

    const evil = await app.server.inject({ method: "OPTIONS", url: "/api/orders", headers: { origin: "https://evil.example.com" } });
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("API responses carry the CORS header for the Mini App origin", async () => {
    const u = await makeRegisteredUser(db);
    const res = await app.server.inject({ method: "GET", url: "/api/me", headers: { ...auth(u), origin: VERCEL } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(VERCEL);
  });

  it("bot buttons open the Vercel Mini App", async () => {
    const client = await makeRegisteredUser(db);
    const route = await makeRoute(db);
    const order = (await app.server.inject({ method: "POST", url: "/api/orders", headers: auth(client), payload: orderBody(route.id) })).json();
    const d = await makeActiveDriver(db);
    await app.bot.handleUpdate(textUpdate(Number(d.user.telegramId), `/start order_${order.id}`));
    const msg = app.apiCalls.filter((c) => c.method === "sendMessage").at(-1)!.payload;
    expect(msg.reply_markup.inline_keyboard[0][0].web_app.url).toBe(`${VERCEL}/?order=${order.id}`);
  });
});
