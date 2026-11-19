import { Bot, InlineKeyboard, Keyboard, type Context } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { Language, PrismaClient, User } from "@prisma/client";
import { maskPhone, normalizeUzPhone } from "@taxi/shared";
import { LANGUAGE_BUTTONS, clientStatus, menuActionFromText, t, type Texts } from "./i18n.js";
import { findActiveDriver, registerStart } from "./users.js";
import { ORDER_START_PREFIX } from "./messages.js";

export interface BotConfig {
  /** Public HTTPS base URL of the backend; admin lives at `/admin/`, Mini App at `/app/` unless miniAppUrl is set. */
  publicBaseUrl: string;
  /** Mini App hosted separately (e.g. Vercel). Replaces `${publicBaseUrl}/app/`. */
  miniAppUrl?: string | undefined;
  adminTelegramIds: ReadonlySet<bigint>;
}

export interface Logger {
  info(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export type AcceptOutcome =
  | { ok: true; driverDmOk: boolean }
  | { ok: false; error: "not_found" | "not_driver" | "bot_not_started" | "already_taken" };

/** Domain operations the bot needs; implemented by the API (keeps the bot free of business logic). */
export interface BotServices {
  acceptOrder(orderId: string, driverTelegramId: bigint): Promise<AcceptOutcome>;
  cancelOrder(orderId: string, clientTelegramId: bigint): Promise<"ok" | "not_found" | "cannot_cancel">;
  /** One-time browser login URL for admins; null for non-admins. */
  createAdminLoginUrl(telegramId: bigint): Promise<string | null>;
  supportContact(): Promise<string>;
  handleGroupMessage(msg: {
    chatId: bigint;
    chatTitle?: string | undefined;
    messageId: number;
    text: string;
    from: { id: number; isBot: boolean; firstName: string; lastName?: string | undefined; username?: string | undefined };
  }): Promise<unknown>;
  groupMembershipChanged(e: { chatId: bigint; title?: string | undefined; status: string; canDelete: boolean }): Promise<void>;
}

export interface CreateBotOptions {
  token: string;
  db: PrismaClient;
  config: BotConfig;
  services?: BotServices;
  logger?: Logger;
  /** Pass in tests to skip the getMe network call. */
  botInfo?: UserFromGetMe;
}

const consoleLogger: Logger = {
  info: (obj, msg) => console.log(msg ?? "", obj),
  error: (obj, msg) => console.error(msg ?? "", obj),
};

const noServices: BotServices = {
  acceptOrder: async () => ({ ok: false, error: "not_found" }),
  cancelOrder: async () => "not_found",
  createAdminLoginUrl: async () => null,
  supportContact: async () => "",
  handleGroupMessage: async () => undefined,
  groupMembershipChanged: async () => undefined,
};

export function miniAppUrl(config: Pick<BotConfig, "publicBaseUrl" | "miniAppUrl">, path = "/app/"): string | null {
  if (path.startsWith("/app/") && config.miniAppUrl?.startsWith("https://")) {
    return `${config.miniAppUrl.replace(/\/$/, "")}/${path.slice("/app/".length)}`;
  }
  return config.publicBaseUrl.startsWith("https://") ? `${config.publicBaseUrl.replace(/\/$/, "")}${path}` : null;
}

function languageKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const { lang, label } of LANGUAGE_BUTTONS) kb.text(label, `lang:${lang}`);
  return kb;
}

function phoneKeyboard(tx: Texts): Keyboard {
  return new Keyboard().requestContact(tx.sharePhoneButton).resized().oneTime();
}

// NOTE: Mini Apps opened from a REPLY keyboard button get no initData (Telegram limitation), so the
// reply keyboard holds plain text buttons and the Mini App is opened via an INLINE web_app button.
function clientMenu(tx: Texts, isAdmin: boolean): Keyboard {
  const kb = new Keyboard()
    .text(tx.btnOrder)
    .row()
    .text(tx.btnStatus)
    .text(tx.btnRepeat)
    .row()
    .text(tx.btnCancel)
    .text(tx.btnOperator);
  if (isAdmin) kb.row().text(tx.btnAdmin);
  return kb.resized();
}

