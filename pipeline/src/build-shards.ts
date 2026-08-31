/**
 * Builds the prebuilt search index that runs at the edge.
 *
 * SPEC section 6: D1 is explicitly not the search engine, and per-query
 * database reads at 337k scale are both slow and billable. Instead the
 * pipeline pre-computes everything a query needs into small immutable shards,
 * and the search Worker fetches one to three of them, scores in memory and
 * answers. Hot shards live in the edge cache, so most queries touch nothing
 * billable at all.
 *
 * BUCKETING
 *
 * A term goes in the bucket named by its first two characters. A query token
 * therefore needs exactly one bucket, and a two-word query needs two - which
 * is what keeps a search to one or three fetches rather than a scan.
 *
 * Buckets that grow past MAX_BUCKET_POSTINGS split by third character, so
 * "co" becomes "co", "coa", "cob" and so on. Without that, common English
 * openings would produce a handful of megabyte shards while the rest sat at a
 * few kilobytes.
 *
 * Typo tolerance comes free from this shape: "arow" and "camra" share their
 * first two characters with "arrow" and "camera", so the right bucket is
 * already in hand and the Worker matches within it by edit distance. Typos in
 * the first two characters are the known gap; the parity report measures how
 * much that costs before anything is built to fix it.
 *
 * RANKING
 *
 * Weights are document quality, computed once here: which field matched, how
 * early the token appears, capability tier, set size, name length. Match
 * quality - exact versus prefix versus fuzzy - is a query-time multiplier the
 * Worker applies, because only the Worker knows what was typed.
 */

import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import type { IconDoc, SetMetadata } from "./types.ts";
import type { Tier } from "./tiers.ts";

const DIST = new URL("../dist/", import.meta.url).pathname;
const OUT = join(DIST, "shards");

/** Postings kept per term. Nobody pages past this; the tail is noise. */
const MAX_POSTINGS_PER_TERM = 300;
/** Above this, a bucket splits by third character. */
const MAX_BUCKET_POSTINGS = 4000;

const TIER_BOOST: Record<Tier, number> = { T1: 12, T2: 8, T3: 4, T4: 0 };

/** Field the term came from, in descending trustworthiness. */
const FIELD_WEIGHT = { name: 100, alias: 70, category: 40 } as const;
type Field = keyof typeof FIELD_WEIGHT;

export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Two characters, padded so single-character terms still land somewhere. */
export function bucketOf(term: string): string {
  return term.length >= 2 ? term.slice(0, 2) : `${term}_`;
}

interface Posting {
  /** Index into the bucket's own document table. */
  doc: number;
  weight: number;
}

interface DocRecord {
  prefix: string;
  name: string;
  tier: Tier;
  style: string | null;
  license: string;
  attributionRequired: boolean;
  brand: boolean;
  width: number;
  height: number;
}

/**
 * Serialized document: positional, not keyed, because the field names would
 * otherwise be the largest thing in the file. Flags pack into one integer.
 */
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

function packDoc(doc: DocRecord): PackedDoc {
  return [
    doc.prefix,
    doc.name,
    doc.tier,
    doc.style,
    doc.license,
    (doc.attributionRequired ? FLAG_ATTRIBUTION : 0) |
      (doc.brand ? FLAG_BRAND : 0),
    doc.width,
    doc.height,
  ];
}

function documentWeight(
  doc: IconDoc,
  set: SetMetadata,
  field: Field,
  tokenIndex: number,
  isWholeName: boolean,
): number {
  let weight = FIELD_WEIGHT[field];

  /* An icon literally called "star" should beat "star-filled-half" for the
     query "star", whichever set it came from. */
  if (isWholeName) weight += 100;

  /* Earlier tokens carry the subject: "arrow-right" is an arrow first. */
  weight -= Math.min(tokenIndex * 5, 25);

  weight += TIER_BOOST[doc.tier];

  /* A gentle nudge toward larger, better-maintained sets. Logarithmic so a
     15k-icon set edges out a 200-icon one without burying it. */
  weight += Math.min(Math.log10(Math.max(set.icons, 1)) * 3, 15);

  /* Shorter names are usually the canonical form of an idea. */
  weight -= Math.min(doc.name.length / 4, 12);

  return Math.round(weight * 100) / 100;
}

interface BucketBuilder {
  docs: Map<string, number>;
  packed: PackedDoc[];
  terms: Map<string, Posting[]>;
}

function emptyBucket(): BucketBuilder {
  return { docs: new Map(), packed: [], terms: new Map() };
}

