/**
 * SearchIsland.tsx's URL <-> state mapping, pulled out as pure functions so
 * the "which facets does the URL carry in each mode" rule can be
 * unit-tested without mounting the island or touching `window.history`.
 *
 * Bug this fixes: the island seeded tier/style/
 * license/noAttribution/category FROM the URL on load, but the effect that
 * writes the URL back only did so for the "set" mode (no query) - typing a
 * query while a tier/style/license/noAttribution filter was active dropped
 * those filters from the address bar, so a reload or a shared link lost
 * them even though the search results themselves were still filtered.
 * `buildSearchUrl` is now the one place both the "results" and "set"
 * branches build their params, so they can no longer drift apart again.
 */

export type FacetKey = "prefix" | "style" | "license" | "tier";

export interface Selected {
  prefix: string[];
  style: string[];
  license: string[];
  tier: string[];
  noAttribution: boolean;
  /** Single slug: a category filter is one facet at a time, unlike sets. */
  category: string | null;
}

export const EMPTY_SELECTED: Selected = {
  prefix: [],
  style: [],
  license: [],
  tier: [],
  noAttribution: false,
  category: null,
};

/** Every facet beyond `q`/`sets`/`category`, appended onto `params` the same
    way regardless of which mode is building the URL. */
function appendRestOfFacets(params: URLSearchParams, selected: Selected): void {
  for (const key of ["style", "license", "tier"] as FacetKey[]) {
    for (const value of selected[key]) params.append(key, value);
  }
  if (selected.noAttribution) params.set("noAttribution", "1");
  if (selected.category) params.set("category", selected.category);
}

/**
 * The canonical URL for the island's current state - what the URL-sync
 * effect pushes/replaces, and what a shared link should resolve back to.
 *
 *   results  a query, with or without filters -> /search?q=...&sets=...&...
 *   set      exactly one set, nothing else    -> /{prefix} (the canonical
 *                                                 set page)
 *   set      any other filter combination      -> /search?sets=...&...
 *   resting  nothing selected                  -> basePath
 */
export function buildSearchUrl({
  mode,
  query,
  selected,
  filterCount,
  basePath,
}: {
  mode: "resting" | "set" | "results";
  query: string;
  selected: Selected;
  filterCount: number;
  basePath: string;
}): string {
  if (mode === "results") {
    const params = new URLSearchParams();
    params.set("q", query);
    if (selected.prefix.length > 0) params.set("sets", selected.prefix.join(","));
    appendRestOfFacets(params, selected);
    return `/search?${params}`;
  }

  if (mode === "set" && selected.prefix.length === 1 && filterCount === 1) {
    /* Exactly one set and nothing else: the canonical set page URL. */
    return `/${selected.prefix[0]}`;
  }

  if (mode === "set") {
    const params = new URLSearchParams();
    if (selected.prefix.length > 0) params.set("sets", selected.prefix.join(","));
    appendRestOfFacets(params, selected);
    return `/search?${params}`;
  }

  return basePath;
}
