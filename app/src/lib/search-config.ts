/** Shared response types for the search route and the island. */

/** Filterable facets, mirrored from the indexer settings. */
export const FACETS = ["prefix", "style", "license", "tier"] as const;

export interface SearchHit {
  id: string;
  prefix: string;
  setName: string;
  name: string;
  style: string | null;
  license: string;
  attributionRequired: boolean;
  brand: boolean;
  tier: "T1" | "T2" | "T3" | "T4";
  /** Always null - deliberate, not "rare" (search/shard-engine.ts's `toHit`
      and both browse paths never inline a body): the island fetches each
      icon from /api/icon instead, which is immutable and edge-cached once
      globally rather than per search. A caller that needs the real body for
      more than a rendered tile (StyledIconGlyph's styled fallback,
      IconQuickView's fetch-on-open) resolves it explicitly. */
  body: string | null;
  width: number;
  height: number;
}

export interface SearchSuccess {
  limited: false;
  hits: SearchHit[];
  total: number;
  offset: number;
  limit: number;
  facets: Record<string, Record<string, number>>;
  /**
   * The anonymous daily allowance, or `null` when the visitor is signed in
   * and search is unlimited. `null` is the whole signal: the route never
   * touches KV for a signed-in visitor, so there is no count to report, and
   * the island renders no counter anywhere rather than a counter with
   * made-up numbers. Nullable rather than a second `{ unlimited: true }`
   * shape because every consumer already has to handle "is there a meter" at
   * one place - the counter - and a truthiness check reads the same there
   * whether the answer arrives as an absence or as a flag.
   */
  meter: { used: number; remaining: number; limit: number } | null;
  tookMs: number;
}

/** Only ever reached by an anonymous visitor - a signed-in one has no meter
    to exhaust - so the meter here is always present. */
export interface SearchLimited {
  limited: true;
  meter: { used: number; remaining: number; limit: number };
  upsell: {
    headline: string;
    body: string;
    /** Never a dead end: browse routes stay open and unmetered. */
    browse: { label: string; href: string }[];
  };
}

export type SearchResponse = SearchSuccess | SearchLimited;
