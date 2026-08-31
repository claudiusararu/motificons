/**
 * Reads @iconify/json and emits the local data the app, search index and MCP
 * server run on. One set at a time: some set files are ~100MB, so nothing is
 * ever held across iterations and no combined icon list is built in memory.
 *
 * Output is deterministic - every list is sorted - so a re-run produces a
 * byte-identical tree unless the upstream data actually changed.
 */

import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { isBrandSet, licensePolicy } from "./licenses.ts";
import { classifySet, SPIKE_EXPECTED_TIERS, type Tier } from "./tiers.ts";
import type {
  IconDoc,
  IconifyJSON,
  IconifyInfo,
  SetMetadata,
  Stats,
} from "./types.ts";

const require = createRequire(import.meta.url);
const DATA_DIR = dirname(require.resolve("@iconify/json/collections.json"));
const JSON_DIR = join(DATA_DIR, "json");
const OUT_DIR = new URL("../dist/", import.meta.url).pathname;

/** Lines are batched so a 16k-icon set is a handful of writes, not 16k. */
const FLUSH_EVERY = 512;

class JsonlWriter {
  #stream: WriteStream;
  #buffer: string[] = [];

  constructor(path: string) {
    this.#stream = createWriteStream(path, { encoding: "utf8" });
  }

