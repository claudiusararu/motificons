/**
 * The WebMCP tools the icon search offers to an agent - on the icon library
 * page (/search), and inside a collection's open "Add icons" panel.
 *
 * The point of every one of these is that the agent and the human are looking
 * at the same screen. A tool call here does not run a private, headless query
 * on the side - it drives the exact React state the visitor's own typing and
 * facet clicks drive, so the grid re-renders, the URL updates, and the person
 * watching sees what the agent just did and can carry on from it by hand.
 *
 * That is why this module never fetches anything itself. It takes a
 * `SearchToolHandle` - the imperative handle SearchIsland.tsx hands out - and
 * every tool is a thin translation between the agent's JSON and that handle.
 * Two consequences worth stating, because they are the whole design:
 *
 *   - The metered search path is the same one a human hits. An agent cannot
 *     spend searches the visitor would not have spent, and cannot get around
 *     the daily allowance by asking a different way.
 *   - This file is pure. Given a fake handle it is fully unit-testable, with
 *     no DOM, no island and no network - see search-tools.test.ts.
 *
 * Payloads stay small deliberately: names, sets and URLs, never SVG bodies.
 * An agent that wants the artwork follows the `url` to the icon page, where
 * the download and export UI already lives.
 *
 * TWO MODES, because the same island powers two screens (see `SearchToolsMode`
 * below). On /search the full four tools are offered. Inside a collection's
 * "Add icons" slide-over the search tools are offered without `open_icon`:
 * there, the human has a panel open over their collection, and navigating the
 * tab away to an icon page mid-add would throw that work on the floor. In the
 * panel, the way to act on a hit is `add_icon_to_collection` from
 * collection-tools.ts, which every hit's `prefix` and `name` feed directly.
 */

import type { SearchHit } from "../search-config";
import type { Selected } from "../search/url-state";
import type { WebMcpTool } from "./bridge";

/** The anonymous daily allowance, as the search route reports it. */
export interface SearchMeter {
  used: number;
  remaining: number;
  limit: number;
}

/** One result row, in the compact shape the tools return. */
export interface SearchToolHit {
  name: string;
  /** Human-readable set name, e.g. "Tabler Icons". */
  set: string;
  /** Set prefix, e.g. "tabler" - the first path segment of `url`. */
  prefix: string;
  style: string | null;
  license: string;
  /** Path to the icon's own page on this site. */
  url: string;
}

/**
 * What the island reports back once a search has actually landed in the UI.
 *
 *   results  the grid is showing hits (possibly zero)
 *   limited  the anonymous allowance is spent; the grid shows the upsell
 *   idle     nothing is being searched or filtered - the resting set grid
 *   error    the request failed
 */
export type SearchOutcome =
  | {
      status: "results";
      total: number;
      hits: SearchToolHit[];
      /** null means "signed in, unlimited" - the route sends no meter at all. */
      meter: SearchMeter | null;
    }
  | { status: "limited"; meter: SearchMeter }
  | { status: "idle" }
  | { status: "error"; message: string };

/**
 * Compacts a search-route hit down to what an agent can use: identity, where
 * it came from, what the license asks for, and a link to the page that has
 * everything else. Never the SVG body - that would be kilobytes per row of
 * markup the agent cannot do anything useful with, and the icon page already
 * serves it properly.
 */
export function toToolHit(hit: SearchHit): SearchToolHit {
  return {
    name: hit.name,
    set: hit.setName,
    prefix: hit.prefix,
    style: hit.style,
    license: hit.license,
    url: `/${hit.prefix}/${hit.name}`,
  };
}

/** What the page is showing: the state that produced it, and the result. */
export interface SearchSnapshot {
  query: string;
  sets: string[];
  category: string | null;
  tier: string[];
  style: string[];
  license: string[];
  noAttribution: boolean;
  /**
   * The style values the STYLE rail is currently offering, most common first -
   * i.e. the keys of the search response's `style` facet. This is the only
   * authority on what a style name may be: styles are not a fixed enum, they
   * are labels each icon set declares ("Outline", "Fill", "Duo", "Path",
   * "Two-Tone"), so an agent's guess is checked against what this screen can
   * actually filter by rather than against a list baked in here. Empty when
   * nothing has been searched yet.
   */
  styleOptions: string[];
  outcome: SearchOutcome;
}

