/**
 * Builds a standalone SVG document from an icon body plus the user's edits.
 *
 * This is the single place edits are composed, so every export format - SVG,
 * PNG, JSX, data URI, asset catalog - is guaranteed to show what the preview
 * showed. Doing it per format is how those drift apart.
 */

import type { IconSource, Tier } from "../data";
import { recolor, recolorPalette, toCurrentColor } from "./color";
import { retargetStroke } from "./stroke";

export interface IconEdits {
  /** Rendered pixel size. Omit to keep the intrinsic grid. */
  size?: number;
  /** Flatten to one colour. */
  color?: string;
  /** Per-original-colour mapping, for multicolour icons. */
  palette?: Record<string, string>;
  /** T1 only; ignored otherwise (see applyEdits). */
  strokeWidth?: number;
  /** Hand every paint to CSS so `color` drives the icon. */
  cssStyleable?: boolean;
  rotate?: 0 | 90 | 180 | 270;
  flipH?: boolean;
  flipV?: boolean;
  /** Inset as a fraction of the viewBox, e.g. 0.1 for 10% padding. */
  padding?: number;
}

/** What the editor is allowed to offer for a given tier. */
export interface TierCapabilities {
  strokeRetarget: boolean;
  recolor: boolean;
  perPathRecolor: boolean;
  swiftUiShape: boolean;
  swiftUiView: boolean;
  assetCatalog: boolean;
}

export function capabilitiesFor(tier: Tier): TierCapabilities {
  switch (tier) {
    case "T1":
      return {
        strokeRetarget: true,
        recolor: true,
        perPathRecolor: false,
        swiftUiShape: true,
        swiftUiView: false,
        assetCatalog: true,
      };
    case "T2":
      return {
        strokeRetarget: false,
        recolor: true,
        perPathRecolor: false,
        swiftUiShape: true,
        swiftUiView: false,
        assetCatalog: true,
      };
    case "T3":
      return {
        strokeRetarget: false,
        recolor: true,
        perPathRecolor: true,
        swiftUiShape: false,
        swiftUiView: true,
        assetCatalog: true,
      };
    case "T4":
      return {
        strokeRetarget: false,
        recolor: false,
        perPathRecolor: false,
        swiftUiShape: false,
        swiftUiView: false,
        assetCatalog: true,
      };
  }
}

/**
 * Applies the edits a tier actually supports and silently drops the rest.
 * Dropping rather than throwing is deliberate: the UI already hides controls
 * that do not apply, so anything arriving here is a stale client or a crafted
 * request, and neither deserves an error page.
 */
export function applyEdits(icon: IconSource, edits: IconEdits, tier: Tier): string {
  const can = capabilitiesFor(tier);
  let body = icon.body;

  if (edits.cssStyleable) {
    body = toCurrentColor(body);
  } else if (edits.palette && can.perPathRecolor) {
    body = recolorPalette(body, edits.palette);
  } else if (edits.color && can.recolor) {
    body = recolor(body, edits.color);
  }

  if (edits.strokeWidth !== undefined && can.strokeRetarget) {
    body = retargetStroke(body, edits.strokeWidth);
  }

  return body;
}

function transformAttribute(
  icon: IconSource,
  edits: IconEdits,
): string | null {
  const parts: string[] = [];
  const { width, height } = icon;

  if (edits.rotate) {
    /* Rotate about the centre so the art stays in the box. */
    parts.push(`rotate(${edits.rotate} ${width / 2} ${height / 2})`);
  }
  if (edits.flipH) parts.push(`translate(${width} 0) scale(-1 1)`);
  if (edits.flipV) parts.push(`translate(0 ${height}) scale(1 -1)`);

  if (edits.padding && edits.padding > 0) {
    const factor = Math.max(0, 1 - Math.min(0.4, edits.padding) * 2);
    const dx = (width * (1 - factor)) / 2;
    const dy = (height * (1 - factor)) / 2;
    parts.push(`translate(${round(dx)} ${round(dy)}) scale(${round(factor)})`);
  }

  return parts.length > 0 ? parts.join(" ") : null;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

export function buildSvg(
  icon: IconSource,
  edits: IconEdits,
  tier: Tier,
): string {
  const inner = applyEdits(icon, edits, tier);
  const wrapped = (() => {
    const transform = transformAttribute(icon, edits);
    return transform ? `<g transform="${transform}">${inner}</g>` : inner;
  })();

  const size = edits.size;
  const dimensions =
    size === undefined
      ? `width="${icon.width}" height="${icon.height}"`
      : `width="${size}" height="${size}"`;

  return `<svg xmlns="http://www.w3.org/2000/svg" ${dimensions} viewBox="0 0 ${icon.width} ${icon.height}">${wrapped}</svg>`;
}

/** Inline preview markup: no width/height so CSS controls the box. */
export function buildInlineSvg(
  icon: IconSource,
  edits: IconEdits,
  tier: Tier,
  attrs = "",
): string {
  const inner = applyEdits(icon, edits, tier);
  const transform = transformAttribute(icon, edits);
  const wrapped = transform
    ? `<g transform="${transform}">${inner}</g>`
    : inner;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${icon.width} ${icon.height}"${attrs ? ` ${attrs}` : ""}>${wrapped}</svg>`;
}
