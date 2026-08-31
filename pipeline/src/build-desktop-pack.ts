// Builds the desktop app's offline pack: a single SQLite file with
// FTS5 search over icon names/aliases and deflate-compressed body chunks.
// Reads pipeline/dist (sync-icons.ts output); writes dist/desktop/pack.sqlite
// + pack-manifest.json (version = sha256, used by the app's background updater).
//
// Chunking: bodies are grouped per set in ~256KB raw chunks and deflated as a
// unit - within-set redundancy is what compresses (per-icon deflate loses it).
// The app inflates a chunk on first access and caches the decoded bodies.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { deflateRawSync } from "node:zlib";

const DIST = join(import.meta.dirname, "..", "dist");
const OUT_DIR = join(DIST, "desktop");
const PACK_PATH = join(OUT_DIR, "pack.sqlite");
const CHUNK_RAW_TARGET = 256 * 1024;

interface IconDoc {
  id: string;
  prefix: string;
  name: string;
  tier: string;
  aliases: string[];
  categories: string[];
  license: string;
  attributionRequired: boolean;
}

interface SetEntry {
  prefix: string;
  name: string;
  tier: string;
  license: { title: string; spdx: string };
  samples?: string[];
}

function tokens(value: string): string {
  return value.replace(/[-_:]/g, " ").toLowerCase();
}

