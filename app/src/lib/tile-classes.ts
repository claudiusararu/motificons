/**
 * Single source for the icon-tile classes.
 *
 * IconTile.astro renders server-side for browse and SEO pages, and the search
 * island renders the same tile in React. Both import from here so the two can
 * never drift into looking almost the same, which is the failure mode when a
 * component gets reimplemented for a different renderer.
 */

export const TILE_CLASS =
  "press-lift relative flex min-w-[96px] flex-col items-center gap-3 rounded-card bg-surface px-3 py-5 text-center no-underline";

export const TILE_GLYPH_CLASS =
  "flex h-8 items-center justify-center text-ink";

export const TILE_NAME_CLASS = "w-full truncate text-meta text-ink-muted";

export const TILE_BADGE_CLASS = "absolute top-2 right-2";

/** Grid used by every icon results/browse grid. */
export const TILE_GRID_CLASS =
  "grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-3";
