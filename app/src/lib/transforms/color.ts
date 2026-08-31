/**
 * Colour transforms.
 *
 * Two different jobs share this file because they are the same operation seen
 * from different ends: a monochrome icon has one paint to change, a multicolour
 * icon has several and the caller decides which becomes what.
 */

const PAINT_ATTR = /\b(fill|stroke)\s*=\s*"([^"]*)"/g;
const PAINT_STYLE = /\b(fill|stroke)\s*:\s*([^;"']+)/g;

function isPaintable(value: string): boolean {
  const paint = value.trim();
  return paint !== "" && paint !== "none" && !paint.startsWith("url(");
}

/**
 * Distinct hardcoded colours in document order. currentColor is excluded: it
 * is not a colour, it is a deferral to CSS.
 */
export function extractPalette(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const record = (value: string) => {
    const paint = value.trim();
    if (!isPaintable(paint) || paint === "currentColor") return;
    const key = paint.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(paint);
  };

  for (const match of body.matchAll(PAINT_ATTR)) record(match[2]!);
  for (const match of body.matchAll(PAINT_STYLE)) record(match[2]!);
  return out;
}

/** True when the icon defers all of its paint to CSS already. */
export function isCurrentColorOnly(body: string): boolean {
  return extractPalette(body).length === 0;
}

/**
 * Rewrites every paint through `map`. Returning null from the map leaves that
 * paint untouched, which is what makes per-path recolouring possible without
 * having to enumerate the whole document.
 */
export function mapPaints(
  body: string,
  map: (paint: string, attribute: "fill" | "stroke") => string | null,
): string {
  return body
    .replace(PAINT_ATTR, (whole, attribute: string, value: string) => {
      if (!isPaintable(value)) return whole;
      const next = map(value.trim(), attribute as "fill" | "stroke");
      return next === null ? whole : `${attribute}="${next}"`;
    })
    .replace(PAINT_STYLE, (whole, attribute: string, value: string) => {
      if (!isPaintable(value)) return whole;
      const next = map(value.trim(), attribute as "fill" | "stroke");
      return next === null ? whole : `${attribute}:${next}`;
    });
}

/**
 * Paints the whole icon one colour. Safe on multicolour art too - it simply
 * flattens it, which is what a user asking for "make it blue" means.
 */
export function recolor(body: string, color: string): string {
  return mapPaints(body, () => color);
}

/**
 * Per-path recolour for multicolour icons: a map from the original paint to
 * its replacement, matched case-insensitively because #FFF and #fff are the
 * same colour to everyone except a string comparison.
 */
export function recolorPalette(
  body: string,
  mapping: Record<string, string>,
): string {
  const normalized = new Map(
    Object.entries(mapping).map(([from, to]) => [from.toLowerCase(), to]),
  );
  return mapPaints(body, (paint) => normalized.get(paint.toLowerCase()) ?? null);
}

/**
 * "CSS-styleable": hand every paint back to the cascade so `color` drives the
 * icon. Explicit `none` stays - it is structural, not a colour choice.
 */
export function toCurrentColor(body: string): string {
  return mapPaints(body, () => "currentColor");
}
