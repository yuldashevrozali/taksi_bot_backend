import { z } from "zod";

const telegramIdList = z
  .string()
  .default("")
  .transform((s, ctx) => {
    const ids = new Set<bigint>();
    for (const part of s.split(",").map((p) => p.trim()).filter(Boolean)) {
      if (!/^-?\d+$/.test(part)) {
        ctx.addIssue({ code: "custom", message: `not a Telegram ID: ${part}` });
        return z.NEVER;
      }
      ids.add(BigInt(part));
    }
    return ids as ReadonlySet<bigint>;
  });

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().startsWith("mongodb"),
  BOT_TOKEN: z.string().regex(/^\d+:[A-Za-z0-9_-]{30,}$/, "invalid bot token format"),
  // Telegram allows only A-Z a-z 0-9 _ - in secret_token.
  BOT_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{16,256}$/, "16-256 chars of A-Z a-z 0-9 _ -"),
  DRIVERS_GROUP_CHAT_ID: z
    .string()
    .regex(/^-\d+$/)
    .transform((s) => BigInt(s))
    .optional()
    .or(z.literal("").transform(() => undefined)),
  ADMIN_TELEGRAM_IDS: telegramIdList,
  PUBLIC_BASE_URL: z.url(),
  // Optional: Mini App hosted separately (e.g. https://taxi-miniapp.vercel.app). Bot buttons open it,
  // and the API allows CORS from this origin.
  MINI_APP_URL: z
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  // Signs admin browser sessions. Generate: node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"
  SESSION_SECRET: z.string().min(32, "at least 32 chars"),
  // Optional: short name of a Mini App registered in @BotFather (/newapp). If set, the drivers-group
  // button opens the Mini App directly; otherwise it goes through the bot chat.
  MINI_APP_SHORT_NAME: z
    .string()
    .regex(/^[A-Za-z0-9_]{3,30}$/)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Hosting fallbacks (Railway): PORT -> API_PORT, RAILWAY_PUBLIC_DOMAIN -> PUBLIC_BASE_URL.
 * Explicit values always win.
 */
export function withHostingDefaults(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const domain = source.RAILWAY_PUBLIC_DOMAIN;
  return {
    ...source,
    API_PORT: source.API_PORT || source.PORT,
    PUBLIC_BASE_URL: source.PUBLIC_BASE_URL || (domain ? `https://${domain}` : undefined),
  };
}

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = EnvSchema.safeParse(withHostingDefaults(source));
  if (!result.success) {
    // Print only field names and messages — never values (they contain secrets).
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment (.env):\n${issues}`);
  }
  return result.data;
}
