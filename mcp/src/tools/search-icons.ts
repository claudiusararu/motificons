/**
 * search_icons: candidates tuned for an agent to pick from, not a
 * paginated results page - distinct icons, metadata only, no bodies (fetch
 * the body separately via get_icon once a specific id is chosen, same
 * "island fetches per tile" design the web search uses and for the same
 * reason: a body is worth caching once per icon, not once per search).
 *
 * Reuses the shard engine verbatim (app/src/lib/search/shard-engine.ts) -
 * the same ranking, typo tolerance and facet filtering /api/search runs, so
 * results here never diverge from what a human would find on the site for
 * the same query. Unmetered: MCP is capped by fair-use call rate
 * (src/rate-limit.ts), not by the anonymous search allowance - that meter
 * (app/src/lib/search/meter-kv.ts) is never imported here.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { shardEngine } from "../../../app/src/lib/search/shard-engine";
import type { EngineQuery } from "../../../app/src/lib/search/engine";

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;

export const searchIconsInputSchema = z.object({
  query: z
    .string()
    .describe(
      'Search text, matched against icon names, aliases and tags (e.g. "arrow right", "settings gear"). Empty string browses by filters alone.',
    ),
  style: z
    .string()
    .optional()
    .describe('Restrict to one visual style, e.g. "outline", "filled", "duotone" (styles vary by set - omit to search all styles).'),
  set: z
    .string()
    .optional()
    .describe('Restrict to one icon set by its prefix, e.g. "tabler" or "material-symbols".'),
  license: z
    .string()
    .optional()
    .describe('Restrict to one license, by its SPDX id (e.g. "MIT") or display title.'),
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe(`Max results to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`),
});

export type SearchIconsInput = z.infer<typeof searchIconsInputSchema>;

export async function runSearchIcons(input: SearchIconsInput): Promise<CallToolResult> {
  const query: EngineQuery = {
    query: input.query,
    prefixes: input.set ? [input.set] : [],
    styles: input.style ? [input.style] : [],
    licenses: input.license ? [input.license] : [],
    tiers: [],
    noAttribution: false,
    noBrand: false,
    limit: input.limit,
    offset: 0,
  };

  const result = await shardEngine.search(query);

  const hits = result.hits.map((hit) => ({
    id: hit.id,
    name: hit.name,
    set: hit.setName,
    style: hit.style,
    license: hit.license,
    attributionRequired: hit.attributionRequired,
    tier: hit.tier,
  }));

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ total: result.total, hits }, null, 2),
      },
    ],
  };
}
