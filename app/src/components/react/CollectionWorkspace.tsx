import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import type { CollectionIconLicense } from "../../lib/collection-download";
import { saveCollectionStyles } from "../../lib/collection-style-save";
import { registerWebMcpTools } from "../../lib/webmcp/bridge";
import {
  createCollectionTools,
  type CollectionDownloadResult,
  type CollectionSnapshot,
  type CollectionStyleReport,
  type CollectionStyleRequest,
  type CollectionToolHandle,
} from "../../lib/webmcp/collection-tools";

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

/** What /api/icon/[prefix]/[name].json answers with - everything a tile
    needs that a SearchHit (or an agent's bare prefix/name) cannot carry. */
interface IconDetailDTO {
  body: string;
  width: number;
  height: number;
  tier: Tier | null;
  license: CollectionIconLicense | null;
}

/** How long a WebMCP `download_collection` call waits for the download panel
    to open and point the browser at the zip. Short, because that is all it
    waits for now: the zip is built by the server behind a plain URL, so
    "the browser has it" is the honest end of this call - how long the file
    then takes to arrive is the browser's business, exactly as it is for a
    person who clicked the link. */
const DOWNLOAD_TIMEOUT_MS = 10_000;

/** The style settings, in the shape the WebMCP tools speak: an icon pair
    instead of a "prefix:name" string, and no server-computed targets (an
    agent can do nothing with a fingerprint it cannot render). */
