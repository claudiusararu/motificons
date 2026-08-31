/**
 * The edge search engine.
 *
 * A query token resolves to exactly one shard, so a one-word search is one
 * fetch and a two-word search is two. Shards are immutable, so hot ones sit in
 * the edge cache and most searches touch nothing billable (SPEC section 6).
 *
 * Scoring multiplies two things that are deliberately computed in different
 * places: document quality, baked into the shard by the pipeline (field,
 * token position, tier, set size, name length), and match quality, applied
 * here because only this side knows what was typed.
 *
 * Bodies are not in the shards and not in the response. Each icon SVG is
 * immutable and individually cacheable at the edge once, globally, across
 * every user and query - so the island fetches per tile from /api/icon and
 * popular icons stay hot forever. Assembling bodies here would re-read them
 * per search and produce a composite response no cache could reuse.
 */

import { getSet, isSafeSegment, listIconNames, loadSetList } from "../data";
import type { SearchHit } from "../search-config";
import { storage } from "../storage";
import type { EngineQuery, EngineResult, SearchEngine } from "./engine";

/* Positional document record, mirroring build-shards.ts. */
type PackedDoc = [
  prefix: string,
  name: string,
  tier: string,
  style: string | null,
  license: string,
  flags: number,
  width: number,
  height: number,
];

const FLAG_ATTRIBUTION = 1;
const FLAG_BRAND = 2;

interface Bucket {
  b: string;
  d: PackedDoc[];
  t: Record<string, [number, number][]>;
  f: Record<string, Record<string, number>>;
}

interface ShardIndex {
  buckets: number;
  index: Record<string, { terms: number; docs: number; bytes: number }>;
}

/** Match quality multipliers. Exact should always beat a longer prefix match. */
const EXACT = 3;
const PREFIX = 1.8;
const FUZZY = 0.9;

/** Below this length a typo is indistinguishable from a different word. */
const MIN_FUZZY_LENGTH = 4;

/* Parsed shards, kept in the isolate. Bounded because a bucket can be 359KB
   and an isolate that caches all 1,710 would be holding 36MB. */
const MAX_RESIDENT_BUCKETS = 48;
const resident = new Map<string, Bucket>();

let indexPromise: Promise<ShardIndex | null> | null = null;
/** term -> bucket, for two-character prefixes that were split. */
const fuzzyMaps = new Map<string, Record<string, string> | null>();
/** Extra shards a single fuzzy miss may pull in. Keeps the worst case bounded. */
const MAX_FUZZY_FALLBACK_BUCKETS = 2;

/**
 * The bucket directory, loaded once per isolate.
 *
 * A failed load is deliberately not memoized. Caching the null would mean one
 * unlucky first request - shards mid-publish, a transient R2 error - left that
 * isolate returning "search unavailable" for its entire life, long after the
 * data came back.
 */
function shardIndex(): Promise<ShardIndex | null> {
  indexPromise ??= (async () => {
    const raw = await (await storage()).text("shards/index.json");
    if (!raw) {
      indexPromise = null;
      return null;
    }
    return JSON.parse(raw) as ShardIndex;
  })().catch((error: unknown) => {
    indexPromise = null;
    throw error;
  });
  return indexPromise;
}

async function loadFuzzyMap(
  parent: string,
): Promise<Record<string, string> | null> {
  const cached = fuzzyMaps.get(parent);
  if (cached !== undefined) return cached;

  const raw = await (await storage()).text(`shards/fuzzy/${parent}.json`);
  const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : null;
  fuzzyMaps.set(parent, parsed);
  return parsed;
}

/** Synthetic origin: the Cache API keys on a URL, and these never leave. */
function cacheKeyFor(bucket: string): Request {
  return new Request(`https://shards.motificons.app/terms/${bucket}.json`);
}

