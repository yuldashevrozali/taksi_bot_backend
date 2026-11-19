import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBot } from "@taxi/bot";
import { BOT_INFO, TEST_TOKEN, callbackUpdate, captureApi, contactUpdate, textUpdate, type ApiCall } from "./bot-harness.js";
import { makeOrder, makeRoute, resetDb, testDb } from "./helpers.js";

const db = testDb();
afterAll(() => db.$disconnect());

const ADMIN_ID = 900_000_001;
const silent = { info: () => {}, error: () => {} };

function setup(publicBaseUrl = "https://taxi.example.com") {
  const bot = createBot({
    token: TEST_TOKEN,
    db,
    botInfo: BOT_INFO,
    logger: silent,
    config: { publicBaseUrl, adminTelegramIds: new Set([BigInt(ADMIN_ID)]) },
  });
  const calls = captureApi(bot);
  return { bot, calls };
}

const sent = (calls: ApiCall[]) => calls.filter((c) => c.method === "sendMessage");
const lastSent = (calls: ApiCall[]) => sent(calls).at(-1)!.payload;
const buttons = (payload: Record<string, any>): any[] => (payload.reply_markup?.keyboard ?? []).flat();

async function onboard(bot: ReturnType<typeof setup>["bot"], userId: number, phone = "+998901234567") {
  await bot.handleUpdate(textUpdate(userId, "/start"));
  await bot.handleUpdate(callbackUpdate(userId, "lang:UZ_LATN"));
  await bot.handleUpdate(contactUpdate(userId, userId, phone));
}

beforeEach(() => resetDb(db));

describe("bot onboarding", () => {
  it("/start creates a user and asks for language", async () => {
    const { bot, calls } = setup();
    await bot.handleUpdate(textUpdate(111, "/start", { username: "ali" }));

    const user = await db.user.findUniqueOrThrow({ where: { telegramId: 111n } });
    expect(user.botStarted).toBe(true);
    expect(user.username).toBe("ali");
    expect(user.role).toBe("CLIENT");
    expect(user.referralCode).toMatch(/^[A-Za-z0-9_-]{8}$/);
    const msg = lastSent(calls);
    expect(msg.text).toContain("Tilni tanlang");
    expect(msg.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data)).toEqual([
      "lang:UZ_LATN",
      "lang:UZ_CYRL",
    ]);
  });

  it("language -> phone -> menu with a Mini App button", async () => {
    const { bot, calls } = setup();
    await bot.handleUpdate(textUpdate(222, "/start"));
    await bot.handleUpdate(callbackUpdate(222, "lang:UZ_CYRL"));

    expect((await db.user.findUniqueOrThrow({ where: { telegramId: 222n } })).language).toBe("UZ_CYRL");
    expect(calls.some((c) => c.method === "answerCallbackQuery")).toBe(true);
    const ask = lastSent(calls);
    expect(ask.text).toContain("Телефон");
    expect(buttons(ask)[0].request_contact).toBe(true);

    await bot.handleUpdate(contactUpdate(222, 222, "998 90 123 45 67"));
    const user = await db.user.findUniqueOrThrow({ where: { telegramId: 222n } });
    expect(user.phone).toBe("+998901234567");
    const menu = lastSent(calls);
    expect(menu.text).toBe("Асосий меню:");
    // Reply keyboard must NOT contain web_app buttons (they get no initData).
    expect(buttons(menu).some((b) => "web_app" in b)).toBe(false);

    await bot.handleUpdate(textUpdate(222, "🚕 Буюртма бериш"));
    const open = lastSent(calls);
    expect(open.reply_markup.inline_keyboard.flat()[0]).toMatchObject({
      text: "🚕 Буюртма бериш",
      web_app: { url: "https://taxi.example.com/app/" },
    });
  });

  it("rejects someone else's contact card", async () => {
    const { bot, calls } = setup();
    await bot.handleUpdate(textUpdate(333, "/start"));
    await bot.handleUpdate(contactUpdate(333, 444, "+998901112233"));
    expect((await db.user.findUniqueOrThrow({ where: { telegramId: 333n } })).phone).toBeNull();
    expect(lastSent(calls).text).toContain("o'zingizning raqamingizni");
  });

  it("rejects non-Uzbek numbers", async () => {
    const { bot, calls } = setup();
    await bot.handleUpdate(textUpdate(334, "/start"));
    await bot.handleUpdate(contactUpdate(334, 334, "+79161234567"));
    expect((await db.user.findUniqueOrThrow({ where: { telegramId: 334n } })).phone).toBeNull();
    expect(lastSent(calls).text).toContain("noto'g'ri");
  });

  it("registered user gets the menu right away on /start", async () => {
    const { bot, calls } = setup();
    await onboard(bot, 555);
    calls.length = 0;
    await bot.handleUpdate(textUpdate(555, "/start"));
    expect(sent(calls)).toHaveLength(1);
    expect(lastSent(calls).text).toBe("Asosiy menyu:");
  });

  it("without an HTTPS URL the order button is plain text and explains why", async () => {
    const { bot, calls } = setup("http://localhost:3000");
    await onboard(bot, 556);
    expect(buttons(lastSent(calls))[0]).toEqual({ text: "🚕 Buyurtma berish" });
    await bot.handleUpdate(textUpdate(556, "🚕 Buyurtma berish"));
    expect(lastSent(calls).text).toContain("Mini App");
  });

  it("phone is never written to the logs unmasked", async () => {
    const logs: string[] = [];
    const bot = createBot({
      token: TEST_TOKEN,
      db,
      botInfo: BOT_INFO,
      logger: { info: (o, m) => logs.push(JSON.stringify([m, o])), error: (o, m) => logs.push(JSON.stringify([m, o])) },
      config: { publicBaseUrl: "https://x.example.com", adminTelegramIds: new Set() },
    });
    captureApi(bot);
    await onboard(bot, 557, "+998901234567");
    expect(logs.join("\n")).not.toContain("901234567");
    expect(logs.join("\n")).toContain("+99890*****67");
  });
});

