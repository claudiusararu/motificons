import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import type {
  SearchHit,
  SearchResponse,
  SearchSuccess,
  SearchLimited,
} from "../../lib/search-config";
import type { IconEdits } from "../../lib/transforms/svg-doc";
import { isPlainLeftClick } from "../../lib/quick-view";
import {
  TILE_CLASS,
  TILE_GLYPH_CLASS,
  TILE_GRID_CLASS,
  TILE_NAME_CLASS,
} from "../../lib/tile-classes";
import { useAccount } from "./useAccount";
import SaveStar from "./save/SaveStar";
import AddToCollectionStar from "./save/AddToCollectionStar";
import QuickSaveToast, { useQuickSaveToast } from "./save/QuickSaveToast";
import IconQuickView from "./IconQuickView";
import {
  EMPTY_SELECTED,
  buildSearchUrl,
  type FacetKey,
  type Selected,
} from "../../lib/search/url-state";
import { registerWebMcpTools } from "../../lib/webmcp/bridge";
import {
  createSearchTools,
  toSnapshot,
  toToolHit,
  type SearchOutcome,
  type SearchSnapshot,
  type SearchToolHandle,
} from "../../lib/webmcp/search-tools";
import { planFacetChanges } from "../../lib/webmcp/facet-plan";

const DEBOUNCE_MS = 300;
/** The first page of results (offset 0). Every
    subsequent Load more page stays at LOAD_MORE_PAGE_SIZE. */
const INITIAL_PAGE_SIZE = 100;
const LOAD_MORE_PAGE_SIZE = 60;
/** Sets shown in the rail before "show all" - the rest are a type-to-filter. */
const SET_FACET_LIMIT = 15;
/** Categories shown in the rail before "show all" - same pattern as sets. */
const CATEGORY_FACET_LIMIT = 15;
/** How long a WebMCP tool waits for a search to land before it answers the
    agent with an error instead of hanging on an unresolved promise. */
const WEBMCP_TIMEOUT_MS = 15000;

const TIER_LABEL: Record<string, string> = {
  T1: "Restyles fully",
  T2: "Recolor + resize",
  T3: "Multicolor",
  T4: "Ships as drawn",
};

const SUGGESTIONS = [
  "arrow right",
  "settings",
  "user",
  "chevron",
  "calendar",
  "trash",
  "heart",
  "search",
];

/** Names for the set chips, so a filtered view can say "Tabler Icons" not "tabler". */
export interface SetLabel {
  prefix: string;
  name: string;
  icons: number;
}

/** Names and global counts for the category chips/pills - counts always come
    from the pipeline's categories.json (counts are data), never from a live
    facet, so the rail reads the same whether resting, browsing or searching. */
export interface CategoryLabel {
  slug: string;
  tag: string;
  icons: number;
}

/**
 * The library.
 *
 * One layout - search on top, facet rail left, content right - and only the
 * content grid changes:
 *
 *   resting  no query, no filters   -> the server-rendered set grid (children)
 *   set      a set filter, no query -> that set's icons, browse, unmetered
 *   results  a query               -> search results, metered when signed out
 *
 * The meter belongs to anonymous visitors only. A signed-in visitor gets
 * `meter: null` from /api/search and this island then shows no counter and no
 * limit state anywhere - there is nothing to count.
 *
 * The URL follows the state rather than the route: /search while resting,
 * /{prefix} while browsing a set, /search?q= while searching. Those are all
 * real server-rendered pages, so a shared link, a crawler and the back button
 * all land somewhere true - the takeover is only ever an optimisation on top
 * of URLs that already work.
 */
export interface CollectionTarget {
  id: string;
  /** "prefix:name" ids already in the collection - controls each tile's
      star state without a per-tile fetch, kept in sync by the caller as
      icons are added/removed here or from the grid behind the panel. */
  addedIconIds: Set<string>;
  /** Carries the full hit (not just its id) so the caller can append a new
      tile to its own grid without a second fetch, so the collection grid
      reflects additions live. Irrelevant on removal, but passed for a consistent shape. */
  onToggle: (hit: SearchHit, added: boolean) => void;
  /** Quick-view ENTRY 2: the collection's saved color/stroke and size -
      IconQuickView.tsx's preview/exports start from these exactly like the
      grid behind this panel already renders every icon with them, whether
      or not the one being quick-viewed has actually been added yet. */
  savedEdits: IconEdits;
  savedSize: number | null;
}

/** Quick view ENTRY 2's scroll-preserving swap: the nearest scrollable
    ancestor of `node` (an `overflow-y: auto/scroll` element whose content
    actually overflows it), or `window` when none is found - covers both
    contexts this component runs in without knowing which one it is: the
    standalone /search page (page scroll) and the Add-icons SlideOver (whose
    own inner wrapper is the scrollable element, not anything inside
    SearchIsland itself). Not a pure function (walks real DOM/computed
    style), so unlike quick-view.ts's helpers this one is not unit-tested -
    this project's convention is pure-function tests only; a DOM-walking
    helper's correctness only means anything against a real layout, which
    circles back to "no browser available" the same way every other
    interaction claim in this session has. */
function findScrollParent(node: HTMLElement | null): HTMLElement | Window {
  let current = node?.parentElement ?? null;
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    const scrollable = style.overflowY === "auto" || style.overflowY === "scroll";
    if (scrollable && current.scrollHeight > current.clientHeight) return current;
    current = current.parentElement;
  }
  return window;
}

