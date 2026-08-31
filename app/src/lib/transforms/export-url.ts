import type { IconEdits } from "./svg-doc";

/**
 * Builds the query string /api/export/[prefix]/[name].ts expects, from an
 * `IconEdits` object - the single place that does this, so every caller
 * (FormatPreviewPanel.tsx's per-format tabs, CollectionDownloadPanel.tsx's
 * per-icon zip fetches) sends exactly the same params the server's own
 * `parseEdits` reads back. Split out from FormatPreviewPanel.tsx - the zip
 * reuses the exact param building rather than a new server endpoint -
 * instead of left as that component's private inline function, so a second
 * caller could not drift from it by copying it slightly wrong.
 */
export function buildExportUrl(
  prefix: string,
  name: string,
  format: string,
  edits: IconEdits,
  /** Omit (or pass `undefined`) to keep the icon's intrinsic grid - the
      server's own `parseEdits` treats a missing `size` param exactly like
      IconEdits's own "omit to keep the intrinsic grid" (svg-doc.ts). Never
      pass `undefined` through `String()` here: that would literally send
      `size=undefined` as the query value, which is why this is a real
      parameter rather than always-stringified like the original
      FormatPreviewPanel-only version was (that caller always had a real
      number; CollectionDownloadPanel.tsx's caller does not, whenever the
      collection's own size setting is "Unset"). */
  size?: number,
): string {
  const params = new URLSearchParams({ format });
  if (size !== undefined) params.set("size", String(size));
  if (edits.color) params.set("color", edits.color);
  if (edits.strokeWidth) params.set("stroke", String(edits.strokeWidth));
  if (edits.cssStyleable) params.set("css", "1");
  if (edits.rotate) params.set("rotate", String(edits.rotate));
  if (edits.flipH) params.set("flipH", "1");
  if (edits.flipV) params.set("flipV", "1");
  if (edits.padding) params.set("padding", String(edits.padding));
  return `/api/export/${prefix}/${name}?${params}`;
}
