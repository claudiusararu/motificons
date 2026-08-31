import { useEffect, useId, useRef, useState } from "react";
import SaveCollectionPanel from "./save/SaveCollectionPanel";
import QuickSaveToast, { useQuickSaveToast } from "./save/QuickSaveToast";
import { getLastCollection, setLastCollection } from "./save/lastCollection";
import { StarIcon, SpinnerIcon } from "./save/icons";
import { useSavePicker } from "./save/useSavePicker";

const BUTTON_SECONDARY_SM =
  "press press-sm relative inline-flex items-center justify-center gap-2 rounded-control border-2 border-ink bg-surface text-body font-semibold leading-[1.25] text-ink disabled:cursor-not-allowed disabled:opacity-[0.55]";

/**
 * The Save control on the icon detail page. Saving needs an
 * account - a free one - because a collection has to belong to somebody;
 * nothing else on this page does. CRITICAL: this page is edge-cached for a
 * day and shared across every visitor, so nothing about this component's
 * INPUT can be session-specific - it only ever receives `iconId`, which is
 * public data. Everything session-shaped (signed in? which collections
 * already have this icon?) is resolved client-side, after hydration, from
 * IconEditor.tsx's single useAccount() call - `signedIn`/`accountLoading`
 * are passed in from that same call so this never fires a second one.
 *
 * The picker's collections list (and therefore this icon's saved state) DOES
 * load eagerly for a signed-in visitor - one extra request beyond
 * /api/entitlements, gated on `signedIn` so an anonymous visitor (the
 * overwhelming majority of the 337k icon pages' traffic) never fires it.
 * That is the one place this differs from SaveStar (the search grid's
 * quick-save star): a single detail page can afford one eager fetch to
 * paint the right star state on load; a grid of dozens of tiles cannot.
 */
export default function SaveButton({
  iconId,
  signedIn,
  accountLoading,
}: {
  iconId: string;
  signedIn: boolean;
  accountLoading: boolean;
}) {
  const panelId = useId();
  const tooltipId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [quickBusy, setQuickBusy] = useState(false);
  const { toast, showToast, dismiss: dismissToast } = useQuickSaveToast();

  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  function handleSaved(collection: { id: string; name: string }) {
    setLastCollection(collection);
    if (!openRef.current) {
      showToast(`Saved to ${collection.name}`, () => {
        setOpen(true);
        if (picker.listStatus === "idle") picker.loadCollections();
      });
    }
  }

  const picker = useSavePicker(iconId, handleSaved);

  /* Eager load, signed-in only (see header comment). Runs once the account
     answer lands; a no-op if the visitor has no account or it already
     ran. */
  useEffect(() => {
    if (accountLoading || !signedIn) return;
    if (picker.listStatus !== "idle") return;
    picker.loadCollections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountLoading, signedIn]);

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

  /* The same default-collection + toast + Change pattern SaveStar.tsx (the
     search grid's quick-save star) uses, rather than always opening the
     picker - a signed-in visitor's click saves straight to (or removes
     straight from) the last-used collection;
     the picker only opens as a fallback (no last collection yet, a stale/
     over-cap/network error) or via the toast's own "Change" escape hatch. */
  async function handleTriggerClick() {
    if (accountLoading || quickBusy) return;
    if (open) {
      setOpen(false);
      return;
    }

    /* Anonymous: the signed-out prompt below (SaveCollectionPanel's own
       !signedIn branch) invites a free account. */
    if (!signedIn) {
      setOpen(true);
      return;
    }

    const last = getLastCollection();
    if (!last) {
      setOpen(true);
      if (picker.listStatus === "idle") picker.loadCollections();
      return;
    }

    /* Whether THIS icon is in the default (last-used) collection
       specifically - the eager load above means `picker.collections` is
       almost always already accurate by the time the visitor can click,
       unlike SaveStar.tsx's grid (which never eager-loads per tile). */
    const defaultEntry = picker.collections.find((option) => option.id === last.id);
    const savedInDefault = defaultEntry ? defaultEntry.saved : false;

    setQuickBusy(true);
    const outcome = await picker.toggle({ id: last.id, name: last.name, saved: savedInDefault });
    setQuickBusy(false);

    if (outcome === "removed") {
      if (!openRef.current) {
        showToast(`Removed from ${last.name}`, () => {
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

  const label = picker.savedAnywhere ? "Saved - manage collections" : "Save to collection";

  return (
    <div ref={containerRef} className="absolute right-4 top-4">
      <button
        ref={triggerRef}
        type="button"
        onClick={handleTriggerClick}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        aria-describedby={tooltipId}
        disabled={accountLoading}
        aria-busy={accountLoading || quickBusy}
        className={`group ${BUTTON_SECONDARY_SM} h-11 w-11 !px-0 !py-0 shadow-card`}
      >
        {accountLoading || quickBusy ? <SpinnerIcon /> : <StarIcon filled={picker.savedAnywhere} />}
        <span
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none absolute right-full top-1/2 mr-2 -translate-y-1/2 whitespace-nowrap rounded-control border-2 border-ink bg-ink px-2.5 py-1 text-pill font-semibold text-canvas opacity-0 shadow-card transition-opacity duration-120 ease-in group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          {label}
        </span>
      </button>

      {open && (
        <div
          id={panelId}
          ref={panelRef}
          role="dialog"
          aria-label={signedIn ? "Save to a collection" : "Save to a collection - account needed"}
          tabIndex={-1}
          className="absolute right-0 top-full z-20 mt-2 w-72 rounded-card border-2 border-ink bg-surface p-4 text-left shadow-hard focus:outline-none"
        >
          <SaveCollectionPanel panelId={panelId} signedIn={signedIn} picker={picker} />
        </div>
      )}

      <QuickSaveToast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
