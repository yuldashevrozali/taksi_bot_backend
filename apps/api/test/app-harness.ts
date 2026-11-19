import type { User } from "@prisma/client";
import { createApp, type App } from "../src/app.js";
import { signInitData } from "../src/auth/telegram-init-data.js";
import { RecordingNotifier } from "../src/modules/notify/notifier.js";
import { BOT_INFO, TEST_TOKEN, captureApi, type ApiCall } from "./bot-harness.js";
import type { Db } from "../src/db/client.js";

export const SECRET = "test_secret_test_secret_1234";
export const SESSION_SECRET = "session_secret_session_secret_session_secret";
export const ENV_ADMIN_ID = 900_000_009n;

export interface TestApp extends App {
  notifier: RecordingNotifier;
  apiCalls: ApiCall[];
}

export async function makeApp(db: Db, extra: { miniAppUrl?: string } = {}): Promise<TestApp> {
  const notifier = new RecordingNotifier();
  const app = await createApp({
    db,
    config: {
      botToken: TEST_TOKEN,
      webhookSecret: SECRET,
      sessionSecret: SESSION_SECRET,
      publicBaseUrl: "https://taxi.example.com",
      adminTelegramIds: new Set([ENV_ADMIN_ID]),
      driversChatId: -100123n,
      miniAppUrl: extra.miniAppUrl,
    },
    botInfo: BOT_INFO,
    notifier,
    logger: { info: () => {}, error: () => {} },
    httpLogger: false,
    serveStatic: false,
  });
  const apiCalls = captureApi(app.bot);
  return { ...app, notifier, apiCalls };
}

let seq = 0;
export async function makeRegisteredUser(
  db: Db,
  opts: { role?: User["role"]; phone?: string | null; username?: string; telegramId?: bigint } = {},
): Promise<User> {
  seq += 1;
  return db.user.create({
    data: {
      telegramId: opts.telegramId ?? BigInt(5_000_000 + seq * 7),
      firstName: `User${seq}`,
      username: opts.username ?? `user${seq}`,
      phone: opts.phone === undefined ? `+9989012${String(10000 + seq).slice(-5)}` : opts.phone,
      role: opts.role ?? "CLIENT",
      botStarted: true,
      referralCode: `code${seq}x${Date.now() % 100000}`,
    },
  });
}

export async function makeActiveDriver(db: Db, opts: { botStarted?: boolean } = {}) {
  const user = await makeRegisteredUser(db, { role: "DRIVER" });
  if (opts.botStarted === false) await db.user.update({ where: { id: user.id }, data: { botStarted: false } });
  const driver = await db.driver.create({ data: { userId: user.id, carModel: "Cobalt", carNumber: "40A123BC", carColor: "Oq" } });
  return { user: { ...user, botStarted: opts.botStarted ?? true }, driver };
}

export function auth(user: { telegramId: bigint; firstName?: string | null }): { authorization: string } {
  const initData = signInitData(
    {
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: Number(user.telegramId), first_name: user.firstName ?? "X" }),
    },
    TEST_TOKEN,
  );
  return { authorization: `tma ${initData}` };
}

let keySeq = 0;
export function orderBody(routeId: string, extra: Record<string, unknown> = {}) {
  keySeq += 1;
  return {
    routeId,
    pickup: "Mustaqillik ko'chasi 5",
    dropoff: "Qo'qon bozori",
    passengers: 2,
    isNow: true,
    contactName: "Ali",
    idempotencyKey: `key_${Date.now()}_${keySeq}`,
    ...extra,
  };
}
