import { describe, expect, it } from "vitest";
import { normalizeEmail } from "./account-lookup";

describe("normalizeEmail", () => {
  it("trims and lowercases, so one person is one account", () => {
    expect(normalizeEmail("  Sam@Example.COM ")).toBe("sam@example.com");
  });

  it("leaves an already-normal address alone", () => {
    expect(normalizeEmail("sam@example.com")).toBe("sam@example.com");
  });

  it("collapses whitespace-only input to empty, which never matches", () => {
    expect(normalizeEmail("   ")).toBe("");
  });
});
