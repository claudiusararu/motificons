/**
 * Capability tiers (SPEC section 3.5, decided from Spike S1).
 *
 * The spike measured what each transform can actually do per family; this is
 * the same classification generalised to all 239 sets so nothing is hardcoded
 * to the 15 families that were sampled. The spike script itself stays frozen
 * as evidence - this is the product path.
 *
 *   T1  full support, including live stroke retarget
 *   T2  everything except stroke (geometry is already expanded to fill)
 *   T3  geometry and bounds fine, colour is per-path, SwiftUI as layered View
 *   T4  asset-catalog-only native export (masks, clips, gradients, <use>)
 *
 * Order matters: a set with masks is T4 even if it also strokes, and a
 * multicolour set is T3 even if it also strokes, because the harder constraint
 * is the one that decides what we can honestly promise.
 */

import { parseFragment, styleDeclarations } from "./svg/markup.ts";

export type Tier = "T1" | "T2" | "T3" | "T4";

export const TIER_LABEL: Record<Tier, string> = {
  T1: "Full restyle",
  T2: "Recolor and resize",
  T3: "Multicolor",
  T4: "Export only",
};

export const TIER_SUMMARY: Record<Tier, string> = {
  T1: "Stroke width, colour, size and optical padding are all editable, and it exports as a SwiftUI Shape.",
  T2: "Colour, size and optical padding are editable; the artwork is already expanded so there is no stroke to retarget. Exports as a SwiftUI Shape.",
  T3: "Multicolour artwork: recolour per path, resize freely. Exports as a layered SwiftUI View.",
  T4: "Uses masks, clipping or gradients, so it is delivered as-is: resize and export, no restyle. Native export is the asset catalog.",
};

const GEOMETRY = new Set([
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
]);

const BLOCKING_ELEMENTS = new Set([
  "mask",
  "clipPath",
  "filter",
  "linearGradient",
  "radialGradient",
  "pattern",
  "use",
  "image",
  "foreignObject",
]);

export interface IconCapability {
  blocked: boolean;
  multicolor: boolean;
  stroked: boolean;
}

export function analyseIconCapability(body: string): IconCapability {
  const { elements } = parseFragment(body);
  const colors = new Set<string>();
  let blocked = false;
  let stroked = false;

  for (const element of elements) {
    if (BLOCKING_ELEMENTS.has(element.name)) blocked = true;
    if (element.attrs["mask"] || element.attrs["clip-path"]) blocked = true;
    if (element.attrs["filter"]) blocked = true;

    if (!GEOMETRY.has(element.name) && element.name !== "g") continue;

    const style = element.attrs["style"]
      ? styleDeclarations(element.attrs["style"])
      : undefined;

    for (const key of ["fill", "stroke"] as const) {
      const value = style?.[key] ?? element.attrs[key];
      if (!value || value === "none") continue;
      if (value.startsWith("url(")) blocked = true;
      else if (value !== "currentColor") colors.add(value.toLowerCase());
      if (key === "stroke") stroked = true;
    }
  }

  return { blocked, multicolor: colors.size >= 2, stroked };
}

/** Deterministic stride sample so the tier does not depend on insertion order. */
export function sampleForTier(names: string[], count: number): string[] {
  if (names.length <= count) return names;
  const stride = names.length / count;
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) out.push(names[Math.floor(i * stride)]!);
  return out;
}

export interface TierResult {
  tier: Tier;
  /** Share of the sample that hit each constraint, for auditing. */
  blockedShare: number;
  multicolorShare: number;
  strokedShare: number;
  sampled: number;
}

export function classifySet(
  icons: Record<string, { body: string }>,
  sampleSize = 60,
): TierResult {
  const names = sampleForTier(Object.keys(icons).sort(), sampleSize);
  let blocked = 0;
  let multicolor = 0;
  let stroked = 0;

  for (const name of names) {
    const capability = analyseIconCapability(icons[name]!.body);
    if (capability.blocked) blocked += 1;
    if (capability.multicolor) multicolor += 1;
    if (capability.stroked) stroked += 1;
  }

  const sampled = names.length || 1;
  const blockedShare = blocked / sampled;
  const multicolorShare = multicolor / sampled;
  const strokedShare = stroked / sampled;

  const tier: Tier =
    blockedShare >= 0.5
      ? "T4"
      : multicolorShare >= 0.5
        ? "T3"
        : strokedShare >= 0.5
          ? "T1"
          : "T2";

  return {
    tier,
    blockedShare,
    multicolorShare,
    strokedShare,
    sampled: names.length,
  };
}

/**
 * The 15 families Spike S1 measured, with the tiers SPEC records as canonical.
 * sync-icons asserts against this so a change to the heuristic that silently
 * contradicts the measured evidence fails the build instead of shipping.
 */
export const SPIKE_EXPECTED_TIERS: Record<string, Tier> = {
  tabler: "T1",
  lucide: "T1",
  feather: "T1",
  arcticons: "T1",
  "material-symbols": "T2",
  mdi: "T2",
  ph: "T2",
  "ant-design": "T2",
  carbon: "T2",
  "fluent-emoji-flat": "T3",
  "icon-park": "T3",
  "fluent-emoji": "T4",
  meteocons: "T4",
  "circle-flags": "T4",
  "icon-park-twotone": "T4",
};
