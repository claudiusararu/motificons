import { describe, expect, it } from "vitest";
import {
  createSearchTools,
  mergeStyleOptions,
  toSnapshot,
  toStyleOptions,
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
  /* The STYLE facet the screen is offering. Styles are labels icon sets
     declare, not a fixed enum, so the tools check an agent's style against
     these rather than against anything hard-coded. */
  styleOptions: string[] = [],
): SearchSnapshot =>
  toSnapshot(query, { ...EMPTY_SELECTED, ...selected }, outcome, styleOptions);

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
  /* Snapshots that each SEARCH in turn will land on, for the two-step path
     (run the query, read the style facet off it, then press the pill). A
     read - `snapshot()` - never consumes one: it describes the screen as it
     stands, which is the whole reason the two-step exists. */
  const landings: SearchSnapshot[] = [];
  const land = () => {
    const next = landings.shift();
    if (next) current = next;
    return current;
  };
  const handle: SearchToolHandle = {
    async search(input) {
      calls.push({ method: "search", input });
      return land();
    },
    async refine(input) {
      calls.push({ method: "refine", input });
      return land();
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
    /** Queue what each successive search/refine lands on. */
    thenLandOn(...next: SearchSnapshot[]) {
      landings.push(...next);
    },
    tools: () => createSearchTools(handle),
    /* The same island, mounted inside a collection's open "Add icons"
       slide-over. */
    panelTools: () => createSearchTools(handle, "collection-panel"),
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
      styles: [],
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

/**
 * The style facet, which is how people actually ask for icons ("outline
 * arrows"). Three things have to hold, and none of them are obvious:
 *
 *   - the rail's own spelling wins. Facet values are the labels icon sets
 *     ship ("Outline", "Fill", "Duo"); an agent writes what the human said.
 *     A press that carries "outline" toggles nothing, so the tool has to
 *     resolve the case before pressing;
 *   - a style these results do not have is an error naming the ones they do,
 *     not an empty grid the human has to make sense of;
 *   - with nothing searched yet there is no facet to check against, so the
 *     value goes through as written instead of being rejected by an empty list.
 */
const STYLE_FACET = ["Outline", "Fill", "Duo", "Path"];

describe("style filtering", () => {
  it("passes styles through to the search in the facet rail's own spelling", async () => {
    const fake = fakeHandle(snapshot(results([], null), "arrow", {}, STYLE_FACET));
    await run(fake.tools(), "search_icons", { query: "arrow", styles: ["outline"] });
    expect(fake.calls.at(-1)).toEqual({
      method: "search",
      input: { query: "arrow", styles: ["Outline"] },
    });
  });

  it("accepts a bare string, and several styles at once", async () => {
    const fake = fakeHandle(snapshot(results([], null), "arrow", {}, STYLE_FACET));
    await run(fake.tools(), "search_icons", { query: "arrow", styles: "FILL" });
    expect((fake.calls.at(-1)!.input as { styles: string[] }).styles).toEqual(["Fill"]);

    await run(fake.tools(), "refine_search", { styles: ["fill", "duo"] });
    expect((fake.calls.at(-1)!.input as { styles: string[] }).styles).toEqual([
      "Fill",
      "Duo",
    ]);
  });

  it("clears the style filter on null and on an empty list", async () => {
    const fake = fakeHandle(
      snapshot(results([], null), "arrow", { style: ["Outline"] }, STYLE_FACET),
    );
    await run(fake.tools(), "refine_search", { styles: null });
    expect(fake.calls.at(-1)).toEqual({ method: "refine", input: { styles: [] } });

    await run(fake.tools(), "refine_search", { styles: [] });
    expect(fake.calls.at(-1)).toEqual({ method: "refine", input: { styles: [] } });
  });

  it("leaves the human's style filter alone when styles are not mentioned", async () => {
    const fake = fakeHandle(
      snapshot(results([], null), "arrow", { style: ["Outline"] }, STYLE_FACET),
    );
    await run(fake.tools(), "search_icons", { query: "arrow", sets: ["tabler"] });
    expect(fake.calls.at(-1)!.input).toEqual({ query: "arrow", sets: ["tabler"] });
  });

  it("refuses an unknown style, naming the ones these results have", async () => {
    const fake = fakeHandle(snapshot(results([], null), "arrow", {}, STYLE_FACET));
    const result = await run(fake.tools(), "search_icons", {
      query: "arrow",
      styles: ["squiggly"],
    });
    const message = String(result["error"]);
    expect(message).toContain("squiggly");
    expect(message).toContain("Outline, Fill, Duo, Path");
    /* The query the agent asked for still ran - it is the search the tool was
       called to do, and the human sees it. What did NOT happen is a pill
       press carrying a value no facet has. */
    expect(fake.calls.map((call) => call.method)).toEqual(["snapshot", "search"]);
    expect(fake.calls[1]!.input).toEqual({ query: "arrow", styles: [] });
  });

  it("refuses an unknown style on refine_search too", async () => {
    const fake = fakeHandle(snapshot(results([], null), "arrow", {}, STYLE_FACET));
    const result = await run(fake.tools(), "refine_search", { styles: ["Outline", "wobble"] });
    expect(String(result["error"])).toContain("wobble");
    expect(fake.calls.map((call) => call.method)).toEqual(["snapshot", "refine"]);
    expect(fake.calls[1]!.input).toEqual({ styles: [] });
  });

  it("switches to a style the narrowed facet no longer lists", async () => {
    /* The screen is filtered to Outline, so its facet offers Outline alone -
       the island widens that with what it saw before (mergeStyleOptions), and
       "make them filled" goes through instead of being refused. */
    const fake = fakeHandle(
      snapshot(results([], null), "arrow", { style: ["Outline"] }, [
        "Outline",
        "Fill",
        "Duo",
      ]),
    );
    await run(fake.tools(), "refine_search", { styles: ["fill"] });
    expect(fake.calls.at(-1)).toEqual({ method: "refine", input: { styles: ["Fill"] } });
  });

  /**
   * The production failure this section exists for: on a FRESH page the tools
   * had no facet to resolve against and pressed the agent's raw wording, so
   * search_icons {query:"house", styles:["bold"]} lit a BOLD chip over zero
   * results - the engine matches style exactly, and the label is "Bold".
   * Nothing unresolved may ever be pressed; the query runs first instead.
   */
  describe("on a page that has not searched yet", () => {
    it("runs the query first, then presses the style the results actually have", async () => {
      const fake = fakeHandle(snapshot({ status: "idle" }, ""));
      fake.thenLandOn(
        /* 1. the query, style filter deliberately cleared - this is where the
              style facet comes from. */
        snapshot(results([hit("house")], null, 214), "house", {}, ["Bold", "Outline"]),
        /* 2. the pill press, in the facet's own spelling. */
        snapshot(results([hit("house")], null, 11), "house", { style: ["Bold"] }, [
          "Bold",
          "Outline",
        ]),
      );

      const result = await run(fake.tools(), "search_icons", {
        query: "house",
        styles: ["bold"],
      });

      expect(fake.calls.map((call) => call.method)).toEqual([
        "snapshot",
        "search",
        "refine",
      ]);
      expect(fake.calls[1]!.input).toEqual({ query: "house", styles: [] });
      expect(fake.calls[2]!.input).toEqual({ styles: ["Bold"] });
      expect(result["total"]).toBe(11);
      expect((result["applied"] as { styles: string[] }).styles).toEqual(["Bold"]);
    });

    it("carries the other filters into the query step, not into the pill press", async () => {
      const fake = fakeHandle(snapshot({ status: "idle" }, ""));
      fake.thenLandOn(
        snapshot(results([hit("house")], null), "house", { prefix: ["tabler"] }, ["Bold"]),
        snapshot(results([hit("house")], null), "house", {
          prefix: ["tabler"],
          style: ["Bold"],
        }),
      );
      await run(fake.tools(), "search_icons", {
        query: "house",
        styles: ["bold"],
        sets: ["tabler"],
        category: "buildings",
      });
      expect(fake.calls[1]!.input).toEqual({
        query: "house",
        sets: ["tabler"],
        category: "buildings",
        styles: [],
      });
      expect(fake.calls[2]!.input).toEqual({ styles: ["Bold"] });
    });

    it("never presses a style the query's own results do not have", async () => {
      const fake = fakeHandle(snapshot({ status: "idle" }, ""));
      fake.thenLandOn(
        snapshot(results([hit("house")], null, 214), "house", {}, ["Bold", "Outline"]),
      );

      const result = await run(fake.tools(), "search_icons", {
        query: "house",
        styles: ["squiggly"],
      });

      expect(String(result["error"])).toContain("squiggly");
      expect(String(result["error"])).toContain("Bold, Outline");
      /* The query ran and the human can see it. The pill press did not. */
      expect(fake.calls.map((call) => call.method)).toEqual(["snapshot", "search"]);
    });

    it("says what happened when the query itself has no style facet", async () => {
      const fake = fakeHandle(snapshot({ status: "idle" }, ""));
      fake.thenLandOn(snapshot(results([], null, 0), "xyzzy"));
      const result = await run(fake.tools(), "search_icons", {
        query: "xyzzy",
        styles: ["bold"],
      });
      expect(String(result["error"])).toContain("no style facet");
      expect(fake.calls.map((call) => call.method)).toEqual(["snapshot", "search"]);
    });

    it("reports a spent allowance instead of an error about style names", async () => {
      const fake = fakeHandle(snapshot({ status: "idle" }, ""));
      fake.thenLandOn(
        snapshot({ status: "limited", meter: { used: 10, remaining: 0, limit: 10 } }, "house"),
      );
      const result = await run(fake.tools(), "search_icons", {
        query: "house",
        styles: ["bold"],
      });
      expect(result["limited"]).toBe(true);
      expect(fake.calls.map((call) => call.method)).toEqual(["snapshot", "search"]);
    });

    it("refuses to refine by style with nothing on screen to read", async () => {
      const fake = fakeHandle(snapshot({ status: "idle" }, ""));
      const result = await run(fake.tools(), "refine_search", { styles: ["bold"] });
      expect(String(result["error"])).toContain("no style facet");
      expect(String(result["error"])).toContain("search_icons");
      /* The clearing refine is a no-op on an empty rail; no style was pressed. */
      expect(
        fake.calls.filter(
          (call) => call.method === "refine" && (call.input as { styles?: string[] }).styles?.length,
        ),
      ).toHaveLength(0);
    });

    it("resolves a refine's style against the results the refine itself produced", async () => {
      /* A category was picked but no style facet has been read yet. */
      const fake = fakeHandle(snapshot(results([], null), "house"));
      fake.thenLandOn(
        snapshot(results([hit("house")], null, 214), "house", { category: "buildings" }, [
          "Bold",
        ]),
        snapshot(results([hit("house")], null, 11), "house", {
          category: "buildings",
          style: ["Bold"],
        }),
      );
      const result = await run(fake.tools(), "refine_search", {
        styles: ["BOLD"],
        category: "buildings",
      });
      expect(fake.calls[1]!.input).toEqual({ category: "buildings", styles: [] });
      expect(fake.calls[2]!.input).toEqual({ styles: ["Bold"] });
      expect(result["total"]).toBe(11);
    });
  });

  it("tells an agent what to try when the style emptied the grid", async () => {
    const fake = fakeHandle(
      snapshot(results([], null, 0), "house", { style: ["Bold"] }, ["Bold", "Outline", "Duo"]),
    );
    const result = await run(fake.tools(), "refine_search", { tier: "T1" });
    const note = String(result["note"]);
    expect(note).toContain("No results with this style");
    expect(note).toContain("styles: null");
    expect(note).toContain("Outline, Duo");
    expect(note).not.toContain("Bold,");
  });

  it("leaves the zero-result note off when no style is in force", async () => {
    const fake = fakeHandle(snapshot(results([], null, 0), "house"));
    const result = await run(fake.tools(), "refine_search", { tier: "T1" });
    expect(result["note"]).toBeUndefined();
  });

  it("counts styles as a refinement of their own", async () => {
    const fake = fakeHandle(snapshot(results([], null), "arrow", {}, STYLE_FACET));
    const result = await run(fake.tools(), "refine_search", { styles: ["Duo"] });
    expect(result["error"]).toBeUndefined();
  });

  it("echoes the styles in force next to the other applied filters", async () => {
    const fake = fakeHandle(
      snapshot(
        results([hit("arrow-right")], null),
        "arrow",
        { style: ["Outline"], prefix: ["tabler"], category: "arrows" },
        STYLE_FACET,
      ),
    );
    const result = await run(fake.tools(), "search_icons", { query: "arrow" });
    expect(result["applied"]).toEqual({
      query: "arrow",
      sets: ["tabler"],
      styles: ["Outline"],
      category: "arrows",
      tier: [],
    });
  });

  it("names the style facet in both tools' schemas", () => {
    const tools = fakeHandle(snapshot({ status: "idle" })).tools();
    for (const name of ["search_icons", "refine_search"]) {
      const properties = (
        toolNamed(tools, name).inputSchema as {
          properties: Record<string, { description: string }>;
        }
      ).properties;
      expect(properties["styles"]!.description).toContain("outline");
      expect(properties["styles"]!.description).toContain("STYLE facet");
    }
  });
});

describe("toStyleOptions", () => {
  it("lists the style facet most common first, like the rail does", () => {
    expect(toStyleOptions({ style: { Duo: 21, Outline: 25, Path: 19 } })).toEqual([
      "Outline",
      "Duo",
      "Path",
    ]);
    expect(toStyleOptions(undefined)).toEqual([]);
    expect(toStyleOptions({ prefix: { tabler: 4 } })).toEqual([]);
  });
});

/**
 * Facet counts describe the results after filtering, so one style pill on
 * means every other style is missing from the payload - the rail collapses to
 * the single pill the human can un-press. An agent has no pill to look at, so
 * "switch these to filled" must not be answered with "there is no Fill".
 */
describe("mergeStyleOptions", () => {
  it("keeps what the results have now first, then what they had before", () => {
    expect(mergeStyleOptions(["Outline"], ["Outline", "Fill", "Duo"], ["Outline"])).toEqual([
      "Outline",
      "Fill",
      "Duo",
    ]);
  });

  it("never repeats a style, whichever list it came from", () => {
    expect(mergeStyleOptions(["Fill"], ["Fill"], ["Fill"])).toEqual(["Fill"]);
  });

  it("still names an active style the current results have lost", () => {
    expect(mergeStyleOptions([], [], ["Two-Tone"])).toEqual(["Two-Tone"]);
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

/**
 * The Add-icons panel on a collection page mounts the same island, so it gets
 * the same searching tools - that is the only way an agent working inside a
 * collection can FIND an icon rather than having to already know its name.
 * What must differ: no `open_icon` (it would navigate the tab away from the
 * collection the human has open, mid-add), and descriptions that say where
 * the results are appearing and that add_icon_to_collection is what acts on
 * one.
 */
describe("createSearchTools - inside a collection's Add icons panel", () => {
  it("offers the three searching tools and withholds open_icon", () => {
    const tools = fakeHandle(snapshot({ status: "idle" })).panelTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      "search_icons",
      "refine_search",
      "get_search_state",
    ]);
  });

  it("points the searching tools at add_icon_to_collection and the open panel", () => {
    const tools = fakeHandle(snapshot({ status: "idle" })).panelTools();
    for (const name of ["search_icons", "refine_search"]) {
      const { description } = toolNamed(tools, name);
      expect(description).toContain("add_icon_to_collection");
      expect(description).toContain("Add icons");
    }
    expect(toolNamed(tools, "get_search_state").description).toContain("Add icons");
  });

  it("searches through the same handle, and notes where the results landed", async () => {
    const fake = fakeHandle(snapshot(results([hit("bell")], null)));
    const result = await run(fake.panelTools(), "search_icons", { query: "bell" });

    expect(fake.calls).toEqual([{ method: "search", input: { query: "bell" } }]);
    expect(result["hits"]).toEqual([
      {
        name: "bell",
        set: "Tabler Icons",
        prefix: "tabler",
        style: "outline",
        license: "MIT",
        url: "/tabler/bell",
      },
    ]);
    expect(String(result["note"])).toContain("add_icon_to_collection");
  });

  it("leaves the /search results free of the panel note", async () => {
    const fake = fakeHandle(snapshot(results([hit("bell")], null)));
    const result = await run(fake.tools(), "search_icons", { query: "bell" });
    expect(result["note"]).toBeUndefined();
  });
});
