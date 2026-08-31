import { useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { TILE_BADGE_CLASS } from "../../../lib/tile-classes";
import SaveCollectionPanel from "./SaveCollectionPanel";
import { SpinnerIcon, StarIcon } from "./icons";
import { getLastCollection, setLastCollection } from "./lastCollection";
import { useSavePicker } from "./useSavePicker";

/**
 * Quick-save star on a search results tile (SPEC follow-up, 2026-08-08):
 * bulk-saving from the grid without opening each icon page. Reuses
 * useSavePicker/SaveCollectionPanel - the exact machinery SaveButton.tsx
 * uses on the icon detail page - rather than a second implementation.
 *
 * First use on a fresh browser opens the full picker (same as the detail
 * page). Once a collection has been used once, later stars save straight to
 * it (POST is idempotent - see collection-items API - so re-saving an icon
 * already in that collection is a harmless no-op) and surface a small toast
 * with a "Change" escape hatch back to the full picker. `onQuickSaved` is
 * owned by the grid (SearchIsland) because only one toast should be visible
 * at a time across potentially dozens of tiles.
 *
 * Rendered as a sibling of the tile's `<a>`, never nested inside it - a
 * `<button>` inside an `<a>` is invalid HTML (same reasoning as
 * CollectionIconGrid's remove control).
 */
export default function SaveStar({
  iconId,
  name,
  signedIn,
  accountLoading,
  tabIndex,
  onQuickSaved,
}: {
  iconId: string;
  name: string;
  /** Resolved once for the whole grid by whichever parent owns the single
      shared /api/entitlements call (SearchIsland.tsx, TileStars.tsx) and
      threaded down, rather than one request per tile. */
  signedIn: boolean;
  accountLoading: boolean;
  tabIndex: number;
  onQuickSaved: (message: string, onChange: () => void) => void;
}) {
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [quickBusy, setQuickBusy] = useState(false);
  /* Known-saved only once this tile has actually seen a successful save or
     loaded its own collections list - the grid deliberately never prefetches
     this for every tile (PM decision: dozens of tiles is a real request
     batch). Starts unknown/false, same "resolve lazily" posture as the
     picker's own `savedAnywhere`. */
  const [savedLocally, setSavedLocally] = useState(false);

  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  function handleSaved(collection: { id: string; name: string }) {
    setLastCollection(collection);
    setSavedLocally(true);
    if (!openRef.current) {
      onQuickSaved(`Saved to ${collection.name}`, () => {
        setOpen(true);
        if (picker.listStatus === "idle") picker.loadCollections();
      });
    }
  }

  const picker = useSavePicker(iconId, handleSaved);
  const saved = savedLocally || picker.savedAnywhere;

  function closePanel() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;

    function onDocMouseDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closePanel();
    }

    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  async function handleClick(event: ReactMouseEvent<HTMLButtonElement>) {
    /* Stop the click reaching anything the tile wrapper listens on - the
       star is a sibling of the tile link, not a descendant, so this is
       belt-and-braces rather than a navigation guard. */
    event.preventDefault();
    event.stopPropagation();

    if (accountLoading || quickBusy) return;

    if (open) {
      setOpen(false);
      return;
    }

    /* Anonymous: the signed-out prompt (SaveCollectionPanel's own
       !signedIn branch - the same one the icon detail page's Save flow
       shows). Collections need an account; the account is free. */
    if (!signedIn) {
      setOpen(true);
      if (picker.listStatus === "idle") picker.loadCollections();
      return;
    }

    const last = getLastCollection();
    if (!last) {
      setOpen(true);
      if (picker.listStatus === "idle") picker.loadCollections();
      return;
    }

    /* The real toggle target: whether THIS icon is in the default (last-
       used) collection specifically, not "saved somewhere" - a picker list
       that has already loaded knows this precisely; otherwise fall back to
       this control's own session-local memory of what it last did, the same
       resolve-lazily posture `saved`/`savedLocally` already use. */
    const defaultEntry = picker.collections.find((option) => option.id === last.id);
    const savedInDefault = defaultEntry ? defaultEntry.saved : savedLocally;

    setQuickBusy(true);
    const outcome = await picker.toggle({ id: last.id, name: last.name, saved: savedInDefault });
    setQuickBusy(false);

    if (outcome === "removed") {
      setSavedLocally(false);
      /* Mirrors handleSaved's own guard: a removal that happened while the
         panel is open (e.g. a row click inside it) already shows its own
         visual confirmation - the toast is for the panel-closed quick-click
         path only. */
      if (!openRef.current) {
        onQuickSaved(`Removed from ${last.name}`, () => {
          setOpen(true);
          if (picker.listStatus === "idle") picker.loadCollections();
        });
      }
      return;
    }

    if (outcome !== "saved") {
      /* Stale last-used collection (deleted), over the collection cap, or a
         network error - all three need the full picker so the visitor can
         see why and choose again, instead of a star click that silently did
         nothing - a control that does nothing does not ship. */
      setOpen(true);
      if (picker.listStatus === "idle") picker.loadCollections();
    }
    /* outcome === "saved": handleSaved (useSavePicker's onSaved callback,
       above) already fired the toast - see its own guard. */
  }

  const label = saved ? `${name} - saved, manage collections` : `Save ${name} to a collection`;
  const forceVisible = open || quickBusy || saved;

  return (
    <div ref={containerRef} className={`${TILE_BADGE_CLASS} z-10`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleClick}
        tabIndex={tabIndex}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        title={label}
        disabled={accountLoading}
        aria-busy={accountLoading || quickBusy}
        className={`touch-target-inset flex h-7 w-7 items-center justify-center rounded-full border-2 border-ink bg-surface text-ink shadow-card transition-opacity duration-120 ease-in disabled:cursor-not-allowed ${
          forceVisible ? "opacity-100 pointer-events-auto" : "quick-save-star"
        }`}
      >
        {accountLoading || quickBusy ? <SpinnerIcon size={14} /> : <StarIcon filled={saved} size={14} />}
      </button>

      {open && (
        <div
          id={panelId}
          ref={panelRef}
          role="dialog"
          aria-label={signedIn ? "Save to a collection" : "Save to a collection - account needed"}
          tabIndex={-1}
          className="absolute right-0 top-full z-20 mt-2 w-72 rounded-card border-2 border-ink bg-surface p-4 text-left shadow-hard focus:outline-none"
          onClick={(event) => event.stopPropagation()}
        >
          <SaveCollectionPanel panelId={panelId} signedIn={signedIn} picker={picker} />
        </div>
      )}
    </div>
  );
}