async function loadBucket(key: string): Promise<Bucket | null> {
  const cached = resident.get(key);
  if (cached) return cached;

  let text: string | null = null;

  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  if (cache) {
    const hit = await cache.match(cacheKeyFor(key));
    if (hit) text = await hit.text();
  }

  if (text === null) {
    text = await (await storage()).text(`shards/terms/${key}.json`);
    if (text !== null && cache) {
      /* Shards are immutable for the life of a pipeline run, so a long TTL is
         safe: a re-publish changes the contents under the same key, and the
         deploy that follows starts fresh isolates. */
      await cache.put(
        cacheKeyFor(key),
        new Response(text, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=86400",
          },
        }),
      );
    }
  }

  if (text === null) return null;

  const bucket = JSON.parse(text) as Bucket;
  if (resident.size >= MAX_RESIDENT_BUCKETS) {
    const oldest = resident.keys().next().value;
    if (oldest !== undefined) resident.delete(oldest);
  }
  resident.set(key, bucket);
  return bucket;
}

export function normalize(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Which shard holds a term. Buckets over the size limit were split by third
 * character at build time, so the index decides whether to ask for two or
 * three - guessing would miss every split bucket.
 */
function bucketFor(token: string, index: ShardIndex): string | null {
  const two = token.length >= 2 ? token.slice(0, 2) : `${token}_`;
  if (token.length >= 3) {
    const three = token.slice(0, 3);
    if (index.index[three]) return three;
  }
  if (index.index[two]) return two;
  if (index.index[`${two}_`]) return `${two}_`;
  return null;
}

/** Levenshtein with an early exit: anything past `max` is not interesting. */
export function withinDistance(a: string, b: string, max: number): number | null {
  if (Math.abs(a.length - b.length) > max) return null;
  if (a === b) return 0;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + cost,
      );
      current.push(value);
      if (value < best) best = value;
    }
    if (best > max) return null;
    previous = current;
  }

  const distance = previous[b.length]!;
  return distance <= max ? distance : null;
}

interface Candidate {
  doc: PackedDoc;
  score: number;
  matched: number;
  /** The icon's whole name is exactly what was typed. */
  wholeName: boolean;
}

/**
 * Scores one token against one shard.
 *
 * Returns whether the shard held a strong match - a term equal to the token or
 * starting with it. That is what decides whether the fuzzy fallback is needed:
 * a weak edit-distance hit is not evidence the right shard was reached. "trsh"
 * finds the term "tr" in its bucket and would otherwise look no further, while
 * the word it meant sits in a sibling.
 */
function scoreToken(
  bucket: Bucket,
  token: string,
  into: Map<string, Candidate>,
): boolean {
  /* Best score per document for this token: an icon whose name and alias both
     match should not be counted twice. */
  const best = new Map<number, number>();

  let strong = false;

  const apply = (term: string, multiplier: number) => {
    const postings = bucket.t[term];
    if (!postings) return;
    for (const [doc, weight] of postings) {
      const value = weight * multiplier;
      const current = best.get(doc);
      if (current === undefined || value > current) best.set(doc, value);
    }
  };

  for (const term of Object.keys(bucket.t)) {
    if (term === token) {
      strong = true;
      apply(term, EXACT);
      continue;
    }
    if (term.startsWith(token)) {
      strong = true;
      /* A prefix match on a much longer word is a weaker signal: "arrow" in
         "arrowhead" is worth less than in "arrows". */
      apply(term, PREFIX * (token.length / term.length));
      continue;
    }
    if (token.length >= MIN_FUZZY_LENGTH) {
      const distance = withinDistance(token, term, 2);
      if (distance !== null && distance > 0) {
        apply(term, FUZZY / (1 + distance));
      }
    }
  }

  for (const [docIndex, score] of best) {
    const doc = bucket.d[docIndex];
    if (!doc) continue;
    const id = `${doc[0]}:${doc[1]}`;
    const existing = into.get(id);
    if (existing) {
      existing.score += score;
      existing.matched += 1;
    } else {
      into.set(id, { doc, score, matched: 1, wholeName: false });
    }
  }

  return strong;
}

function toHit(doc: PackedDoc, setName: string): SearchHit {
  return {
    id: `${doc[0]}:${doc[1]}`,
    prefix: doc[0],
    setName,
    name: doc[1],
    style: doc[3],
    license: doc[4],
    attributionRequired: (doc[5] & FLAG_ATTRIBUTION) !== 0,
    brand: (doc[5] & FLAG_BRAND) !== 0,
    tier: doc[2] as SearchHit["tier"],
    /* Deliberately null: the island fetches each icon from /api/icon, which is
       immutable and edge-cached once globally rather than per search. */
    body: null,
    width: doc[6],
    height: doc[7],
  };
}