function main(): void {
  const started = Date.now();
  mkdirSync(OUT_DIR, { recursive: true });
  rmSync(PACK_PATH, { force: true });

  const stats = JSON.parse(readFileSync(join(DIST, "stats.json"), "utf8"));
  const sets: SetEntry[] = JSON.parse(readFileSync(join(DIST, "sets.json"), "utf8"));
  const setByPrefix = new Map(sets.map((s) => [s.prefix, s]));
  // Per-icon docs carry category TAGS ("User Interface"); categories.json is
  // the tag -> slug/name registry (the web facet's source of truth, rule 8).
  const categories: { tag: string; slug: string; icons: number }[] = JSON.parse(
    readFileSync(join(DIST, "categories.json"), "utf8"),
  );
  const slugByTag = new Map(categories.map((c) => [c.tag, c.slug]));

  const db = new DatabaseSync(PACK_PATH);
  db.exec(`
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous = OFF;
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE sets (
      prefix TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      tier TEXT NOT NULL,
      license TEXT NOT NULL,
      attribution INTEGER NOT NULL,
      icon_count INTEGER NOT NULL,
      samples TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE icons (
      id INTEGER PRIMARY KEY,
      prefix TEXT NOT NULL,
      name TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      chunk INTEGER NOT NULL,
      pos INTEGER NOT NULL
    );
    CREATE TABLE chunks (id INTEGER PRIMARY KEY, data BLOB NOT NULL);
    CREATE TABLE categories (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon_count INTEGER NOT NULL
    );
    CREATE TABLE icon_category (
      icon_id INTEGER NOT NULL,
      slug TEXT NOT NULL,
      PRIMARY KEY (icon_id, slug)
    ) WITHOUT ROWID;
    CREATE INDEX idx_icon_category_slug ON icon_category (slug);
    CREATE VIRTUAL TABLE icon_fts USING fts5(terms, content='', tokenize='unicode61');
  `);

  const insertSet = db.prepare(
    "INSERT INTO sets (prefix, name, tier, license, attribution, icon_count, samples) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const insertIcon = db.prepare(
    "INSERT INTO icons (id, prefix, name, width, height, chunk, pos) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const insertChunk = db.prepare("INSERT INTO chunks (id, data) VALUES (?, ?)");
  const insertFts = db.prepare("INSERT INTO icon_fts (rowid, terms) VALUES (?, ?)");
  const insertCategory = db.prepare("INSERT INTO categories (slug, name, icon_count) VALUES (?, ?, ?)");
  const insertIconCategory = db.prepare(
    "INSERT OR IGNORE INTO icon_category (icon_id, slug) VALUES (?, ?)",
  );

  const prefixes = readdirSync(join(DIST, "icons"))
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => f.replace(/\.jsonl$/, ""))
    .sort();

  let iconId = 0;
  let chunkId = 0;
  let totalIcons = 0;

  db.exec("BEGIN");
  for (const prefix of prefixes) {
    const set = setByPrefix.get(prefix);
    if (!set) {
      console.warn(`skip ${prefix}: not in sets.json`);
      continue;
    }

    const docs: IconDoc[] = readFileSync(join(DIST, "icons", `${prefix}.jsonl`), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    const bodiesRaw = readFileSync(join(DIST, "bodies", `${prefix}.jsonl`), "utf8");
    const index: Record<string, [number, number]> = JSON.parse(
      readFileSync(join(DIST, "bodies", `${prefix}.index.json`), "utf8")
    );

    insertSet.run(
      prefix,
      set.name,
      set.tier,
      set.license.spdx,
      docs.some((d) => d.attributionRequired) ? 1 : 0,
      docs.length,
      JSON.stringify((set.samples ?? []).slice(0, 4)),
    );

    // Accumulate this set's bodies into ~256KB raw chunks.
    let chunkBodies: string[] = [];
    let chunkMeta: { doc: IconDoc; width: number; height: number }[] = [];
    let chunkRawBytes = 0;

    const flush = (): void => {
      if (chunkBodies.length === 0) return;
      chunkId += 1;
      insertChunk.run(chunkId, deflateRawSync(JSON.stringify(chunkBodies), { level: 9 }));
      for (let pos = 0; pos < chunkMeta.length; pos += 1) {
        const entry = chunkMeta[pos];
        if (!entry) continue;
        const { doc, width, height } = entry;
        iconId += 1;
        insertIcon.run(iconId, doc.prefix, doc.name, width, height, chunkId, pos);
        const terms = [tokens(doc.name), ...doc.aliases.map(tokens), ...doc.categories.map(tokens)]
          .filter(Boolean)
          .join(" ");
        insertFts.run(iconId, terms);
        for (const tag of doc.categories) {
          const slug = slugByTag.get(tag);
          if (slug) insertIconCategory.run(iconId, slug);
        }
      }
      chunkBodies = [];
      chunkMeta = [];
      chunkRawBytes = 0;
    };

    for (const doc of docs) {
      const span = index[doc.name];
      if (!span) continue;
      const record = JSON.parse(bodiesRaw.slice(span[0], span[0] + span[1])) as {
        body: string;
        width: number;
        height: number;
      };
      chunkBodies.push(record.body);
      chunkMeta.push({ doc, width: record.width, height: record.height });
      chunkRawBytes += record.body.length;
      totalIcons += 1;
      if (chunkRawBytes >= CHUNK_RAW_TARGET) flush();
    }
    flush();
  }

  for (const category of categories) {
    insertCategory.run(category.slug, category.tag, category.icons);
  }

  const setMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
  setMeta.run("generatedAt", stats.generatedAt);
  setMeta.run("iconifyVersion", stats.iconifyVersion);
  setMeta.run("icons", String(totalIcons));
  setMeta.run("sets", String(prefixes.length));
  db.exec("COMMIT");
  db.exec("VACUUM");
  db.close();

  const bytes = statSync(PACK_PATH).size;
  const sha256 = createHash("sha256").update(readFileSync(PACK_PATH)).digest("hex");
  const manifest = {
    version: sha256.slice(0, 16),
    sha256,
    bytes,
    icons: totalIcons,
    sets: prefixes.length,
    generatedAt: stats.generatedAt,
    builtAt: new Date().toISOString(),
  };
  writeFileSync(join(OUT_DIR, "pack-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const mb = (bytes / 1024 / 1024).toFixed(1);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`pack.sqlite: ${mb}MB, ${totalIcons} icons, ${prefixes.length} sets, ${chunkId} chunks, ${secs}s`);
}

main();
