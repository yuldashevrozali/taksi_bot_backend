import { describe, expect, it } from "vitest";
import { maskPhone, normalizeUzPhone } from "../src/phone.js";

describe("normalizeUzPhone", () => {
  it.each([
    ["+998901234567", "+998901234567"],
    ["998901234567", "+998901234567"],
    ["+998 (90) 123-45-67", "+998901234567"],
    ["90 123 45 67", "+998901234567"],
    ["901234567", "+998901234567"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeUzPhone(input)).toBe(expected);
  });

  it.each(["", "12345", "+79161234567", "99890123456", "+9989012345678"])("rejects %s", (input) => {
    expect(normalizeUzPhone(input)).toBeNull();
  });
});

describe("maskPhone", () => {
  it("hides the middle digits", () => {
    expect(maskPhone("+998901234567")).toBe("+99890*****67");
  });
  it("handles empty values", () => {
    expect(maskPhone(null)).toBe("-");
    expect(maskPhone("")).toBe("-");
  });
});
