import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Bot } from "grammy";
import { nextSequence } from "../src/db/counter.js";
import { TelegramNotifier } from "../src/modules/notify/notifier.js";
import { orderInclude } from "../src/modules/orders/order.model.js";
import { BOT_INFO, TEST_TOKEN, captureApi } from "./bot-harness.js";
import { makeActiveDriver, makeRegisteredUser } from "./app-harness.js";
import { makeRoute, resetDb, testDb } from "./helpers.js";

const db = testDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

async function setup() {
  const bot = new Bot(TEST_TOKEN, { botInfo: BOT_INFO });
  const calls = captureApi(bot);
  const notifier = new TelegramNotifier(bot.api, db, -100123n, { info: () => {}, error: () => {} }, { botUsername: "test_bot" });
  const client = await makeRegisteredUser(db);
  const route = await makeRoute(db);
  const { driver } = await makeActiveDriver(db);
  const created = await db.order.create({
    data: { number: await nextSequence(db, "order"), clientId: client.id, routeId: route.id, source: "MINIAPP", driverId: driver.id },
  });
  const load = () => db.order.findUniqueOrThrow({ where: { id: created.id }, include: orderInclude });
  const toClient = () => calls.filter((c) => c.method === "sendMessage" && c.payload.chat_id === client.telegramId.toString());
  return { notifier, calls, load, toClient, orderId: created.id };
}

describe("client notifications: only 'kutilmoqda' and 'qabul qilindi'", () => {
  it("order created -> client gets a 'Kutilmoqda' confirmation; drivers group gets the order", async () => {
    const { notifier, load, toClient, calls } = await setup();
    await notifier.orderCreated(await load());
    expect(toClient()).toHaveLength(1);
    expect(toClient()[0]!.payload.text).toContain("Kutilmoqda");
    const group = calls.find((c) => c.payload.chat_id === "-100123")!;
    expect(group.payload.text).toContain("Yangi mijoz");
    expect(group.payload.text).toContain("Hozir / tez");
    expect(group.payload.text).not.toContain("+998"); // no client contact in the group
    const button = group.payload.reply_markup.inline_keyboard[0][0];
    expect(button.text).toBe("🚕 Buyurtmani olish");
    expect(button.url).toMatch(/^https:\/\/t\.me\/test_bot\?start=order_[a-f0-9]{24}$/);
  });

  it("with MINI_APP_SHORT_NAME the group button opens the Mini App directly", async () => {
    const bot = new Bot(TEST_TOKEN, { botInfo: BOT_INFO });
    const calls = captureApi(bot);
    const notifier = new TelegramNotifier(bot.api, db, -100123n, { info: () => {}, error: () => {} }, { botUsername: "test_bot", miniAppShortName: "taxi" });
    const { load } = await setup();
    await notifier.orderCreated(await load());
    const group = calls.find((c) => c.payload.chat_id === "-100123")!;
    expect(group.payload.reply_markup.inline_keyboard[0][0].url).toMatch(/^https:\/\/t\.me\/test_bot\/taxi\?startapp=order_[a-f0-9]{24}$/);
  });

  it("accepted -> client is told the driver will contact them soon", async () => {
    const { notifier, load, toClient } = await setup();
    await notifier.orderAccepted(await load());
    expect(toClient()[0]!.payload.text).toContain("tez orada siz bilan bog'lanadi");
  });

  it("IN_PROGRESS sends nothing to the client; COMPLETED only announces earned points", async () => {
    const { notifier, load, toClient, orderId } = await setup();
    await db.order.update({ where: { id: orderId }, data: { status: "IN_PROGRESS" } });
    await notifier.statusChanged(await load(), 0);
    expect(toClient()).toHaveLength(0);

    await db.order.update({ where: { id: orderId }, data: { status: "COMPLETED" } });
    await notifier.statusChanged(await load(), 0);
    expect(toClient()).toHaveLength(0);
    await notifier.statusChanged(await load(), 10);
    expect(toClient()).toHaveLength(1);
    expect(toClient()[0]!.payload.text).toContain("+10 ball");
    expect(toClient()[0]!.payload.text).not.toContain("yakunlandi");
  });
});

describe("group-sourced order accepted", () => {
  it("deletes the original group message and marks it deleted (copy stays in DB)", async () => {
    const { notifier, load, calls, orderId } = await setup();
    const gm = await db.groupMessage.create({
      data: { chatId: -1005550001n, messageId: 77, text: "Qoqonga 2 kishi", confidence: "HIGH", result: "ORDER_CREATED", orderId },
    });
    await db.order.update({ where: { id: orderId }, data: { source: "GROUP" } });
    await notifier.orderAccepted(await load());
    const del = calls.find((c) => c.method === "deleteMessage")!;
    expect(del.payload).toMatchObject({ chat_id: "-1005550001", message_id: 77 });
    const row = await db.groupMessage.findUniqueOrThrow({ where: { id: gm.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.text).toBe("Qoqonga 2 kishi");
  });
});

describe("parcel orders in Telegram texts", () => {
  it("drivers group shows 'Pochta' instead of passengers", async () => {
    const { notifier, load, calls, orderId } = await setup();
    await db.order.update({ where: { id: orderId }, data: { parcel: true, passengers: 0 } });
    await notifier.orderCreated(await load());
    const group = calls.find((c) => c.payload.chat_id === "-100123")!;
    expect(group.payload.text).toContain("Pochta");
    expect(group.payload.text).not.toContain("Yo'lovchilar");
  });
});
