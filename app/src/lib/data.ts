/**
 * Read access to the pipeline output.
 *
 * Split by size, not by kind:
 *
 *   Embedded  sets, stats, categories, licenses. About 1MB of JSON imported
 *             directly, so it is baked into the bundle. This is what lets
 *             prerendering behave identically in Node at build time and in
 *             workerd at request time, and it saves a round trip on every
 *             page that needs a set name.
 *   Storage   icon bodies. 421MB, read one byte range at a time through the
 *             R2 (or dev disk) driver.
 */

import setsJson from "../../../pipeline/dist/sets.json";
import statsJson from "../../../pipeline/dist/stats.json";
import categoriesJson from "../../../pipeline/dist/categories.json";
import licensesJson from "../../../pipeline/dist/licenses.json";
import { storage } from "./storage";

export type Tier = "T1" | "T2" | "T3" | "T4";

export interface LicensePolicy {
  spdx: string;
  name: string;
  url: string;
  attributionRequired: boolean;
  noticeRequired: boolean;
  shareAlike: boolean;
  nonCommercial: boolean;
  unknown: boolean;
}

export interface SetMetadata {
  prefix: string;
  tier: Tier;
  tierEvidence: {
    blockedShare: number;
    multicolorShare: number;
    strokedShare: number;
    sampled: number;
  };
  name: string;
  author: { name: string; url: string };
  license: { title: string; spdx: string; url: string; policy: LicensePolicy };
  attributionRequired: boolean;
  brand: boolean;
  category: string | null;
  tags: string[];
  palette: boolean;
  height: number | null;
  version: string | null;
  icons: number;
  aliases: number;
  declaredTotal: number | null;
  styles: string[];
  samples: string[];
  sampleGlyphs: { name: string; body: string; width: number; height: number }[];
}

export interface Stats {
  generatedAt: string;
  iconifyVersion: string;
  totals: {
    sets: number;
    icons: number;
    aliases: number;
    brandSets: number;
    noAttributionIcons: number;
    categories: number;
  };
  perSet: { prefix: string; icons: number; aliases: number; tier: Tier }[];
  byTier: { tier: Tier; sets: number; icons: number }[];
}

export interface CategoryEntry {
  tag: string;
  slug: string;
  icons: number;
  sets: string[];
}

export interface LicenseSummary extends LicensePolicy {
  sets: number;
  icons: number;
}

export interface LicensesFile {
  generatedAt: string;
  licenses: LicenseSummary[];
  attributionRequiredSets: string[];
  brandSets: string[];
  unknownLicenseSets: { prefix: string; license: string }[];
}

export interface IconSource {
  prefix: string;
  name: string;
  body: string;
  width: number;
  height: number;
}

const SETS = setsJson as unknown as SetMetadata[];
const SET_MAP = new Map(SETS.map((set) => [set.prefix, set]));
const STATS = statsJson as unknown as Stats;
const CATEGORIES = categoriesJson as unknown as CategoryEntry[];
const LICENSES = licensesJson as unknown as LicensesFile;

export async function loadSets(): Promise<Map<string, SetMetadata>> {
  return SET_MAP;
}

export async function loadSetList(): Promise<SetMetadata[]> {
  return SETS;
}

export async function getSet(prefix: string): Promise<SetMetadata | null> {
  return SET_MAP.get(prefix) ?? null;
}

export async function loadStats(): Promise<Stats> {
  return STATS;
}

export async function loadCategories(): Promise<CategoryEntry[]> {
  return CATEGORIES;
}

export async function getCategory(slug: string): Promise<CategoryEntry | null> {
  return CATEGORIES.find((entry) => entry.slug === slug) ?? null;
}

export async function loadLicenses(): Promise<LicensesFile> {
  return LICENSES;
}

/** Both segments end up in an object key, so nothing else is accepted. */
const SAFE = /^[a-zA-Z0-9._-]+$/;

export function isSafeSegment(value: string): boolean {
  return SAFE.test(value) && !value.includes("..");
}

/* Body offset indexes are per set and small; cached for the isolate's life. */
const indexCache = new Map<string, Record<string, [number, number]> | null>();

async function bodyIndex(
  prefix: string,
): Promise<Record<string, [number, number]> | null> {
  const cached = indexCache.get(prefix);
  if (cached !== undefined) return cached;

  const raw = await (await storage()).text(`bodies/${prefix}.index.json`);
  const parsed = raw
    ? (JSON.parse(raw) as Record<string, [number, number]>)
    : null;
  indexCache.set(prefix, parsed);
  return parsed;
}

export async function getIcon(
  prefix: string,
  name: string,
): Promise<IconSource | null> {
  if (!isSafeSegment(prefix) || !isSafeSegment(name)) return null;

  const index = await bodyIndex(prefix);
  const entry = index?.[name];
  if (!entry) return null;

  const [offset, length] = entry;
  const raw = await (await storage()).range(
    `bodies/${prefix}.jsonl`,
    offset,
    length,
  );
  if (!raw) return null;

  const icon = JSON.parse(raw) as {
    body: string;
    width: number;
    height: number;
  };
  return { prefix, name, ...icon };
}

/** Icon names in a set, for grids, load-more and sitemaps. */
export async function listIconNames(prefix: string): Promise<string[]> {
  const index = await bodyIndex(prefix);
  return index ? Object.keys(index) : [];
}
