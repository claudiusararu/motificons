/**
 * The contract both search engines implement.
 *
 * Meilisearch stays as the development engine until the shard engine passes
 * its parity review, so the two live behind one interface and `/api/search`
 * picks between them. That is also what lets the parity harness run the same
 * query through both without a second code path.
 */

import type { SearchHit } from "../search-config";

export interface EngineQuery {
  query: string;
  /** Facet filters. Set-level ones can be answered without a query term. */
  prefixes: string[];
  styles: string[];
  licenses: string[];
  tiers: string[];
  noAttribution: boolean;
  noBrand: boolean;
  /** Single category slug. Per icon, from the pipeline's categories/<slug>.json
      list rather than a facet the shard index can answer on its own. */
  category?: string;
  limit: number;
  offset: number;
}

export interface EngineResult {
  hits: SearchHit[];
  total: number;
  facets: Record<string, Record<string, number>>;
  /** Time spent inside the engine, for the parity report. */
  tookMs: number;
}

export interface SearchEngine {
  readonly name: "shards";
  search(query: EngineQuery): Promise<EngineResult>;
}

export function emptyResult(): EngineResult {
  return { hits: [], total: 0, facets: {}, tookMs: 0 };
}
