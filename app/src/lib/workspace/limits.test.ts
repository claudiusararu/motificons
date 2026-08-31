import { describe, expect, it } from "vitest";
import {
  MAX_NAME_LENGTH,
  COLLECTION_LIMIT,
  canCreateResource,
  collectionCapUpsell,
  validateResourceName,
} from "./limits";

describe("validateResourceName", () => {
  it("accepts a plain name", () => {
    expect(validateResourceName("Plume", "collection")).toEqual({
      ok: true,
      name: "Plume",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(validateResourceName("  Plume  ", "collection")).toEqual({
      ok: true,
      name: "Plume",
    });
  });

  it("rejects an empty string", () => {
    const result = validateResourceName("", "collection");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Give your collection a name.");
  });

  it("rejects a whitespace-only string", () => {
    const result = validateResourceName("   ", "collection");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Give your collection a name.");
  });

  it("rejects a non-string payload", () => {
    const result = validateResourceName(undefined, "collection");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Give your collection a name.");
  });

  it("accepts a name exactly at the length cap", () => {
    const name = "a".repeat(MAX_NAME_LENGTH);
    expect(validateResourceName(name, "collection")).toEqual({ ok: true, name });
  });

  it("rejects a name over the length cap", () => {
    const name = "a".repeat(MAX_NAME_LENGTH + 1);
    const result = validateResourceName(name, "collection");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        `Keep the name under ${MAX_NAME_LENGTH} characters.`,
      );
    }
  });

  it("counts the length after trimming, not before", () => {
    const padded = `  ${"a".repeat(MAX_NAME_LENGTH)}  `;
    expect(validateResourceName(padded, "collection").ok).toBe(true);
  });
});

describe("canCreateResource", () => {
  it("allows a workspace under the cap", () => {
    expect(canCreateResource(0, COLLECTION_LIMIT)).toBe(true);
    expect(canCreateResource(3, COLLECTION_LIMIT)).toBe(true);
  });

  it("blocks a workspace at the cap", () => {
    expect(canCreateResource(COLLECTION_LIMIT, COLLECTION_LIMIT)).toBe(false);
  });

  it("blocks a workspace over the cap", () => {
    expect(canCreateResource(20, COLLECTION_LIMIT)).toBe(false);
  });

  it("the cap is exactly 5 (an anti-spam guard)", () => {
    expect(COLLECTION_LIMIT).toBe(5);
  });

  it("allows the 5th collection and blocks the 6th", () => {
    expect(canCreateResource(4, COLLECTION_LIMIT)).toBe(true);
    expect(canCreateResource(5, COLLECTION_LIMIT)).toBe(false);
  });
});

describe("collectionCapUpsell", () => {
  it("states the limit and the make-room path, in the exact wording", () => {
    const { upsell } = collectionCapUpsell();
    expect(`${upsell.headline} ${upsell.body}`).toBe(
      "You have reached the limit of 5 collections. Delete or reuse one to make room.",
    );
  });

  /* Nothing is for sale, so the cap notice must never read as an offer or
     route the visitor to a mailbox. */
  it("offers nothing to buy, no link and no email", () => {
    const capped = collectionCapUpsell();
    const copy = `${capped.upsell.headline} ${capped.upsell.body}`;
    expect(copy).not.toMatch(/@|upgrade|pro\b|\$/i);
    expect(capped.upsell).not.toHaveProperty("href");
  });
});
