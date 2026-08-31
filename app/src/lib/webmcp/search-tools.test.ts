import { describe, expect, it } from "vitest";
import {
  createSearchTools,
  toSnapshot,
  toToolHit,
  type SearchOutcome,
  type SearchSnapshot,
  type SearchToolHandle,
} from "./search-tools";
import type { WebMcpTool } from "./bridge";
import { EMPTY_SELECTED, type Selected } from "../search/url-state";
import type { SearchHit } from "../search-config";

/**
 * The tools are pure translation between an agent's JSON and the island's
 * handle, so they test without a DOM, a network or React: hand them a fake
 * handle and assert on what it was asked to do and what came back.
 *
 * What these are really guarding:
 *   - the meter is never bypassed or misreported (a limited page must tell the
 *     agent to ask the human to sign in, not silently return zero results);
 *   - payloads stay compact and never carry SVG bodies;
 *   - the three-state filter contract the descriptions promise is the one the
 *     handle is actually called with.
 */

const hit = (name: string, patch: Partial<SearchHit> = {}): SearchHit => ({
  id: `tabler:${name}`,
  prefix: "tabler",
  setName: "Tabler Icons",
  name,
  style: "outline",
  license: "MIT",
  attributionRequired: false,
  brand: false,
  tier: "T1",
  body: null,
  width: 24,
  height: 24,
  ...patch,
});

const snapshot = (
  outcome: SearchOutcome,
  query = "arrow",
  selected: Partial<Selected> = {},
): SearchSnapshot => toSnapshot(query, { ...EMPTY_SELECTED, ...selected }, outcome);

const results = (
  hits: SearchHit[],
  meter: { used: number; remaining: number; limit: number } | null,
  total = hits.length,
): SearchOutcome => ({
  status: "results",
  total,
  hits: hits.map(toToolHit),
  meter,
});

/** Records every call, and answers with whatever snapshot the test queued. */
function fakeHandle(answer: SearchSnapshot) {
  const calls: { method: string; input: unknown }[] = [];
  let current = answer;
  const handle: SearchToolHandle = {
    async search(input) {
      calls.push({ method: "search", input });
      return current;
    },
    async refine(input) {
      calls.push({ method: "refine", input });
      return current;
    },
    snapshot() {
      calls.push({ method: "snapshot", input: null });
      return current;
    },
    navigate(path) {
      calls.push({ method: "navigate", input: path });
    },
  };
  return {
    handle,
    calls,
    answerWith(next: SearchSnapshot) {
      current = next;
    },
    tools: () => createSearchTools(handle),
  };
}

function toolNamed(tools: WebMcpTool[], name: string): WebMcpTool {
  const found = tools.find((tool) => tool.name === name);
  if (!found) throw new Error(`no tool named ${name}`);
  return found;
}

const run = (tools: WebMcpTool[], name: string, input: Record<string, unknown>) =>
  Promise.resolve(toolNamed(tools, name).execute(input, {})) as Promise<
    Record<string, unknown>
  >;

describe("createSearchTools - the registered set", () => {
  it("offers exactly the four /search tools, each described for an agent", () => {
    const tools = fakeHandle(snapshot({ status: "idle" })).tools();
    expect(tools.map((tool) => tool.name)).toEqual([
      "search_icons",
      "refine_search",
      "open_icon",
      "get_search_state",
    ]);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(80);
      expect(tool.inputSchema).toMatchObject({ type: "object" });
    }
  });

  it("marks only the reading tool read-only", () => {
    const tools = fakeHandle(snapshot({ status: "idle" })).tools();
    expect(toolNamed(tools, "get_search_state").annotations).toEqual({
      readOnlyHint: true,
    });
    expect(toolNamed(tools, "search_icons").annotations).toBeUndefined();
  });

  it("tells the agent the allowance is shared with the human", () => {
    const tools = fakeHandle(snapshot({ status: "idle" })).tools();
    expect(toolNamed(tools, "search_icons").description).toContain("allowance");
    expect(toolNamed(tools, "search_icons").description).toContain("free account");
  });
});

describe("toToolHit", () => {
  it("keeps the payload compact and links to the icon page", () => {
    expect(toToolHit(hit("arrow-right"))).toEqual({
      name: "arrow-right",
      set: "Tabler Icons",
      prefix: "tabler",
      style: "outline",
      license: "MIT",
      url: "/tabler/arrow-right",
    });
  });

  it("never carries an SVG body, even when the route inlined one", () => {
    const compact = toToolHit(hit("arrow-right", { body: "<path d='M0 0h24'/>" }));
    expect(JSON.stringify(compact)).not.toContain("path");
  });
});

