import { useMemo, useState, type ReactNode } from "react";
import type { Tier } from "../../lib/data";
import type { IconEdits } from "../../lib/transforms/svg-doc";
import SearchIsland, {
  type CategoryLabel,
  type SetLabel,
} from "./SearchIsland";
import type { SearchHit } from "../../lib/search-config";
import SlideOver from "./SlideOver";
import CollectionIconGrid, { type CollectionIconItem } from "./CollectionIconGrid";
import CollectionStylePanel, { type CollectionStyleSettings } from "./CollectionStylePanel";
import CollectionDownloadPanel from "./CollectionDownloadPanel";
import IconQuickView from "./IconQuickView";

/** el:brush (pipeline/dist/bodies/el.jsonl) - the same path data as
    Icon.astro's "brush" glyph, duplicated inline because
    Icon.astro is a plain .astro component and cannot be used from a React
    island (same convention as every other icon in this file's neighbors,
    e.g. SaveButton.tsx's StarIcon). Standing rule: every UI glyph comes
    from the library's own pipeline data, never hand-drawn -
    see Icon.astro's header comment for the sourcing convention this
    follows. Elusive Icons draws on a 1200x1200 grid as a single filled
    path, hence viewBox 0 0 1200 1200 and fill="currentColor" on the path
    itself rather than this component's usual stroke setup. Rendered at
    20x20. */
function BrushIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 1200 1200"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        fill="currentColor"
        d="M1157.602.013c-46.711 2.677-736.479 591.498-793.123 798.838l130.736 136.944C868.899 624.199 988.915 294.221 1200 .649L1157.617 0zM323.267 840.562C87.09 927.418 235.147 1099.273 0 1183.352c266.294 59.953 384.296-49.748 454.003-205.421L323.267 840.548z"
      />
    </svg>
  );
}

/** Not a new hand-drawn glyph (the standing rule above still holds for
    anything actually new): this is Icon.astro's own existing `download`
    entry, the same stroke path FormatPreviewPanel.tsx's single-icon
    download button already uses - reusing it keeps "download" reading as
    one consistent symbol across the product instead of growing a second
    one for collections. Duplicated inline for the same reason BrushIcon is
    - Icon.astro cannot be used from a React island. */
function DownloadIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M12 3v12" />
      <path d="m7 10.5 5 5 5-5" />
      <path d="M4 20h16" />
    </svg>
  );
}

/**
 * The collection detail page's client-managed half: the icon grid, the
 * "Add icons" slide-over (a full SearchIsland reused wholesale rather than
 * a plain "Add more icons -> /search" link), and the "Set collection
 * styles" slide-over. One component
 * because all three share state that has to stay in sync: the grid's item
 * list is what the style panel's anchor picker shows, and what the add
 * panel's star states are checked against.
 *
 * Rename and Duplicate (items 3 and 4) live in CollectionHeaderControls.tsx
 * instead - neither needs to share state with the grid (Duplicate navigates
 * away entirely), so they stay a separate, simpler island next to the H1.
 */