  async write(line: string): Promise<void> {
    this.#buffer.push(line);
    if (this.#buffer.length >= FLUSH_EVERY) await this.#flush();
  }

  async #flush(): Promise<void> {
    if (this.#buffer.length === 0) return;
    const chunk = this.#buffer.join("");
    this.#buffer = [];
    if (!this.#stream.write(chunk)) await once(this.#stream, "drain");
  }

  async close(): Promise<void> {
    await this.#flush();
    this.#stream.end();
    await once(this.#stream, "finish");
  }
}

/** Aliases can point at other aliases; walk to the real icon. */
function resolveAliases(
  aliases: Record<string, { parent: string }> | undefined,
  icons: Record<string, unknown>,
): Map<string, string[]> {
  const byIcon = new Map<string, string[]>();
  if (!aliases) return byIcon;

  for (const name of Object.keys(aliases)) {
    let target = aliases[name]?.parent;
    for (let hop = 0; hop < 8 && target && !(target in icons); hop += 1) {
      target = aliases[target]?.parent;
    }
    if (!target || !(target in icons)) continue;
    const list = byIcon.get(target);
    if (list) list.push(name);
    else byIcon.set(target, [name]);
  }

  for (const list of byIcon.values()) list.sort();
  return byIcon;
}

function invertCategories(
  categories: Record<string, string[]> | undefined,
): Map<string, string[]> {
  const byIcon = new Map<string, string[]>();
  if (!categories) return byIcon;

  for (const category of Object.keys(categories).sort()) {
    for (const name of categories[category] ?? []) {
      const list = byIcon.get(name);
      if (list) list.push(category);
      else byIcon.set(name, [category]);
    }
  }

  for (const list of byIcon.values()) list.sort();
  return byIcon;
}

/**
 * Style comes from the set's own prefix/suffix maps - the only style signal
 * Iconify actually ships. Longest match wins so "outline-rounded" does not
 * lose to "rounded".
 */
function styleResolver(data: IconifyJSON): (name: string) => string | null {
  const suffixes = Object.entries(data.suffixes ?? {})
    .filter(([key]) => key !== "")
    .sort((a, b) => b[0].length - a[0].length);
  const prefixes = Object.entries(
    (data as { prefixes?: Record<string, string> }).prefixes ?? {},
  )
    .filter(([key]) => key !== "")
    .sort((a, b) => b[0].length - a[0].length);
  const fallback = data.suffixes?.[""] ?? null;

  if (suffixes.length === 0 && prefixes.length === 0) return () => null;

  return (name: string) => {
    for (const [suffix, label] of suffixes) {
      if (name.endsWith(`-${suffix}`)) return label;
    }
    for (const [prefix, label] of prefixes) {
      if (name.startsWith(`${prefix}-`)) return label;
    }
    return fallback;
  };
}

function styleLabels(data: IconifyJSON): string[] {
  const labels = new Set<string>();
  for (const label of Object.values(data.suffixes ?? {})) labels.add(label);
  for (const label of Object.values(
    (data as { prefixes?: Record<string, string> }).prefixes ?? {},
  )) {
    labels.add(label);
  }
  return [...labels].sort();
}

async function listPrefixes(
  collections: Record<string, IconifyInfo>,
): Promise<string[]> {
  const files = await readdir(JSON_DIR);
  const fromFiles = files
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length));
  return [...new Set([...Object.keys(collections), ...fromFiles])].sort();
}

async function main(): Promise<void> {
  const started = Date.now();
  const collections = JSON.parse(
    await readFile(join(DATA_DIR, "collections.json"), "utf8"),
  ) as Record<string, IconifyInfo>;
  const iconifyVersion = (
    JSON.parse(
      await readFile(join(DATA_DIR, "package.json"), "utf8"),
    ) as { version: string }
  ).version;

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(join(OUT_DIR, "sets"), { recursive: true });
  await mkdir(join(OUT_DIR, "icons"), { recursive: true });
  await mkdir(join(OUT_DIR, "bodies"), { recursive: true });

  const prefixes = await listPrefixes(collections);
  const sets: SetMetadata[] = [];
  /* Category -> icons and the sets that use it. Aggregated while streaming so
     the categories pages never have to scan 337k documents at request time. */
  const categories = new Map<string, { icons: number; sets: Set<string> }>();
  /* Category -> its icons, so category pages read one file instead of asking
     a search engine to reconstruct a list the pipeline already knows. */
  const categoryIcons = new Map<string, string[]>();
  const skipped: string[] = [];
  let totalIcons = 0;
  let totalAliases = 0;
  let noAttributionIcons = 0;

  for (const prefix of prefixes) {
    let data: IconifyJSON;
    try {
      data = JSON.parse(
        await readFile(join(JSON_DIR, `${prefix}.json`), "utf8"),
      ) as IconifyJSON;
    } catch {
      skipped.push(`${prefix} (no set file)`);
      continue;
    }

    const info = collections[prefix] ?? data.info;
    if (!info) {
      skipped.push(`${prefix} (no metadata)`);
      continue;
    }

    const iconNames = Object.keys(data.icons).sort();
    const tierResult = classifySet(
      data.icons as Record<string, { body: string }>,
    );
    const expectedTier = SPIKE_EXPECTED_TIERS[prefix];
    if (expectedTier && expectedTier !== tierResult.tier) {
      throw new Error(
        `Tier heuristic contradicts Spike S1 evidence: ${prefix} measured ${expectedTier}, classifier said ${tierResult.tier}`,
      );
    }
    const aliasesByIcon = resolveAliases(data.aliases, data.icons);
    const categoriesByIcon = invertCategories(data.categories);
    const styleOf = styleResolver(data);

    const policy = licensePolicy(info.license.spdx, info.license.title);
    const brand = isBrandSet(prefix, info.category);
    const palette = info.palette === true;
    const aliasCount = [...aliasesByIcon.values()].reduce(
      (sum, list) => sum + list.length,
      0,
    );

    const writer = new JsonlWriter(join(OUT_DIR, "icons", `${prefix}.jsonl`));
    /* Bodies live in their own store with a byte-offset index so the SVG
       endpoint can seek straight to one icon instead of parsing a set file
       that can be 99MB. */
    const bodyWriter = new JsonlWriter(
      join(OUT_DIR, "bodies", `${prefix}.jsonl`),
    );
    const bodyIndex: Record<string, [number, number]> = {};
    let bodyOffset = 0;

    for (const name of iconNames) {
      const entry = data.icons[name] as {
        body: string;
        width?: number;
        height?: number;
      };
      const bodyLine = `${JSON.stringify({
        body: entry.body,
        width: entry.width ?? data.width ?? 16,
        height: entry.height ?? data.height ?? 16,
      })}\n`;
      const bodyBytes = Buffer.byteLength(bodyLine, "utf8");
      bodyIndex[name] = [bodyOffset, bodyBytes - 1];
      bodyOffset += bodyBytes;
      await bodyWriter.write(bodyLine);
      const doc: IconDoc = {
        id: `${prefix}:${name}`,
        prefix,
        name,
        tier: tierResult.tier,
        aliases: aliasesByIcon.get(name) ?? [],
        categories: categoriesByIcon.get(name) ?? [],
        style: styleOf(name),
        palette,
        license: policy.spdx,
        attributionRequired: policy.attributionRequired,
        brand,
      };
      for (const category of doc.categories) {
        const entry = categories.get(category) ?? { icons: 0, sets: new Set() };
        entry.icons += 1;
        entry.sets.add(prefix);
        categories.set(category, entry);

        const list = categoryIcons.get(category);
        if (list) list.push(doc.id);
        else categoryIcons.set(category, [doc.id]);
      }

      await writer.write(`${JSON.stringify(doc)}\n`);
    }
    await writer.close();
    await bodyWriter.close();
    await writeFile(
      join(OUT_DIR, "bodies", `${prefix}.index.json`),
      JSON.stringify(bodyIndex),
    );

    const height = Array.isArray(info.height) ? info.height[0] : info.height;
    const metadata: SetMetadata = {
      prefix,
      tier: tierResult.tier,
      tierEvidence: {
        blockedShare: Number(tierResult.blockedShare.toFixed(3)),
        multicolorShare: Number(tierResult.multicolorShare.toFixed(3)),
        strokedShare: Number(tierResult.strokedShare.toFixed(3)),
        sampled: tierResult.sampled,
      },
      name: info.name,
      author: { name: info.author.name, url: info.author.url ?? "" },
      license: {
        title: info.license.title,
        spdx: info.license.spdx ?? "",
        url: info.license.url ?? "",
        policy,
      },
      attributionRequired: policy.attributionRequired,
      brand,
      category: info.category ?? null,
      tags: [...(info.tags ?? [])].sort(),
      palette,
      height: height ?? null,
      version: info.version ?? null,
      icons: iconNames.length,
      aliases: aliasCount,
      declaredTotal: info.total ?? null,
      styles: styleLabels(data),
      samples: (info.samples ?? iconNames).slice(0, 6),
      /* Resolved here so /sets and every other browse grid can render six real
         glyphs per set without touching the body store at request time. */
      sampleGlyphs: (info.samples ?? iconNames)
        .slice(0, 6)
        .map((sampleName) => {
          const entry = data.icons[sampleName] as
            | { body: string; width?: number; height?: number }
            | undefined;
          if (!entry) return null;
          return {
            name: sampleName,
            body: entry.body,
            width: entry.width ?? data.width ?? 16,
            height: entry.height ?? data.height ?? 16,
          };
        })
        .filter((glyph) => glyph !== null),
    };

    await writeFile(
      join(OUT_DIR, "sets", `${prefix}.json`),
      `${JSON.stringify(metadata, null, 2)}\n`,
    );

    sets.push(metadata);
    totalIcons += metadata.icons;
    totalAliases += metadata.aliases;
    if (!policy.attributionRequired) noAttributionIcons += metadata.icons;
  }

  sets.sort((a, b) => a.prefix.localeCompare(b.prefix));

  const byLicense = new Map<string, { sets: number; icons: number }>();
  for (const set of sets) {
    const entry = byLicense.get(set.license.policy.spdx) ?? {
      sets: 0,
      icons: 0,
    };
    entry.sets += 1;
    entry.icons += set.icons;
    byLicense.set(set.license.policy.spdx, entry);
  }

  const stats: Stats = {
    generatedAt: new Date().toISOString(),
    iconifyVersion,
    totals: {
      sets: sets.length,
      icons: totalIcons,
      aliases: totalAliases,
      brandSets: sets.filter((set) => set.brand).length,
      noAttributionIcons,
      categories: categories.size,
    },
    perSet: sets.map((set) => ({
      prefix: set.prefix,
      icons: set.icons,
      aliases: set.aliases,
      tier: set.tier,
    })),
    byTier: (["T1", "T2", "T3", "T4"] as Tier[]).map((tier) => ({
      tier,
      sets: sets.filter((set) => set.tier === tier).length,
      icons: sets
        .filter((set) => set.tier === tier)
        .reduce((sum, set) => sum + set.icons, 0),
    })),
    byLicense: [...byLicense.entries()]
      .map(([spdx, entry]) => ({ spdx, ...entry }))
      .sort((a, b) => b.icons - a.icons || a.spdx.localeCompare(b.spdx)),
  };

  await writeFile(
    join(OUT_DIR, "sets.json"),
    `${JSON.stringify(sets, null, 2)}\n`,
  );
  /* Slugs are derived, so collisions are possible in principle ("UI Actions"
     and "UI-Actions" both slugify to ui-actions). Sorting first and
     disambiguating with a counter keeps the result deterministic. */
  const usedSlugs = new Set<string>();
  const categoryList = [...categories.entries()]
    .sort((a, b) => b[1].icons - a[1].icons || a[0].localeCompare(b[0]))
    .map(([tag, entry]) => {
      const base =
        tag
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "tag";
      let slug = base;
      for (let n = 2; usedSlugs.has(slug); n += 1) slug = `${base}-${n}`;
      usedSlugs.add(slug);
      return {
        tag,
        slug,
        icons: entry.icons,
        sets: [...entry.sets].sort(),
      };
    });

  await mkdir(join(OUT_DIR, "categories"), { recursive: true });
  for (const entry of categoryList) {
    await writeFile(
      join(OUT_DIR, "categories", `${entry.slug}.json`),
      JSON.stringify(categoryIcons.get(entry.tag) ?? []),
    );
  }

  await writeFile(
    join(OUT_DIR, "categories.json"),
    `${JSON.stringify(categoryList, null, 2)}\n`,
  );

  await writeFile(
    join(OUT_DIR, "stats.json"),
    `${JSON.stringify(stats, null, 2)}\n`,
  );
  await writeFile(
    join(OUT_DIR, "licenses.json"),
    `${JSON.stringify(
      {
        generatedAt: stats.generatedAt,
        licenses: [...byLicense.keys()].sort().map((spdx) => {
          const set = sets.find((item) => item.license.policy.spdx === spdx)!;
          return {
            ...set.license.policy,
            sets: byLicense.get(spdx)!.sets,
            icons: byLicense.get(spdx)!.icons,
          };
        }),
        attributionRequiredSets: sets
          .filter((set) => set.attributionRequired)
          .map((set) => set.prefix),
        brandSets: sets.filter((set) => set.brand).map((set) => set.prefix),
        unknownLicenseSets: sets
          .filter((set) => set.license.policy.unknown)
          .map((set) => ({ prefix: set.prefix, license: set.license.title })),
      },
      null,
      2,
    )}\n`,
  );

  report(stats, skipped, Date.now() - started);
}

function report(stats: Stats, skipped: string[], elapsedMs: number): void {
  const n = (value: number) => value.toLocaleString("en-US");
  const top = [...stats.perSet].sort((a, b) => b.icons - a.icons).slice(0, 5);

  console.log("");
  console.log("Motificons icon pipeline");
  console.log("------------------------");
  console.log(`  sets                 ${n(stats.totals.sets)}`);
  console.log(`  icons                ${n(stats.totals.icons)}`);
  console.log(`  aliases              ${n(stats.totals.aliases)}`);
  console.log(`  brand sets           ${n(stats.totals.brandSets)}`);
  console.log(
    `  no-attribution icons ${n(stats.totals.noAttributionIcons)} (${Math.round(
      (stats.totals.noAttributionIcons / stats.totals.icons) * 100,
    )}%)`,
  );
  console.log(`  @iconify/json        ${stats.iconifyVersion}`);
  console.log("");
  console.log("  largest sets");
  for (const set of top) {
    console.log(`    ${set.prefix.padEnd(20)} ${n(set.icons).padStart(7)}`);
  }
  console.log("");
  console.log(`  categories           ${n(stats.totals.categories)}`);
  console.log("");
  console.log("  capability tiers");
  for (const row of stats.byTier) {
    console.log(
      `    ${row.tier}  ${n(row.icons).padStart(7)} icons  ${String(row.sets).padStart(3)} sets`,
    );
  }
  console.log("");
  console.log("  licenses by icon count");
  for (const row of stats.byLicense.slice(0, 8)) {
    console.log(
      `    ${row.spdx.padEnd(20)} ${n(row.icons).padStart(7)}  ${row.sets} sets`,
    );
  }
  if (skipped.length > 0) {
    console.log("");
    console.log(`  skipped: ${skipped.join(", ")}`);
  }
  console.log("");
  console.log(`  done in ${(elapsedMs / 1000).toFixed(1)}s -> pipeline/dist`);
  console.log("");
}

await main();