describe("search_icons", () => {
  it("runs the search in the UI and returns hits, totals and the meter", async () => {
    const fake = fakeHandle(
      snapshot(
        results([hit("arrow-right"), hit("arrow-left")], {
          used: 3,
          remaining: 7,
          limit: 10,
        }, 214),
      ),
    );

    const result = await run(fake.tools(), "search_icons", { query: " arrow " });

    expect(fake.calls[0]).toEqual({ method: "search", input: { query: "arrow" } });
    expect(result["total"]).toBe(214);
    expect(result["shown"]).toBe(2);
    expect(result["meter"]).toEqual({ remaining: 7, limit: 10 });
    expect(result["hits"]).toEqual([
      {
        name: "arrow-right",
        set: "Tabler Icons",
        prefix: "tabler",
        style: "outline",
        license: "MIT",
        url: "/tabler/arrow-right",
      },
      {
        name: "arrow-left",
        set: "Tabler Icons",
        prefix: "tabler",
        style: "outline",
        license: "MIT",
        url: "/tabler/arrow-left",
      },
    ]);
  });

  it("reports a signed-in visitor as unlimited rather than inventing numbers", async () => {
    const fake = fakeHandle(snapshot(results([hit("arrow-right")], null)));
    const result = await run(fake.tools(), "search_icons", { query: "arrow" });
    expect(result["meter"]).toBe("unlimited");
  });

  it("echoes back the filters actually in force", async () => {
    const fake = fakeHandle(
      snapshot(results([hit("arrow-right")], null), "arrow", {
        prefix: ["tabler"],
        category: "arrows",
        tier: ["T1"],
      }),
    );
    const result = await run(fake.tools(), "search_icons", { query: "arrow" });
    expect(result["applied"]).toEqual({
      query: "arrow",
      sets: ["tabler"],
      category: "arrows",
      tier: ["T1"],
    });
  });

  it("passes sets and category through, and leaves out what was not asked for", async () => {
    const fake = fakeHandle(snapshot(results([], null)));
    await run(fake.tools(), "search_icons", {
      query: "arrow",
      sets: ["tabler", "lucide"],
    });
    expect(fake.calls[0]!.input).toEqual({
      query: "arrow",
      sets: ["tabler", "lucide"],
    });

    await run(fake.tools(), "search_icons", { query: "arrow", category: "arrows" });
    expect(fake.calls[1]!.input).toEqual({ query: "arrow", category: "arrows" });
  });

  it("accepts a bare string where a set list was asked for", async () => {
    const fake = fakeHandle(snapshot(results([], null)));
    await run(fake.tools(), "search_icons", { query: "arrow", sets: "tabler" });
    expect(fake.calls[0]!.input).toEqual({ query: "arrow", sets: ["tabler"] });
  });

  it("trims the returned hits to the requested limit, clamped to 50", async () => {
    const many = Array.from({ length: 80 }, (_, index) => hit(`icon-${index}`));
    const fake = fakeHandle(snapshot(results(many, null, 900)));
    const tools = fake.tools();

    expect((await run(tools, "search_icons", { query: "a" }))["shown"]).toBe(20);
    expect((await run(tools, "search_icons", { query: "a", limit: 3 }))["shown"]).toBe(3);
    expect((await run(tools, "search_icons", { query: "a", limit: 500 }))["shown"]).toBe(50);
    expect((await run(tools, "search_icons", { query: "a", limit: 0 }))["shown"]).toBe(1);
  });

  it("hands back the sign-in message when the daily allowance is spent", async () => {
    const fake = fakeHandle(
      snapshot({ status: "limited", meter: { used: 10, remaining: 0, limit: 10 } }),
    );
    const result = await run(fake.tools(), "search_icons", { query: "arrow" });
    expect(result["limited"]).toBe(true);
    expect(String(result["message"])).toContain("sign in or register");
    expect(result["hits"]).toBeUndefined();
  });

  it("reports a failed search as an error the agent can read out", async () => {
    const fake = fakeHandle(
      snapshot({ status: "error", message: "Search is unavailable right now." }),
    );
    const result = await run(fake.tools(), "search_icons", { query: "arrow" });
    expect(result).toEqual({ error: "Search is unavailable right now." });
  });

  it("refuses an empty query instead of clearing the human's screen", async () => {
    const fake = fakeHandle(snapshot(results([], null)));
    const result = await run(fake.tools(), "search_icons", { query: "   " });
    expect(String(result["error"])).toContain("refine_search");
    expect(fake.calls).toHaveLength(0);
  });
});

