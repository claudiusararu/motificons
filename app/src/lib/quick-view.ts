/**
 * Pure helpers for the icon quick-view: the click-
 * interception guard both entry points use, and the edits-composition logic
 * IconQuickView.tsx feeds FormatPreviewPanel with. Split out so the exact
 * precedence rules (does cssStyleable suppress the color override? does a
 * non-recoloring tier?) are unit-tested directly, not just eyeballed in a
 * component - this project's whole testing convention, no browser needed.
 */

import type { IconEdits } from "./transforms/svg-doc";

/** The same "progressive enhancement" rule SearchIsland.tsx's set-card
    click (`onRestingClick`) already used before this round: a plain left
    click is intercepted (opens the quick view / applies a filter instead of
    navigating); anything else - a modified click, a non-primary button, or
    a handler upstream that already called preventDefault() - is left alone
    so opening in a new tab, middle-click, etc. keep working exactly like
    any other link on the page. */
export function isPlainLeftClick(event: {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  return true;
}

/** The quick view's preview/export state: the collection's saved stroke
    width passes straight through untouched (there is no stroke control in
    this "limited controls" view - applyEdits/capabilitiesFor already keep
    that honest per-tier, the same shared engine every other surface uses),
    while color is the view's own ephemeral, per-session override - never
    the collection's saved color, and never written back to it. Mirrors
    IconEditor.tsx's own edits derivation (same precedence: cssStyleable
    wins over a baked-in color; a 0/false/falsy transform value collapses to
    `undefined` so an untouched control never taints the export URL/preview
    with a no-op param). */
export function combineQuickViewEdits({
  savedStrokeWidth,
  colorOverride,
  cssStyleable,
  canRecolor,
  rotate,
  flipH,
  flipV,
  padding,
}: {
  savedStrokeWidth?: number;
  colorOverride: string;
  cssStyleable: boolean;
  /** capabilitiesFor(tier).recolor - passed in rather than a raw Tier so
      this stays a pure function of booleans/numbers, no data-layer import
      needed just to unit-test it. */
  canRecolor: boolean;
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  padding: number;
}): IconEdits {
  return {
    color: canRecolor && !cssStyleable ? colorOverride : undefined,
    strokeWidth: savedStrokeWidth,
    cssStyleable,
    rotate: rotate === 0 ? undefined : rotate,
    flipH,
    flipV,
    padding: padding || undefined,
  };
}
