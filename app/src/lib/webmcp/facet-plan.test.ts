import { describe, expect, it } from "vitest";
import { planFacetChanges } from "./facet-plan";
import { EMPTY_SELECTED, type Selected } from "../search/url-state";

/**
 * The merge rules an agent is promised in every tool description: a field left
 * out changes nothing, null clears, a value sets. These tests are the contract
 * - if one of them has to change, the tool descriptions in search-tools.ts
 * have to change with it, or the agent is being lied to.
 */

const selected = (patch: Partial<Selected>): Selected => ({
  ...EMPTY_SELECTED,
  ...patch,
});

describe("planFacetChanges - fields left out", () => {
  it("plans nothing for an empty request", () => {
    expect(planFacetChanges(selected({ prefix: ["tabler"] }), {})).toEqual([]);
  });

  it("leaves the other facets alone when only one is named", () => {
    const current = selected({ prefix: ["tabler"], category: "arrows", tier: ["T1"] });
    expect(planFacetChanges(current, { category: "weather" })).toEqual([
      { kind: "category", slug: "weather" },
    ]);
  });
});

describe("planFacetChanges - sets", () => {
  it("adds a set that is not selected yet", () => {
    expect(planFacetChanges(EMPTY_SELECTED, { sets: ["tabler"] })).toEqual([
      { kind: "toggle", key: "prefix", value: "tabler" },
    ]);
  });

  it("plans nothing when the set filter already matches", () => {
    const current = selected({ prefix: ["tabler"] });
    expect(planFacetChanges(current, { sets: ["tabler"] })).toEqual([]);
  });

  it("swaps one set for another - removals first, then additions", () => {
    const current = selected({ prefix: ["tabler", "lucide"] });
    expect(planFacetChanges(current, { sets: ["lucide", "mdi"] })).toEqual([
      { kind: "toggle", key: "prefix", value: "tabler" },
      { kind: "toggle", key: "prefix", value: "mdi" },
    ]);
  });

  it("clears the set filter on an empty array", () => {
    const current = selected({ prefix: ["tabler", "lucide"] });
    expect(planFacetChanges(current, { sets: [] })).toEqual([
      { kind: "toggle", key: "prefix", value: "tabler" },
      { kind: "toggle", key: "prefix", value: "lucide" },
    ]);
  });

  it("ignores empty strings in the requested list", () => {
    expect(planFacetChanges(EMPTY_SELECTED, { sets: ["", "tabler"] })).toEqual([
      { kind: "toggle", key: "prefix", value: "tabler" },
    ]);
  });
});

describe("planFacetChanges - styles", () => {
  it("presses the STYLE pill an agent asked for", () => {
    expect(planFacetChanges(EMPTY_SELECTED, { styles: ["Outline"] })).toEqual([
      { kind: "toggle", key: "style", value: "Outline" },
    ]);
  });

  it("plans nothing when the style filter already matches", () => {
    const current = selected({ style: ["Outline"] });
    expect(planFacetChanges(current, { styles: ["Outline"] })).toEqual([]);
  });

  it("swaps one style for another - removals first, then additions", () => {
    const current = selected({ style: ["Outline", "Fill"] });
    expect(planFacetChanges(current, { styles: ["Fill", "Duo"] })).toEqual([
      { kind: "toggle", key: "style", value: "Outline" },
      { kind: "toggle", key: "style", value: "Duo" },
    ]);
  });

  it("clears the style filter on an empty array", () => {
    const current = selected({ style: ["Outline"] });
    expect(planFacetChanges(current, { styles: [] })).toEqual([
      { kind: "toggle", key: "style", value: "Outline" },
    ]);
  });

  it("leaves an active style alone when styles are not named", () => {
    const current = selected({ style: ["Outline"] });
    expect(planFacetChanges(current, { sets: ["tabler"] })).toEqual([
      { kind: "toggle", key: "prefix", value: "tabler" },
    ]);
  });
});

describe("planFacetChanges - category", () => {
  it("selects a category when none is active", () => {
    expect(planFacetChanges(EMPTY_SELECTED, { category: "arrows" })).toEqual([
      { kind: "category", slug: "arrows" },
    ]);
  });

  it("plans nothing when that category is already active", () => {
    const current = selected({ category: "arrows" });
    expect(planFacetChanges(current, { category: "arrows" })).toEqual([]);
  });

  it("clears by naming the active slug, because the handler is a toggle", () => {
    const current = selected({ category: "arrows" });
    expect(planFacetChanges(current, { category: null })).toEqual([
      { kind: "category", slug: "arrows" },
    ]);
  });

  it("plans nothing when asked to clear a category that is not set", () => {
    expect(planFacetChanges(EMPTY_SELECTED, { category: null })).toEqual([]);
  });
});

describe("planFacetChanges - tier", () => {
  it("selects a tier when none is active", () => {
    expect(planFacetChanges(EMPTY_SELECTED, { tier: "T1" })).toEqual([
      { kind: "toggle", key: "tier", value: "T1" },
    ]);
  });

  it("replaces the active tier rather than adding to it", () => {
    const current = selected({ tier: ["T1"] });
    expect(planFacetChanges(current, { tier: "T2" })).toEqual([
      { kind: "toggle", key: "tier", value: "T1" },
      { kind: "toggle", key: "tier", value: "T2" },
    ]);
  });

  it("clears every active tier on null", () => {
    const current = selected({ tier: ["T1", "T3"] });
    expect(planFacetChanges(current, { tier: null })).toEqual([
      { kind: "toggle", key: "tier", value: "T1" },
      { kind: "toggle", key: "tier", value: "T3" },
    ]);
  });
});

describe("planFacetChanges - several facets at once", () => {
  it("plans sets, then styles, then tier, then category", () => {
    const current = selected({
      prefix: ["mdi"],
      style: ["Fill"],
      tier: ["T4"],
      category: "weather",
    });
    expect(
      planFacetChanges(current, {
        sets: ["tabler"],
        styles: ["Outline"],
        tier: "T1",
        category: "arrows",
      }),
    ).toEqual([
      { kind: "toggle", key: "prefix", value: "mdi" },
      { kind: "toggle", key: "prefix", value: "tabler" },
      { kind: "toggle", key: "style", value: "Fill" },
      { kind: "toggle", key: "style", value: "Outline" },
      { kind: "toggle", key: "tier", value: "T4" },
      { kind: "toggle", key: "tier", value: "T1" },
      { kind: "category", slug: "arrows" },
    ]);
  });
});