/**
 * A category's icon list, loaded from the pipeline's flat
 * categories/<slug>.json rather than anything the shard index can answer -
 * category is per icon and the terms index has no notion of it. Kept as both
 * the ordered array (category browse pagination) and a Set built from the
 * same strings (O(1) membership test for the search-path intersection),
 * cached per isolate so repeat queries against a popular category (e.g. a
 * visitor paging through /search?category=symbols) do not refetch it.
 */
interface CategoryList {
  ids: string[];
  set: Set<string>;
}

/* A handful of recently used categories is enough - each list tops out
   around 8K short strings (the largest category, People & Body), nothing
   like the 421MB body store this file otherwise guards against holding. */
const MAX_RESIDENT_CATEGORIES = 12;
const categoryLists = new Map<string, CategoryList>();
const EMPTY_CATEGORY: CategoryList = { ids: [], set: new Set() };

async function loadCategory(slug: string): Promise<CategoryList | null> {
  if (!isSafeSegment(slug)) return null;

  const cached = categoryLists.get(slug);
  if (cached) return cached;

  const raw = await (await storage()).text(`categories/${slug}.json`);
  if (raw === null) return null;

  const entry: CategoryList = { ids: JSON.parse(raw) as string[], set: new Set() };
  entry.set = new Set(entry.ids);

  if (categoryLists.size >= MAX_RESIDENT_CATEGORIES) {
    const oldest = categoryLists.keys().next().value;
    if (oldest !== undefined) categoryLists.delete(oldest);
  }
  categoryLists.set(slug, entry);
  return entry;
}

function passesFilters(
  doc: PackedDoc,
  query: EngineQuery,
  category: CategoryList | null,
): boolean {
  if (query.prefixes.length > 0 && !query.prefixes.includes(doc[0])) return false;
  if (query.tiers.length > 0 && !query.tiers.includes(doc[2])) return false;
  if (query.licenses.length > 0 && !query.licenses.includes(doc[4])) return false;
  if (query.styles.length > 0 && (doc[3] === null || !query.styles.includes(doc[3]))) {
    return false;
  }
  if (query.noAttribution && (doc[5] & FLAG_ATTRIBUTION) !== 0) return false;
  if (query.noBrand && (doc[5] & FLAG_BRAND) !== 0) return false;
  /* Intersection after scoring/matching, same as every other filter here -
     a category miss should not have kept the doc out of the ranking, only
     out of the final page. */
  if (category && !category.set.has(`${doc[0]}:${doc[1]}`)) return false;
  return true;
}

function emptyFacets(): Record<string, Record<string, number>> {
  return { prefix: {}, tier: {}, license: {}, style: {} };
}

function collectFacets(docs: PackedDoc[]): Record<string, Record<string, number>> {
  const facets = emptyFacets();
  for (const doc of docs) {
    const bump = (facet: string, value: string | null) => {
      if (value === null) return;
      const table = facets[facet];
      if (!table) return;
      table[value] = (table[value] ?? 0) + 1;
    };
    bump("prefix", doc[0]);
    bump("tier", doc[2]);
    bump("license", doc[4]);
    bump("style", doc[3]);
  }
  return facets;
}

/**
 * Category browse: no query term, but a category slug narrows the flat id
 * list the pipeline already built (categories/<slug>.json) instead of the
 * set-by-set walk plain browse() does. The other facets are still set-level -
 * every icon in the category defers to its own set for tier, licence,
 * attribution and brand - so each id resolves to one metadata lookup rather
 * than a term. Style stays unavailable for the same reason it is in
 * browse(): nothing here is per icon except which category claims it.
 */
