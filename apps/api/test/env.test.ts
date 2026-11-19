import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/config/env.js";

const base = {
  DATABASE_URL: "mongodb+srv://u:p@cluster.example.mongodb.net/taxi",
  BOT_TOKEN: "123456:ABCdefGhIJKlmnoPQRstuVWxyz0123456789",
  BOT_WEBHOOK_SECRET: "a".repeat(32),
  SESSION_SECRET: "b".repeat(40),
};

describe("env", () => {
  it("Railway: PORT and RAILWAY_PUBLIC_DOMAIN are used as fallbacks", () => {
    const env = parseEnv({ ...base, PORT: "8080", RAILWAY_PUBLIC_DOMAIN: "taxi.up.railway.app" });
    expect(env.API_PORT).toBe(8080);
    expect(env.PUBLIC_BASE_URL).toBe("https://taxi.up.railway.app");
  });

  it("platform PORT wins over a copied API_PORT; explicit PUBLIC_BASE_URL wins", () => {
    const env = parseEnv({ ...base, PORT: "8080", API_PORT: "3000", PUBLIC_BASE_URL: "https://x.example.com", RAILWAY_PUBLIC_DOMAIN: "y.up.railway.app" });
    expect(env.API_PORT).toBe(8080);
    expect(env.PUBLIC_BASE_URL).toBe("https://x.example.com");
    expect(parseEnv({ ...base, API_PORT: "3000", PUBLIC_BASE_URL: "https://x.example.com" }).API_PORT).toBe(3000);
  });

  it("refuses PUBLIC_BASE_URL pointing at the Mini App (webhook would go to Vercel)", () => {
    expect(() =>
      parseEnv({ ...base, PUBLIC_BASE_URL: "https://taksi-bot-app-yc3d.vercel.app", MINI_APP_URL: "https://taksi-bot-app-yc3d.vercel.app" }),
    ).toThrow(/BACKEND/);
    expect(() =>
      parseEnv({ ...base, RAILWAY_PUBLIC_DOMAIN: "api.up.railway.app", MINI_APP_URL: "https://taksi-bot-app-yc3d.vercel.app" }),
    ).not.toThrow();
  });

  it("errors list field names but never values", () => {
    let message = "";
    try {
      parseEnv({ ...base, BOT_TOKEN: "leaky-secret-value", PUBLIC_BASE_URL: "https://x.example.com" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("BOT_TOKEN");
    expect(message).not.toContain("leaky-secret-value");
  });
});
