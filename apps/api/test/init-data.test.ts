import { describe, expect, it } from "vitest";
import { InitDataError, signInitData, verifyInitData } from "../src/auth/telegram-init-data.js";

const TOKEN = "123456:ABCdefGhIJKlmnoPQRstuVWxyz0123456789";
const now = new Date("2026-11-19T10:00:00Z");
const authDate = String(Math.floor(now.getTime() / 1000) - 60);
const user = JSON.stringify({ id: 7_123_456_789, first_name: "Ali", username: "ali" });

describe("verifyInitData", () => {
  it("accepts correctly signed data", () => {
    const data = signInitData({ auth_date: authDate, query_id: "q1", user }, TOKEN);
    const res = verifyInitData(data, TOKEN, { now });
    expect(res.user.id).toBe(7_123_456_789);
    expect(res.user.username).toBe("ali");
  });

  it("rejects data signed with another bot token", () => {
    const data = signInitData({ auth_date: authDate, user }, "999:other_token_other_token_other_token");
    expect(() => verifyInitData(data, TOKEN, { now })).toThrow(InitDataError);
  });

  it("rejects tampered user field", () => {
    const data = signInitData({ auth_date: authDate, user }, TOKEN);
    const tampered = data.replace(encodeURIComponent('"id":7123456789'), encodeURIComponent('"id":1'));
    expect(tampered).not.toBe(data);
    expect(() => verifyInitData(tampered, TOKEN, { now })).toThrow(InitDataError);
  });

  it("rejects expired data", () => {
    const old = String(Math.floor(now.getTime() / 1000) - 2 * 24 * 3600);
    const data = signInitData({ auth_date: old, user }, TOKEN);
    expect(() => verifyInitData(data, TOKEN, { now })).toThrow(/expired/);
  });

  it("rejects missing hash and garbage", () => {
    expect(() => verifyInitData(`auth_date=${authDate}&user=${encodeURIComponent(user)}`, TOKEN, { now })).toThrow(
      InitDataError,
    );
    expect(() => verifyInitData("", TOKEN, { now })).toThrow(InitDataError);
  });
});
