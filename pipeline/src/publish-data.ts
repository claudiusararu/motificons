/**
 * Publishes pipeline output to R2.
 *
 * Four groups, publishable independently because they change at different
 * rates: `meta` (a few small JSON files), `shards` (the search index, ~1,700
 * objects, rebuilt whenever the library changes), `bodies` (the icon markup,
 * 478 objects, only changes on an upstream sync), and `categories` (per-
 * category id-list files, 477 objects, that back /category/<slug> pages and
 * the search page's category filter).
 *
 * Uploads go through the wrangler CLI rather than the S3 API so a deploy needs
 * nothing beyond `wrangler login` - no access keys to mint, store or rotate.
 * The cost is a process per object, so uploads run through a small pool.
 *
 *   pnpm publish-data                         everything, to the real bucket
 *   pnpm publish-data --local                 everything, to miniflare
 *   pnpm publish-data --only=shards,meta      just the search index
 *   pnpm publish-data --only=categories       just the per-category id lists
 *   pnpm publish-data --sets=tabler,mdi       limit bodies to these sets
 *   pnpm publish-data --dry-run               list what would be pushed
 */

import { spawn } from "node:child_process";
import { readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
/* Run from app/ so --local finds the same miniflare state the dev server and
   `wrangler dev` use, and so the bucket names resolve from app/wrangler.jsonc. */
const APP_DIR = fileURLToPath(new URL("../../app/", import.meta.url));
const WRANGLER = fileURLToPath(
  new URL("../node_modules/.bin/wrangler", import.meta.url),
);

const BUCKET_NAME = process.env["R2_BUCKET"] ?? "motificons-icons";
/* wrangler reads preview_bucket_name in local and preview mode, so seeding
   the production name locally puts the objects somewhere the Worker will
   never look. Matching its behaviour here is what makes --local actually
   exercise the same path production does. */
const PREVIEW_BUCKET =
  process.env["R2_PREVIEW_BUCKET"] ?? `${BUCKET_NAME}-preview`;

type Group = "meta" | "shards" | "bodies" | "categories";

interface Upload {
  key: string;
  file: string;
  group: Group;
  bytes: number;
}

interface Options {
  local: boolean;
  dryRun: boolean;
  groups: Set<Group>;
  sets: Set<string> | null;
  concurrency: number;
  limit: number | null;
}

function parseArgs(argv: string[]): Options {
  const flag = (name: string) =>
    argv.find((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
  const value = (name: string) => flag(name)?.split("=")[1];

  const only = value("only");
  const sets = value("sets");

  const local = Boolean(flag("local"));
  const limit = value("limit");

  return {
    local,
    dryRun: Boolean(flag("dry-run")),
    groups: new Set(
      (only
        ? only.split(",")
        : ["meta", "shards", "bodies", "categories"]) as Group[],
    ),
    sets: sets ? new Set(sets.split(",").filter(Boolean)) : null,
    /* Miniflare keeps local R2 in SQLite, and parallel wrangler processes
       deadlock on it with SQLITE_BUSY. Remote R2 is an HTTP API and has no
       such problem, so the pool only opens up when publishing for real. */
    concurrency: local ? 1 : Number(value("concurrency") ?? 8),
    limit: limit ? Number(limit) : null,
  };
}

async function sizeOf(file: string): Promise<number> {
  return (await stat(file)).size;
}

async function collect(options: Options): Promise<Upload[]> {
  const uploads: Upload[] = [];

  const add = async (key: string, file: string, group: Group) => {
    uploads.push({ key, file, group, bytes: await sizeOf(file) });
  };

  if (options.groups.has("meta")) {
    for (const name of [
      "sets.json",
      "stats.json",
      "categories.json",
      "licenses.json",
    ]) {
      await add(name, join(DIST, name), "meta");
    }
  }

  if (options.groups.has("shards")) {
    await add("shards/index.json", join(DIST, "shards", "index.json"), "shards");
    const files = (await readdir(join(DIST, "shards", "terms"))).sort();
    for (const file of files) {
      await add(
        `shards/terms/${file}`,
        join(DIST, "shards", "terms", file),
        "shards",
      );
    }
    /* Fuzzy routing maps for split buckets (build-shards.ts's "Fuzzy routing
       map" step) - without these, shard-engine.ts's loadFuzzyMap requests
       `shards/fuzzy/${parent}.json` and gets nothing back, silently
       disabling the third-char-typo fallback in prod (the split-bucket typo
       fix measured against the parity corpus, e.g. "trsh" -> "trash") while
       dev/miniflare,
       which reads straight off dist/, kept working. */
    const fuzzyFiles = (await readdir(join(DIST, "shards", "fuzzy"))).sort();
    for (const file of fuzzyFiles) {
      await add(
        `shards/fuzzy/${file}`,
        join(DIST, "shards", "fuzzy", file),
        "shards",
      );
    }
  }

  if (options.groups.has("bodies")) {
    const files = (await readdir(join(DIST, "bodies"))).sort();
    for (const file of files) {
      const prefix = file.replace(/\.(index\.)?jsonl?$/, "").replace(/\.json$/, "");
      if (options.sets && !options.sets.has(prefix)) continue;
      await add(`bodies/${file}`, join(DIST, "bodies", file), "bodies");
    }
  }

  if (options.groups.has("categories")) {
    /* Per-category icon-id lists (one file per category slug). Without
       these, /category/<slug> pages and the search page's category filter
       have nothing to read and fail empty. */
    const files = (await readdir(join(DIST, "categories"))).sort();
    for (const file of files) {
      await add(`categories/${file}`, join(DIST, "categories", file), "categories");
    }
  }

  return uploads;
}

function bucketFor(options: Options): string {
  return options.local ? PREVIEW_BUCKET : BUCKET_NAME;
}

function put(upload: Upload, options: Options): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "r2",
      "object",
      "put",
      `${bucketFor(options)}/${upload.key}`,
      `--file=${upload.file}`,
    ];
    if (options.local) args.push("--local");
    else args.push("--remote");

    const child = spawn(WRANGLER, args, {
      cwd: APP_DIR,
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${upload.key}: ${stderr.trim().slice(0, 300)}`));
    });
  });
}

/** Fixed-size worker pool: enough parallelism to matter, not enough to swap. */
async function runPool(
  uploads: Upload[],
  options: Options,
  onDone: (upload: Upload) => void,
): Promise<string[]> {
  const failures: string[] = [];
  let next = 0;

  const worker = async () => {
    for (;;) {
      const index = next++;
      const upload = uploads[index];
      if (!upload) return;
      try {
        await put(upload, options);
      } catch (error) {
        failures.push(String(error instanceof Error ? error.message : error));
      }
      onDone(upload);
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, options.concurrency) }, worker),
  );
  return failures;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const started = Date.now();
  const all = await collect(options);
  const uploads = options.limit ? all.slice(0, options.limit) : all;

  const totalBytes = uploads.reduce((sum, upload) => sum + upload.bytes, 0);
  const byGroup = new Map<Group, { count: number; bytes: number }>();
  for (const upload of uploads) {
    const entry = byGroup.get(upload.group) ?? { count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += upload.bytes;
    byGroup.set(upload.group, entry);
  }

  console.log("");
  console.log(
    `Publishing to ${options.local ? "local miniflare" : "R2"} bucket ${bucketFor(options)}`,
  );
  if (options.limit) {
    console.log(`  (limited to ${options.limit} of ${all.length} objects)`);
  }
  if (options.local) console.log("  (local: sequential, SQLite single-writer)");
  console.log("--------------------------------------------------");
  for (const [group, entry] of byGroup) {
    console.log(
      `  ${group.padEnd(8)} ${String(entry.count).padStart(5)} objects  ${(entry.bytes / 1048576).toFixed(1)}MB`,
    );
  }
  console.log(
    `  ${"total".padEnd(8)} ${String(uploads.length).padStart(5)} objects  ${(totalBytes / 1048576).toFixed(1)}MB`,
  );
  console.log("");

  /* The manifest is what a deploy can diff against to know the bucket matches
     this build of the pipeline. */
  const manifest = {
    generatedAt: new Date().toISOString(),
    bucket: bucketFor(options),
    objects: uploads.length,
    bytes: totalBytes,
    groups: Object.fromEntries(byGroup),
    keys: uploads.map((upload) => ({ key: upload.key, bytes: upload.bytes })),
  };
  await writeFile(
    join(DIST, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  if (options.dryRun) {
    console.log("  dry run: nothing uploaded, manifest written");
    console.log("");
    return;
  }

  let done = 0;
  const failures = await runPool(uploads, options, () => {
    done += 1;
    if (done % 25 === 0 || done === uploads.length) {
      process.stdout.write(`\r  uploaded ${done}/${uploads.length}`);
    }
  });

  /* Manifest last, so its presence means the objects before it landed. */
  if (failures.length === 0) {
    await put(
      {
        key: "manifest.json",
        file: join(DIST, "manifest.json"),
        group: "meta",
        bytes: await sizeOf(join(DIST, "manifest.json")),
      },
      options,
    );
  }

  process.stdout.write("\r");
  console.log("");
  if (failures.length > 0) {
    console.error(`  ${failures.length} uploads failed:`);
    for (const failure of failures.slice(0, 5)) console.error(`    ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `  done in ${((Date.now() - started) / 1000).toFixed(1)}s - manifest.json published last`,
  );
  console.log("");
}

await main();
