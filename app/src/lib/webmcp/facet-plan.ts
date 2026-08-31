/**
 * Turns "the agent asked for these filters" into "these are the facet pills to
 * click", as a pure function.
 *
 * The WebMCP tools on /search must not fork the island's state handling. The
 * honest way to satisfy that is for a tool to press the same controls a person
 * presses: SearchIsland's `toggle(key, value)` - the facet-pill click handler -
 * and `selectCategory(slug)` - the single-select category handler. So instead
 * of computing a new `Selected` behind the island's back, this plans a list of
 * those exact calls, and the island runs them.
 *
 * Two payoffs: the agent's change goes through the same code path (and the
 * same URL sync, and the same re-render) as a human click, and the merge rules
 * below are testable without React.
 *
 * The request is three-state throughout, which is the contract the tool
 * descriptions promise an agent:
 *
 *   field absent  leave that filter exactly as the human has it
 *   field null    clear that filter
 *   field value   make that filter be exactly this
 */

import type { FacetKey, Selected } from "../search/url-state";

/** One call to make on the island, in order. */
export type FacetOperation =
  | { kind: "toggle"; key: FacetKey; value: string }
  | { kind: "category"; slug: string };

/** The subset of filters the /search tools can touch. Style, license and the
    no-attribution switch stay human-only for now: they are refinements a
    person makes while looking at the rail, and every extra knob is another
    thing an agent can get subtly wrong on someone else's screen. */
export interface FacetRequest {
  /** Set prefixes. `[]` clears the set filter. */
  sets?: string[];
  /** One category slug, or null to clear. */
  category?: string | null;
  /** One capability tier ("T1".."T4"), or null to clear. */
  tier?: string | null;
}

/** Toggles that turn `current` (a list facet) into exactly `wanted`. */
function toggleListTo(
  key: FacetKey,
  current: string[],
  wanted: string[],
): FacetOperation[] {
  const target = new Set(wanted.filter(Boolean));
  const operations: FacetOperation[] = [];
  /* Remove first, then add: the island applies these as successive functional
     state updates, so the intermediate states stay small and the final one is
     the same either way. Removing first just reads better in a log. */
  for (const value of current) {
    if (!target.has(value)) operations.push({ kind: "toggle", key, value });
  }
  for (const value of target) {
    if (!current.includes(value)) operations.push({ kind: "toggle", key, value });
  }
  return operations;
}

/**
 * The facet-pill presses that move `current` to what `request` asks for.
 *
 * An empty result means the page already shows what was asked - the caller can
 * then skip waiting for a re-render that will never come.
 */
export function planFacetChanges(
  current: Selected,
  request: FacetRequest,
): FacetOperation[] {
  const operations: FacetOperation[] = [];

  if (request.sets !== undefined) {
    operations.push(...toggleListTo("prefix", current.prefix, request.sets));
  }

  if (request.tier !== undefined) {
    const wanted = request.tier === null ? [] : [request.tier];
    operations.push(...toggleListTo("tier", current.tier, wanted));
  }

  if (request.category !== undefined && request.category !== current.category) {
    /* `selectCategory` is a toggle in single-select clothing: calling it with
       a different slug swaps that slug in, calling it with the active one
       clears it. So clearing means naming the slug that is currently set. */
    const slug = request.category ?? current.category;
    if (slug) operations.push({ kind: "category", slug });
  }

  return operations;
}
