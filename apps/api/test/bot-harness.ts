import type { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";

export const TEST_TOKEN = "123456:ABCdefGhIJKlmnoPQRstuVWxyz0123456789";

export const BOT_INFO: UserFromGetMe = {
  id: 123456,
  is_bot: true,
  first_name: "Test",
  username: "test_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
} as UserFromGetMe;

export interface ApiCall {
  method: string;
  payload: Record<string, any>;
}

/** Intercepts all outgoing Bot API calls; nothing is sent to Telegram. */
export function captureApi(bot: Bot): ApiCall[] {
  const calls: ApiCall[] = [];
  let messageId = 1000;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, any> });
    const result =
      method === "sendMessage" || method === "editMessageText"
        ? { message_id: ++messageId, date: 0, chat: { id: (payload as any).chat_id ?? 0, type: "private" }, text: "" }
        : true;
    return { ok: true, result } as any;
  });
  return calls;
}

let updateId = 1;
const from = (id: number, extra: Record<string, unknown> = {}) => ({ id, is_bot: false, first_name: "Ali", ...extra });

export function textUpdate(userId: number, text: string, extra: Record<string, unknown> = {}): Update {
  const entities = text.startsWith("/") ? [{ type: "bot_command", offset: 0, length: text.split(" ")[0]!.length }] : [];
  return {
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: userId, type: "private", first_name: "Ali" },
      from: from(userId, extra),
      text,
      entities,
    },
  } as unknown as Update;
}

export function contactUpdate(userId: number, contactUserId: number, phone: string): Update {
  return {
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: userId, type: "private", first_name: "Ali" },
      from: from(userId),
      contact: { phone_number: phone, first_name: "Ali", user_id: contactUserId },
    },
  } as unknown as Update;
}

export function callbackUpdate(userId: number, data: string): Update {
  return {
    update_id: updateId++,
    callback_query: {
      id: String(updateId),
      from: from(userId),
      chat_instance: "1",
      data,
      message: { message_id: 1, date: 0, chat: { id: userId, type: "private", first_name: "Ali" }, text: "x" },
    },
  } as unknown as Update;
}
