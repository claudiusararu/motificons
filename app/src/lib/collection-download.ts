/**
 * Pure helpers for "Download collection": everything
 * about turning a collection's icons into one zip that does NOT touch the
 * network, the DOM or fflate, so it is unit-testable without a browser -
 * CollectionDownloadPanel.tsx is the one caller that wires these to real
 * fetches and a real zip.
 */

import type { ExportFormat } from "./transforms/formats";

/** What a collection item knows about the set it came from, for the zip's
    LICENSES.txt. Two ways to end up with one (see buildLicensesText's own
    comment for why the fields differ in richness):
    - SSR (pages/collections/[id].astro): full - the page already resolves
      `getSet(prefix)` for the style-engine tier, so forwarding the rest of
      that same object's author/license fields costs nothing extra.
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

/** Every per-icon export the server can hand back, mapped to the extension
    it would use - the fallback for when a response somehow arrives without
    a readable Content-Disposition header (parseContentDispositionFilename
    returns null). Matches api/export/[prefix]/[name].ts's own per-format
    naming exactly (catalog's `.imageset.zip`, swiftui's real filename is a
    PascalCase type name the server computes - `.swift` here is an honest
    fallback, not a claim of matching it byte-for-byte, which is why the real
    header is always preferred when present). */
const DEFAULT_EXTENSIONS: Record<ExportFormat, string> = {
  svg: "svg",
  png: "png",
  jsx: "jsx",
  tsx: "tsx",
  vue: "vue",
  svelte: "svelte",
  swiftui: "swift",
  catalog: "imageset.zip",
  datauri: "txt",
};

export function defaultExtensionFor(format: ExportFormat): string {
  return DEFAULT_EXTENSIONS[format];
}

/** The name a per-icon zip entry falls back to when the response's own
    Content-Disposition could not be read - same `prefix-name` stem the
    server uses for every format except swiftui/catalog (see
    DEFAULT_EXTENSIONS's own comment). */
export function fallbackFilename(prefix: string, name: string, format: ExportFormat): string {
  return `${prefix}-${name}.${defaultExtensionFor(format)}`;
}

/** Reads the filename /api/export/[prefix]/[name].ts already puts on every
    response (`Content-Disposition: attachment; filename="..."`) - the exact
    name a single-icon download would have used, so the zip never needs its
    own naming logic to agree with that route's (avoids the two ever
    drifting, same reasoning as reusing its param-building via
    buildExportUrl). Same-origin fetch, so the header is always readable -
    no CORS restriction to work around. */
export function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const quoted = /filename="([^"]*)"/i.exec(header);
  if (quoted?.[1]) return quoted[1];
  const bare = /filename=([^;]+)/i.exec(header);
  if (bare?.[1]) return bare[1].trim();
  return null;
}

/** Guards against two icons in one collection resolving to the same zip
    entry name - fflate's `Zippable` object is keyed by filename, so a silent
    collision would silently drop one icon's file. Same-prefix icons never
    collide (Iconify names are unique within a set, and the stem is
    `prefix-name`); this only ever bites the swiftui fallback's PascalCase
    typeName, or two different sets that happen to produce an identical
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

/** The download panel's zip filename, and the base name if a future caller
    ever needs one - lowercased, ASCII-safe, no leading/trailing dashes.
    Never empty: an all-punctuation/emoji collection name still produces
    something downloadable. */
export function slugifyFilename(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "collection";
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
