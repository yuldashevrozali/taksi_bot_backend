import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Update } from "grammy/types";
import { auth, makeActiveDriver, makeApp, makeRegisteredUser, type TestApp } from "./app-harness.js";
import { resetDb, testDb } from "./helpers.js";

const db = testDb();
let app: TestApp;
const GROUP = -1005550001;
const DRIVERS_GROUP = -100123; // see app-harness driversChatId

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
  await db.route.createMany({
    data: [
      { code: "FERGANA_KOKAND", fromCity: "Farg'ona", toCity: "Qo'qon", sortOrder: 1 },
      { code: "KOKAND_FERGANA", fromCity: "Qo'qon", toCity: "Farg'ona", sortOrder: 2 },
    ],
  });
});

let uid = 700000;
function botStatus(chatId: number, status: "administrator" | "member" | "left", fromId = 1): Update {
  return {
    update_id: uid++,
    my_chat_member: {
      chat: { id: chatId, type: "supergroup", title: "Farg'ona Qo'qon taksi" },
      from: { id: fromId, is_bot: false, first_name: "Admin" },
      date: 0,
      old_chat_member: { status: "left", user: { id: 123456, is_bot: true, first_name: "T" } },
      new_chat_member:
        status === "administrator"
          ? { status, user: { id: 123456, is_bot: true, first_name: "T" }, can_delete_messages: true }
          : { status, user: { id: 123456, is_bot: true, first_name: "T" } },
    },
  } as unknown as Update;
}

let mid = 1;
function groupMsg(text: string, from: { id: number; username?: string; first_name?: string; is_bot?: boolean } = { id: 42 }, chatId = GROUP, messageId = mid++): Update {
  return {
    update_id: uid++,
    message: {
      message_id: messageId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: "supergroup", title: "Taksi" },
      from: { is_bot: false, first_name: "Vali", ...from },
      text,
    },
  } as unknown as Update;
}

async function monitored() {
  await app.bot.handleUpdate(botStatus(GROUP, "administrator"));
}

describe("monitored groups", () => {
  it("bot promoted to admin -> group is monitored; removed -> monitoring off", async () => {
    await monitored();
    const g = await db.monitoredGroup.findUniqueOrThrow({ where: { chatId: BigInt(GROUP) } });
    expect(g).toMatchObject({ isActive: true, botIsAdmin: true, canDelete: true });
    await app.bot.handleUpdate(botStatus(GROUP, "left"));
    expect((await db.monitoredGroup.findUniqueOrThrow({ where: { chatId: BigInt(GROUP) } })).isActive).toBe(false);
  });

  it("the drivers group is never monitored", async () => {
    await app.bot.handleUpdate(botStatus(DRIVERS_GROUP, "administrator"));
    expect(await db.monitoredGroup.count()).toBe(0);
    await app.bot.handleUpdate(groupMsg("Qoqonga 2 kishi kerak", { id: 42 }, DRIVERS_GROUP));
    expect(await db.order.count()).toBe(0);
  });

  it("messages from groups where the bot is not admin are ignored", async () => {
    await app.bot.handleUpdate(groupMsg("Qoqonga 2 kishi kerak"));
    expect(await db.order.count()).toBe(0);
    expect(await db.groupMessage.count()).toBe(0);
  });
});