describe("bot roles and referral", () => {
  it("admin Telegram ID is promoted to ADMIN", async () => {
    const { bot } = setup();
    await bot.handleUpdate(textUpdate(ADMIN_ID, "/start"));
    expect((await db.user.findUniqueOrThrow({ where: { telegramId: BigInt(ADMIN_ID) } })).role).toBe("ADMIN");
  });

  it("active driver sees the driver menu; deactivated driver sees the client menu", async () => {
    const { bot, calls } = setup();
    await onboard(bot, 666);
    const user = await db.user.findUniqueOrThrow({ where: { telegramId: 666n } });
    const driver = await db.driver.create({ data: { userId: user.id } });

    await bot.handleUpdate(textUpdate(666, "/start"));
    expect(lastSent(calls).text).toBe("Haydovchi menyusi:");
    await bot.handleUpdate(textUpdate(666, "🚖 Haydovchi paneli"));
    expect(lastSent(calls).reply_markup.inline_keyboard.flat()[0].web_app.url).toBe(
      "https://taxi.example.com/app/?mode=driver",
    );

    await db.driver.update({ where: { id: driver.id }, data: { isActive: false } });
    await bot.handleUpdate(textUpdate(666, "/start"));
    expect(lastSent(calls).text).toBe("Asosiy menyu:");
  });

  it("referral link links a new user to the referrer", async () => {
    const { bot } = setup();
    await bot.handleUpdate(textUpdate(777, "/start"));
    const referrer = await db.user.findUniqueOrThrow({ where: { telegramId: 777n } });

    await bot.handleUpdate(textUpdate(778, `/start ref_${referrer.referralCode}`));
    const referred = await db.user.findUniqueOrThrow({ where: { telegramId: 778n } });
    expect(referred.referredById).toBe(referrer.id);
    const referral = await db.referral.findUniqueOrThrow({ where: { referredId: referred.id } });
    expect(referral.referrerId).toBe(referrer.id);
    expect(referral.bonusGranted).toBe(false);
  });

  it("referral link is ignored for existing users and for self", async () => {
    const { bot } = setup();
    await bot.handleUpdate(textUpdate(780, "/start"));
    await bot.handleUpdate(textUpdate(781, "/start"));
    const a = await db.user.findUniqueOrThrow({ where: { telegramId: 780n } });

    // existing user clicks someone's link
    await bot.handleUpdate(textUpdate(781, `/start ref_${a.referralCode}`));
    // user clicks own link
    await bot.handleUpdate(textUpdate(780, `/start ref_${a.referralCode}`));

    expect(await db.referral.count()).toBe(0);
    expect((await db.user.findUniqueOrThrow({ where: { telegramId: 781n } })).referredById).toBeNull();
  });

  it("parallel /start presses create exactly one user", async () => {
    const { bot } = setup();
    await Promise.all(Array.from({ length: 5 }, () => bot.handleUpdate(textUpdate(888, "/start"))));
    expect(await db.user.count({ where: { telegramId: 888n } })).toBe(1);
  });
});

