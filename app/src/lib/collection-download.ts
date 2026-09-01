/**
 * Pure helpers for "Download collection": the naming, licence text and size
 * rules the zip needs, with no network, DOM or fflate anywhere near them, so
 * they are unit-testable without a browser.
 *
 * Both sides of the download read from here. The zip itself is built on the
 * server (lib/collection-zip.ts, behind the download route);
 * CollectionDownloadPanel.tsx only builds the URL that asks for it, using
 * the same slug the server puts on the file.
 */

import type { ExportFormat } from "./transforms/formats";

/** What a collection item knows about the set it came from, for the zip's
    LICENSES.txt. Two ways to end up with one (see buildLicensesText's own
    comment for why the fields differ in richness):
    - SSR (lib/workspace/collection-icons.ts, for the collection page and
      the zip route alike): full - it already resolves `getSet(prefix)` for
      the style-engine tier, so forwarding the rest of that same object's
      author/license fields costs nothing extra.
    - Added client-side via the "Add icons" panel this session, before the
      next reload (CollectionWorkspace.tsx's handlePanelToggle): only what
      SearchHit already carries (setName/license/attributionRequired) - no
      author name/url, since the search index does not index those. */
export interface CollectionIconLicense {
  setName: string;
  authorName: string | null;
  authorUrl: string | null;
  licenseName: string;
  licenseSpdx: string | null;
  licenseUrl: string | null;
  attributionRequired: boolean;
}

/** Guards against two icons in one collection resolving to the same zip
    entry name - fflate's `Zippable` object is keyed by filename, so a silent
    collision would silently drop one icon's file. Same-prefix icons never
    collide (Iconify names are unique within a set, and the stem is
    `prefix-name`); this only ever bites the SwiftUI format's PascalCase
    type name, or two different sets that happen to produce an identical
    stem some other way. Pure - does not mutate `used`; the caller adds the
    returned name to it. */
export function dedupeFilename(name: string, used: ReadonlySet<string>): string {
  if (!used.has(name)) return name;

  const lastDot = name.lastIndexOf(".");
  const stem = lastDot > 0 ? name.slice(0, lastDot) : name;
  const ext = lastDot > 0 ? name.slice(lastDot) : "";

  let attempt = 2;
  let candidate = `${stem}-${attempt}${ext}`;
  while (used.has(candidate)) {
    attempt += 1;
    candidate = `${stem}-${attempt}${ext}`;
  }
  return candidate;
}

/** The name the collection's zip is downloaded under, and the last segment
    of the URL that produces it - lowercased, ASCII-safe, no
    leading/trailing dashes. Never empty: an all-punctuation/emoji
    collection name still produces something downloadable. */
export function slugifyFilename(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "collection";
}

/**
 * The URL the Download button points at - a plain, same-origin GET that
 * answers with the zip as an attachment.
 *
 * It ends in the collection's own slug so that a download manager which
 * names files from the URL rather than from Content-Disposition still writes
 * `my-icons.zip`. That is the whole reason this is a URL at all: an embedded
 * browser (the ChatGPT desktop app's) hands downloads to an external manager
 * that cannot read a blob the page built, and stops them dead.
 *
 * That same manager is also why the URL carries a `token`: it fetches this
 * string as a separate program, with none of the page's cookies, so the URL
 * has to authenticate itself. See lib/download-token.ts.
 */
export function buildCollectionDownloadUrl(
  collectionId: string,
  collectionName: string,
  format: ExportFormat,
  /** Omit to let the server apply the collection's own remembered size. */
  size?: number,
  /** The page's short-lived signed token for this collection. Omit and the
      URL works only for a request that carries the session cookie. */
  token?: string,
): string {
  const params = new URLSearchParams({ format });
  if (size !== undefined) params.set("size", String(size));
  if (token) params.set("token", token);
  return `/api/collections/${collectionId}/download/${slugifyFilename(collectionName)}.zip?${params}`;
}

