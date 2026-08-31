/**
 * Xcode asset catalog export.
 *
 * The universal fallback: an .imageset holding the SVG with
 * preserve-vector-data, which renders crisp at any point size and reproduces
 * the artwork exactly, including the masks and gradients that defeat Path
 * codegen. Spike S1 measured this at 100% of a 450-icon stratified sample,
 * which is what makes "every icon, SwiftUI-ready" an honest claim.
 */

import type { IconSource, Tier } from "../data";
import { buildSvg, type IconEdits } from "./svg-doc";
import { createZip, type ZipEntry } from "./zip";

/** Xcode asset names allow letters, digits, dash and underscore. */
export function assetName(prefix: string, name: string): string {
  return `${prefix}-${name}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function contentsJson(filename: string): string {
  return `${JSON.stringify(
    {
      images: [{ filename, idiom: "universal" }],
      info: { author: "xcode", version: 1 },
      properties: {
        "preserves-vector-representation": true,
        "template-rendering-intent": "template",
      },
    },
    null,
    2,
  )}\n`;
}

export interface AssetCatalogResult {
  filename: string;
  zip: Buffer;
  entries: string[];
}

export function toAssetCatalog(
  icon: IconSource,
  edits: IconEdits,
  tier: Tier,
): AssetCatalogResult {
  const asset = assetName(icon.prefix, icon.name);
  const svgName = `${asset}.svg`;
  const root = `${asset}.imageset`;

  const entries: ZipEntry[] = [
    { path: `${root}/Contents.json`, contents: contentsJson(svgName) },
    { path: `${root}/${svgName}`, contents: buildSvg(icon, edits, tier) },
  ];

  return {
    filename: `${asset}.imageset.zip`,
    zip: createZip(entries),
    entries: entries.map((entry) => entry.path),
  };
}

/** Batch export: several icons into one catalog folder. */
export function toAssetCatalogBundle(
  icons: { icon: IconSource; tier: Tier }[],
  edits: IconEdits,
  bundleName = "Motificons",
): AssetCatalogResult {
  const entries: ZipEntry[] = [
    {
      path: `${bundleName}.xcassets/Contents.json`,
      contents: `${JSON.stringify({ info: { author: "xcode", version: 1 } }, null, 2)}\n`,
    },
  ];

  for (const { icon, tier } of icons) {
    const asset = assetName(icon.prefix, icon.name);
    const svgName = `${asset}.svg`;
    const root = `${bundleName}.xcassets/${asset}.imageset`;
    entries.push(
      { path: `${root}/Contents.json`, contents: contentsJson(svgName) },
      { path: `${root}/${svgName}`, contents: buildSvg(icon, edits, tier) },
    );
  }

  return {
    filename: `${bundleName}.xcassets.zip`,
    zip: createZip(entries),
    entries: entries.map((entry) => entry.path),
  };
}
