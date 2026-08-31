import type { Tier } from "../../lib/data";
import type { IconEdits } from "../../lib/transforms/svg-doc";
import type { CollectionIconLicense } from "../../lib/collection-download";
import { isPlainLeftClick } from "../../lib/quick-view";
import { StyledIconGlyph } from "./StyledIconGlyph";
import {
  TILE_BADGE_CLASS,
  TILE_CLASS,
  TILE_GLYPH_CLASS,
  TILE_GRID_CLASS,
  TILE_NAME_CLASS,
} from "../../lib/tile-classes";

export interface CollectionIconItem {
  /** "{prefix}:{name}" - the identity DELETE /api/collections/[id]/icons
      needs, and the React key. */
  iconId: string;
  prefix: string;
  name: string;
  body: string | null;
  width: number;
  height: number;
  /** Which style-engine capabilities this icon's set has - needed
      client-side to apply the collection's style settings honestly (a T4
      icon never fakes a stroke it cannot take). Absent only for the rare
      icon whose body came back too large to inline (see StyledIconGlyph). */
  tier: Tier | null;
  /** "Download collection": the set/license info its zip's
      LICENSES.txt reads. Null in the same rare case `tier` is (the set left
      the pipeline at a re-sync); see CollectionIconLicense's own comment for
      why an icon added client-side this session carries a shorter version
      of this than one the server rendered. */
  license: CollectionIconLicense | null;
}

function SpinnerIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="animate-spin"
    >
      <circle cx="12" cy="12" r="9" opacity="0.3" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6 18 18M18 6 6 18" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg
      width={28}
      height={28}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-ink-muted"
    >
      <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mt-0.5 shrink-0"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5" />
      <path d="M12 16.5h.01" />
    </svg>
  );
}

/**
 * The collection detail page's saved-icon grid. Controlled by the parent (CollectionWorkspace.tsx) rather
 * than owning its own item list: the "Add icons" panel and this grid both
 * need to agree on what is currently saved, so one place (the parent) is the
 * source of truth for `items` and the mutation (remove) requests, and this
 * component is a pure renderer plus the per-tile remove control.
 *
 * Reuses the same TILE_CLASS/TILE_GRID_CLASS building blocks as every other
 * icon grid (tile-classes.ts's header comment: "the failure mode... a
 * component reimplemented for a different renderer"). The remove control
 * sits OUTSIDE the `<a>` tile as an absolutely positioned sibling, not
 * nested inside it - a `<button>` inside an `<a>` is invalid HTML and would
 * also fire the tile's navigation on every remove click.
 */
export default function CollectionIconGrid({
  items,
  edits,
  busyId,
  errorId,
  error,
  onRemove,
  onOpenAdd,
  onOpenQuickView,
}: {
  items: CollectionIconItem[];
  /** The collection's style settings, already reduced to an IconEdits -
      color/strokeWidth only (size/format do not visually change a small
      grid tile; they matter for export instead). */
  edits: IconEdits;
  busyId: string | null;
  errorId: string | null;
  error: string;
  onRemove: (item: CollectionIconItem) => void;
  /** Opens the "Add icons" slide-over - the empty state's call to action. */
  onOpenAdd: () => void;
  /** Quick view, ENTRY 1: a plain left click on a tile opens the icon quick-
      view instead of navigating (see the tile's own onClick below for the
      progressive-enhancement guard - a real href stays on the tile for
      crawlers/middle-click/new-tab, all untouched). */
  onOpenQuickView: (item: CollectionIconItem) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="mt-8 flex flex-col items-center gap-3 rounded-card bg-surface px-8 py-16 text-center shadow-card">
        <StarIcon />
        <p className="text-body font-semibold text-ink">Icons you save will appear here</p>
        <p className="text-meta text-ink-muted">
          Press Add icons, find what you like, and press the star - it lands here.
        </p>
        <button
          type="button"
          onClick={onOpenAdd}
          className="press mt-2 inline-flex items-center justify-center rounded-btn border-2 border-ink bg-primary px-6 py-[15px] text-body font-semibold text-ink"
        >
          Add icons
        </button>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <div className={TILE_GRID_CLASS}>
        {items.map((item) => (
          <div key={item.iconId} className="relative">
            <a
              href={`/${item.prefix}/${item.name}`}
              onClick={(event) => {
                if (!isPlainLeftClick(event)) return;
                event.preventDefault();
                onOpenQuickView(item);
              }}
              title={item.name}
              aria-label={item.name}
              className={TILE_CLASS}
            >
              <span className={`${TILE_GLYPH_CLASS} glyph-checker`}>
                <StyledIconGlyph item={item} edits={edits} />
              </span>
              <span className={TILE_NAME_CLASS}>{item.name}</span>
            </a>
            <button
              type="button"
              onClick={() => onRemove(item)}
              disabled={busyId === item.iconId}
              aria-busy={busyId === item.iconId}
              aria-label={`Remove ${item.name} from this collection`}
              className={`${TILE_BADGE_CLASS} touch-target-inset flex h-7 w-7 items-center justify-center rounded-full border-2 border-ink bg-surface text-ink-muted transition-colors duration-[120ms] ease-in hover:text-danger hover:border-danger disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {busyId === item.iconId ? <SpinnerIcon /> : <RemoveIcon />}
            </button>
            {errorId === item.iconId && (
              <p
                role="alert"
                className="mt-1 flex items-start justify-center gap-1 text-center text-pill text-danger"
              >
                <AlertIcon />
                {error}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