describe("refine_search", () => {
  it("passes only the fields the agent named, so the rest stay as they are", async () => {
    const fake = fakeHandle(snapshot(results([hit("arrow-right")], null)));
    await run(fake.tools(), "refine_search", { sets: ["tabler"] });
    expect(fake.calls[0]).toEqual({ method: "refine", input: { sets: ["tabler"] } });
  });

  it("forwards null as a clear, which is different from leaving it out", async () => {
    const fake = fakeHandle(snapshot(results([], null)));
    await run(fake.tools(), "refine_search", { category: null, tier: "T1" });
    expect(fake.calls[0]!.input).toEqual({ category: null, tier: "T1" });
  });

  it("treats an empty set list as a clear", async () => {
    const fake = fakeHandle(snapshot(results([], null)));
    await run(fake.tools(), "refine_search", { sets: [] });
    expect(fake.calls[0]!.input).toEqual({ sets: [] });
  });

  it("asks for a facet instead of re-running the same search for nothing", async () => {
    const fake = fakeHandle(snapshot(results([], null)));
    const result = await run(fake.tools(), "refine_search", { limit: 5 });
    expect(String(result["error"])).toContain("at least one of");
    expect(fake.calls).toHaveLength(0);
  });

  it("returns the same shape as search_icons", async () => {
    const fake = fakeHandle(
      snapshot(
        results([hit("arrow-right")], { used: 1, remaining: 9, limit: 10 }, 12),
        "arrow",
        { prefix: ["tabler"] },
      ),
    );
    const result = await run(fake.tools(), "refine_search", { sets: ["tabler"] });
    expect(Object.keys(result).sort()).toEqual([
      "applied",
      "hits",
      "meter",
      "shown",
      "total",
    ]);
    expect(result["meter"]).toEqual({ remaining: 9, limit: 10 });
  });

  it("hands back the sign-in message when refining hits the limit", async () => {
    const fake = fakeHandle(
      snapshot({ status: "limited", meter: { used: 10, remaining: 0, limit: 10 } }),
    );
    const result = await run(fake.tools(), "refine_search", { tier: "T1" });
    expect(result["limited"]).toBe(true);
  });

  it("says so when there is nothing on screen to refine", async () => {
    const fake = fakeHandle(snapshot({ status: "idle" }, ""));
    const result = await run(fake.tools(), "refine_search", { tier: "T1" });
    expect(result["total"]).toBe(0);
    expect(String(result["note"])).toContain("search_icons");
  });
});

describe("open_icon", () => {
  it("navigates to the icon page and confirms in words", async () => {
    const fake = fakeHandle(snapshot(results([], null)));
    const result = await Promise.resolve(
      toolNamed(fake.tools(), "open_icon").execute(
        { prefix: "tabler", name: "arrow-right" },
        {},
      ),
    );
    expect(fake.calls[0]).toEqual({ method: "navigate", input: "/tabler/arrow-right" });
    expect(String(result)).toContain("/tabler/arrow-right");
  });

  it("refuses anything that is not a plain slug, and navigates nowhere", async () => {
    const fake = fakeHandle(snapshot(results([], null)));
    const tools = fake.tools();
    for (const input of [
      { prefix: "../etc", name: "passwd" },
      { prefix: "tabler", name: "a/b" },
      { prefix: "https://evil.example", name: "x" },
      { prefix: "", name: "arrow-right" },
      { prefix: "tabler", name: 7 },
    ]) {
      const result = (await Promise.resolve(
        toolNamed(tools, "open_icon").execute(input as Record<string, unknown>, {}),
      )) as Record<string, unknown>;
      expect(result["error"]).toBeTypeOf("string");
    }
    expect(fake.calls).toHaveLength(0);
  });
});

describe("get_search_state", () => {
  it("reports the query, every filter, the count and the allowance", async () => {
    const fake = fakeHandle(
      snapshot(
        results([hit("arrow-right")], { used: 4, remaining: 6, limit: 10 }, 214),
        "arrow",
        { prefix: ["tabler"], category: "arrows", tier: ["T1"], noAttribution: true },
      ),
    );

    const result = await run(fake.tools(), "get_search_state", {});

    expect(result).toEqual({
      query: "arrow",
      filters: {
        sets: ["tabler"],
        category: "arrows",
        tier: ["T1"],
        style: [],
        license: [],
        noAttribution: true,
      },
      status: "results",
      total: 214,
      meter: { remaining: 6, limit: 10 },
    });
  });

  it("reads the state without running a search", async () => {
    const fake = fakeHandle(snapshot(results([], null)));
    await run(fake.tools(), "get_search_state", {});
    expect(fake.calls.map((call) => call.method)).toEqual(["snapshot"]);
  });

  it("says the allowance is spent rather than reporting an empty page", async () => {
    const fake = fakeHandle(
      snapshot({ status: "limited", meter: { used: 10, remaining: 0, limit: 10 } }),
    );
    const result = await run(fake.tools(), "get_search_state", {});
    expect(result["limited"]).toBe(true);
    expect(result["meter"]).toEqual({ remaining: 0, limit: 10 });
  });
});