describe("bot menu", () => {
  it("status shows 'Qabul qilindi' for trip stages (clients see two states only)", async () => {
    const { bot, calls } = setup();
    await onboard(bot, 998);
    const user = await db.user.findUniqueOrThrow({ where: { telegramId: 998n } });
    const route = await makeRoute(db);
    const order = await makeOrder(db, { clientId: user.id, routeId: route.id });
    await db.order.update({ where: { id: order.id }, data: { status: "IN_PROGRESS" } });
    await bot.handleUpdate(textUpdate(998, "📋 Buyurtma holati"));
    expect(lastSent(calls).text).toBe(`Buyurtma #${order.number}: Qabul qilindi`);
  });

  it("status shows the latest order", async () => {
    const { bot, calls } = setup();
    await onboard(bot, 999);
    await bot.handleUpdate(textUpdate(999, "📋 Buyurtma holati"));
    expect(lastSent(calls).text).toBe("Sizda hali buyurtma yo'q.");

    const user = await db.user.findUniqueOrThrow({ where: { telegramId: 999n } });
    const route = await makeRoute(db);
    const order = await makeOrder(db, { clientId: user.id, routeId: route.id });
    await bot.handleUpdate(textUpdate(999, "📋 Buyurtma holati"));
    expect(lastSent(calls).text).toBe(`Buyurtma #${order.number}: Kutilmoqda`);
  });

  it("menu buttons are ignored before registration", async () => {
    const { bot, calls } = setup();
    await bot.handleUpdate(textUpdate(1001, "/start"));
    calls.length = 0;
    await bot.handleUpdate(textUpdate(1001, "📋 Buyurtma holati"));
    expect(sent(calls)).toHaveLength(0);
  });
});

describe("bot resilience", () => {
  it("expired callback query does not break language selection", async () => {
    const { bot, calls } = setup();
    await bot.handleUpdate(textUpdate(1201, "/start"));
    bot.api.config.use(async (prev, method, payload, signal) => {
      if (method === "answerCallbackQuery") {
        return { ok: false, error_code: 400, description: "Bad Request: query is too old" } as any;
      }
      return prev(method, payload, signal);
    });
    await expect(bot.handleUpdate(callbackUpdate(1201, "lang:UZ_CYRL"))).resolves.toBeUndefined();
    expect((await db.user.findUniqueOrThrow({ where: { telegramId: 1201n } })).language).toBe("UZ_CYRL");
    expect(lastSent(calls).text).toContain("Телефон");
  });

  it("handler errors are swallowed and logged without the bot token", async () => {
    const logs: string[] = [];
    const bot = createBot({
      token: TEST_TOKEN,
      db,
      botInfo: BOT_INFO,
      logger: { info: () => {}, error: (o, m) => logs.push(JSON.stringify([m, o])) },
      config: { publicBaseUrl: "https://x.example.com", adminTelegramIds: new Set() },
    });
    bot.api.config.use(async () => ({ ok: false, error_code: 500, description: "boom" }) as any);
    await expect(bot.handleUpdate(textUpdate(1202, "/start"))).resolves.toBeUndefined();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join("\n")).not.toContain(TEST_TOKEN.split(":")[1]!);
  });
});

describe("group chat id helper (admins only)", () => {
  async function adminUser() {
    return db.user.create({ data: { telegramId: 31337n, firstName: "Boss", role: "ADMIN", botStarted: true, referralCode: "bossbossx" } });
  }

  it("/id in a group answers only our admins", async () => {
    const { bot, calls } = setup();
    const update = (fromId: number) =>
      ({
        update_id: 990001 + fromId,
        message: {
          message_id: 1,
          date: 0,
          chat: { id: -1001234567890, type: "supergroup", title: "Haydovchilar" },
          from: { id: fromId, is_bot: false, first_name: "A" },
          text: "/id",
          entities: [{ type: "bot_command", offset: 0, length: 3 }],
        },
      }) as any;
    await bot.handleUpdate(update(1));
    expect(sent(calls)).toHaveLength(0);
    await adminUser();
    await bot.handleUpdate(update(31337));
    expect(lastSent(calls).text).toContain("-1001234567890");
  });

  it("bot added to a group by an admin -> chat id is sent privately to that admin, not to the group", async () => {
    const { bot, calls } = setup();
    await adminUser();
    await bot.handleUpdate({
      update_id: 990002,
      my_chat_member: {
        chat: { id: -1009999, type: "supergroup", title: "Drivers" },
        from: { id: 31337, is_bot: false, first_name: "Boss" },
        date: 0,
        old_chat_member: { status: "left", user: { id: 123456, is_bot: true, first_name: "T" } },
        new_chat_member: { status: "administrator", user: { id: 123456, is_bot: true, first_name: "T" } },
      },
    } as any);
    const sentMsg = lastSent(calls);
    expect(sentMsg.chat_id).toBe(31337);
    expect(sentMsg.text).toContain("-1009999");
  });
});
