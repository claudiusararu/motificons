/**
 * Related icons, set browse and category grids.
 *
 * All three run on the shard engine and the pipeline's own data now. They used
 * to query Meilisearch directly, which made a dev-only search engine a hard
 * dependency of three SEO surfaces - the detail pages, set pages and category
 * pages all went blank without it running.
 */

import { getSet, isSafeSegment, type SetMetadata } from "./data";
import { shardEngine } from "./search/shard-engine";
import { storage } from "./storage";

export interface RelatedIcon {
  id: string;
  prefix: string;
  setName: string;
  name: string;
  body: string | null;
  width: number;
  height: number;
}

function toRelated(hit: {
  id: string;
  prefix: string;
  setName: string;
  name: string;
  width: number;
  height: number;
}): RelatedIcon {
  return {
    id: hit.id,
    prefix: hit.prefix,
    setName: hit.setName,
    name: hit.name,
    /* Bodies come from /api/icon, which is immutable and edge-cached once
       globally rather than re-read per page render. */
    body: null,
    width: hit.width,
    height: hit.height,
  };
}

const EMPTY = {
  prefixes: [],
  styles: [],
  licenses: [],
  tiers: [],
  noAttribution: false,
  noBrand: false,
};

/**
 * The same idea drawn by other sets, which is what a designer comparing icons
 * actually wants, plus siblings from the same set to fill the row.
 */
export async function relatedIcons(
  prefix: string,
  name: string,
  categories: string[],
  limit = 18,
): Promise<RelatedIcon[]> {
  const seen = new Set([`${prefix}:${name}`]);
  const out: RelatedIcon[] = [];

  const add = (hits: Parameters<typeof toRelated>[0][]) => {
    for (const hit of hits) {
      if (out.length >= limit || seen.has(hit.id)) continue;
      seen.add(hit.id);
      out.push(toRelated(hit));
    }
  };

  try {
    const across = await shardEngine.search({
      ...EMPTY,
      query: name.replace(/-/g, " "),
      limit: limit + 12,
      offset: 0,
    });
    add(across.hits.filter((hit) => hit.prefix !== prefix));

    if (out.length < limit && categories.length > 0) {
      const sameSet = await shardEngine.search({
        ...EMPTY,
        query: categories[0]!,
        prefixes: [prefix],
        limit,
        offset: 0,
      });
      add(sameSet.hits);
    }
  } catch {
    /* A detail page is an SEO surface and must render regardless. */
    return out;
  }

  return out;
}

/** First page of a set's icons. Browse, so never metered. */
export async function setIcons(
  prefix: string,
  limit: number,
  offset = 0,
): Promise<{ hits: RelatedIcon[]; total: number }> {
  try {
    const result = await shardEngine.search({
      ...EMPTY,
      query: "",
      prefixes: [prefix],
      limit,
      offset,
    });
    return { hits: result.hits.map(toRelated), total: result.total };
  } catch {
    return { hits: [], total: 0 };
  }
}

/**
 * Icons filed under a category by their own authors.
 *
 * Read straight from the pipeline's per-category list rather than reconstructed
 * from a search: categories are per icon, the set-level filters the shard
 * engine browses by cannot express them, and the pipeline already knows the
 * answer exactly.
 */
export async function categoryIcons(
  slug: string,
  limit: number,
  offset = 0,
): Promise<{ hits: RelatedIcon[]; total: number }> {
  if (!isSafeSegment(slug)) return { hits: [], total: 0 };

  const raw = await (await storage()).text(`categories/${slug}.json`);
  if (!raw) return { hits: [], total: 0 };

  const ids = JSON.parse(raw) as string[];
  const page = ids.slice(offset, offset + limit);
  const sets = new Map<string, SetMetadata | null>();

  const hits: RelatedIcon[] = [];
  for (const id of page) {
    const [prefix, name] = id.split(":");
    if (!prefix || !name) continue;
    if (!sets.has(prefix)) sets.set(prefix, await getSet(prefix));
    const set = sets.get(prefix);
    hits.push({
      id,
      prefix,
      name,
      setName: set?.name ?? prefix,
      body: null,
      width: set?.height ?? 24,
      height: set?.height ?? 24,
    });
  }

  return { hits, total: ids.length };
}
