import { describe, expect, it } from "vitest";
import { formatTashkent, startOfTashkentDay, tashkentDateKey } from "../src/time.js";

describe("Tashkent time", () => {
  it("day starts at 19:00 UTC of the previous day", () => {
    expect(startOfTashkentDay(new Date("2026-11-19T03:00:00Z")).toISOString()).toBe("2026-11-18T19:00:00.000Z");
    expect(startOfTashkentDay(new Date("2026-11-19T19:30:00Z")).toISOString()).toBe("2026-11-19T19:00:00.000Z");
  });
  it("formats in local time", () => {
    expect(formatTashkent(new Date("2026-11-19T15:00:00Z"))).toBe("19.11 20:00");
    expect(tashkentDateKey(new Date("2026-11-19T20:00:00Z"))).toBe("2026-11-20");
  });
});
