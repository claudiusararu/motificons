import { describe, expect, it } from "vitest";
import { EMPTY_SELECTED, buildSearchUrl, type Selected } from "./url-state";

describe("buildSearchUrl", () => {
  it("resting mode returns the base path", () => {
    expect(
      buildSearchUrl({
        mode: "resting",
        query: "",
        selected: EMPTY_SELECTED,
        filterCount: 0,
        basePath: "/search",
      }),
    ).toBe("/search");
  });

  it("a query with no filters goes to /search?q=", () => {
    expect(
      buildSearchUrl({
        mode: "results",
        query: "arrow",
        selected: EMPTY_SELECTED,
        filterCount: 0,
        basePath: "/search",
      }),
    ).toBe("/search?q=arrow");
  });

  it("a query keeps the tier/style/license/noAttribution/category facets in the URL", () => {
    const selected: Selected = {
      prefix: ["tabler"],
      style: ["outline"],
      license: ["MIT"],
      tier: ["T1"],
      noAttribution: true,
      category: "arrows",
    };
    const url = buildSearchUrl({
      mode: "results",
      query: "arrow",
      selected,
      filterCount: 5,
      basePath: "/search",
    });
    const params = new URL(url, "https://example.test").searchParams;
    expect(params.get("q")).toBe("arrow");
    expect(params.get("sets")).toBe("tabler");
    expect(params.getAll("style")).toEqual(["outline"]);
    expect(params.getAll("license")).toEqual(["MIT"]);
    expect(params.getAll("tier")).toEqual(["T1"]);
    expect(params.get("noAttribution")).toBe("1");
    expect(params.get("category")).toBe("arrows");
  });

  it("a query keeps multiple sets joined with commas", () => {
    const selected: Selected = { ...EMPTY_SELECTED, prefix: ["tabler", "iconoir"] };
    const url = buildSearchUrl({
      mode: "results",
      query: "heart",
      selected,
      filterCount: 2,
      basePath: "/search",
    });
    expect(new URL(url, "https://example.test").searchParams.get("sets")).toBe(
      "tabler,iconoir",
    );
  });

  it("exactly one set and nothing else canonicalizes to /{prefix}", () => {
    const selected: Selected = { ...EMPTY_SELECTED, prefix: ["tabler"] };
    expect(
      buildSearchUrl({
        mode: "set",
        query: "",
        selected,
        filterCount: 1,
        basePath: "/search",
      }),
    ).toBe("/tabler");
  });

  it("one set plus another facet does not canonicalize - stays on /search", () => {
    const selected: Selected = { ...EMPTY_SELECTED, prefix: ["tabler"], tier: ["T1"] };
    const url = buildSearchUrl({
      mode: "set",
      query: "",
      selected,
      filterCount: 2,
      basePath: "/search",
    });
    expect(url.startsWith("/search?")).toBe(true);
    const params = new URL(url, "https://example.test").searchParams;
    expect(params.get("sets")).toBe("tabler");
    expect(params.getAll("tier")).toEqual(["T1"]);
  });

  it("a facet-only set state with no sets still lands on /search with the facets", () => {
    const selected: Selected = { ...EMPTY_SELECTED, license: ["MIT"] };
    const url = buildSearchUrl({
      mode: "set",
      query: "",
      selected,
      filterCount: 1,
      basePath: "/search",
    });
    const params = new URL(url, "https://example.test").searchParams;
    expect(params.has("sets")).toBe(false);
    expect(params.getAll("license")).toEqual(["MIT"]);
  });
});