async function browseCategory(
  query: EngineQuery,
  slug: string,
): Promise<EngineResult> {
  const started = Date.now();
  const category = await loadCategory(slug);
  if (!category) return { hits: [], total: 0, facets: emptyFacets(), tookMs: Date.now() - started };

  const setMap = new Map((await loadSetList()).map((set) => [set.prefix, set]));
  const facets = emptyFacets();
  const hits: SearchHit[] = [];
  let matched = 0;

  for (const id of category.ids) {
    const separator = id.indexOf(":");
    if (separator < 0) continue;
    const prefix = id.slice(0, separator);
    const name = id.slice(separator + 1);

    const set = setMap.get(prefix);
    if (!set) continue;
    if (query.prefixes.length > 0 && !query.prefixes.includes(prefix)) continue;
    if (query.tiers.length > 0 && !query.tiers.includes(set.tier)) continue;
    const spdx = set.license.spdx || set.license.title;
    if (query.licenses.length > 0 && !query.licenses.includes(spdx)) continue;
    if (query.noAttribution && set.attributionRequired) continue;
    if (query.noBrand && set.brand) continue;

    facets["prefix"]![prefix] = (facets["prefix"]![prefix] ?? 0) + 1;
    facets["tier"]![set.tier] = (facets["tier"]![set.tier] ?? 0) + 1;
    facets["license"]![spdx] = (facets["license"]![spdx] ?? 0) + 1;

    if (matched >= query.offset && hits.length < query.limit) {
      hits.push({
        id,
        prefix,
        setName: set.name,
        name,
        style: null,
        license: spdx,
        attributionRequired: set.attributionRequired,
        brand: set.brand,
        tier: set.tier,
        body: null,
        width: set.height ?? 24,
        height: set.height ?? 24,
      });
    }
    matched += 1;
  }

  return { hits, total: matched, facets, tookMs: Date.now() - started };
}

/**
 * Browse: no query term, so there is nothing to look up in the term index.
 * Set-level attributes - which set, tier, licence, attribution, brand - are
 * the same for every icon in a set, so the filter is answered from set
 * metadata and the icons come from the name index. Style is per icon and
 * cannot be filtered without a term; the rail hides that facet when there are
 * no counts, so nothing offers what this cannot do.
 */
async function browse(query: EngineQuery): Promise<EngineResult> {
  if (query.category) return browseCategory(query, query.category);

  const started = Date.now();
  const sets = await loadSetList();

  const matching = sets.filter((set) => {
    if (query.prefixes.length > 0 && !query.prefixes.includes(set.prefix)) {
      return false;
    }
    if (query.tiers.length > 0 && !query.tiers.includes(set.tier)) return false;
    if (
      query.licenses.length > 0 &&
      !query.licenses.includes(set.license.spdx || set.license.title)
    ) {
      return false;
    }
    if (query.noAttribution && set.attributionRequired) return false;
    if (query.noBrand && set.brand) return false;
    return true;
  });

  const total = matching.reduce((sum, set) => sum + set.icons, 0);
  const hits: SearchHit[] = [];
  let skipped = 0;

  for (const set of matching) {
    if (hits.length >= query.limit) break;
    /* Skip whole sets that fall entirely before the offset rather than
       listing their names just to throw them away. */
    if (skipped + set.icons <= query.offset) {
      skipped += set.icons;
      continue;
    }

    const names = await listIconNames(set.prefix);
    for (const name of names) {
      if (skipped < query.offset) {
        skipped += 1;
        continue;
      }
      if (hits.length >= query.limit) break;
      hits.push({
        id: `${set.prefix}:${name}`,
        prefix: set.prefix,
        setName: set.name,
        name,
        style: null,
        license: set.license.spdx || set.license.title,
        attributionRequired: set.attributionRequired,
        brand: set.brand,
        tier: set.tier,
        body: null,
        width: set.height ?? 24,
        height: set.height ?? 24,
      });
    }
  }

  const facets = emptyFacets();
  for (const set of matching) {
    facets["prefix"]![set.prefix] = set.icons;
    facets["tier"]![set.tier] = (facets["tier"]![set.tier] ?? 0) + set.icons;
    const spdx = set.license.spdx || set.license.title;
    facets["license"]![spdx] = (facets["license"]![spdx] ?? 0) + set.icons;
  }

  return { hits, total, facets, tookMs: Date.now() - started };
}

