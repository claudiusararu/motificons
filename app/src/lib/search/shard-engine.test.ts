import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { EngineQuery } from "./engine";

/**
 * Category filter coverage: intersection on the search path, and the browse
 * path that serves a category directly when there is no query term.
 *
 * Only categories/<slug>.json is faked - shards, sets and bodies come straight
 * off pipeline/dist on disk, so ranking, tiers and licenses are the real
 * pipeline data rather than invented fixtures. `storage()` is the one seam
 * both paths go through (loadBucket, loadCategory, shardIndex), so mocking it
 * is enough to control what a category contains without touching the shard
 * matching logic under test.
 */

const DIST = fileURLToPath(new URL("../../../../pipeline/dist", import.meta.url));

const categoryFixtures = vi.hoisted(() => ({
  current: {} as Record<string, string[]>,
}));

vi.mock("../storage", () => ({
  storage: async () => ({
    async text(key: string): Promise<string | null> {
      const categoryMatch = /^categories\/(.+)\.json$/.exec(key);
      if (categoryMatch) {
        const slug = categoryMatch[1]!;
        const fixture = categoryFixtures.current[slug];
        return fixture ? JSON.stringify(fixture) : null;
      }
      try {
        return await readFile(`${DIST}/${key}`, "utf-8");
      } catch {
        return null;
      }
    },
    async range(key: string, offset: number, length: number): Promise<string | null> {
      try {
        const buffer = await readFile(`${DIST}/${key}`);
        return buffer.subarray(offset, offset + length).toString("utf-8");
      } catch {
        return null;
      }
    },
  }),
}));

const EMPTY: Omit<EngineQuery, "query" | "limit" | "offset"> = {
  prefixes: [],
  styles: [],
  licenses: [],
  tiers: [],
  noAttribution: false,
  noBrand: false,
};

/** A fresh module per test: the resident bucket/category caches are per
    isolate in production, and a test must not leak one test's fixture
    into the next through them. */
async function freshEngine() {
  vi.resetModules();
  const mod = await import("./shard-engine");
  return mod.shardEngine;
}

beforeEach(() => {
  categoryFixtures.current = {};
});

afterEach(() => {
  vi.resetModules();
});

describe("category browse (no query term)", () => {
  test("serves the category list directly, resolving each id's own set", async () => {
    const engine = await freshEngine();
    categoryFixtures.current["browse-fixture"] = [
      "feather:a",
      "feather:b",
      "mdi:c",
      "mdi:d",
      "ph:e",
    ];

    const result = await engine.search({
      ...EMPTY,
      query: "",
      category: "browse-fixture",
      limit: 60,
      offset: 0,
    });

    expect(result.total).toBe(5);
    expect(result.hits.map((hit) => hit.id)).toEqual([
      "feather:a",
      "feather:b",
      "mdi:c",
      "mdi:d",
      "ph:e",
    ]);
    const feather = result.hits.find((hit) => hit.id === "feather:a")!;
    expect(feather.tier).toBe("T1");
    expect(feather.license).toBe("MIT");
    expect(feather.setName).toBeTruthy();
  });

  test("paginates with offset/limit while total stays the full category count", async () => {
    const engine = await freshEngine();
    categoryFixtures.current["browse-page"] = [
      "feather:a",
      "feather:b",
      "mdi:c",
      "mdi:d",
      "ph:e",
    ];

    const page1 = await engine.search({
      ...EMPTY,
      query: "",
      category: "browse-page",
      limit: 2,
      offset: 0,
    });
    expect(page1.hits.map((hit) => hit.id)).toEqual(["feather:a", "feather:b"]);
    expect(page1.total).toBe(5);

    const page2 = await engine.search({
      ...EMPTY,
      query: "",
      category: "browse-page",
      limit: 2,
      offset: 2,
    });
    expect(page2.hits.map((hit) => hit.id)).toEqual(["mdi:c", "mdi:d"]);
    expect(page2.total).toBe(5);
  });

  test("composes with a prefix filter", async () => {
    const engine = await freshEngine();
    categoryFixtures.current["browse-prefix"] = [
      "feather:a",
      "feather:b",
      "mdi:c",
      "mdi:d",
      "ph:e",
    ];

    const result = await engine.search({
      ...EMPTY,
      prefixes: ["mdi"],
      query: "",
      category: "browse-prefix",
      limit: 60,
      offset: 0,
    });

    expect(result.total).toBe(2);
    expect(result.hits.every((hit) => hit.prefix === "mdi")).toBe(true);
  });

  test("composes with a tier filter", async () => {
    const engine = await freshEngine();
    categoryFixtures.current["browse-tier"] = [
      "feather:a", // T1
      "mdi:c", // T2
      "ph:e", // T2
    ];

    const result = await engine.search({
      ...EMPTY,
      tiers: ["T1"],
      query: "",
      category: "browse-tier",
      limit: 60,
      offset: 0,
    });

    expect(result.hits.map((hit) => hit.id)).toEqual(["feather:a"]);
    expect(result.total).toBe(1);
  });

  test("an unknown category slug browses empty rather than falling back to everything", async () => {
    const engine = await freshEngine();
    const result = await engine.search({
      ...EMPTY,
      query: "",
      category: "no-such-category",
      limit: 60,
      offset: 0,
    });
    expect(result.total).toBe(0);
    expect(result.hits).toEqual([]);
  });
});

describe("category intersection (search path)", () => {
  test("keeps only matches inside the category, same order as unfiltered", async () => {
    const engine = await freshEngine();

    const base = await engine.search({ ...EMPTY, query: "home", limit: 60, offset: 0 });
    expect(base.hits.length).toBeGreaterThanOrEqual(4);

    const half = Math.ceil(base.hits.length / 2);
    const kept = base.hits.slice(0, half).map((hit) => hit.id);
    const dropped = base.hits.slice(half).map((hit) => hit.id);
    categoryFixtures.current["search-fixture"] = kept;

    const filtered = await engine.search({
      ...EMPTY,
      query: "home",
      category: "search-fixture",
      limit: 60,
      offset: 0,
    });

    expect(filtered.total).toBe(kept.length);
    expect(filtered.hits.map((hit) => hit.id)).toEqual(
      base.hits.filter((hit) => kept.includes(hit.id)).map((hit) => hit.id),
    );
    for (const hit of filtered.hits) {
      expect(dropped).not.toContain(hit.id);
    }
  });

  test("composes with a prefix filter on the search path too", async () => {
    const engine = await freshEngine();

    const base = await engine.search({ ...EMPTY, query: "home", limit: 60, offset: 0 });
    expect(base.hits.length).toBeGreaterThanOrEqual(2);

    categoryFixtures.current["search-prefix"] = base.hits.map((hit) => hit.id);
    const onePrefix = base.hits[0]!.prefix;

    const filtered = await engine.search({
      ...EMPTY,
      query: "home",
      category: "search-prefix",
      prefixes: [onePrefix],
      limit: 60,
      offset: 0,
    });

    expect(filtered.hits.every((hit) => hit.prefix === onePrefix)).toBe(true);
    expect(filtered.hits.length).toBe(
      base.hits.filter((hit) => hit.prefix === onePrefix).length,
    );
  });

  test("an unknown category slug returns nothing rather than ignoring the filter", async () => {
    const engine = await freshEngine();
    const result = await engine.search({
      ...EMPTY,
      query: "home",
      category: "no-such-category",
      limit: 60,
      offset: 0,
    });
    expect(result.total).toBe(0);
    expect(result.hits).toEqual([]);
  });
});