function driverMenu(tx: Texts, isAdmin: boolean): Keyboard {
  const kb = new Keyboard().text(tx.btnDriverPanel).row().text(tx.btnOrder).text(tx.btnStatus);
  if (isAdmin) kb.row().text(tx.btnAdmin);
  return kb.resized();
}

export function createBot(opts: CreateBotOptions): Bot {
  const bot = new Bot(opts.token, opts.botInfo ? { botInfo: opts.botInfo } : {});
  registerHandlers(bot, opts);
  return bot;
}

export function registerHandlers(
  bot: Bot,
  { db, config, services = noServices, logger = consoleLogger }: Omit<CreateBotOptions, "token" | "botInfo">,
): void {
  // Must be first: a handler error must never reach the webhook as HTTP 500, otherwise Telegram
  // redelivers the same update again and again. Log only safe fields (ctx contains the bot token).
  bot.use(async (ctx, next) => {
    try {
      await next();
    } catch (e) {
      logger.error(
        { updateId: ctx.update.update_id, error: e instanceof Error ? e.message : String(e) },
        "bot handler error",
      );
    }
  });

  // ── Drivers group: "Qabul qilish" (works in any chat where the bot posted the order) ──
  bot.callbackQuery(/^accept:([a-f0-9]{24})$/, async (ctx) => {
    const result = await services.acceptOrder(ctx.match[1]!, BigInt(ctx.from.id));
    const answer = result.ok
      ? result.driverDmOk
        ? { text: "✅ Buyurtma sizniki! Mijoz kontakti shaxsiy xabarda." }
        : { text: "✅ Qabul qilindi, lekin shaxsiy xabar yuborilmadi. Botni oching va /start bosing.", show_alert: true }
      : {
          not_found: { text: "Buyurtma topilmadi.", show_alert: true },
          not_driver: { text: "⛔ Siz faol haydovchi sifatida ro'yxatda yo'qsiz.", show_alert: true },
          bot_not_started: { text: "Avval botga shaxsiy xabarda /start bosing, keyin qayta urinib ko'ring.", show_alert: true },
          already_taken: { text: "Bu buyurtma allaqachon olingan.", show_alert: true },
        }[result.error];
    await ctx.answerCallbackQuery(answer).catch(() => undefined);
  });

  // ── Groups ──
  const groups = bot.chatType(["group", "supergroup"]);
  const chatIdText = (id: number, title?: string) =>
    `🆔 <b>${title ? title.replace(/[<>&]/g, "") : "Guruh"}</b>\nChat ID: <code>${id}</code>\n\n` +
    `• Haydovchilar guruhi bo'lsa, .env ga yozing: <code>DRIVERS_GROUP_CHAT_ID="${id}"</code>\n` +
    `• Mijozlar yozadigan ommaviy guruh bo'lsa: botni <b>admin</b> qiling (xabarlarni o'qish va o'chirish huquqi bilan) — monitoring avtomatik yoqiladi.`;
  const isAdminUser = async (telegramId: number) =>
    (await db.user.findUnique({ where: { telegramId: BigInt(telegramId) } }))?.role === "ADMIN";

  // /id — only for our admins (no noise in public groups).
  groups.command("id", async (ctx) => {
    if (!ctx.from || !(await isAdminUser(ctx.from.id))) return;
    await ctx.reply(chatIdText(ctx.chat.id, ctx.chat.title), { parse_mode: "HTML" });
  });

  bot.on("my_chat_member", async (ctx) => {
    const chat = ctx.myChatMember.chat;
    if (chat.type !== "group" && chat.type !== "supergroup") return;
    const was = ctx.myChatMember.old_chat_member.status;
    const member = ctx.myChatMember.new_chat_member;
    const canDelete = member.status === "administrator" && Boolean(member.can_delete_messages);
    await services.groupMembershipChanged({ chatId: BigInt(chat.id), title: chat.title, status: member.status, canDelete });
    const joinedOrPromoted = member.status !== was && (member.status === "member" || member.status === "administrator");
    if (joinedOrPromoted && (await isAdminUser(ctx.myChatMember.from.id))) {
      logger.info({ chatId: chat.id, status: member.status }, "bot added to group");
      // Tell the admin privately — never post configuration hints into a public group.
      await ctx.api
        .sendMessage(ctx.myChatMember.from.id, chatIdText(chat.id, chat.title), { parse_mode: "HTML" })
        .catch(() => undefined);
    }
  });

  // Every text/caption in a group goes to the order detector (it ignores irrelevant chatter).
  groups.on(["message:text", "message:caption"], async (ctx) => {
    const text = ctx.message.text ?? ctx.message.caption ?? "";
    const from = ctx.from;
    if (!from || ctx.message.sender_chat || text.startsWith("/")) return; // channels, anonymous admins, commands
    await services.handleGroupMessage({
      chatId: BigInt(ctx.chat.id),
      chatTitle: ctx.chat.title,
      messageId: ctx.message.message_id,
      text,
      from: { id: from.id, isBot: from.is_bot, firstName: from.first_name, lastName: from.last_name, username: from.username },
    });
  });

  const pm = bot.chatType("private");

  async function loadUser(ctx: Context): Promise<User | null> {
    if (!ctx.from) return null;
    return db.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
  }

  async function showMenu(ctx: Context, user: User): Promise<void> {
    const tx = t(user.language);
    const isAdmin = user.role === "ADMIN";
    const driver = await findActiveDriver(db, user.id);
    if (driver) {
      await ctx.reply(tx.driverMenuTitle, { reply_markup: driverMenu(tx, isAdmin) });
    } else {
      await ctx.reply(tx.menuTitle, { reply_markup: clientMenu(tx, isAdmin) });
    }
  }

  async function sendAdminLinks(ctx: Context, user: User): Promise<void> {
    const tx = t(user.language);
    if (user.role !== "ADMIN") return void (await ctx.reply(tx.noAccess));
    const url = miniAppUrl(config, "/admin/");
    if (!url) return void (await ctx.reply(tx.miniAppUnavailable));
    const kb = new InlineKeyboard().webApp(tx.btnAdmin, url);
    const loginUrl = await services.createAdminLoginUrl(user.telegramId);
    if (loginUrl) kb.row().url(tx.btnBrowserLogin, loginUrl);
    await ctx.reply(tx.adminPrompt, { reply_markup: kb });
  }

  /** Driver came from the drivers-group "Buyurtmani olish" link: open this order in the Mini App. */
  async function sendTakeOrder(ctx: Context, user: User, orderId: string): Promise<void> {
    const tx = t(user.language);
    if (!(await findActiveDriver(db, user.id))) return void (await ctx.reply(tx.notDriver));
    const order = /^[a-f0-9]{24}$/.test(orderId) ? await db.order.findUnique({ where: { id: orderId } }) : null;
    if (!order || order.status !== "PENDING") return void (await ctx.reply(tx.orderGone));
    const url = miniAppUrl(config, `/app/?order=${order.id}`);
    if (!url) return void (await ctx.reply(tx.miniAppUnavailable));
    await ctx.reply(tx.takeOrderPrompt(order.number), {
      reply_markup: new InlineKeyboard().webApp(tx.btnTakeOrder, url),
    });
  }

  // Onboarding: language -> phone -> menu. State is derived from the DB (no sessions).
  pm.command("start", async (ctx) => {
    const { user, isNew } = await registerStart(db, ctx.from, ctx.match, config.adminTelegramIds);
    logger.info({ userId: user.id, isNew, referred: Boolean(user.referredById) }, "bot /start");
    if (ctx.match === "login") return sendAdminLinks(ctx, user);
    if (ctx.match.startsWith(ORDER_START_PREFIX)) return sendTakeOrder(ctx, user, ctx.match.slice(ORDER_START_PREFIX.length));
    if (!user.phone) {
      await ctx.reply(t(user.language).chooseLanguage, { reply_markup: languageKeyboard() });
      return;
    }
    await showMenu(ctx, user);
  });

  pm.command("menu", async (ctx) => {
    const user = await loadUser(ctx);
    if (!user) return void (await ctx.reply("/start"));
    if (!user.phone) return void (await ctx.reply(t(user.language).askPhone, { reply_markup: phoneKeyboard(t(user.language)) }));
    await showMenu(ctx, user);
  });

  pm.command("admin", async (ctx) => {
    const user = await loadUser(ctx);
    if (!user) return void (await ctx.reply("/start"));
    await sendAdminLinks(ctx, user);
  });

  pm.callbackQuery(/^lang:(UZ_LATN|UZ_CYRL)$/, async (ctx) => {
    // Answer immediately (Telegram expires callback queries quickly); a late/duplicate answer is harmless.
    await ctx.answerCallbackQuery().catch(() => undefined);
    const lang = ctx.match[1] as Language;
    const existing = await loadUser(ctx);
    if (!existing) return;
    const user = await db.user.update({ where: { id: existing.id }, data: { language: lang } });
    const tx = t(lang);
    // Fails with "message is not modified" if the button is pressed twice — not an error for us.
    await ctx.editMessageText(tx.languageSet).catch(() => undefined);
    if (!user.phone) {
      await ctx.reply(tx.askPhone, { reply_markup: phoneKeyboard(tx) });
    } else {
      await showMenu(ctx, user);
    }
  });

  pm.callbackQuery(/^cancel:([a-f0-9]{24})$/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => undefined);
    const user = await loadUser(ctx);
    if (!user) return;
    const tx = t(user.language);
    const res = await services.cancelOrder(ctx.match[1]!, user.telegramId);
    const text = res === "ok" ? tx.cancelDone : res === "cannot_cancel" ? tx.cannotCancel : tx.nothingToCancel;
    await ctx.editMessageText(text).catch(() => ctx.reply(text));
  });

  pm.on("message:contact", async (ctx) => {
    const user = await loadUser(ctx);
    if (!user) return void (await ctx.reply("/start"));
    const tx = t(user.language);
    // Only accept the sender's own contact (shared via the button), not someone else's card.
    if (ctx.message.contact.user_id !== ctx.from.id) {
      await ctx.reply(tx.notOwnContact, { reply_markup: phoneKeyboard(tx) });
      return;
    }
    const phone = normalizeUzPhone(ctx.message.contact.phone_number);
    if (!phone) {
      await ctx.reply(tx.invalidPhone, { reply_markup: phoneKeyboard(tx) });
      return;
    }
    const updated = await db.user.update({ where: { id: user.id }, data: { phone } });
    logger.info({ userId: user.id, phone: maskPhone(phone) }, "phone registered");
    await ctx.reply(tx.registered);
    await showMenu(ctx, updated);
  });

  pm.on("message:text", async (ctx) => {
    const action = menuActionFromText(ctx.message.text);
    if (!action) return;
    const user = await loadUser(ctx);
    if (!user?.phone) return;
    const tx = t(user.language);
    const lastOrder = () => db.order.findFirst({ where: { clientId: user.id }, orderBy: { createdAt: "desc" } });

    switch (action) {
      case "status": {
        const order = await lastOrder();
        await ctx.reply(order ? tx.orderStatus(order.number, tx.status[clientStatus(order.status)]) : tx.noOrders);
        return;
      }
      case "order":
      case "driverPanel": {
        const url = miniAppUrl(config, action === "order" ? "/app/" : "/app/?mode=driver");
        if (!url) return void (await ctx.reply(tx.miniAppUnavailable));
        const [prompt, label] =
          action === "order" ? [tx.openOrderPrompt, tx.btnOrder] : [tx.openDriverPrompt, tx.btnDriverPanel];
        await ctx.reply(prompt, { reply_markup: new InlineKeyboard().webApp(label, url) });
        return;
      }
      case "repeat": {
        const order = await lastOrder();
        if (!order) return void (await ctx.reply(tx.noOrders));
        const url = miniAppUrl(config, `/app/?repeat=${order.id}`);
        if (!url) return void (await ctx.reply(tx.miniAppUnavailable));
        await ctx.reply(tx.repeatPrompt(order.number), { reply_markup: new InlineKeyboard().webApp(tx.btnRepeat, url) });
        return;
      }
      case "cancel": {
        const order = await db.order.findFirst({
          where: { clientId: user.id, status: { in: ["PENDING", "ACCEPTED"] } },
          orderBy: { createdAt: "desc" },
        });
        if (!order) return void (await ctx.reply(tx.nothingToCancel));
        await ctx.reply(tx.cancelConfirm(order.number), {
          reply_markup: new InlineKeyboard().text(tx.btnCancelYes, `cancel:${order.id}`),
        });
        return;
      }
      case "operator": {
        const contact = await services.supportContact();
        await ctx.reply(contact ? tx.operator(contact) : tx.operatorUnset);
        return;
      }
      case "admin":
        await sendAdminLinks(ctx, user);
        return;
    }
  });
}