/** The download panel's one-line, plain-language readout of what will
    actually change about how the icons look - unset parts are omitted, and
    it deliberately states the real hex/number rather than inventing a
    human color name ("pink"): the product has no color-naming feature
    anywhere else (ColorField's swatches are titled by their own hex), and
    guessing one here risked being wrong in a way a real value cannot be. */
export function summarizeCollectionStyles({
  color,
  strokeWidth,
}: {
  color: string | null;
  strokeWidth: number | null;
}): string {
  const parts: string[] = [];
  if (color) parts.push(`color ${color}`);
  if (strokeWidth !== null) parts.push(`stroke width ${strokeWidth}`);

  if (parts.length === 0) {
    return "Icons export exactly as they look in the library - no collection styles applied.";
  }
  return `Icons export with this collection's look: ${parts.join(", ")}.`;
}

function attributionLine(license: CollectionIconLicense): string {
  /* Same formula as [prefix]/[name].astro's own `attribution` line, reused
     verbatim - the same attribution snippet pattern as the icon detail
     page - so a set's wording never reads differently depending on
     whether a visitor is looking at one icon's page or a collection's zip. */
  if (license.authorName) {
    return `${license.setName} by ${license.authorName}${
      license.authorUrl ? ` (${license.authorUrl})` : ""
    }, licensed under ${license.licenseName}${
      license.licenseUrl ? ` - ${license.licenseUrl}` : ""
    }`;
  }
  /* Degraded case - see CollectionIconLicense's own comment: an icon added
     from search this session, before the next reload, has no author
     name/url to report. Still honest, just shorter; never fabricates one. */
  return `${license.setName}, licensed under ${license.licenseName}`;
}

/** LICENSES.txt - one block per SET (not per icon: a collection with twelve
    Lucide icons gets one Lucide block, not twelve identical ones), set name
    + license + the reused attribution line, sorted alphabetically by set
    name for a stable, diffable file. Icons whose set metadata never
    resolved (`license: null` - the same rare "a set left the pipeline"
    edge case [id].astro already handles for `tier`) are silently skipped:
    there is nothing honest to attribute them to. */
export function buildLicensesText({
  collectionName,
  items,
}: {
  collectionName: string;
  items: { prefix: string; license: CollectionIconLicense | null }[];
}): string {
  const byPrefix = new Map<string, CollectionIconLicense>();
  for (const item of items) {
    if (item.license && !byPrefix.has(item.prefix)) {
      byPrefix.set(item.prefix, item.license);
    }
  }

  const sets = [...byPrefix.values()].sort((a, b) => a.setName.localeCompare(b.setName));

  const lines = [
    `Icon licenses - ${collectionName}`,
    "Downloaded from Motificons (https://motificons.app)",
    "",
    "Every icon in this download is open source. This lists the set, license",
    "and attribution line for each one - check it before you ship; some",
    "licenses require visible credit.",
    "",
  ];

  for (const license of sets) {
    const spdxSuffix =
      license.licenseSpdx && license.licenseSpdx !== license.licenseName
        ? ` (${license.licenseSpdx})`
        : "";
    const attributionSuffix = license.attributionRequired
      ? "attribution required"
      : "no attribution required";

    lines.push(license.setName);
    lines.push(`License: ${license.licenseName}${spdxSuffix} - ${attributionSuffix}`);
    lines.push(attributionLine(license));
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

/** Which `size` param (if any) a per-icon export request should carry -
    PNG always gets one (the server itself defaults an omitted PNG size to
    512, mirrored here as the panel's own default so the shown default and
    the actual server behavior can never disagree); every other format
    follows the collection's own remembered size setting, or none at all
    when it is "Unset" (IconEdits's "omit to keep the intrinsic grid"). */
export function resolveExportSize(
  format: ExportFormat,
  pngSize: number,
  collectionSize: number | null,
): number | undefined {
  if (format === "png") return pngSize;
  return collectionSize ?? undefined;
}