async function main(): Promise<void> {
  const started = Date.now();

  const sets = JSON.parse(
    await readFile(join(DIST, "sets.json"), "utf8"),
  ) as SetMetadata[];
  const setMap = new Map(sets.map((set) => [set.prefix, set]));

  /* term -> postings, accumulated globally first so the cap is applied to the
     true top 300 rather than to whatever happened to be read first. */
  const postings = new Map<string, { doc: DocRecord; weight: number }[]>();

  const files = (await readdir(join(DIST, "icons")))
    .filter((file) => file.endsWith(".jsonl"))
    .sort();

  let docCount = 0;

  for (const file of files) {
    const reader = createInterface({
      input: createReadStream(join(DIST, "icons", file)),
      crlfDelay: Infinity,
    });

    for await (const line of reader) {
      if (!line) continue;
      const doc = JSON.parse(line) as IconDoc;
      const set = setMap.get(doc.prefix);
      if (!set) continue;
      docCount += 1;

      const record: DocRecord = {
        prefix: doc.prefix,
        name: doc.name,
        tier: doc.tier,
        style: doc.style,
        license: doc.license,
        attributionRequired: doc.attributionRequired,
        brand: doc.brand,
        /* The set's grid. Per-icon overrides live in the body store, which the
           search response does not read - it returns body: null and the client
           fetches /api/icon. Zero here would produce viewBox="0 0 0 0" the
           moment anything did try to inline a body. */
        width: set.height ?? 24,
        height: set.height ?? 24,
      };

      /* One entry per (term, field) pair, best weight wins, so an icon whose
         name and alias share a token is not counted twice. */
      const best = new Map<string, number>();

      const consider = (value: string, field: Field) => {
        const tokens = tokenize(value);
        const whole = tokens.join("");
        tokens.forEach((token, index) => {
          const isWholeName =
            field === "name" && (tokens.length === 1 || token === whole);
          const weight = documentWeight(doc, set, field, index, isWholeName);
          const current = best.get(token);
          if (current === undefined || weight > current) best.set(token, weight);
        });
      };

      consider(doc.name, "name");
      for (const alias of doc.aliases) consider(alias, "alias");
      for (const category of doc.categories) consider(category, "category");

      for (const [term, weight] of best) {
        const list = postings.get(term);
        if (list) list.push({ doc: record, weight });
        else postings.set(term, [{ doc: record, weight }]);
      }
    }
  }

  /* Cap and sort. Deterministic tie-break so two runs agree byte for byte. */
  const terms = [...postings.keys()].sort();
  for (const term of terms) {
    const list = postings.get(term)!;
    list.sort(
      (a, b) =>
        b.weight - a.weight ||
        a.doc.prefix.localeCompare(b.doc.prefix) ||
        a.doc.name.localeCompare(b.doc.name),
    );
    if (list.length > MAX_POSTINGS_PER_TERM) {
      postings.set(term, list.slice(0, MAX_POSTINGS_PER_TERM));
    }
  }

  /* Assign buckets, splitting the heavy ones by third character. */
  const load = new Map<string, number>();
  for (const term of terms) {
    const key = bucketOf(term);
    load.set(key, (load.get(key) ?? 0) + postings.get(term)!.length);
  }
  const split = new Set(
    [...load.entries()]
      .filter(([, count]) => count > MAX_BUCKET_POSTINGS)
      .map(([key]) => key),
  );

  const bucketFor = (term: string): string => {
    const base = bucketOf(term);
    if (!split.has(base)) return base;
    return term.length >= 3 ? term.slice(0, 3) : `${base}_`;
  };

  const buckets = new Map<string, BucketBuilder>();
  for (const term of terms) {
    const key = bucketFor(term);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = emptyBucket();
      buckets.set(key, bucket);
    }

    const list: Posting[] = [];
    for (const entry of postings.get(term)!) {
      const id = `${entry.doc.prefix}:${entry.doc.name}`;
      let index = bucket.docs.get(id);
      if (index === undefined) {
        index = bucket.packed.length;
        bucket.docs.set(id, index);
        bucket.packed.push(packDoc(entry.doc));
      }
      list.push({ doc: index, weight: entry.weight });
    }
    bucket.terms.set(term, list);
  }

  await rm(OUT, { recursive: true, force: true });
  await mkdir(join(OUT, "terms"), { recursive: true });

  const index: Record<string, { terms: number; docs: number; bytes: number }> =
    {};
  let totalBytes = 0;
  let totalPostings = 0;

  for (const key of [...buckets.keys()].sort()) {
    const bucket = buckets.get(key)!;

    /* Facet aggregates for the whole bucket. The Worker computes exact facets
       from the documents it actually matched; these describe the bucket as a
       whole, which is what a filter-only request needs. */
    const facets: Record<string, Record<string, number>> = {
      prefix: {},
      tier: {},
      license: {},
      style: {},
    };
    for (const doc of bucket.packed) {
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

    const termTable: Record<string, [number, number][]> = {};
    for (const term of [...bucket.terms.keys()].sort()) {
      termTable[term] = bucket.terms
        .get(term)!
        .map((posting) => [posting.doc, posting.weight]);
      totalPostings += bucket.terms.get(term)!.length;
    }

    const payload = JSON.stringify({
      b: key,
      d: bucket.packed,
      t: termTable,
      f: facets,
    });

    await writeFile(join(OUT, "terms", `${key}.json`), payload);
    const bytes = Buffer.byteLength(payload, "utf8");
    totalBytes += bytes;
    index[key] = {
      terms: bucket.terms.size,
      docs: bucket.packed.length,
      bytes,
    };
  }

  /* Fuzzy routing map, for split buckets only.
     Splitting by third character means a typo THERE routes to the wrong
     shard: "trash" lives in "tra" but "trsh" resolves to "tr_". The parity
     run measured 7 of 24 typo queries losing to exactly this. For every
     two-character prefix that was split, this records where each of its terms
     actually went, so a fuzzy miss can look the word up and fetch the right
     shard - one extra round trip, and only on queries that currently fail. */
  await mkdir(join(OUT, "fuzzy"), { recursive: true });
  let fuzzyBytes = 0;
  let fuzzyTerms = 0;

  const byParent = new Map<string, Record<string, string>>();
  for (const term of terms) {
    const parent = bucketOf(term);
    if (!split.has(parent)) continue;
    const table = byParent.get(parent) ?? {};
    table[term] = bucketFor(term);
    byParent.set(parent, table);
  }

  for (const parent of [...byParent.keys()].sort()) {
    const table = byParent.get(parent)!;
    const ordered: Record<string, string> = {};
    for (const term of Object.keys(table).sort()) ordered[term] = table[term]!;
    const payload = JSON.stringify(ordered);
    await writeFile(join(OUT, "fuzzy", `${parent}.json`), payload);
    fuzzyBytes += Buffer.byteLength(payload, "utf8");
    fuzzyTerms += Object.keys(ordered).length;
  }

  const meta = {
    generatedAt: new Date().toISOString(),
    scheme: {
      bucket: "first two characters of the term",
      split: `third character when a bucket exceeds ${MAX_BUCKET_POSTINGS} postings`,
      maxPostingsPerTerm: MAX_POSTINGS_PER_TERM,
      fuzzy: "edit distance within the fetched bucket",
    },
    buckets: Object.keys(index).length,
    terms: terms.length,
    postings: totalPostings,
    documents: docCount,
    bytes: totalBytes,
    fuzzy: {
      files: byParent.size,
      terms: fuzzyTerms,
      bytes: fuzzyBytes,
      parents: [...byParent.keys()].sort(),
    },
    index,
  };

  await writeFile(
    join(OUT, "index.json"),
    `${JSON.stringify(meta, null, 2)}\n`,
  );

  report(meta, Date.now() - started);
}

