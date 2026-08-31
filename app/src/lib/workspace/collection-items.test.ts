import { describe, expect, it } from "vitest";
import { isValidIconId } from "./collection-items";

describe("isValidIconId", () => {
  it("accepts a plain prefix:name id", () => {
    expect(isValidIconId("fa-solid:house")).toBe(true);
  });

  it("accepts dots, dashes and underscores in either half", () => {
    expect(isValidIconId("mdi:arrow-right_alt.2")).toBe(true);
  });

  it("rejects a non-string value", () => {
    expect(isValidIconId(undefined)).toBe(false);
    expect(isValidIconId(42)).toBe(false);
    expect(isValidIconId(null)).toBe(false);
  });

  it("rejects an id with no colon", () => {
    expect(isValidIconId("fa-solid-house")).toBe(false);
  });

  it("rejects an id with more than one colon", () => {
    expect(isValidIconId("fa-solid:house:extra")).toBe(false);
  });

  it("rejects an empty prefix or name half", () => {
    expect(isValidIconId(":house")).toBe(false);
    expect(isValidIconId("fa-solid:")).toBe(false);
  });

  it("rejects path traversal attempts", () => {
    expect(isValidIconId("../etc:passwd")).toBe(false);
    expect(isValidIconId("fa-solid:../../etc")).toBe(false);
    /* No slash needed to trip this one - ".." alone is otherwise a
       charset-legal segment, so it needs its own explicit reject. */
    expect(isValidIconId("..:..")).toBe(false);
  });

  it("rejects slashes and other unsafe characters", () => {
    expect(isValidIconId("fa-solid/house:name")).toBe(false);
    expect(isValidIconId("fa-solid:house name")).toBe(false);
    expect(isValidIconId("<script>:alert")).toBe(false);
  });
});
