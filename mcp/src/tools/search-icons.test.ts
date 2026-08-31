import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineQuery, EngineResult } from "../../../app/src/lib/search/engine";

const searchMock = vi.fn<(query: EngineQuery) => Promise<EngineResult>>();
vi.mock("../../../app/src/lib/search/shard-engine", () => ({
  shardEngine: { name: "shards", search: (query: EngineQuery) => searchMock(query) },
}));

const { runSearchIcons } = await import("./search-icons");

function result(overrides: Partial<EngineResult> = {}): EngineResult {
  return {
    hits: [],
    total: 0,
    facets: { prefix: {}, tier: {}, license: {}, style: {} },
    tookMs: 1,
    ...overrides,
  };
}

beforeEach(() => {
  searchMock.mockReset();
});

describe("runSearchIcons", () => {
  it("maps query/style/set/license/limit onto the engine query", async () => {
    searchMock.mockResolvedValue(result());
    await runSearchIcons({
      query: "arrow",
      style: "outline",
      set: "tabler",
      license: "MIT",
      limit: 10,
    });

    expect(searchMock).toHaveBeenCalledWith({
      query: "arrow",
      prefixes: ["tabler"],
      styles: ["outline"],
      licenses: ["MIT"],
      tiers: [],
      noAttribution: false,
      noBrand: false,
      limit: 10,
      offset: 0,
    } satisfies EngineQuery);
  });

  it("omits unset filters as empty arrays rather than undefined", async () => {
    searchMock.mockResolvedValue(result());
    await runSearchIcons({ query: "arrow", limit: 24 });

    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ prefixes: [], styles: [], licenses: [] }),
    );
  });

  it("maps hits to id/name/set/style/license/attributionRequired/tier only - no bodies", async () => {
    searchMock.mockResolvedValue(
      result({
        total: 1,
        hits: [
          {
            id: "tabler:arrow-right",
            prefix: "tabler",
            setName: "Tabler Icons",
            name: "arrow-right",
            style: null,
            license: "MIT",
            attributionRequired: false,
            brand: false,
            tier: "T1",
            body: null,
            width: 24,
            height: 24,
          },
        ],
      }),
    );

    const output = await runSearchIcons({ query: "arrow right", limit: 24 });
    const text = output.content[0];
    if (text?.type !== "text") throw new Error("expected text content");
    const parsed = JSON.parse(text.text) as {
      total: number;
      hits: Record<string, unknown>[];
    };

    expect(parsed.total).toBe(1);
    expect(parsed.hits).toEqual([
      {
        id: "tabler:arrow-right",
        name: "arrow-right",
        set: "Tabler Icons",
        style: null,
        license: "MIT",
        attributionRequired: false,
        tier: "T1",
      },
    ]);
    expect(text.text).not.toContain("body");
    expect(text.text).not.toContain("<svg");
  });
});