describe("group message -> order", () => {
  it("creates a GROUP order with defaults, saves the copy, posts to drivers", async () => {
    await monitored();
    await app.bot.handleUpdate(groupMsg("Fargonadan Qoqonga taksi kerak", { id: 4242, username: "vali_k", first_name: "Vali" }));
    const order = await db.order.findFirstOrThrow({ include: { route: true, groupMessages: true, client: true } });
    expect(order).toMatchObject({ source: "GROUP", status: "PENDING", passengers: 1, passengersUnknown: true, isNow: true, contactName: "Vali" });
    expect(order.route.code).toBe("FERGANA_KOKAND");
    expect(order.client).toMatchObject({ telegramId: 4242n, username: "vali_k", botStarted: false });
    expect(order.groupMessages[0]).toMatchObject({ result: "ORDER_CREATED", confidence: "HIGH", text: "Fargonadan Qoqonga taksi kerak" });
    expect(app.notifier.calls.map((c) => c.method)).toEqual(["orderCreated"]);
  });

  it("uses the phone number from the text and parsed passengers/time", async () => {
    await monitored();
    await app.bot.handleUpdate(groupMsg("Qoqondan Fargonaga 3 kishi ertaga 08:00, tel 90 123 45 67", { id: 4343 }));
    const order = await db.order.findFirstOrThrow({ include: { route: true } });
    expect(order).toMatchObject({ contactPhone: "+998901234567", passengers: 3, passengersUnknown: false, isNow: false });
    expect(order.route.code).toBe("KOKAND_FERGANA");
  });

  it("the accepting driver sees the original text and the sender's Telegram contact", async () => {
    await monitored();
    await app.bot.handleUpdate(groupMsg("Qoqonga 2 kishi kerak", { id: 4444, username: "ali_q" }));
    const order = await db.order.findFirstOrThrow();
    const d = await makeActiveDriver(db);
    const res = await app.server.inject({ method: "POST", url: `/api/driver/orders/${order.id}/accept`, headers: auth(d.user) });
    expect(res.json().contact).toMatchObject({ username: "ali_q", telegramId: "4444", sourceText: "Qoqonga 2 kishi kerak", phone: null });
  });

  it("same message delivered twice -> one order", async () => {
    await monitored();
    await app.bot.handleUpdate(groupMsg("Qoqonga 2 kishi kerak", { id: 50 }, GROUP, 9001));
    await app.bot.handleUpdate(groupMsg("Qoqonga 2 kishi kerak", { id: 50 }, GROUP, 9001));
    expect(await db.order.count()).toBe(1);
    expect(await db.groupMessage.count()).toBe(1);
  });

  it("same person posting again (or in another group) within 30 min -> DUPLICATE, no new order", async () => {
    await monitored();
    await app.bot.handleUpdate(botStatus(-1005550002, "administrator"));
    await app.bot.handleUpdate(groupMsg("Qoqonga 2 kishi kerak", { id: 51 }));
    await app.bot.handleUpdate(groupMsg("Qoqonga 2 kishi kerak!!", { id: 51 }, -1005550002));
    expect(await db.order.count()).toBe(1);
    expect(await db.groupMessage.count({ where: { result: "DUPLICATE" } })).toBe(1);
    // the opposite direction is a different trip
    await app.bot.handleUpdate(groupMsg("Fargonaga 1 kishi kerak", { id: 51 }));
    expect(await db.order.count()).toBe(2);
  });

  it("driver offers and messages from our drivers are not orders", async () => {
    await monitored();
    await app.bot.handleUpdate(groupMsg("Qoqonga ketyapman 3 ta joy bor", { id: 60 }));
    const d = await makeActiveDriver(db);
    await app.bot.handleUpdate(groupMsg("Qoqonga 2 kishi kerak", { id: Number(d.user.telegramId) }));
    expect(await db.order.count()).toBe(0);
    expect(await db.groupMessage.count({ where: { result: "DRIVER_OFFER" } })).toBe(2);
  });

  it("unclear messages are logged as UNRECOGNIZED; pure chatter is not stored", async () => {
    await monitored();
    await app.bot.handleUpdate(groupMsg("Qo'qonda havo qanday?", { id: 70 }));
    await app.bot.handleUpdate(groupMsg("Salom hammaga", { id: 71 }));
    expect(await db.order.count()).toBe(0);
    const rows = await db.groupMessage.findMany();
    expect(rows.map((r) => r.result)).toEqual(["UNRECOGNIZED"]);
  });

  it("bots, channels and disabled groups are ignored", async () => {
    await monitored();
    await app.bot.handleUpdate(groupMsg("Qoqonga 2 kishi kerak", { id: 80, is_bot: true }));
    const g = await db.monitoredGroup.findFirstOrThrow();
    await db.monitoredGroup.update({ where: { id: g.id }, data: { isActive: false } });
    await app.bot.handleUpdate(groupMsg("Qoqonga 2 kishi kerak", { id: 81 }));
    expect(await db.order.count()).toBe(0);
  });

  it("admin sees group messages by result and can toggle monitoring", async () => {
    await monitored();
    await app.bot.handleUpdate(groupMsg("Qoqonga 2 kishi kerak", { id: 90 }));
    await app.bot.handleUpdate(groupMsg("Qo'qonda havo qanday?", { id: 91 }));
    const admin = await makeRegisteredUser(db, { role: "ADMIN" });
    const created = (await app.server.inject({ method: "GET", url: "/api/admin/groups/messages?result=ORDER_CREATED", headers: auth(admin) })).json();
    expect(created.total).toBe(1);
    const unrec = (await app.server.inject({ method: "GET", url: "/api/admin/groups/messages", headers: auth(admin) })).json();
    expect(unrec.items[0].text).toBe("Qo'qonda havo qanday?");
    const groups = (await app.server.inject({ method: "GET", url: "/api/admin/groups", headers: auth(admin) })).json();
    await app.server.inject({ method: "PATCH", url: `/api/admin/groups/${groups[0].id}`, headers: auth(admin), payload: { isActive: false } });
    expect((await db.monitoredGroup.findFirstOrThrow()).isActive).toBe(false);
  });
});
