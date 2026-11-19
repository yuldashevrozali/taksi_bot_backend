import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GrammyError } from "grammy";
import { BroadcastService, type BroadcastSender } from "../src/modules/broadcast/broadcast.service.js";
import { auth, makeActiveDriver, makeApp, makeRegisteredUser, type TestApp } from "./app-harness.js";
import { resetDb, testDb } from "./helpers.js";

const db = testDb();
const silent = { info: () => {}, error: () => {} };
let app: TestApp;

beforeAll(async () => {
  app = await makeApp(db);
});
afterAll(async () => {
  await app.server.close();
  await db.$disconnect();
});
beforeEach(() => resetDb(db));

function fakeSender(fail: Record<string, GrammyError | Error> = {}) {
  const sent: { chatId: string; kind: "text" | "photo"; text: string; button?: string }[] = [];
  let retried429 = false;
  const sender: BroadcastSender = {
    async sendMessage(chatId, text, other) {
      const err = fail[chatId];
      if (err && !(err instanceof GrammyError && err.error_code === 429 && retried429)) {
        if (err instanceof GrammyError && err.error_code === 429) retried429 = true;
        throw err;
      }
      sent.push({ chatId, kind: "text", text, button: other?.reply_markup?.inline_keyboard[0]?.[0]?.text });
    },
    async sendPhoto(chatId, _photo, other) {
      sent.push({ chatId, kind: "photo", text: other?.caption ?? "" });
    },
  };
  return { sender, sent };
}

const tgError = (code: number, description: string, retry_after?: number) =>
  new GrammyError("x", { ok: false, error_code: code, description, ...(retry_after ? { parameters: { retry_after } } : {}) }, "sendMessage", {});

describe("broadcast service", () => {
  it("sends to every user who pressed /start, skips those who never did", async () => {
    const admin = await makeRegisteredUser(db, { role: "ADMIN" });
    const a = await makeRegisteredUser(db);
    const b = await makeRegisteredUser(db);
    await db.user.update({ where: { id: b.id }, data: { botStarted: false } }); // group-only user
    const { sender, sent } = fakeSender();
    const svc = new BroadcastService(db, sender, silent, 0);
    const bc = await svc.create({ text: "Chegirma!", audience: "ALL", buttonText: "Buyurtma", buttonUrl: "https://t.me/test_bot" }, admin);
    expect(bc.total).toBe(2);
    await svc.drain();
    expect(sent.map((s) => s.chatId).sort()).toEqual([admin.telegramId.toString(), a.telegramId.toString()].sort());
    expect(sent[0]!.button).toBe("Buyurtma");
    const done = await db.broadcast.findUniqueOrThrow({ where: { id: bc.id } });
    expect(done).toMatchObject({ status: "DONE", sent: 2, failed: 0, blocked: 0 });
    expect(await db.auditLog.count({ where: { action: "broadcast.create" } })).toBe(1);
  });

  it("audience: CLIENTS vs DRIVERS", async () => {
    const admin = await makeRegisteredUser(db, { role: "ADMIN" });
    const client = await makeRegisteredUser(db);
    const d = await makeActiveDriver(db);
    const svc = new BroadcastService(db, fakeSender().sender, silent, 0);
    expect(await svc.countRecipients("CLIENTS")).toBe(1);
    expect(await svc.countRecipients("DRIVERS")).toBe(1);
    expect(await svc.countRecipients("ALL")).toBe(3);
    const { sender, sent } = fakeSender();
    const drivers = new BroadcastService(db, sender, silent, 0);
    await drivers.create({ text: "Haydovchilar uchun", audience: "DRIVERS" }, admin);
    await drivers.drain();
    expect(sent.map((s) => s.chatId)).toEqual([d.user.telegramId.toString()]);
    void client;
  });

  it("blocked users are counted and skipped next time; 429 is retried; other errors counted as failed", async () => {
    const admin = await makeRegisteredUser(db, { role: "ADMIN" });
    const blocker = await makeRegisteredUser(db);
    const limited = await makeRegisteredUser(db);
    const broken = await makeRegisteredUser(db);
    const { sender, sent } = fakeSender({
      [blocker.telegramId.toString()]: tgError(403, "Forbidden: bot was blocked by the user"),
      [limited.telegramId.toString()]: tgError(429, "Too Many Requests", 0.01 as unknown as number),
      [broken.telegramId.toString()]: new Error("network"),
    });
    const svc = new BroadcastService(db, sender, silent, 0);
    const bc = await svc.create({ text: "Salom", audience: "ALL" }, admin);
    await svc.drain();
    const done = await db.broadcast.findUniqueOrThrow({ where: { id: bc.id } });
    expect(done).toMatchObject({ status: "DONE", sent: 2, blocked: 1, failed: 1 });
    expect(sent.map((s) => s.chatId)).toContain(limited.telegramId.toString());
    expect((await db.user.findUniqueOrThrow({ where: { id: blocker.id } })).botStarted).toBe(false);
    expect(await svc.countRecipients("ALL")).toBe(3);
  });

  it("photo broadcasts use sendPhoto with the text as caption", async () => {
    const admin = await makeRegisteredUser(db, { role: "ADMIN" });
    const { sender, sent } = fakeSender();
    const svc = new BroadcastService(db, sender, silent, 0);
    await svc.create({ text: "Yangi narxlar", photoUrl: "https://example.com/a.jpg", audience: "ALL" }, admin);
    await svc.drain();
    expect(sent[0]).toMatchObject({ kind: "photo", text: "Yangi narxlar" });
  });

  it("resumes after a restart from the saved cursor (no duplicates)", async () => {
    const admin = await makeRegisteredUser(db, { role: "ADMIN" });
    const users = [admin];
    for (let i = 0; i < 3; i++) users.push(await makeRegisteredUser(db));
    const ordered = [...users].sort((x, y) => (x.id < y.id ? -1 : 1));
    // Simulate a crash after the first two recipients
    const bc = await db.broadcast.create({
      data: { text: "Davomi", audience: "ALL", total: 4, status: "RUNNING", sent: 2, cursorUserId: ordered[1]!.id, createdById: admin.id },
    });
    const { sender, sent } = fakeSender();
    const svc = new BroadcastService(db, sender, silent, 0);
    svc.kick();
    await svc.drain();
    expect(sent.map((s) => s.chatId)).toEqual([ordered[2]!.telegramId.toString(), ordered[3]!.telegramId.toString()]);
    expect(await db.broadcast.findUniqueOrThrow({ where: { id: bc.id } })).toMatchObject({ status: "DONE", sent: 4 });
  });

  it("a cancelled broadcast stops", async () => {
    const admin = await makeRegisteredUser(db, { role: "ADMIN" });
    for (let i = 0; i < 3; i++) await makeRegisteredUser(db);
    const bc = await db.broadcast.create({ data: { text: "x", audience: "ALL", total: 4, status: "QUEUED", createdById: admin.id } });
    const { sender, sent } = fakeSender();
    const svc = new BroadcastService(db, sender, silent, 0);
    await svc.cancel(bc.id, admin);
    svc.kick();
    await svc.drain();
    expect(sent).toHaveLength(0);
    expect((await db.broadcast.findUniqueOrThrow({ where: { id: bc.id } })).status).toBe("CANCELLED");
    await expect(svc.cancel(bc.id, admin)).rejects.toMatchObject({ code: "not_running" });
  });
});