export default function CollectionWorkspace({
  collectionId,
  collectionName,
  initialItems,
  initialStyleSettings,
  setLabels,
  categoryLabels,
  children,
}: {
  collectionId: string;
  /** "Download collection": the zip's own filename and the
      LICENSES.txt header. SSR-only (the page's H1, via
      CollectionHeaderControls.tsx, is a separate island) - a rename in the
      same session without a reload will not be reflected here, same
      already-accepted gap as every other cross-island value on this page. */
  collectionName: string;
  initialItems: CollectionIconItem[];
  initialStyleSettings: CollectionStyleSettings;
  setLabels: SetLabel[];
  categoryLabels: CategoryLabel[];
  /** Server-rendered resting-state set grid, forwarded into the Add-icons
      panel's SearchIsland exactly like /search.astro does at the top level -
      the same "container component" mechanism, one layer deeper. */
  children: ReactNode;
}) {
  const [items, setItems] = useState(initialItems);
  const [styleSettings, setStyleSettings] = useState(initialStyleSettings);

  const [addOpen, setAddOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);

  /* Quick view, ENTRY 1: `quickViewOpen` (the SlideOver's `open`) and
     `quickViewItem` (which icon it shows) are deliberately TWO separate
     pieces of state, not one nullable item doubling as both. If closing
     just set the item to null, the panel's content would vanish instantly
     while the SlideOver's own 200ms exit transition was still sliding it
     away - the same empty-flash bug class the other panels avoid by never
     tying their content to a nullable "current selection". `quickViewItem`
     is left stale (pointing at whatever was last opened) once set; only
     `quickViewOpen` toggles on close. */
  const [quickViewOpen, setQuickViewOpen] = useState(false);
  const [quickViewItem, setQuickViewItem] = useState<CollectionIconItem | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState("");

  const addedIconIds = useMemo(() => new Set(items.map((item) => item.iconId)), [items]);

  const edits: IconEdits = {
    color: styleSettings.color ?? undefined,
    strokeWidth: styleSettings.strokeWidth ?? undefined,
  };

  async function handleRemove(item: CollectionIconItem) {
    setBusyId(item.iconId);
    setErrorId(null);

    try {
      const response = await fetch(`/api/collections/${collectionId}/icons`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icon: item.iconId }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setErrorId(item.iconId);
        setRemoveError(data?.error ?? "Could not remove. Try again.");
        setBusyId(null);
        return;
      }

      setItems((prev) => prev.filter((i) => i.iconId !== item.iconId));
      setBusyId(null);
    } catch {
      setErrorId(item.iconId);
      setRemoveError("Could not remove. Try again.");
      setBusyId(null);
    }
  }

  function openQuickView(item: CollectionIconItem) {
    setQuickViewItem(item);
    setQuickViewOpen(true);
  }

  function handlePanelToggle(hit: SearchHit, added: boolean) {
    const iconId = `${hit.prefix}:${hit.name}`;
    if (added) {
      setItems((prev) =>
        prev.some((item) => item.iconId === iconId)
          ? prev
          : [
              ...prev,
              {
                iconId,
                prefix: hit.prefix,
                name: hit.name,
                /* hit.body is ALWAYS null (SearchHit's own doc comment - by
                   design, not "rare") - the fetch right below resolves the
                   real body within one round trip so this tile stops
                   rendering through StyledIconGlyph's fallback img almost as
                   soon as it lands; until then that fallback is itself
                   correctly styled (buildExportUrl), so there is no
                   unstyled window either way. */
                body: hit.body,
                width: hit.width,
                height: hit.height,
                tier: hit.tier,
                /* The degraded case CollectionIconLicense's own comment
                   describes: SearchHit has no author name/url (the search
                   index does not carry those), so a LICENSES.txt line for an
                   icon added this session, before the next reload, is
                   shorter than one the server rendered - still true, never
                   fabricated. */
                license: {
                  setName: hit.setName,
                  authorName: null,
                  authorUrl: null,
                  licenseName: hit.license,
                  licenseSpdx: null,
                  licenseUrl: null,
                  attributionRequired: hit.attributionRequired,
                },
              },
            ],
      );

      /* Close the body gap: resolve this
         icon's real body once, client-side, the same JSON endpoint
         IconQuickView.tsx's fetch-on-open uses - so an icon added this
         session ends up carrying its body exactly like a page-load icon
         does (/collections/[id].astro's own getIcon() resolve), regardless
         of when it was added. Fire-and-forget: on failure the tile just
         keeps rendering through StyledIconGlyph's (now correctly styled)
         fallback img, same honest degrade as before this existed. */
      fetch(`/api/icon/${hit.prefix}/${hit.name}.json`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { body: string; width: number; height: number; tier: Tier | null } | null) => {
          if (!data) return;
          setItems((prev) =>
            prev.map((item) =>
              item.iconId === iconId
                ? { ...item, body: data.body, width: data.width, height: data.height, tier: data.tier ?? item.tier }
                : item,
            ),
          );
        })
        .catch(() => {});
    } else {
      setItems((prev) => prev.filter((item) => item.iconId !== iconId));
    }
  }

  return (
    <div className="mt-8">
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="press inline-flex items-center justify-center gap-2 rounded-btn border-2 border-ink bg-primary px-6 py-[15px] text-body font-semibold text-ink"
        >
          Add icons
        </button>
        <button
          type="button"
          onClick={() => setStyleOpen(true)}
          className="on-navy press inline-flex items-center justify-center gap-2 rounded-btn border-2 border-ink bg-blue-deep px-6 py-[15px] text-body font-semibold text-white"
        >
          <BrushIcon />
          Set collection styles
        </button>
        {/* Far right of the row, and only once there is
            something to zip - an empty collection's own empty state already
            tells a visitor to add icons first, so a Download button here
            would just be a second, redundant dead end. */}
        {items.length > 0 && (
          <button
            type="button"
            onClick={() => setDownloadOpen(true)}
            /* Green, same construction as the yellow primary: border-ink
               + hard shadow (.press's default
               --press-shadow-color is ink regardless of fill), teal token
               fill with ink text - never teal-deep with white text, which
               reads under 4.5:1. Row: yellow Add icons, blue Set collection
               styles, green Download collection. */
            className="press ml-auto inline-flex items-center justify-center gap-2 rounded-btn border-2 border-ink bg-teal px-6 py-[15px] text-body font-semibold text-ink"
          >
            <DownloadIcon />
            Download collection
          </button>
        )}
      </div>

      <CollectionIconGrid
        items={items}
        edits={edits}
        busyId={busyId}
        errorId={errorId}
        error={removeError}
        onRemove={handleRemove}
        onOpenAdd={() => setAddOpen(true)}
        onOpenQuickView={openQuickView}
      />

      <SlideOver
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add icons"
        widthClassName="w-[90%]"
      >
        <div className="p-6">
          <SearchIsland
            syncUrl={false}
            setLabels={setLabels}
            categoryLabels={categoryLabels}
            collectionTarget={{
              id: collectionId,
              addedIconIds,
              onToggle: handlePanelToggle,
              savedEdits: edits,
              savedSize: styleSettings.size,
            }}
          >
            {children}
          </SearchIsland>
        </div>
      </SlideOver>

      <SlideOver
        open={styleOpen}
        onClose={() => setStyleOpen(false)}
        title="Set collection styles"
        widthClassName="w-full sm:max-w-[480px]"
      >
        <CollectionStylePanel
          collectionId={collectionId}
          items={items}
          initialSettings={styleSettings}
          savedEdits={edits}
          onSaved={setStyleSettings}
        />
      </SlideOver>

      <SlideOver
        open={downloadOpen}
        onClose={() => setDownloadOpen(false)}
        title="Download collection"
        widthClassName="w-full sm:max-w-[480px]"
      >
        <CollectionDownloadPanel
          collectionId={collectionId}
          collectionName={collectionName}
          items={items}
          styleSettings={styleSettings}
          savedEdits={edits}
          onFormatSaved={(exportFormat) =>
            setStyleSettings((prev) => ({ ...prev, exportFormat }))
          }
        />
      </SlideOver>

      {/* ENTRY 1: closing this IS "back" - there is
          no separate listing state inside the quick view to return to, so
          `onBack` is omitted (see IconQuickView.tsx's own doc comment on
          what each entry point does and doesn't pass). `collectionStar` IS
          passed here too: the grid tile behind
          this panel already has its own remove control, but a full-size,
          labeled "Remove"/"Add to collection" row inside the quick view
          itself is unmissable in a way a 28px corner icon on a tile the
          visitor would have to close this panel to reach is not - the same
          AddToCollectionStar the add-panel entry uses, so `added` flipping
          to false after a remove swaps this straight back to the primary
          "Add to collection" CTA (no dead end - it can be re-added from
          right here, using the item this panel already has in hand rather
          than a second fetch). */}
      <SlideOver
        open={quickViewOpen}
        onClose={() => setQuickViewOpen(false)}
        title={quickViewItem?.name ?? "Icon"}
        widthClassName="w-full sm:max-w-[640px]"
      >
        {quickViewItem && (
          <IconQuickView
            icon={quickViewItem}
            tier={quickViewItem.tier}
            savedEdits={edits}
            savedSize={styleSettings.size}
            collectionStar={{
              collectionId,
              iconId: quickViewItem.iconId,
              name: quickViewItem.name,
              added: addedIconIds.has(quickViewItem.iconId),
              onToggle: (added) => {
                if (added) {
                  setItems((prev) =>
                    prev.some((item) => item.iconId === quickViewItem.iconId)
                      ? prev
                      : [...prev, quickViewItem],
                  );
                } else {
                  setItems((prev) => prev.filter((item) => item.iconId !== quickViewItem.iconId));
                }
              },
            }}
          />
        )}
      </SlideOver>
    </div>
  );
}