export default function SearchIsland({
  initialQuery = "",
  initialSets = [],
  initialStyle = [],
  initialLicense = [],
  initialTier = [],
  initialNoAttribution = false,
  initialCategory = "",
  basePath = "/search",
  setLabels = [],
  categoryLabels = [],
  collectionTarget,
  syncUrl = true,
  children,
}: {
  initialQuery?: string;
  /** Server-rendered set-filter state, when the island boots already filtered. */
  initialSets?: string[];
  /** The rest of the facet rail, server-parsed the same way - a shared link
      like the icon detail page's "browse icons with a stroke to retarget"
      (?tier=T1) has to land already filtered, not just land on /search and
      silently drop the facet. */
  initialStyle?: string[];
  initialLicense?: string[];
  initialTier?: string[];
  initialNoAttribution?: boolean;
  /** A category page's "Search in this category" link lands here already
      filtered (?category=<slug>) the same way. */
  initialCategory?: string;
  basePath?: string;
  setLabels?: SetLabel[];
  categoryLabels?: CategoryLabel[];
  /** Set only inside a collection's "Add icons" slide-over: every tile's
      save-star becomes a direct,
      one-click, no-picker add/remove against THIS collection instead of the
      normal collection picker. Metering and everything else about search is
      unchanged - only the star swaps. */
  collectionTarget?: CollectionTarget;
  /** Off inside the Add-icons panel (CollectionWorkspace.tsx): this instance
      lives inside a slide-over on top of /collections/[id], so it must never
      push/replace the browser's URL to /search or /{prefix} - that would
      silently navigate the address bar away from the collection page the
      visitor is still looking at, and corrupt the back button. The actual
      search request/results/metering are unaffected; only the three
      URL-touching effects (focus-param cleanup, state->URL sync, popstate
      restore) are skipped. Defaults to true - every top-level page usage
      (/search, /{prefix} via the set-filter state) wants the real thing. */
  syncUrl?: boolean;
  /** Server-rendered resting content. Stays mounted so returning is instant. */
  children?: ReactNode;
}) {
  const [input, setInput] = useState(initialQuery);
  const [committed, setCommitted] = useState(initialQuery);
  const [selected, setSelected] = useState<Selected>({
    prefix: initialSets,
    style: initialStyle,
    license: initialLicense,
    tier: initialTier,
    noAttribution: initialNoAttribution,
    category: initialCategory || null,
  });
  const [setQuery, setSetQuery] = useState("");
  const [showAllSets, setShowAllSets] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState("");
  const [showAllCategories, setShowAllCategories] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<SearchSuccess | null>(null);
  const [extraHits, setExtraHits] = useState<SearchHit[]>([]);
  const [limited, setLimited] = useState<SearchLimited | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);

  /* One account fetch for the whole grid (SaveStar's quick-save star,
     rendered once per tile) - not one per tile, which at 60 tiles a page
     would turn a single results render into 60 requests. Same call shape
     IconEditor.tsx uses on the icon detail page. */
  const { signedIn, ready: accountReady } = useAccount();
  const { toast, showToast, dismiss: dismissToast } = useQuickSaveToast();

  const gridRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);

  /* WebMCP: an agent driving this page calls tools that must resolve with what
     the human can actually SEE, so every tool that runs a search waits here
     until the island's own fetch has landed and re-rendered the grid. The
     waiters are drained by `settleSearch` from the one effect below that owns
     the request - there is no second, agent-only search path, which is what
     keeps the daily meter honest. */
  const searchWaiters = useRef<Array<(state: SearchSnapshot) => void>>([]);
  /* Settled with the query and facets that PRODUCED this outcome (the fetch
     effect's own closure), not with whatever the component has re-rendered to
     since - so the snapshot an agent receives always describes the screenful
     it is being handed. */
  const settleSearch = useCallback(
    (outcome: SearchOutcome, appliedQuery: string, appliedSelected: Selected) => {
      const waiters = searchWaiters.current;
      if (waiters.length === 0) return;
      searchWaiters.current = [];
      const state = toSnapshot(appliedQuery, appliedSelected, outcome);
      for (const resolve of waiters) resolve(state);
    },
    [],
  );

  /* Quick view, ENTRY 2: a result tile click swaps the panel content to the
     icon quick-view instead of navigating away - only when this instance is
     inside a collection's Add-icons panel (`collectionTarget` set); the
     standalone /search page keeps its normal tile links untouched.
     `quickViewHit` alone decides what renders (facet rail + results vs. the
     quick view) - unlike CollectionWorkspace.tsx's own quick-view SlideOver,
     there is no separate open/mount animation here to desync from: this is
     a plain content swap inside an ALREADY fully-open, already-mounted
     SlideOver, so a single nullable piece of state is enough and does not
     reintroduce the empty-flash problem that pattern exists to avoid
     elsewhere. */
  const [quickViewHit, setQuickViewHit] = useState<SearchHit | null>(null);
  /* Which tile (by position in `hits`) opened the current quick view, and
     where the panel was scrolled to when it did - both restored once the
     visitor comes back (see the effect below). Refs, not state: neither
     should ever trigger a re-render on its own, only get read at the moment
     "back" actually happens. */
  const quickViewIndexRef = useRef<number | null>(null);
  const quickViewScrollRef = useRef<{ target: HTMLElement | Window; position: number } | null>(
    null,
  );

  function openQuickView(hit: SearchHit, index: number) {
    quickViewIndexRef.current = index;
    const target = findScrollParent(gridRef.current);
    quickViewScrollRef.current = {
      target,
      position: target === window ? window.scrollY : (target as HTMLElement).scrollTop,
    };
    setQuickViewHit(hit);
  }

  const backToListing = useCallback(() => setQuickViewHit(null), []);

  /* Escape, while quick view is showing, means "back to the listing" - not
     "close the whole Add-icons panel", which is what the wrapping
     SlideOver's OWN Escape handler (SlideOver.tsx) would otherwise do on
     the very same keypress. A capture-phase listener on `document` runs
     before ANY bubble-phase listener anywhere - including SlideOver's own
     bubble-phase `document` listener - so calling stopPropagation() here
     reliably prevents that second handler from ever seeing the event. This
     is a deliberate choice over relying on registration order (a
     same-phase listener registered earlier does fire first, which would
     also work here since this component mounts as SlideOver's child and so
     runs its effects first - but that is an implementation detail of
     effect-ordering on mount, not a guarantee that reads clearly at the
     call site) - capture-phase-wins is a real platform guarantee, not a
     timing coincidence, which is worth the one extra option argument. */
  useEffect(() => {
    if (!collectionTarget || !quickViewHit) return;
    /* The native DOM event, not React's own KeyboardEvent<T> (imported
       above for onGridKeyDown's synthetic-event param and shadowing the
       global name in this file) - document.addEventListener always hands
       back the former. */
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      backToListing();
    }
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [collectionTarget, quickViewHit, backToListing]);

  const query = committed.trim();
  const filterCount =
    selected.prefix.length +
    selected.style.length +
    selected.license.length +
    selected.tier.length +
    (selected.noAttribution ? 1 : 0) +
    (selected.category ? 1 : 0);

  const mode: "resting" | "set" | "results" =
    query !== "" ? "results" : filterCount > 0 ? "set" : "resting";

  const setNames = useMemo(
    () => new Map(setLabels.map((label) => [label.prefix, label.name])),
    [setLabels],
  );

  const categoryNames = useMemo(
    () => new Map(categoryLabels.map((label) => [label.slug, label.tag])),
    [categoryLabels],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setCommitted(input), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [input]);

  /* The navbar search icon lands here with ?focus=1. Focus the input and drop
     the parameter with replaceState, so the flag never becomes a history entry
     the back button has to walk through. */
  useEffect(() => {
    if (!syncUrl) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("focus") !== "1") return;
    searchInputRef.current?.focus();
    url.searchParams.delete("focus");
    window.history.replaceState(
      { motificons: true },
      "",
      `${url.pathname}${url.search}`,
    );
  }, [syncUrl]);

  /* URL follows state. Entering a new state pushes so back walks the states;
     refining within a state replaces, so back does not replay every keystroke.
     Skipped entirely when `syncUrl` is false - see that prop's doc comment.

     `buildSearchUrl` (lib/search/url-state.ts) owns exactly which facets
     land in the URL for each mode - previously duplicated inline here, and
     the "results" branch's copy had drifted to drop style/license/tier/
     noAttribution (a query with a facet applied lost
     that facet on reload/share, even though the results themselves stayed
     filtered). One function now, so the two branches can't drift again. */
  const previousMode = useRef(mode);
  useEffect(() => {
    if (!syncUrl) return;
    const target = buildSearchUrl({ mode, query, selected, filterCount, basePath });

    const current = `${window.location.pathname}${window.location.search}`;
    if (current !== target) {
      if (previousMode.current === mode) {
        window.history.replaceState({ motificons: true }, "", target);
      } else {
        window.history.pushState({ motificons: true }, "", target);
      }
    }
    previousMode.current = mode;
  }, [syncUrl, mode, query, selected, filterCount, basePath]);

  useEffect(() => {
    if (!syncUrl) return;
    const onPop = () => {
      const url = new URL(window.location.href);
      const q = url.searchParams.get("q") ?? "";
      const list = (key: string) =>
        url.searchParams
          .getAll(key)
          .flatMap((value) => value.split(","))
          .filter(Boolean);
      const sets = list("sets");
      /* A bare /{prefix} in the history is a set-browse state. */
      const pathPrefix = /^\/([a-z0-9-]+)$/.exec(url.pathname)?.[1];
      const asSet =
        pathPrefix && pathPrefix !== "sets" && pathPrefix !== "search"
          ? [pathPrefix]
          : sets;
      /* The rest of the facet rail, restored the same way - otherwise a
         style/license/tier filter (e.g. the icon detail page's stroke
         discovery link, ?tier=T1) survives a fresh load but silently drops
         when the back button returns to it. */
      const style = list("style");
      const license = list("license");
      const tier = list("tier");
      const noAttribution = url.searchParams.get("noAttribution") === "1";
      const category = url.searchParams.get("category") || null;

      setInput(q);
      setCommitted(q);
      setSelected({ prefix: asSet, style, license, tier, noAttribution, category });
      const restoredFilterCount =
        asSet.length + style.length + license.length + tier.length +
        (noAttribution ? 1 : 0) + (category ? 1 : 0);
      previousMode.current =
        q.trim() !== "" ? "results" : restoredFilterCount > 0 ? "set" : "resting";
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [syncUrl]);

  const buildParams = useCallback(
    (offset: number) => {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      for (const key of ["prefix", "style", "license", "tier"] as FacetKey[]) {
        for (const value of selected[key]) params.append(key, value);
      }
      if (selected.noAttribution) params.set("noAttribution", "1");
      if (selected.category) params.set("category", selected.category);
      params.set("limit", String(offset > 0 ? LOAD_MORE_PAGE_SIZE : INITIAL_PAGE_SIZE));
      if (offset > 0) params.set("offset", String(offset));
      return params;
    },
    [query, selected],
  );

  useEffect(() => {
    if (mode === "resting") {
      setResult(null);
      setExtraHits([]);
      setLimited(null);
      setLoading(false);
      setError(null);
      settleSearch({ status: "idle" }, query, selected);
      return;
    }

    const id = ++requestId.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setExtraHits([]);

    fetch(`/api/search?${buildParams(0)}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<SearchResponse>;
      })
      .then((payload) => {
        if (id !== requestId.current) return;
        if (payload.limited) {
          setLimited(payload);
          setResult(null);
          settleSearch({ status: "limited", meter: payload.meter }, query, selected);
        } else {
          setLimited(null);
          setResult(payload);
          setFocusIndex(0);
          settleSearch(
            {
              status: "results",
              total: payload.total,
              hits: payload.hits.map(toToolHit),
              meter: payload.meter,
            },
            query,
            selected,
          );
        }
      })
      .catch((cause: unknown) => {
        if (id !== requestId.current) return;
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError("Search is unavailable right now.");
        settleSearch(
          { status: "error", message: "Search is unavailable right now." },
          query,
          selected,
        );
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });

    return () => controller.abort();
    /* `query` and `selected` are read only to describe the request that was
       just made; they change in lockstep with `buildParams`, so listing them
       adds no extra run of this effect. */
  }, [mode, buildParams, settleSearch, query, selected]);

  const hits = useMemo(
    () => [...(result?.hits ?? []), ...extraHits],
    [result, extraHits],
  );

  const loadMore = async () => {
    if (!result || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await fetch(`/api/search?${buildParams(hits.length)}`);
      const payload = (await response.json()) as SearchResponse;
      if (!payload.limited) setExtraHits((current) => [...current, ...payload.hits]);
    } catch {
      setError("Could not load more icons.");
    } finally {
      setLoadingMore(false);
    }
  };

  /* Roving tabindex over the results grid. Columns are
     measured because the grid is auto-fill and the count follows the
     viewport. getBoundingClientRect(), not offsetTop: each tile now sits
     inside its own `position: relative` wrapper (SaveStar's anchor), which
     would make offsetTop relative to that wrapper instead of a shared
     ancestor - bounding-rect coordinates stay viewport-relative regardless
     of how many positioned wrappers sit in between. */
  const columnCount = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return 1;
    const tiles = grid.querySelectorAll<HTMLElement>("[data-tile]");
    if (tiles.length === 0) return 1;
    const top = tiles[0]!.getBoundingClientRect().top;
    let columns = 0;
    for (const tile of tiles) {
      if (tile.getBoundingClientRect().top !== top) break;
      columns += 1;
    }
    return Math.max(1, columns);
  }, []);

  const moveFocus = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(hits.length - 1, next));
      setFocusIndex(clamped);
      gridRef.current
        ?.querySelectorAll<HTMLElement>("[data-tile]")
        [clamped]?.focus();
    },
    [hits.length],
  );

  /* Quick view, ENTRY 2: fires exactly when quick view CLOSES (never on open,
     and not on the very first mount - both guarded by the refs being
     unset). Deferred a frame: the listing's DOM has to actually be back at
     its full height before restoring scroll or moving focus means anything
     - doing either synchronously in this same commit would race the
     browser's own layout pass and could land against the still-collapsed
     quick-view layout instead. Placed after moveFocus/gridRef rather than
     up with the rest of the quick-view state above, since it calls
     moveFocus directly - gridRef itself is unaffected by the swap
     (openQuickView/backToListing run well before this fires), moveFocus
     re-reads `gridRef.current` fresh every call, which by now points at the
     just-remounted listing grid. */
  useEffect(() => {
    if (quickViewHit) return;
    const saved = quickViewScrollRef.current;
    const index = quickViewIndexRef.current;
    if (saved === null && index === null) return;
    quickViewScrollRef.current = null;
    quickViewIndexRef.current = null;

    const frame = requestAnimationFrame(() => {
      if (saved) {
        if (saved.target === window) {
          window.scrollTo({ top: saved.position, behavior: "instant" });
        }
        else (saved.target as HTMLElement).scrollTop = saved.position;
      }
      if (index !== null) moveFocus(index);
    });
    return () => cancelAnimationFrame(frame);
  }, [quickViewHit, moveFocus]);

  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const columns = columnCount();
    const moves: Record<string, number> = {
      ArrowRight: focusIndex + 1,
      ArrowLeft: focusIndex - 1,
      ArrowDown: focusIndex + columns,
      ArrowUp: focusIndex - columns,
      Home: 0,
      End: hits.length - 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    moveFocus(next);
  };

  /* Set cards are real links to real pages. Intercepting a plain left click
     turns them into a filter; every other click (new tab, middle, modified)
     falls through to the href, so nothing that works elsewhere breaks here. */
  const onRestingClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!isPlainLeftClick(event)) return;
    const anchor = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-set-prefix]",
    );
    const prefix = anchor?.dataset["setPrefix"];
    if (!prefix) return;
    event.preventDefault();
    setInput("");
    setCommitted("");
    setSelected({ ...EMPTY_SELECTED, prefix: [prefix] });
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const facets = result?.facets ?? {};
  /* Stable identities (useCallback with no deps - `setSelected` is stable):
     the WebMCP handle below holds on to these for the life of the island and
     presses them on an agent's behalf, so re-creating them every render would
     re-register the whole tool set every render. */
  const toggle = useCallback((key: FacetKey, value: string) => {
    setSelected((current) => {
      const list = current[key];
      return {
        ...current,
        [key]: list.includes(value)
          ? list.filter((item) => item !== value)
          : [...list, value],
      };
    });
  }, []);

  /* Single-select: picking a category swaps it in; picking the same one
     again clears it. Unlike toggle() above, which builds a list. */
  const selectCategory = useCallback((slug: string) => {
    setSelected((current) => ({
      ...current,
      category: current.category === slug ? null : slug,
    }));
  }, []);

  /* ---------------------------------------------------------------------
     WebMCP: the agent-facing half of this island.

     A browser agent (Chrome 149+ behind the WebMCP flag, ChatGPT's desktop
     browser) can call the tools registered below. They do not run a private
     search on the side - they set this component's state and wait for this
     component's fetch, so the human watching sees the query appear in the
     box, the pills light up in the rail, the grid re-render and the URL
     change. One screen, two operators.

     That also means an agent is metered exactly like the person is: there is
     no second request path for it to use.

     `latestState` is refreshed after every commit so a tool call that arrives
     between renders reads what is on screen, not what was on screen when the
     handle was built. Written from an effect rather than during render: it
     must follow the DOM, not a render pass React may still discard.
     --------------------------------------------------------------------- */
  const latestState = useRef({ query, selected, result, limited, loading, error });
  useEffect(() => {
    latestState.current = { query, selected, result, limited, loading, error };
  });

  const webmcpHandle = useMemo<SearchToolHandle>(() => {
    const readOutcome = (): SearchOutcome => {
      const state = latestState.current;
      if (state.limited) return { status: "limited", meter: state.limited.meter };
      if (state.error) return { status: "error", message: state.error };
      if (state.result) {
        return {
          status: "results",
          total: state.result.total,
          hits: state.result.hits.map(toToolHit),
          meter: state.result.meter,
        };
      }
      return { status: "idle" };
    };

    const readSnapshot = (): SearchSnapshot => {
      const state = latestState.current;
      return toSnapshot(state.query, state.selected, readOutcome());
    };

    /* Resolves when the fetch effect above next settles. The timeout is a
       backstop rather than an expected path: an agent left hanging on a
       promise forever is worse than one told the page went quiet. */
    const waitForResults = () =>
      new Promise<SearchSnapshot>((resolve) => {
        searchWaiters.current.push(resolve);
        window.setTimeout(() => {
          resolve(
            toSnapshot(latestState.current.query, latestState.current.selected, {
              status: "error",
              message: "The search did not finish in time.",
            }),
          );
        }, WEBMCP_TIMEOUT_MS);
      });

    /* The one path both tools take: optionally change the query, then press
       the facet pills that `planFacetChanges` says are needed, then wait for
       the results those changes produce. */
    const apply = (
      nextQuery: string | null,
      request: Parameters<SearchToolHandle["refine"]>[0],
    ) => {
      const state = latestState.current;
      const operations = planFacetChanges(state.selected, request);
      const queryChanged = nextQuery !== null && nextQuery !== state.query;

      if (queryChanged) {
        setInput(nextQuery);
        setCommitted(nextQuery);
      }
      for (const operation of operations) {
        if (operation.kind === "toggle") toggle(operation.key, operation.value);
        else selectCategory(operation.slug);
      }

      /* Nothing moved and nothing is in flight: the screen already answers
         the question, so answer it now instead of waiting for a re-render
         that is never coming. */
      if (!queryChanged && operations.length === 0 && !state.loading) {
        return Promise.resolve(readSnapshot());
      }
      return waitForResults();
    };

    return {
      search: ({ query: nextQuery, sets, category }) =>
        apply(nextQuery.trim(), {
          ...(sets === undefined ? {} : { sets }),
          ...(category === undefined ? {} : { category }),
        }),
      refine: (request) => apply(null, request),
      snapshot: readSnapshot,
      navigate: (path) => window.location.assign(path),
    };
  }, [toggle, selectCategory]);

  useEffect(() => {
    /* Only the library page itself offers these. The same island also powers
       a collection's "Add icons" slide-over (`collectionTarget`), and two
       live registrations would give the agent two tools with one name and no
       way to tell which screen it was driving. */
    if (collectionTarget) return;
    return registerWebMcpTools(createSearchTools(webmcpHandle));
  }, [collectionTarget, webmcpHandle]);

  /* Selected sets always stay visible, so a filter can be removed from the
     rail even when the list is collapsed or filtered to something else. */
  const visibleSets = useMemo(() => {
    const term = setQuery.trim().toLowerCase();
    const matching = term
      ? setLabels.filter(
          (set) =>
            set.name.toLowerCase().includes(term) ||
            set.prefix.includes(term),
        )
      : setLabels;
    const listed = showAllSets ? matching : matching.slice(0, SET_FACET_LIMIT);
    const missing = setLabels.filter(
      (set) =>
        selected.prefix.includes(set.prefix) &&
        !listed.some((item) => item.prefix === set.prefix),
    );
    return [...missing, ...listed];
  }, [setLabels, setQuery, showAllSets, selected.prefix]);

  /* Same shape as visibleSets: the active category stays visible even when
     collapsed or filtered out by categoryQuery. */
  const visibleCategories = useMemo(() => {
    const term = categoryQuery.trim().toLowerCase();
    const matching = term
      ? categoryLabels.filter(
          (category) =>
            category.tag.toLowerCase().includes(term) ||
            category.slug.includes(term),
        )
      : categoryLabels;
    const listed = showAllCategories
      ? matching
      : matching.slice(0, CATEGORY_FACET_LIMIT);
    const missing = categoryLabels.filter(
      (category) =>
        selected.category === category.slug &&
        !listed.some((item) => item.slug === category.slug),
    );
    return [...missing, ...listed];
  }, [categoryLabels, categoryQuery, showAllCategories, selected.category]);

  const topFacet = useCallback(
    (key: FacetKey, take: number) =>
      Object.entries(facets[key] ?? {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, take),
    [facets],
  );

  const statusText = useMemo(() => {
    if (mode === "resting") return "";
    if (loading) return "Searching";
    if (limited) return "Daily search limit reached";
    if (!result) return "";
    if (result.total === 0) return `No icons match ${query}`;
    return `${result.total.toLocaleString("en-US")} icons`;
  }, [mode, loading, limited, result, query]);

  const activeChips = [
    ...selected.prefix.map((prefix) => ({
      key: `prefix:${prefix}`,
      label: setNames.get(prefix) ?? prefix,
      clear: () => toggle("prefix", prefix),
    })),
    ...(selected.category
      ? [
          {
            key: `category:${selected.category}`,
            label: categoryNames.get(selected.category) ?? selected.category,
            clear: () => setSelected((current) => ({ ...current, category: null })),
          },
        ]
      : []),
    ...selected.tier.map((tier) => ({
      key: `tier:${tier}`,
      label: TIER_LABEL[tier] ?? tier,
      clear: () => toggle("tier", tier),
    })),
    ...selected.style.map((style) => ({
      key: `style:${style}`,
      label: style,
      clear: () => toggle("style", style),
    })),
    ...selected.license.map((license) => ({
      key: `license:${license}`,
      label: license,
      clear: () => toggle("license", license),
    })),
    ...(selected.noAttribution
      ? [
          {
            key: "noAttribution",
            label: "No credit needed",
            clear: () =>
              setSelected((current) => ({ ...current, noAttribution: false })),
          },
        ]
      : []),
  ];

  return (
    <div>
      {/* Search on top, spanning the full width. */}
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setCommitted(input);
        }}
        className="relative"
      >
        <label className="sr-only" htmlFor="icon-search">
          Search icons
        </label>
        <input
          id="icon-search"
          type="search"
          value={input}
          autoComplete="off"
          placeholder="Search icons"
          ref={searchInputRef}
          onChange={(event) => setInput(event.target.value)}
          className="w-full appearance-none rounded-pill border-2 border-ink bg-surface py-[18px] pr-14 pl-6 text-body text-ink transition-shadow duration-[120ms] ease-in placeholder:text-ink-muted focus:shadow-card [&::-webkit-search-cancel-button]:hidden"
        />
        <span className="absolute top-1/2 right-5 -translate-y-1/2">
          {loading ? (
            <InlineSpinner />
          ) : (
            input !== "" && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setInput("");
                  setCommitted("");
                }}
                className="touch-target-inset flex items-center justify-center text-ink-muted transition-colors duration-[120ms] ease-in hover:text-ink"
              >
                <svg
                  width={18}
                  height={18}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M6 6 18 18M18 6 6 18" />
                </svg>
              </button>
            )
          )}
        </span>
      </form>

      {activeChips.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {activeChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.clear}
              className="touch-target-inset inline-flex items-center gap-2 rounded-tag bg-primary px-3 py-1.5 text-pill font-bold text-ink uppercase"
            >
              {chip.label}
              <svg
                width={12}
                height={12}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={3}
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M6 6 18 18M18 6 6 18" />
              </svg>
              <span className="sr-only">Remove filter</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSelected(EMPTY_SELECTED)}
            className="text-meta font-semibold text-blue-deep underline underline-offset-2"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Quick view, ENTRY 2: swaps the facet rail + results grid for the icon
          quick view - the search bar and any active filter chips above stay
          visible/usable throughout, since there is no reason a visitor
          previewing one icon should lose the ability to keep searching.
          Conditional render, not "mounted but hidden": every piece of state
          that actually needs to survive the swap (query, filters, results,
          scroll position, which tile had focus) already lives in this
          component's own top-level state/refs, untouched by which JSX
          renders below - keeping two parallel DOM trees alive would not
          preserve anything more than that, and the ACTUAL hard part (scroll
          position, focus) needs explicit restore code regardless, since
          hiding-vs-removing the grid changes the scrollable area's height
          exactly the same way either way. See openQuickView/the restore
          effect above moveFocus's own definition for that half. */}
      {collectionTarget && quickViewHit ? (
        <IconQuickView
          icon={quickViewHit}
          tier={quickViewHit.tier}
          savedEdits={collectionTarget.savedEdits}
          savedSize={collectionTarget.savedSize}
          collectionStar={{
            collectionId: collectionTarget.id,
            iconId: `${quickViewHit.prefix}:${quickViewHit.name}`,
            name: quickViewHit.name,
            added: collectionTarget.addedIconIds.has(`${quickViewHit.prefix}:${quickViewHit.name}`),
            onToggle: (added) => collectionTarget.onToggle(quickViewHit, added),
          }}
          onBack={backToListing}
        />
      ) : (
      <div className="mt-8 flex flex-col gap-8 lg:flex-row lg:items-start">
        <aside className="w-full shrink-0 lg:w-[228px]">
          <FacetGroup label="Capability">
            {(["T1", "T2", "T3", "T4"] as const).map((tier) => (
              <FacetPill
                key={tier}
                active={selected.tier.includes(tier)}
                count={facets["tier"]?.[tier]}
                onClick={() => toggle("tier", tier)}
              >
                {TIER_LABEL[tier]}
              </FacetPill>
            ))}
          </FacetGroup>

          <FacetGroup label="License">
            <FacetPill
              active={selected.noAttribution}
              onClick={() =>
                setSelected((current) => ({
                  ...current,
                  noAttribution: !current.noAttribution,
                }))
              }
            >
              No credit needed
            </FacetPill>
            {topFacet("license", 6).map(([value, count]) => (
              <FacetPill
                key={value}
                active={selected.license.includes(value)}
                count={count}
                onClick={() => toggle("license", value)}
              >
                {value}
              </FacetPill>
            ))}
          </FacetGroup>

          {topFacet("style", 8).length > 0 && (
            <FacetGroup label="Style">
              {topFacet("style", 8).map(([value, count]) => (
                <FacetPill
                  key={value}
                  active={selected.style.includes(value)}
                  count={count}
                  onClick={() => toggle("style", value)}
                >
                  {value}
                </FacetPill>
              ))}
            </FacetGroup>
          )}

          {/* Single-select, unlike every other group here: a category is one
              slice of the library, not a set you narrow down further within.
              Counts are the global per-category totals (categories.json),
              never a live facet - counts are data - so they read the same
              at rest, mid-browse or mid-search. */}
          <FacetGroup label="Category">
            {visibleCategories.map((category) => (
              <FacetPill
                key={category.slug}
                active={selected.category === category.slug}
                count={category.icons}
                onClick={() => selectCategory(category.slug)}
              >
                {category.tag}
              </FacetPill>
            ))}

            {showAllCategories && (
              <div className="mt-1 w-full">
                <label className="sr-only" htmlFor="category-filter">
                  Filter categories by name
                </label>
                <input
                  id="category-filter"
                  type="search"
                  value={categoryQuery}
                  placeholder="Filter categories"
                  onChange={(event) => setCategoryQuery(event.target.value)}
                  className="w-full rounded-control border-2 border-ink bg-surface px-3 py-2 text-meta text-ink placeholder:text-ink-muted"
                />
              </div>
            )}

            {(categoryLabels.length > CATEGORY_FACET_LIMIT || showAllCategories) && (
              <button
                type="button"
                onClick={() => {
                  setShowAllCategories((value) => !value);
                  setCategoryQuery("");
                }}
                className="w-full pt-1 text-left text-meta font-semibold text-blue-deep underline underline-offset-2"
              >
                {showAllCategories
                  ? "Show fewer categories"
                  : `Show all ${categoryLabels.length} categories`}
              </button>
            )}
          </FacetGroup>

          {/* Driven by the full set list, not by search facets: the rail has to
              work in the resting state too, where there are no facet counts
              because there is no query yet. */}
          <FacetGroup label="Set">
            {visibleSets.map((set) => (
              <FacetPill
                key={set.prefix}
                active={selected.prefix.includes(set.prefix)}
                count={facets["prefix"]?.[set.prefix] ?? set.icons}
                onClick={() => toggle("prefix", set.prefix)}
              >
                {set.name}
              </FacetPill>
            ))}

            {showAllSets && (
              <div className="mt-1 w-full">
                <label className="sr-only" htmlFor="set-filter">
                  Filter sets by name
                </label>
                <input
                  id="set-filter"
                  type="search"
                  value={setQuery}
                  placeholder="Filter sets"
                  onChange={(event) => setSetQuery(event.target.value)}
                  className="w-full rounded-control border-2 border-ink bg-surface px-3 py-2 text-meta text-ink placeholder:text-ink-muted"
                />
              </div>
            )}

            {(setLabels.length > SET_FACET_LIMIT || showAllSets) && (
              <button
                type="button"
                onClick={() => {
                  setShowAllSets((value) => !value);
                  setSetQuery("");
                }}
                className="w-full pt-1 text-left text-meta font-semibold text-blue-deep underline underline-offset-2"
              >
                {showAllSets
                  ? "Show fewer sets"
                  : `Show all ${setLabels.length} sets`}
              </button>
            )}
          </FacetGroup>
        </aside>

        <div className="min-w-0 flex-1">
          <p className="sr-only" role="status" aria-live="polite">
            {statusText}
          </p>

          {mode !== "resting" && !limited && (
            <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
              <p className="text-meta text-ink-muted">
                {loading
                  ? "Searching..."
                  : result
                    ? `${result.total.toLocaleString("en-US")} icons`
                    : ""}
              </p>
              {/* No meter means a signed-in visitor with unlimited search:
                  no counter, not a counter reading "unlimited". */}
              {result?.meter && query !== "" && (
                <p className="text-meta text-ink-muted">
                  {result.meter.remaining} of {result.meter.limit} searches left
                  today
                </p>
              )}
            </div>
          )}

          {error && (
            <div className="rounded-card bg-surface px-8 py-7 shadow-card">
              <p className="text-meta text-danger">{error}</p>
            </div>
          )}

          {limited && <LimitState state={limited} />}

          {/* Resting content stays mounted so coming back is instant and the
              server-rendered markup is never thrown away. */}
          <div
            hidden={mode !== "resting"}
            onClick={onRestingClick}
            role="presentation"
          >
            {children}
          </div>

          {mode !== "resting" && !limited && loading && hits.length === 0 && (
            <Skeletons />
          )}

          {mode !== "resting" && !limited && !loading && hits.length === 0 && !error && (
            <EmptyState
              query={query}
              onPick={(suggestion) => {
                setInput(suggestion);
                setCommitted(suggestion);
              }}
            />
          )}

          {mode !== "resting" && !limited && hits.length > 0 && (
            <>
              <div
                ref={gridRef}
                className={TILE_GRID_CLASS}
                role="grid"
                aria-label="Icons"
                onKeyDown={onGridKeyDown}
              >
                {hits.map((hit, index) => (
                  <div key={hit.id} className="group relative">
                    <a
                      data-tile
                      href={`/${hit.prefix}/${hit.name}`}
                      tabIndex={index === focusIndex ? 0 : -1}
                      onFocus={() => setFocusIndex(index)}
                      onClick={(event) => {
                        /* ENTRY 2 only - the standalone /search page (no
                           collectionTarget) keeps its normal tile links. */
                        if (!collectionTarget || !isPlainLeftClick(event)) return;
                        event.preventDefault();
                        openQuickView(hit, index);
                      }}
                      title={`${hit.name} - ${hit.setName}`}
                      aria-label={hit.name}
                      className={`${TILE_CLASS} search-tile`}
                    >
                      <span className={`${TILE_GLYPH_CLASS} glyph-checker`}>
                        <IconGlyph hit={hit} />
                      </span>
                      <span className={TILE_NAME_CLASS}>{hit.name}</span>
                    </a>
                    {collectionTarget ? (
                      <AddToCollectionStar
                        iconId={`${hit.prefix}:${hit.name}`}
                        name={hit.name}
                        collectionId={collectionTarget.id}
                        added={collectionTarget.addedIconIds.has(`${hit.prefix}:${hit.name}`)}
                        tabIndex={index === focusIndex ? 0 : -1}
                        onToggle={(added) => collectionTarget.onToggle(hit, added)}
                      />
                    ) : (
                      <SaveStar
                        iconId={`${hit.prefix}:${hit.name}`}
                        name={hit.name}
                        signedIn={signedIn}
                        accountLoading={!accountReady}
                        tabIndex={index === focusIndex ? 0 : -1}
                        onQuickSaved={showToast}
                      />
                    )}
                  </div>
                ))}
              </div>

              {result && hits.length < result.total && (
                <div className="mt-8 flex flex-col items-center gap-3">
                  <button
                    type="button"
                    onClick={loadMore}
                    aria-busy={loadingMore ? "true" : undefined}
                    className="press inline-flex items-center justify-center gap-2 rounded-btn border-2 border-ink bg-surface px-6 py-[15px] text-body font-semibold text-ink"
                  >
                    {loadingMore && <InlineSpinner />}
                    Load more
                  </button>
                  <p className="text-meta text-ink-muted">
                    Showing {hits.length.toLocaleString("en-US")} of{" "}
                    {result.total.toLocaleString("en-US")}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      )}

      <QuickSaveToast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}

/**
 * Inline loader: 16px, ink-muted, the Button spinner style.
 * aria-hidden because the aria-live result count is the announced feedback.
 */
function InlineSpinner() {
  return (
    <svg
      className="inline-spinner text-ink-muted"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" opacity="0.3" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}

function IconGlyph({ hit }: { hit: SearchHit }) {
  if (hit.body) {
    return (
      <svg
        width={30}
        height={30}
        viewBox={`0 0 ${hit.width} ${hit.height}`}
        aria-hidden="true"
        focusable="false"
        dangerouslySetInnerHTML={{ __html: hit.body }}
      />
    );
  }
  return (
    <img
      src={`/api/icon/${hit.prefix}/${hit.name}.svg`}
      width={30}
      height={30}
      alt=""
      loading="lazy"
      decoding="async"
    />
  );
}

function FacetGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-8 first:mt-0">
      <h2 className="mb-3 text-pill font-bold text-ink-muted uppercase">
        {label}
      </h2>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function FacetPill({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`touch-target-inset inline-flex items-center gap-1.5 rounded-tag px-3 py-1.5 text-pill font-bold text-ink uppercase transition-colors duration-[120ms] ease-in ${
        active ? "bg-primary ring-2 ring-ink" : "bg-pill-gray hover:bg-segment-active"
      }`}
    >
      {children}
      {count !== undefined && (
        <span className="font-normal opacity-70">
          {count > 999 ? `${Math.round(count / 1000)}k` : count}
        </span>
      )}
    </button>
  );
}

function Skeletons() {
  return (
    <div className={TILE_GRID_CLASS} aria-hidden="true">
      {Array.from({ length: 30 }, (_, index) => (
        <div
          key={index}
          className="flex min-w-[96px] flex-col items-center gap-3 rounded-card bg-surface px-3 py-5"
        >
          <span className="h-8 w-8 rounded-control bg-canvas" />
          <span className="h-3 w-3/4 rounded-tag bg-canvas" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  query,
  onPick,
}: {
  query: string;
  onPick: (value: string) => void;
}) {
  return (
    <div className="rounded-card bg-surface px-8 py-7 shadow-card">
      <h2 className="text-h3 font-semibold">
        {query ? `Nothing matches "${query}"` : "No icons here"}
      </h2>
      <p className="mt-2 text-meta text-ink-muted">
        {query
          ? "Try a shorter word, or drop a filter. Icon names are usually singular and hyphenated."
          : "Try a different filter, or start from one of these."}
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onPick(suggestion)}
            className="touch-target-inset inline-flex items-center rounded-tag bg-pill-gray px-3 py-1.5 text-pill font-bold text-ink uppercase transition-colors duration-[120ms] ease-in hover:bg-segment-active"
          >
            {suggestion}
          </button>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap gap-4 text-meta">
        <a href="/categories" className="prose-link">
          Browse categories
        </a>
      </div>
    </div>
  );
}

function LimitState({ state }: { state: SearchLimited }) {
  return (
    <div className="rounded-card bg-surface px-8 py-7 shadow-card">
      <span className="inline-flex items-center rounded-tag bg-primary px-3 py-1.5 text-pill font-bold text-ink uppercase">
        {state.meter.used} of {state.meter.limit} used
      </span>
      <h2 className="mt-4 text-h3 font-semibold">{state.upsell.headline}</h2>
      <p className="mt-2 text-meta text-ink-muted">
        {state.upsell.body}
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        {state.upsell.browse.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="press press-sm inline-flex items-center justify-center rounded-control border-2 border-ink bg-surface px-4 py-[10px] text-body font-semibold text-ink no-underline"
          >
            {link.label}
          </a>
        ))}
      </div>
      <p className="mt-6 text-meta text-ink-muted">
        The counter resets tomorrow. Every set, category and icon page stays
        free and unmetered - only the search box is limited.
      </p>
    </div>
  );
}
