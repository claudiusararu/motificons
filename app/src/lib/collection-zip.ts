/**
 * The collection zip itself: every icon exported in one format, plus the
 * LICENSES.txt, assembled into one archive.
 *
 * This used to happen in the visitor's browser - the panel fetched each icon
 * from /api/export and zipped them with fflate, then handed the result over
 * as a blob URL. That works in a normal browser and fails outright in an
 * embedded one: the ChatGPT desktop app's download manager cannot fetch a
 * blob its page created, and marks every such download "Stopped". So the zip
 * is built here instead, and the browser is given a plain URL it can track
 * like any other file on the web.
 *
 * Everything below is pure apart from the icon transforms - no database, no
 * request, no Response - so a test can build a real zip and read it back.
 */

import { strToU8, zipSync, type Zippable } from "fflate";
import {
  buildLicensesText,
  dedupeFilename,
  slugifyFilename,
  type CollectionIconLicense,
} from "./collection-download";
import type { IconSource, Tier } from "./data";
import { exportIconFile } from "./export-file";
import type { ExportFormat, IconEdits } from "./transforms";

/** One icon to put in the zip: the artwork, the tier its transforms need,
    and what its set asks of whoever ships it. */
export interface CollectionZipIcon {
  icon: IconSource;
  tier: Tier;
  license: CollectionIconLicense | null;
}

export interface CollectionZipResult {
  /** `<collection-slug>.zip` - the name the response's Content-Disposition
      carries and the name the download URL ends in. */
  filename: string;
  bytes: Uint8Array;
  /** How many icons actually made it in. Zero is the only case a caller has
      to act on - it means the zip holds nothing but its licence file. */
  included: number;
  /** "prefix:name" of every icon the chosen format could not represent. The
      only format any set can refuse is the Xcode asset catalog, and no tier
      refuses it today - this is the same standing guard the single-icon
      export route carries, kept honest rather than assumed away. */
  skipped: string[];
}

export async function buildCollectionZip({
  collectionName,
  icons,
  format,
  edits,
}: {
  collectionName: string;
  icons: CollectionZipIcon[];
  format: ExportFormat;
  /** The collection's saved look, plus the resolved export size. Applied to
      every icon, exactly as the grid on the page already renders them. */
  edits: IconEdits;
}): Promise<CollectionZipResult> {
  const files: Zippable = {};
  const used = new Set<string>();
  const included: CollectionZipIcon[] = [];
  const skipped: string[] = [];

  for (const entry of icons) {
    const result = await exportIconFile(entry.icon, entry.tier, format, edits);
    if (!result.ok) {
      skipped.push(`${entry.icon.prefix}:${entry.icon.name}`);
      continue;
    }

    /* fflate keys its archive by filename, so a collision would silently
       drop one icon's file rather than fail. */
    const name = dedupeFilename(result.file.filename, used);
    used.add(name);
    files[name] = typeof result.file.body === "string" ? strToU8(result.file.body) : result.file.body;
    included.push(entry);
  }

  /* Built from the icons that are actually in the zip, not from everything
     asked for: a licence block for a set nothing in the archive came from
     would be noise. With nothing skipped - every format but the asset
     catalog, always - that is the same text the browser-side zip produced. */
  files["LICENSES.txt"] = strToU8(
    buildLicensesText({
      collectionName,
      items: included.map((entry) => ({ prefix: entry.icon.prefix, license: entry.license })),
    }),
  );

  return {
    filename: `${slugifyFilename(collectionName)}.zip`,
    bytes: zipSync(files),
    included: included.length,
    skipped,
  };
}
