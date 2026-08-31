/**
 * Stroke width retargeting.
 *
 * Only meaningful for T1 sets: everything else has had its strokes expanded
 * into filled outlines upstream, and there is no width left to change. Spike
 * S1 measured this - 227 of 450 sampled icons had no stroke at all - which is
 * why the tier gate lives in the caller rather than being discovered here.
 */

const STROKE_ATTR = /stroke-width\s*=\s*"([^"]*)"/g;
const STROKE_STYLE = /stroke-width\s*:\s*([0-9.]+)/g;
const STROKEABLE = /^(path|circle|ellipse|rect|line|polyline|polygon|g)$/;

/** Declared widths, in document order. Empty means every stroke inherits 1. */
export function strokeWidths(body: string): number[] {
  const widths: number[] = [];
  for (const match of body.matchAll(STROKE_ATTR)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) widths.push(value);
  }
  for (const match of body.matchAll(STROKE_STYLE)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) widths.push(value);
  }
  return widths;
}

export function hasStroke(body: string): boolean {
  return /\bstroke\s*=\s*"(?!none")/.test(body) || /\bstroke\s*:\s*(?!none)/.test(body);
}

/**
 * Rewrites stroke widths so the thickest becomes `target`, scaling the rest by
 * the same factor. Scaling rather than flattening is deliberate: an icon that
 * deliberately mixes a 2px body with a 1px detail keeps that relationship.
 *
 * When no width is declared at all the attribute is inserted on every stroked
 * element, because the SVG default of 1 is a real width that users expect to
 * be able to change.
 */
/**
 * The stroke width that reads the same on any grid.
 *
 * Stroke numbers are not comparable across sets. icon-park-outline draws
 * stroke 4 on a 48 grid; tabler draws 2 on 24. Those are the SAME optical
 * weight - both 1/12th of the box - and normalizing both to the number 1.5
 * leaves icon-park at half everyone else's weight, which is precisely the
 * inconsistency the style engine exists to remove.
 *
 * So the anchor is a ratio of the grid, not a number, and each icon's target
 * is that ratio scaled to its own viewBox.
 */
export function opticalStrokeTarget(ratio: number, gridWidth: number): number {
  const target = ratio * (gridWidth > 0 ? gridWidth : 24);
  return Math.round(target * 1000) / 1000;
}

/** Anchor expressed as a ratio: 1.5 on a 24 grid, the common stroke default. */
export function strokeRatio(strokeWidth: number, gridWidth: number): number {
  return strokeWidth / (gridWidth > 0 ? gridWidth : 24);
}

export function retargetStroke(body: string, target: number): string {
  const widths = strokeWidths(body);

  if (widths.length === 0) {
    if (!hasStroke(body)) return body;
    return body.replace(
      /<([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g,
      (whole, tag: string, attrs: string, slash: string) => {
        if (!STROKEABLE.test(tag)) return whole;
        if (!/\bstroke\s*=\s*"(?!none")/.test(attrs)) return whole;
        if (/\bstroke-width\s*[=:]/.test(attrs)) return whole;
        return `<${tag}${attrs} stroke-width="${target}"${slash}>`;
      },
    );
  }

  const base = Math.max(...widths);
  if (base === 0) return body;
  const factor = target / base;
  const scale = (value: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return String(Number((parsed * factor).toFixed(4)));
  };

  return body
    .replace(STROKE_ATTR, (whole, value: string) => {
      const next = scale(value);
      return next === null ? whole : `stroke-width="${next}"`;
    })
    .replace(STROKE_STYLE, (whole, value: string) => {
      const next = scale(value);
      return next === null ? whole : `stroke-width:${next}`;
    });
}
