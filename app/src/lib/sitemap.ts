/**
 * Sitemap generation.
 *
 * Served on demand rather than written at build. With 337k icon URLs plus the
 * image sitemap, building them would add roughly 100MB to dist and seconds to
 * every build, to produce files a crawler fetches a few times a day. On demand
 * with a 24h shared cache costs one generation per day per shard, and the
 * output is automatically correct after a re-sync without rebuilding the app.
 *
 * Shard order is the launch order: sets are
 * ranked by capability tier first, then by size, so the first shards carry the
 * highest-value URLs. If a crawler only ever gets through shard 1, it should
 * have seen tabler and material-symbols, not an archive of unmaintained flags.
 */

import { loadSets, loadStats, listIconNames, type Tier } from "./data";
import { absolute, iconImageUrl, xmlEscape } from "./seo";

/** The protocol maximum. Kept as the shard size so counts are predictable. */
export const SHARD_SIZE = 50_000;

const TIER_RANK: Record<Tier, number> = { T1: 0, T2: 1, T3: 2, T4: 3 };

export interface IconRef {
  prefix: string;
  name: string;
}

let orderedPromise: Promise<IconRef[]> | null = null;
let imagePromise: Promise<IconRef[]> | null = null;

async function rankedPrefixes(): Promise<{ prefix: string; tier: Tier }[]> {
  const sets = [...(await loadSets()).values()];
  return sets
    .sort(
      (a, b) =>
        TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
        b.icons - a.icons ||
        a.prefix.localeCompare(b.prefix),
    )
    .map((set) => ({ prefix: set.prefix, tier: set.tier }));
}

/**
 * Every icon URL in launch order. Built once per process: reading 239 index
 * files costs about a second, and every shard request after that is a slice.
 */
export function orderedIcons(): Promise<IconRef[]> {
  orderedPromise ??= (async () => {
    const out: IconRef[] = [];
    for (const { prefix } of await rankedPrefixes()) {
      for (const name of await listIconNames(prefix)) out.push({ prefix, name });
    }
    return out;
  })();
  return orderedPromise;
}

/** T1 and T2 only - the icons whose previews are worth a rasterization. */
export function imageIcons(): Promise<IconRef[]> {
  imagePromise ??= (async () => {
    const out: IconRef[] = [];
    for (const { prefix, tier } of await rankedPrefixes()) {
      if (tier !== "T1" && tier !== "T2") continue;
      for (const name of await listIconNames(prefix)) out.push({ prefix, name });
    }
    return out;
  })();
  return imagePromise;
}

export function shardCount(total: number): number {
  return Math.max(1, Math.ceil(total / SHARD_SIZE));
}

export async function lastmod(): Promise<string> {
  return (await loadStats()).generatedAt;
}

export interface UrlEntry {
  loc: string;
  lastmod?: string;
  changefreq?: "daily" | "weekly" | "monthly" | "yearly";
  priority?: string;
  image?: { loc: string; title: string };
}

export function renderUrlset(entries: UrlEntry[]): string {
  const hasImages = entries.some((entry) => entry.image);
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${
      hasImages
        ? ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"'
        : ""
    }>`,
  ];

  for (const entry of entries) {
    lines.push("<url>");
    lines.push(`<loc>${xmlEscape(entry.loc)}</loc>`);
    if (entry.lastmod) lines.push(`<lastmod>${entry.lastmod}</lastmod>`);
    if (entry.changefreq) lines.push(`<changefreq>${entry.changefreq}</changefreq>`);
    if (entry.priority) lines.push(`<priority>${entry.priority}</priority>`);
    if (entry.image) {
      lines.push("<image:image>");
      lines.push(`<image:loc>${xmlEscape(entry.image.loc)}</image:loc>`);
      lines.push(`<image:title>${xmlEscape(entry.image.title)}</image:title>`);
      lines.push("</image:image>");
    }
    lines.push("</url>");
  }

  lines.push("</urlset>");
  return lines.join("\n");
}

export function renderSitemapIndex(
  maps: { loc: string; lastmod: string }[],
): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const map of maps) {
    lines.push("<sitemap>");
    lines.push(`<loc>${xmlEscape(map.loc)}</loc>`);
    lines.push(`<lastmod>${map.lastmod}</lastmod>`);
    lines.push("</sitemap>");
  }
  lines.push("</sitemapindex>");
  return lines.join("\n");
}

export function iconEntries(refs: IconRef[], modified: string): UrlEntry[] {
  return refs.map((ref) => ({
    loc: absolute(`/${ref.prefix}/${ref.name}`),
    lastmod: modified,
    changefreq: "monthly" as const,
    priority: "0.6",
  }));
}

export function imageEntries(refs: IconRef[], modified: string): UrlEntry[] {
  return refs.map((ref) => ({
    loc: absolute(`/${ref.prefix}/${ref.name}`),
    lastmod: modified,
    image: {
      loc: iconImageUrl(ref.prefix, ref.name),
      title: `${ref.name} icon`,
    },
  }));
}

/** Sitemaps are cheap to regenerate and stale ones are harmless. */
export const SITEMAP_HEADERS = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
} as const;