describe("broadcast admin API", () => {
  const body = { text: "Bugun 20% chegirma!", audience: "ALL" };

  it("non-admins cannot broadcast", async () => {
    const client = await makeRegisteredUser(db);
    const { user: driver } = await makeActiveDriver(db);
    for (const u of [client, driver]) {
      expect((await app.server.inject({ method: "POST", url: "/api/admin/broadcasts", headers: auth(u), payload: body })).statusCode).toBe(403);
    }
    expect(await db.broadcast.count()).toBe(0);
  });

  it("validates input: text required, https only, button text+url together, caption length", async () => {
    const admin = await makeRegisteredUser(db, { role: "ADMIN" });
    const bad = async (p: object) => (await app.server.inject({ method: "POST", url: "/api/admin/broadcasts", headers: auth(admin), payload: p })).statusCode;
    expect(await bad({ text: "", audience: "ALL" })).toBe(400);
    expect(await bad({ ...body, buttonText: "Ochish" })).toBe(400);
    expect(await bad({ ...body, buttonText: "Ochish", buttonUrl: "http://insecure.example.com" })).toBe(400);
    expect(await bad({ ...body, photoUrl: "https://example.com/a.jpg", text: "x".repeat(1025) })).toBe(400);
    expect(await bad({ ...body, audience: "EVERYONE" })).toBe(400);
  });

  it("recipient count, test send to the admin only, then send to all", async () => {
    const admin = await makeRegisteredUser(db, { role: "ADMIN" });
    await makeRegisteredUser(db);
    const count = (await app.server.inject({ method: "GET", url: "/api/admin/broadcasts/recipients?audience=ALL", headers: auth(admin) })).json();
    expect(count.count).toBe(2);

    app.apiCalls.length = 0;
    await app.server.inject({ method: "POST", url: "/api/admin/broadcasts/test", headers: auth(admin), payload: body });
    expect(app.apiCalls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.chat_id))).toEqual([admin.telegramId.toString()]);
    expect(await db.broadcast.count()).toBe(0);

    const res = await app.server.inject({ method: "POST", url: "/api/admin/broadcasts", headers: auth(admin), payload: body });
    expect(res.statusCode).toBe(201);
    await app.broadcasts.drain();
    const list = (await app.server.inject({ method: "GET", url: "/api/admin/broadcasts", headers: auth(admin) })).json();
    expect(list[0]).toMatchObject({ status: "DONE", total: 2, sent: 2, text: body.text });
  });
});
