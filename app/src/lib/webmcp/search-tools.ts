/**
 * The WebMCP tools the icon library page (/search) offers to an agent.
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
  outcome: SearchOutcome;
}

/** Builds a snapshot from the island's own facet state. Kept here, next to
    the shape it produces, so the island has one line to call and the mapping
    is testable on its own. */
export function toSnapshot(
  query: string,
  selected: Selected,
  outcome: SearchOutcome,
): SearchSnapshot {
  return {
    query,
    sets: selected.prefix,
    category: selected.category,
    tier: selected.tier,
    style: selected.style,
    license: selected.license,
    noAttribution: selected.noAttribution,
    outcome,
  };
}

/**
 * The imperative handle SearchIsland.tsx exposes to these tools.
 *
 * `search` and `refine` both RESOLVE with the snapshot the human is now
 * looking at - they wait for the same fetch the island runs and the same
 * render the visitor sees. Fire-and-forget would leave the agent describing a
 * screen that does not exist yet.
 *
 * `sets` and `category` are three-state on the way in, matching what the tool
 * descriptions promise: absent leaves the filter alone, null clears it, a
 * value sets it.
 */
export interface SearchToolHandle {
  search(input: {
    query: string;
    sets?: string[];
    category?: string | null;
  }): Promise<SearchSnapshot>;
  refine(input: {
    sets?: string[];
    category?: string | null;
    tier?: string | null;
  }): Promise<SearchSnapshot>;
  snapshot(): SearchSnapshot;
  /** Navigates the tab to `path` (a same-site icon page). */
  navigate(path: string): void;
}

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
    category: state.category,
    tier: state.tier,
  };
}

/** Turns a snapshot into the JSON an agent gets back. Shared by
    `search_icons` and `refine_search` so the two can never drift. */
function reportOutcome(state: SearchSnapshot, hitLimit: number) {
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
  };
}

/**
 * Builds the tool set for one mounted SearchIsland.
 *
 * Pure: no globals beyond what `handle` reaches for. Pass the result straight
 * to `registerWebMcpTools`.
 */
export function createSearchTools(handle: SearchToolHandle): WebMcpTool[] {
  return [
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
        "specific sets by prefix (e.g. 'tabler', 'lucide') or to one category " +
        "slug. Anonymous visitors have a daily search allowance that these " +
        "calls share with the human's own searches, so search deliberately " +
        "rather than sweeping; a free account makes search unlimited. Returns " +
        "the total match count, a compact list of hits with a page URL each, " +
        "and the remaining allowance. Never returns SVG source - open an " +
        "icon's URL for the artwork and download options.",
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
        const sets = readStringList(input, "sets");
        const category = readNullableString(input, "category");
        const state = await handle.search({
          query,
          ...(sets === undefined ? {} : { sets }),
          ...(category.present ? { category: category.value } : {}),
        });
        return reportOutcome(state, readHitLimit(input));
      },
    },

    {
      name: "refine_search",
      title: "Refine the current search",
      description:
        "Narrow or widen the search already on screen without retyping it - " +
        "this flips the same facet pills in the left-hand rail that the human " +
        "clicks, so the change is visible to them. Use it after search_icons " +
        "when the results are close but too broad ('only Tabler ones', 'just " +
        "the arrows category', 'only icons I can restyle'). Each field is " +
        "three-state: leave it out to keep the current filter, pass null to " +
        "clear it, pass a value to set it. Returns the same shape as " +
        "search_icons. Refining re-runs the search, so it also draws on the " +
        "anonymous daily allowance.",
      inputSchema: {
        type: "object",
        properties: {
          sets: {
            type: "array",
            items: { type: "string" },
            description:
              "Set prefixes to filter to, e.g. ['tabler']. An empty array clears the set filter.",
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
        const sets = readStringList(input, "sets");
        const category = readNullableString(input, "category");
        const tier = readNullableString(input, "tier");
        if (sets === undefined && !category.present && !tier.present) {
          return {
            error:
              "refine_search needs at least one of sets, category or tier. Use search_icons to change the query itself.",
          };
        }
        const state = await handle.refine({
          ...(sets === undefined ? {} : { sets }),
          ...(category.present ? { category: category.value } : {}),
          ...(tier.present ? { tier: tier.value } : {}),
        });
        return reportOutcome(state, readHitLimit(input));
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
      title: "Read the search page state",
      description:
        "Read what the icon library page is currently showing - the query, " +
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
}