export const shardEngine: SearchEngine = {
  name: "shards",

  async search(query: EngineQuery): Promise<EngineResult> {
    const tokens = normalize(query.query);
    if (tokens.length === 0) return browse(query);

    const started = Date.now();
    const index = await shardIndex();
    if (!index) {
      throw new Error(
        "Search shards are missing. Run pnpm build-shards and pnpm publish-data.",
      );
    }

    /* One bucket per token: the fetch count is the word count, which is what
       keeps a search to one or three round trips. */
    const perToken: Map<string, Candidate>[] = [];
    for (const token of tokens) {
      const key = bucketFor(token, index);
      const candidates = new Map<string, Candidate>();
      let strong = false;
      if (key) {
        const bucket = await loadBucket(key);
        if (bucket) strong = scoreToken(bucket, token, candidates);
      }

      /* No strong match in the shard the token routed to. When the
         two-character prefix was split, the word it meant may live in a
         sibling: "trsh" routes to "tr_" while "trash" sits in "tra". The fuzzy
         map says which sibling, so this costs one extra fetch and only on a
         query that did not already find what it was looking for. */
      if (!strong && token.length >= MIN_FUZZY_LENGTH) {
        const parent = token.length >= 2 ? token.slice(0, 2) : `${token}_`;
        const map = await loadFuzzyMap(parent);
        if (map) {
          const wanted = new Set<string>();
          for (const [term, bucketKey] of Object.entries(map)) {
            if (bucketKey === key) continue;
            if (withinDistance(token, term, 2) === null) continue;
            wanted.add(bucketKey);
            if (wanted.size >= MAX_FUZZY_FALLBACK_BUCKETS) break;
          }
          for (const bucketKey of wanted) {
            const bucket = await loadBucket(bucketKey);
            if (bucket) scoreToken(bucket, token, candidates);
          }
        }
      }

      perToken.push(candidates);
    }

    /* Union, ranked by how many tokens matched.
       An intersection would be the obvious choice, but posting lists are
       capped at 300 per term, so intersecting two common words compares two
       truncated lists and returns almost nothing - "arrow right" found 32
       icons that way. Taking the union and sorting by matched-token count
       puts every icon matching both words first anyway, then degrades into
       partial matches instead of a near-empty page. */
    const merged = new Map<string, Candidate>();
    for (const candidates of perToken) {
      for (const [id, candidate] of candidates) {
        const existing = merged.get(id);
        if (existing) {
          existing.score += candidate.score;
          existing.matched += 1;
        } else {
          merged.set(id, { ...candidate });
        }
      }
    }

    /* Reward the name being exactly what was typed.
       Document quality rewards tier and set size, and nothing rewarded the
       name matching the query completely - so "arrow right" led with
       tabler:arrow-right and then filled the page with arrow-right-01..05
       from one large set, while every other set's plain arrow-right sat
       below. An icon literally called what you searched for is the answer,
       whichever set drew it, so it sorts ahead of everything else. */
    const wanted = tokens.join("-");
    for (const candidate of merged.values()) {
      candidate.wholeName = candidate.doc[1].toLowerCase() === wanted;
    }

    const category = query.category
      ? ((await loadCategory(query.category)) ?? EMPTY_CATEGORY)
      : null;
    const filtered = [...merged.values()].filter((candidate) =>
      passesFilters(candidate.doc, query, category),
    );

    filtered.sort(
      (a, b) =>
        Number(b.wholeName) - Number(a.wholeName) ||
        b.matched - a.matched ||
        b.score - a.score ||
        a.doc[0].localeCompare(b.doc[0]) ||
        a.doc[1].localeCompare(b.doc[1]),
    );

    const page = filtered.slice(query.offset, query.offset + query.limit);
    const names = new Map(
      (await loadSetList()).map((set) => [set.prefix, set.name]),
    );

    return {
      hits: page.map((candidate) =>
        toHit(candidate.doc, names.get(candidate.doc[0]) ?? candidate.doc[0]),
      ),
      total: filtered.length,
      facets: collectFacets(filtered.map((candidate) => candidate.doc)),
      tookMs: Date.now() - started,
    };
  },
};

/** Exposed for the parity harness so it can report what a query actually hit. */
export async function bucketsForQuery(query: string): Promise<string[]> {
  const index = await shardIndex();
  if (!index) return [];
  return normalize(query)
    .map((token) => bucketFor(token, index))
    .filter((key): key is string => key !== null);
}

export { getSet };