/** Builds a snapshot from the island's own facet state. Kept here, next to
    the shape it produces, so the island has one line to call and the mapping
    is testable on its own. */
export function toSnapshot(
  query: string,
  selected: Selected,
  outcome: SearchOutcome,
  styleOptions: string[] = [],
): SearchSnapshot {
  return {
    query,
    sets: selected.prefix,
    category: selected.category,
    tier: selected.tier,
    style: selected.style,
    license: selected.license,
    noAttribution: selected.noAttribution,
    styleOptions,
    outcome,
  };
}

/** The style facet's values, most common first - the same order the STYLE
    pills are laid out in the rail, so what an agent is told is available
    reads in the same order as what the human is looking at. */
export function toStyleOptions(
  facets: Record<string, Record<string, number>> | undefined,
): string[] {
  return Object.entries(facets?.["style"] ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([value]) => value);
}

/**
 * The style names an agent may legitimately name, which is wider than the
 * style facet on its own.
 *
 * Facet counts describe the results AFTER every filter, the style filter
 * included - so the moment "Outline" is on, every other style vanishes from
 * the payload and from the rail. A human just un-presses the pill they can
 * see. An agent asked to switch from outline to fill would instead be told
 * "Fill" does not exist and stop. So `remembered` (the widest list this
 * screen offered while no style was selected) and the styles currently in
 * force are folded in behind what the results have right now.
 */
export function mergeStyleOptions(
  options: string[],
  remembered: string[],
  selected: string[],
): string[] {
  const merged = [...options];
  for (const value of [...selected, ...remembered]) {
    if (!merged.includes(value)) merged.push(value);
  }
  return merged;
}

/**
 * The imperative handle SearchIsland.tsx exposes to these tools.
 *
 * `search` and `refine` both RESOLVE with the snapshot the human is now
 * looking at - they wait for the same fetch the island runs and the same
 * render the visitor sees. Fire-and-forget would leave the agent describing a
 * screen that does not exist yet.
 *
 * `sets`, `styles` and `category` are three-state on the way in, matching what
 * the tool descriptions promise: absent leaves the filter alone, null (or an
 * empty list) clears it, a value sets it.
 */
export interface SearchToolHandle {
  search(input: {
    query: string;
    sets?: string[];
    styles?: string[];
    category?: string | null;
  }): Promise<SearchSnapshot>;
  refine(input: {
    sets?: string[];
    styles?: string[];
    category?: string | null;
    tier?: string | null;
  }): Promise<SearchSnapshot>;
  snapshot(): SearchSnapshot;
  /** Navigates the tab to `path` (a same-site icon page). */
  navigate(path: string): void;
}

/**
 * Which screen the island offering these tools is mounted on.
 *
 *   "page"              /search itself: all four tools, `open_icon` included.
 *   "collection-panel"  the "Add icons" slide-over on a collection page: the
 *                       three search tools, no `open_icon` (see the header).
 */
export type SearchToolsMode = "page" | "collection-panel";

/** Appended to the searching tools' descriptions in the panel, so the agent
    knows which screen it is driving and what to do with a hit once it has
    one. The human sees every one of these searches happen inside the panel
    they already have open - that visibility is the point of driving the real
    island instead of querying the API on the side. */
const PANEL_SEARCH_SUFFIX =
  " You are inside a collection's open 'Add icons' panel, not the library " +
  "page: the results appear in that panel, on top of the collection the human " +
  "is building, and they can watch each search land. To put a hit into the " +
  "collection, pass its `prefix` and `name` to add_icon_to_collection - the " +
  "same save the star on the result performs. Nothing here navigates away, so " +
  "the panel and their collection stay put.";

/** The note that rides along with every panel-mode result, for an agent that
    read the hits and not the description. */
