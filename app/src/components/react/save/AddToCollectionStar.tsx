import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { TILE_BADGE_CLASS } from "../../../lib/tile-classes";
import { ErrorLine, SpinnerIcon, StarIcon } from "./icons";

/**
 * The direct-add star used ONLY inside a collection's "Add icons" slide-over
 * - every result tile's save-star adds DIRECTLY to THIS collection: one
 * click, no picker, per-tile feedback. A toggle, not a one-way add - clicking an already-added tile
 * removes it, so a filled star is never a dead click.
 *
 * Deliberately NOT SaveStar.tsx: that component's whole job is choosing
 * WHICH collection (the picker, the last-used shortcut) - here the
 * collection is already fixed by which panel is open, so the picker
 * machinery would be a detour, not a reuse.
 */
export default function AddToCollectionStar({
  iconId,
  name,
  collectionId,
  added,
  tabIndex,
  onToggle,
  variant = "badge",
}: {
  iconId: string;
  name: string;
  collectionId: string;
  added: boolean;
  /** Only meaningful for `variant="badge"` (roving tabindex inside a results
      grid) - a `variant="cta"` button is a normal, always-tabbable control,
      so callers there have nothing to pass. */
  tabIndex?: number;
  onToggle: (added: boolean) => void;
  /** "badge" (default) - the absolutely-positioned tile-corner star every
      results grid uses. "cta" - IconQuickView.tsx's own full-size action
      row (a 28px icon-only star inside a plain
      text row read as "bad UI" and was easy to miss entirely) - a
      prominent, labeled "Add to collection" button when not yet saved, or
      a clear saved status plus a labeled "Remove" button once it is. Same
      mutation underneath either way - only the rendering forks, so there is
      still exactly one place that knows how to add/remove an icon from a
      collection (this file's own header comment). */
  variant?: "badge" | "cta";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function handleClick(event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;

    setBusy(true);
    setError(false);

    try {
      const response = await fetch(`/api/collections/${collectionId}/icons`, {
        method: added ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icon: iconId }),
      });
      if (!response.ok) {
        setError(true);
        setBusy(false);
        return;
      }
      const data = (await response.json().catch(() => null)) as { saved?: boolean } | null;
      setBusy(false);
      onToggle(Boolean(data?.saved));
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  if (variant === "cta") {
    const errorId = `add-to-collection-error-${iconId}`;

    /* Already saved: a clear status (filled star, never a dead click to
       stare at) plus an OBVIOUS, labeled Remove button - never icon-only,
       labeled, never icon-only. Removing
       flips `added` to false on the next render, which swaps this branch
       for the primary CTA below - so the same icon can be re-added right
       here if Remove was a misclick, no dead end either way. */
    if (added) {
      return (
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 text-meta font-semibold text-ink">
              <StarIcon filled size={18} />
              Saved to this collection
            </span>
            <button
              type="button"
              onClick={handleClick}
              disabled={busy}
              aria-busy={busy}
              aria-describedby={error ? errorId : undefined}
              className="press inline-flex items-center justify-center gap-2 rounded-btn border-2 border-ink bg-surface px-5 py-[13px] text-meta font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-[0.55]"
            >
              {busy && <SpinnerIcon size={14} />}
              Remove from this collection
            </button>
          </div>
          {error && <ErrorLine id={errorId} message={`Could not remove ${name} - try again`} />}
        </div>
      );
    }

    /* Not saved yet: ONE prominent, labeled CTA - primary treatment (same
       yellow/border-ink/press construction as every other primary action on
       this page), the star living inside it as decoration rather than
       standing in for the whole control. */
    return (
      <div>
        <button
          type="button"
          onClick={handleClick}
          disabled={busy}
          aria-busy={busy}
          aria-describedby={error ? errorId : undefined}
          className="press inline-flex w-full items-center justify-center gap-2 rounded-btn border-2 border-ink bg-primary px-6 py-[15px] text-body font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-[0.55]"
        >
          {busy ? <SpinnerIcon size={16} /> : <StarIcon filled={false} size={18} />}
          Add to collection
        </button>
        {error && <ErrorLine id={errorId} message={`Could not add ${name} - try again`} />}
      </div>
    );
  }

  const label = error
    ? `Could not update ${name} - try again`
    : added
      ? `${name} - added, tap to remove`
      : `Add ${name} to this collection`;

  return (
    <div className={`${TILE_BADGE_CLASS} z-10`}>
      <button
        type="button"
        onClick={handleClick}
        tabIndex={tabIndex}
        aria-label={label}
        aria-pressed={added}
        title={label}
        disabled={busy}
        aria-busy={busy}
        className={`touch-target-inset flex h-7 w-7 items-center justify-center rounded-full border-2 shadow-card transition-colors duration-120 ease-in disabled:cursor-not-allowed ${
          error ? "border-danger bg-surface text-danger" : "border-ink bg-surface text-ink"
        }`}
      >
        {busy ? <SpinnerIcon size={14} /> : <StarIcon filled={added} size={14} />}
      </button>
    </div>
  );
}