function report(
  meta: {
    buckets: number;
    terms: number;
    postings: number;
    bytes: number;
    fuzzy: { files: number; terms: number; bytes: number };
    index: Record<string, { terms: number; docs: number; bytes: number }>;
  },
  elapsedMs: number,
): void {
  const n = (value: number) => value.toLocaleString("en-US");
  const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)}KB`;
  const sizes = Object.values(meta.index)
    .map((entry) => entry.bytes)
    .sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] ?? 0;
  const p95 = sizes[Math.floor(sizes.length * 0.95)] ?? 0;
  const largest = Object.entries(meta.index)
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .slice(0, 6);

  console.log("");
  console.log("Motificons search shards");
  console.log("------------------------");
  console.log(`  buckets              ${n(meta.buckets)}`);
  console.log(`  terms                ${n(meta.terms)}`);
  console.log(`  postings             ${n(meta.postings)}`);
  console.log(`  total size           ${(meta.bytes / 1048576).toFixed(1)}MB`);
  console.log(
    `  fuzzy maps           ${n(meta.fuzzy.files)} files, ${n(meta.fuzzy.terms)} terms, ${(meta.fuzzy.bytes / 1024).toFixed(0)}KB`,
  );
  console.log(`  median bucket        ${kb(median)}`);
  console.log(`  p95 bucket           ${kb(p95)}`);
  console.log(`  largest bucket       ${kb(sizes[sizes.length - 1] ?? 0)}`);
  console.log("");
  console.log("  largest buckets");
  for (const [key, entry] of largest) {
    console.log(
      `    ${key.padEnd(6)} ${kb(entry.bytes).padStart(7)}  ${n(entry.terms).padStart(6)} terms  ${n(entry.docs).padStart(6)} docs`,
    );
  }
  console.log("");
  console.log(`  done in ${(elapsedMs / 1000).toFixed(1)}s -> pipeline/dist/shards`);
  console.log("");
}

await main();