const PANEL_RESULT_NOTE =
  "These results are showing in the collection's open Add icons panel. Add " +
  "one with add_icon_to_collection, passing a hit's prefix and name.";

/** Default and ceiling for how many hits come back to the agent. The human's
    grid always shows the full first page regardless - this only trims the
    JSON, so a broad query does not return a hundred rows nobody asked for. */
const DEFAULT_HIT_LIMIT = 20;
const MAX_HIT_LIMIT = 50;

/** Path segments we are willing to put in `location.assign`. Icon and set
    slugs are lowercase alphanumerics with hyphens; anything else - a slash, a
    "..", a scheme - is a caller mistake, not a navigation. */
const SLUG = /^[a-z0-9][a-z0-9._-]*$/i;

const LIMIT_MESSAGE =
  "The anonymous search allowance is used up for today. A free account has " +
  "unlimited search - ask the human to sign in or register.";

/** Set/category/icon pages are never metered, so a limited agent still has
    somewhere useful to send the human. */
const LIMITED_RESULT = { limited: true, message: LIMIT_MESSAGE } as const;

function readString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

/** Accepts a string array, or a single string for an agent that sent one
    value where a list was asked for - a common and harmless model slip. */
function readStringList(
  input: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = input[key];
  if (typeof value === "string") return value ? [value] : [];
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

/** Same as `readStringList`, plus the null spelling of "clear it": a list
    field's three states are absent (leave it alone), null or [] (clear), and
    a list of values (set). An agent that reaches for null on a list field is
    being consistent with `category` and `tier`, not making a mistake. */
function readClearableList(
  input: Record<string, unknown>,
  key: string,
): string[] | undefined {
  if (key in input && input[key] === null) return [];
  return readStringList(input, key);
}

/**
 * Resolves the style names an agent asked for against the ones the STYLE rail
 * is actually offering.
 *
 * Two jobs, and both matter for a filter that has no fixed vocabulary:
 *
 *   - Case. The facet values are the labels icon sets ship ("Outline",
 *     "Fill", "Duo"), while an agent relaying a human writes "outline". The
 *     pill press has to carry the rail's exact spelling or it toggles a facet
 *     value that matches nothing.
 *   - Honesty. A style the current results do not have is a dead end that
 *     would silently empty the human's screen, so it comes back as an error
 *     naming what IS there instead.
 *
 * With nothing searched yet there is no facet to check against, so the values
 * pass through as written rather than being rejected against an empty list.
 */
function resolveStyles(
  requested: string[],
  options: string[],
): { ok: true; styles: string[] } | { ok: false; unknown: string[] } {
  if (options.length === 0) return { ok: true, styles: requested };
  const byLower = new Map(options.map((option) => [option.toLowerCase(), option]));
  const styles: string[] = [];
  const unknown: string[] = [];
  for (const value of requested) {
    const match = byLower.get(value.trim().toLowerCase());
    if (match) styles.push(match);
    else unknown.push(value);
  }
  return unknown.length > 0 ? { ok: false, unknown } : { ok: true, styles };
}

/** The message an agent gets for a style nobody on this screen can filter by.
    It names the styles that ARE available, so the next call is a correction
    rather than another guess. */
function unknownStyleError(unknown: string[], options: string[]) {
  return {
    error:
      `No style called ${unknown.map((value) => `"${value}"`).join(", ")} in these ` +
      `results. The styles available right now are: ${options.join(", ")}. ` +
      "Style names come from the STYLE facet shown on the page and differ by " +
      "icon set - pass one of these, or leave styles out to keep every style.",
  };
}

/**
 * Reads a field whose three states all mean something different:
 * absent = leave it alone, null = clear it, string = set it.
 */
function readNullableString(
  input: Record<string, unknown>,
  key: string,
): { present: false } | { present: true; value: string | null } {
  if (!(key in input)) return { present: false };
  const value = input[key];
  if (value === null || value === "") return { present: true, value: null };
  return typeof value === "string"
    ? { present: true, value }
    : { present: false };
}

function readHitLimit(input: Record<string, unknown>): number {
  const value = input["limit"];
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_HIT_LIMIT;
  return Math.max(1, Math.min(MAX_HIT_LIMIT, Math.floor(value)));
}

/** The meter, in the shape the tools report: an object while metered,
    "unlimited" for a signed-in visitor, null when there is nothing to say. */
function reportMeter(
  meter: SearchMeter | null,
): { remaining: number; limit: number } | "unlimited" {
  if (!meter) return "unlimited";
  return { remaining: meter.remaining, limit: meter.limit };
}

/** The filters actually in force after a call, echoed back so the agent never
    has to guess which of its inputs stuck or what the human had already set. */
function reportFilters(state: SearchSnapshot) {
  return {
    query: state.query,
    sets: state.sets,
    styles: state.style,
    category: state.category,
    tier: state.tier,
  };
}

/** Turns a snapshot into the JSON an agent gets back. Shared by
    `search_icons` and `refine_search` so the two can never drift. */
function reportOutcome(
  state: SearchSnapshot,
  hitLimit: number,
  mode: SearchToolsMode,
) {
  const { outcome } = state;
  if (outcome.status === "limited") return LIMITED_RESULT;
  if (outcome.status === "error") return { error: outcome.message };
  if (outcome.status === "idle") {
    return {
      total: 0,
      shown: 0,
      hits: [],
      meter: null,
      applied: reportFilters(state),
      note: "Nothing is being searched. Call search_icons with a query first.",
    };
  }

  const hits = outcome.hits.slice(0, hitLimit);
  return {
    total: outcome.total,
    shown: hits.length,
    hits,
    meter: reportMeter(outcome.meter),
    applied: reportFilters(state),
    ...(mode === "collection-panel" ? { note: PANEL_RESULT_NOTE } : {}),
  };
}

/**
 * Builds the tool set for one mounted SearchIsland.
 *
 * Pure: no globals beyond what `handle` reaches for. Pass the result straight
 * to `registerWebMcpTools`.
 *
 * `mode` is the screen the island is on. In "collection-panel" the returned
 * list is the same three searching tools minus `open_icon`, with descriptions
 * that say where the results are appearing and how to act on one.
 */
export function createSearchTools(
  handle: SearchToolHandle,
  mode: SearchToolsMode = "page",
): WebMcpTool[] {
  const inPanel = mode === "collection-panel";
  const panelSuffix = inPanel ? PANEL_SEARCH_SUFFIX : "";

  const tools: WebMcpTool[] = [
    {
      name: "search_icons",
      title: "Search icons",
      description:
        "Search the Motificons icon library (337,000+ open-source icons across " +
        "hundreds of sets) and show the results in the page the human is " +
        "looking at - the grid, the result count and the address bar all " +
        "update, so they can see and continue what you found. Use this for any " +
        "request like 'find a trash icon' or 'show me outline arrows'. Query " +
        "with plain singular English words ('arrow right', 'user', 'calendar'); " +
        "icon names are usually singular and hyphenated. Optionally narrow to " +
        "specific sets by prefix (e.g. 'tabler', 'lucide'), to one or more " +
        "drawing styles (e.g. 'outline', 'fill') or to one category slug - the " +
        "same set, style and category pills the human can click in the rail. " +
        "Anonymous visitors have a daily search allowance that these " +
        "calls share with the human's own searches, so search deliberately " +
        "rather than sweeping; a free account makes search unlimited. Returns " +
        "the total match count, a compact list of hits with a page URL each, " +
        "and the remaining allowance. Never returns SVG source - open an " +
        "icon's URL for the artwork and download options." +
        panelSuffix,
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "What to search for, in plain words: 'arrow right', 'shopping cart', 'wifi off'.",
          },
          sets: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional set prefixes to restrict the search to, e.g. ['tabler', 'lucide']. " +
              "Omit to keep whatever set filter the human already has; pass an empty array to clear it.",
          },
          styles: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional drawing styles to keep, e.g. ['outline'] for 'outline arrows', or " +
              "['fill', 'duo']. Common values are outline, fill, duo, path, solid, bold, " +
              "line, regular, rounded, sharp, thin - but styles are labels each icon set " +
              "declares, so the real list is the STYLE facet shown on the page (matching " +
              "ignores case). A style these results do not have comes back as an error " +
              "naming the ones they do. Omit to keep the human's current style filter; " +
              "pass an empty array or null to clear it.",
          },
          category: {
            type: "string",
            description:
              "Optional category slug to restrict the search to, e.g. 'arrows' or 'weather'. " +
              "One category at a time. Omit to keep the current one.",
          },
          limit: {
            type: "number",
            description:
              "How many hits to return to you (1-50, default 20). Does not change what the human sees - the grid always shows the full page.",
          },
        },
        required: ["query"],
      },
      async execute(input) {
        const query = readString(input, "query")?.trim() ?? "";
        if (!query) {
          return {
            error:
              "search_icons needs a query. To adjust filters on the current search, use refine_search.",
          };
        }
        /* Filters the agent did not mention are left exactly as the human set
           them - this is a shared screen, not a fresh private query. The
           `applied` block in the response says what ended up in force. */
        const sets = readClearableList(input, "sets");
        const requestedStyles = readClearableList(input, "styles");
        const category = readNullableString(input, "category");
        let styles = requestedStyles;
        if (requestedStyles !== undefined && requestedStyles.length > 0) {
          /* Checked against the screen BEFORE spending a search: a made-up
             style name would otherwise cost the human an allowance and hand
             them an empty grid. `snapshot` reads, it does not search. */
          const options = handle.snapshot().styleOptions;
          const resolved = resolveStyles(requestedStyles, options);
          if (!resolved.ok) return unknownStyleError(resolved.unknown, options);
          styles = resolved.styles;
        }
        const state = await handle.search({
          query,
          ...(sets === undefined ? {} : { sets }),
          ...(styles === undefined ? {} : { styles }),
          ...(category.present ? { category: category.value } : {}),
        });
        return reportOutcome(state, readHitLimit(input), mode);
      },
    },

    {
      name: "refine_search",
      title: "Refine the current search",
      description:
        "Narrow or widen the search already on screen without retyping it - " +
        "this flips the same facet pills in the left-hand rail that the human " +
        "clicks, so the change is visible to them. Use it after search_icons " +
        "when the results are close but too broad ('only Tabler ones', 'the " +
        "outline ones', 'just the arrows category', 'only icons I can " +
        "restyle'). It filters by set, style, category and restyling tier. Each field is " +
        "three-state: leave it out to keep the current filter, pass null to " +
        "clear it, pass a value to set it. Returns the same shape as " +
        "search_icons. Refining re-runs the search, so it also draws on the " +
        "anonymous daily allowance." +
        panelSuffix,
      inputSchema: {
        type: "object",
        properties: {
          sets: {
            type: "array",
            items: { type: "string" },
            description:
              "Set prefixes to filter to, e.g. ['tabler']. An empty array clears the set filter.",
          },
          styles: {
            type: ["array", "null"],
            items: { type: "string" },
            description:
              "Drawing styles to filter to, e.g. ['outline'] or ['fill', 'duo']. Values come " +
              "from the STYLE facet shown on the page (common ones: outline, fill, duo, path, " +
              "solid, bold, line, regular, rounded, sharp, thin); matching ignores case, and a " +
              "style these results do not have comes back as an error naming the ones they do. " +
              "null or an empty array clears the style filter.",
          },
          category: {
            type: ["string", "null"],
            description:
              "Category slug to filter to, e.g. 'arrows'. null clears the category filter.",
          },
          tier: {
            type: ["string", "null"],
            description:
              "Restyling capability of the icons to keep. 'T1' restyles fully (color, stroke " +
              "weight and size), 'T2' takes a recolor and resize, 'T3' is multicolor artwork, " +
              "'T4' ships exactly as drawn. null clears it.",
          },
          limit: {
            type: "number",
            description: "How many hits to return to you (1-50, default 20).",
          },
        },
      },
      async execute(input) {
        const sets = readClearableList(input, "sets");
        const requestedStyles = readClearableList(input, "styles");
        const category = readNullableString(input, "category");
        const tier = readNullableString(input, "tier");
        if (
          sets === undefined &&
          requestedStyles === undefined &&
          !category.present &&
          !tier.present
        ) {
          return {
            error:
              "refine_search needs at least one of sets, styles, category or tier. Use search_icons to change the query itself.",
          };
        }
        let styles = requestedStyles;
        if (requestedStyles !== undefined && requestedStyles.length > 0) {
          const options = handle.snapshot().styleOptions;
          const resolved = resolveStyles(requestedStyles, options);
          if (!resolved.ok) return unknownStyleError(resolved.unknown, options);
          styles = resolved.styles;
        }
        const state = await handle.refine({
          ...(sets === undefined ? {} : { sets }),
          ...(styles === undefined ? {} : { styles }),
          ...(category.present ? { category: category.value } : {}),
          ...(tier.present ? { tier: tier.value } : {}),
        });
        return reportOutcome(state, readHitLimit(input), mode);
      },
    },

    {
      name: "open_icon",
      title: "Open an icon page",
      description:
        "Navigate the tab to one icon's own page, where the human gets the " +
        "preview, the license, the restyling controls and every download and " +
        "code export (SVG, PNG, SwiftUI, React). Use it once you and the human " +
        "have settled on a specific icon from the search results - pass the " +
        "prefix and name straight from a hit. This leaves the search page, so " +
        "gather anything you still need from the results first.",
      inputSchema: {
        type: "object",
        properties: {
          prefix: {
            type: "string",
            description: "The icon set's prefix, from a hit's `prefix` field, e.g. 'tabler'.",
          },
          name: {
            type: "string",
            description: "The icon's name, from a hit's `name` field, e.g. 'arrow-right'.",
          },
        },
        required: ["prefix", "name"],
      },
      execute(input) {
        const prefix = readString(input, "prefix")?.trim() ?? "";
        const name = readString(input, "name")?.trim() ?? "";
        if (!SLUG.test(prefix) || !SLUG.test(name)) {
          return {
            error:
              "open_icon needs a plain set prefix and icon name, copied from a search hit (for example prefix 'tabler', name 'arrow-right').",
          };
        }
        const path = `/${prefix}/${name}`;
        handle.navigate(path);
        return `Opening ${prefix}:${name} at ${path}. The icon page has the preview, license and every export format.`;
      },
    },

    {
      name: "get_search_state",
      title: inPanel ? "Read the Add icons panel's search state" : "Read the search page state",
      description:
        (inPanel
          ? "Read what the collection's open 'Add icons' panel is currently " +
            "showing - the query, "
          : "Read what the icon library page is currently showing - the query, ") +
        "every active filter, how many icons matched, and how much of the " +
        "anonymous daily search allowance is left. Changes nothing and costs " +
        "no allowance. Use it to pick up where the human left off before you " +
        "search, and to check the remaining allowance before running more " +
        "searches.",
      annotations: { readOnlyHint: true },
      inputSchema: { type: "object", properties: {} },
      execute() {
        const state = handle.snapshot();
        const { outcome } = state;
        return {
          query: state.query,
          filters: {
            sets: state.sets,
            category: state.category,
            tier: state.tier,
            style: state.style,
            license: state.license,
            noAttribution: state.noAttribution,
          },
          status: outcome.status,
          total: outcome.status === "results" ? outcome.total : 0,
          meter:
            outcome.status === "limited"
              ? reportMeter(outcome.meter)
              : outcome.status === "results"
                ? reportMeter(outcome.meter)
                : null,
          ...(outcome.status === "limited" ? { limited: true, message: LIMIT_MESSAGE } : {}),
          ...(outcome.status === "error" ? { error: outcome.message } : {}),
        };
      },
    },
  ];

  /* In the panel, `open_icon` is the one tool that would undo the human's
     work: it navigates the whole tab away from the collection they have open,
     mid-add. The icon page is still one click away for them - it is just not
     something the agent should do behind an open panel. */
  return inPanel ? tools.filter((tool) => tool.name !== "open_icon") : tools;
}