function toStyleReport(settings: CollectionStyleSettings): CollectionStyleReport {
  const [prefix, name] = (settings.anchorIconId ?? "").split(":");
  return {
    anchorIcon: prefix && name ? { prefix, name } : null,
    color: settings.color,
    strokeWidth: settings.strokeWidth,
    size: settings.size,
    exportFormat: settings.exportFormat,
  };
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
 *
 * WEBMCP: this component is also what an agent driving the browser can
 * operate (lib/webmcp/collection-tools.ts). Because all four surfaces
 * already share their state here, the tools need no machinery of their own -
 * they call the same functions the buttons call, so an agent adding an icon
 * or setting a shared look produces exactly the tile and the re-render the
 * human would have produced by hand, on the screen they are already
 * watching. There is deliberately no agent-only fetch anywhere below.
 */
export default function CollectionWorkspace({
  collectionId,
  collectionName,
  downloadToken,
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
  /** The signed, 15-minute proof that the zip URL carries so a cookieless
      download manager can fetch it. Minted by this page's SSR pass, which
      is where the session and the ownership check actually happened - see
      lib/download-token.ts. Forwarded untouched to the download panel. */
  downloadToken: string;
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

  /* The Add-icons panel's embedded search, when something other than the
     human opened it: `open_add_icons_panel` can pre-run a query so the
     person lands on candidates instead of an empty box. The nonce remounts
     the SearchIsland (it seeds from `initialQuery` on mount), which matters
     only when the panel is ALREADY open - SlideOver unmounts its children on
     close, so a normal open is a fresh island either way. Cleared on close,
     so the human's own next "Add icons" click opens the resting panel it
     always did. */
  const [addSeed, setAddSeed] = useState({ query: "", nonce: 0 });

  /* Set by `download_collection` only: the download panel starts zipping the
     moment it mounts, instead of waiting for the button the human would
     press. `downloadWaiter` is how that flow's result gets back to the
     agent - the same "resolve with what the human can see" contract
     SearchIsland.tsx's search waiters use. */
  const [downloadAutoStart, setDownloadAutoStart] = useState(false);
  const downloadWaiter = useRef<((result: CollectionDownloadResult) => void) | null>(null);

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

  /* What is on screen right now, for the WebMCP handle below. A tool call
     can arrive between renders, and an agent that read a stale item list
     would describe tiles that are no longer there - so the handle reads this
     ref, written from an effect (after the DOM), never a render closure. */
  const latest = useRef({ items, styleSettings });
  useEffect(() => {
    latest.current = { items, styleSettings };
  });

  /** Returns whether the removal actually landed, so a caller that has to
      report back - the WebMCP tool - can say what happened instead of
      guessing from the UI state it cannot see. The grid's own Remove button
      ignores the return value: for a human, the error line this already sets
      IS the report. */
  async function handleRemove(item: CollectionIconItem): Promise<{ ok: true } | { ok: false; error: string }> {
    setBusyId(item.iconId);
    setErrorId(null);

    const fail = (message: string) => {
      setErrorId(item.iconId);
      setRemoveError(message);
      setBusyId(null);
      return { ok: false as const, error: message };
    };

    try {
      const response = await fetch(`/api/collections/${collectionId}/icons`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icon: item.iconId }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        return fail(data?.error ?? "Could not remove. Try again.");
      }

      setItems((prev) => prev.filter((i) => i.iconId !== item.iconId));
      setBusyId(null);
      return { ok: true };
    } catch {
      return fail("Could not remove. Try again.");
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
                /* What SearchHit alone can say: no author name/url, since
                   the search index does not carry those. The fetch below
                   replaces this with the full license the server has, so the
                   shortfall lasts one round trip rather than until the next
                   reload - never fabricated either way. */
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

      /* Close the body and license gaps: resolve this icon's real body and
         its set's full license line once, client-side, from the same JSON
         endpoint IconQuickView.tsx's fetch-on-open uses - so an icon added
         this session ends up carrying exactly what a page-load icon carries
         (/collections/[id].astro's own getIcon()+getSet() resolve),
         regardless of when it was added. Fire-and-forget: on failure the
         tile just keeps rendering through StyledIconGlyph's (now correctly
         styled) fallback img with the shorter license above, same honest
         degrade as before this existed. */
      fetch(`/api/icon/${hit.prefix}/${hit.name}.json`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data: IconDetailDTO | null) => {
          if (!data) return;
          setItems((prev) =>
            prev.map((item) =>
              item.iconId === iconId
                ? {
                    ...item,
                    body: data.body,
                    width: data.width,
                    height: data.height,
                    tier: data.tier ?? item.tier,
                    license: data.license ?? item.license,
                  }
                : item,
            ),
          );
        })
        .catch(() => {});
    } else {
      setItems((prev) => prev.filter((item) => item.iconId !== iconId));
    }
  }

  /* --------------------------------------------------------------------
     WebMCP - the same four actions, driven by an agent instead of a cursor.

     Every function below goes through the endpoints the buttons above go
     through, in the same order, and updates the same `items`/`styleSettings`
     state the grid renders from. That is the whole point: the human watching
     this page sees the agent's work as tiles landing, a grid re-rendering in
     new colors, a panel sliding open - not as a summary it has to take on
     trust. They can veto anything with the controls already in front of
     them.
     -------------------------------------------------------------------- */

  /** Set name for an icon whose tile has not resolved a license yet - the
      page already has the whole set list for the Add-icons panel's facet
      rail, so no request is needed to name a set. */
  const setNameFor = useCallback(
    (prefix: string) => setLabels.find((label) => label.prefix === prefix)?.name ?? prefix,
    [setLabels],
  );

  const addIconById = useCallback(
    async (prefix: string, name: string) => {
      const iconId = `${prefix}:${name}`;
      const existing = latest.current.items.find((item) => item.iconId === iconId);
      if (existing) {
        /* Idempotent, exactly like the API underneath: already saved is a
           calm success, not an error and not a second tile. */
        return {
          added: false,
          count: latest.current.items.length,
          set: existing.license?.setName ?? setNameFor(prefix),
        };
      }

      /* Resolve the icon BEFORE saving it: an agent types identifiers from
         memory far more often than a human clicks a wrong star, and "there
         is no such icon" is a much more useful answer than a collection row
         pointing at nothing. This is also the request that gives the tile
         its body and license, so it is not an extra round trip. */
      const detailResponse = await fetch(`/api/icon/${prefix}/${name}.json`);
      if (!detailResponse.ok) {
        throw new Error(
          `There is no icon called ${iconId} in the library. Check the set prefix and the icon name - search_icons on the library page returns exact ones.`,
        );
      }
      const detail = (await detailResponse.json()) as IconDetailDTO;

      const response = await fetch(`/api/collections/${collectionId}/icons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icon: iconId }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Could not add ${iconId}. Try again.`);
      }

      setItems((prev) =>
        prev.some((item) => item.iconId === iconId)
          ? prev
          : [
              ...prev,
              {
                iconId,
                prefix,
                name,
                body: detail.body,
                width: detail.width,
                height: detail.height,
                tier: detail.tier,
                license: detail.license,
              },
            ],
      );

      return {
        added: true,
        count: latest.current.items.length + 1,
        set: detail.license?.setName ?? setNameFor(prefix),
      };
    },
    [collectionId, setNameFor],
  );

  const applyStyles = useCallback(
    async (request: CollectionStyleRequest) => {
      const current = latest.current.styleSettings;
      const anchorIconId =
        request.anchorIcon === undefined
          ? current.anchorIconId
          : request.anchorIcon
            ? `${request.anchorIcon.prefix}:${request.anchorIcon.name}`
            : null;

      /* A full-replace PUT (that route's own comment), so every field is
         sent every time - the collection's current value for anything the
         agent did not mention. Same helper the Save styles button uses. */
      const result = await saveCollectionStyles(collectionId, {
        anchorIconId,
        color: request.color === undefined ? current.color : request.color,
        strokeWidth:
          request.strokeWidth === undefined ? current.strokeWidth : request.strokeWidth,
        size: request.size === undefined ? current.size : request.size,
        exportFormat: request.exportFormat ?? current.exportFormat,
      });
      if (!result.ok) throw new Error(result.error);

      setStyleSettings(result.settings);
      return toStyleReport(result.settings);
    },
    [collectionId],
  );

  const webmcpHandle = useMemo<CollectionToolHandle>(() => {
    const readSnapshot = (): CollectionSnapshot => {
      const state = latest.current;
      return {
        id: collectionId,
        name: collectionName,
        count: state.items.length,
        icons: state.items.map((item) => ({
          name: item.name,
          set: item.license?.setName ?? setNameFor(item.prefix),
          prefix: item.prefix,
        })),
        styles: toStyleReport(state.styleSettings),
      };
    };

    return {
      snapshot: readSnapshot,
      addIcon: ({ prefix, name }) => addIconById(prefix, name),
      async removeIcon({ prefix, name }) {
        const iconId = `${prefix}:${name}`;
        const item = latest.current.items.find((candidate) => candidate.iconId === iconId);
        /* The tool checks membership first and refuses with the member list,
           so reaching this is a race (the human removed the same tile a
           moment earlier), not a bad call - answer with the count either
           way rather than inventing a failure. */
        if (!item) return { count: latest.current.items.length };
        const result = await handleRemove(item);
        if (!result.ok) throw new Error(result.error);
        return { count: latest.current.items.length - 1 };
      },
      setStyles: applyStyles,
      openAddPanel(query) {
        if (query !== null) setAddSeed((prev) => ({ query, nonce: prev.nonce + 1 }));
        setAddOpen(true);
      },
      async download(format) {
        if (format && format !== latest.current.styleSettings.exportFormat) {
          /* Persist the format the same way the download panel does when a
             visitor picks a different one, so the panel opens preselected on
             it and the collection remembers it afterwards. */
          await applyStyles({ exportFormat: format });
        }

        const settled = new Promise<CollectionDownloadResult>((resolve) => {
          downloadWaiter.current = resolve;
          window.setTimeout(() => {
            if (!downloadWaiter.current) return;
            downloadWaiter.current = null;
            resolve({
              ok: false,
              count: latest.current.items.length,
              format: latest.current.styleSettings.exportFormat,
              filename: "",
              url: "",
              error:
                "The download panel did not open in time for me to confirm the file was handed to the person's browser.",
            });
          }, DOWNLOAD_TIMEOUT_MS);
        });

        setDownloadAutoStart(true);
        setDownloadOpen(true);
        return settled;
      },
    };
    /* handleRemove is a plain function redefined each render and is
       deliberately NOT a dependency: it closes over nothing that changes
       (collectionId and the state setters are stable), and listing it would
       rebuild the handle - and so re-register every tool - on every
       render. */
  }, [addIconById, applyStyles, collectionId, collectionName, setNameFor]);

  useEffect(() => registerWebMcpTools(createCollectionTools(webmcpHandle)), [webmcpHandle]);

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
        onClose={() => {
          setAddOpen(false);
          /* Drop any query an agent seeded, so the human's own next "Add
             icons" click opens the resting panel, exactly as before. */
          if (addSeed.query) setAddSeed((prev) => ({ query: "", nonce: prev.nonce + 1 }));
        }}
        title="Add icons"
        widthClassName="w-[90%]"
      >
        <div className="p-6">
          <SearchIsland
            key={addSeed.nonce}
            initialQuery={addSeed.query}
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
        onClose={() => {
          setDownloadOpen(false);
          setDownloadAutoStart(false);
        }}
        title="Download collection"
        widthClassName="w-full sm:max-w-[480px]"
      >
        <CollectionDownloadPanel
          collectionId={collectionId}
          collectionName={collectionName}
          downloadToken={downloadToken}
          items={items}
          styleSettings={styleSettings}
          savedEdits={edits}
          onFormatSaved={(exportFormat) =>
            setStyleSettings((prev) => ({ ...prev, exportFormat }))
          }
          autoStart={downloadAutoStart}
          onAutoStartSettled={(result) => {
            const waiter = downloadWaiter.current;
            downloadWaiter.current = null;
            waiter?.(result);
          }}
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
