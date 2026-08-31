/**
 * A style-guide icon's computed "fingerprint" - stroke presence/width,
 * palette - the read side of the style anchor. Pure, no DB/server
 * dependencies (only transforms/stroke.ts + transforms/color.ts, both
 * already proven safe in a client bundle via StyledIconGlyph's applyEdits
 * chain), so it runs in TWO places without becoming two implementations:
 *   - server-side, when a collection's style settings are saved
 *     (lib/workspace/collection-style.ts imports this rather than defining
 *     its own copy),
 *   - client-side, for a LIVE readout the moment a visitor picks a
 *     different anchor tile (CollectionStylePanel.tsx) - the server-saved
 *     value only ever reflects whichever anchor was last actually saved,
 *     which is stale (or simply absent, for a first-ever pick) for
 *     whichever tile a visitor just clicked but has not saved yet.
 */

import { hasStroke, opticalStrokeTarget, strokeRatio, strokeWidths } from "./transforms/stroke";
import { extractPalette } from "./transforms/color";

/** The grid every stroke ratio is normalized against for DISPLAY - a fixed
    reference so a suggested value reads the same regardless of the icon's
    own intrinsic grid. */
const DISPLAY_GRID = 24;

export interface ComputedStyleTargets {
  hasStroke: boolean;
  /** Stroke width as a fraction of the icon's own grid - comparable across
      sets drawn at different intrinsic sizes (stroke.ts's `strokeRatio`). */
  strokeRatio: number | null;
  /** That ratio scaled to a 24px grid, for a human-readable suggestion. */
  suggestedStrokeWidth: number | null;
  /** 0 = no fixed color (CSS-styleable/currentColor only), 1 = a single
      color the UI can suggest outright, 2+ = multicolor (pick manually). */
  paletteSize: number;
  suggestedColor: string | null;
  intrinsicSize: number;
  [key: string]: unknown;
}

export function computeStyleTargets(icon: { body: string; width: number }): ComputedStyleTargets {
  const widths = strokeWidths(icon.body);
  const strokePresent = hasStroke(icon.body);
  const grid = icon.width || DISPLAY_GRID;

  let ratio: number | null = null;
  if (strokePresent) {
    /* Widest declared width, same "thickest wins" convention retargetStroke
       uses - or the SVG default of 1 when a stroked element declares none. */
    const base = widths.length > 0 ? Math.max(...widths) : 1;
    ratio = strokeRatio(base, grid);
  }

  const palette = extractPalette(icon.body);

  return {
    hasStroke: strokePresent,
    strokeRatio: ratio,
    suggestedStrokeWidth: ratio === null ? null : opticalStrokeTarget(ratio, DISPLAY_GRID),
    paletteSize: palette.length,
    suggestedColor: palette.length === 1 ? (palette[0] ?? null) : null,
    intrinsicSize: icon.width,
  };
}

/** What the anchor's computed fingerprint says, in plain language (the
    capability-honesty rule) - a pure function of `ComputedStyleTargets`, kept
    here rather than inline in CollectionStylePanel.tsx so the exact wording
    is unit-testable without a browser (this project's whole testing
    convention is pure lib functions, no React component tests - see
    style-targets.test.ts).
 *
 * The no-stroke case is two DISTINCT sentences (the readout for a
 * filled-shape anchor like fluent:accessibility-28-filled used to show only
 * the icon's name, no explanation - a stale `computedTargets` bug fixed
 * alongside this) rather than folded into the same clause as the color
 * read-out: (1) this icon itself has no stroke to read from, same honest
 * tone as the icon detail page's TIER_COPY.strokeAbsentReason; (2) that is
 * about THIS icon as a fingerprint source, not about the Stroke width
 * control below, which still works for the collection - deliberately
 * phrased differently from that control's own existing sentence ("Icons
 * without a stroke to retarget keep their own look...") so the two read as
 * complementary, not a repeated line. */
export function targetsSummary(targets: ComputedStyleTargets): string {
  const colorPart =
    targets.paletteSize === 1
      ? `its color is ${targets.suggestedColor}`
      : targets.paletteSize === 0
        ? "no fixed color to read (it takes the color around it)"
        : `it uses ${targets.paletteSize} colors - pick one manually below`;

  if (!targets.hasStroke) {
    return `This icon is drawn as filled shapes, so there's no stroke width to read from it - stroke changes below won't affect its preview. The stroke control still applies to any of this collection's icons that do have one. From this icon: ${colorPart}.`;
  }

  return `From this icon: stroke reads about ${targets.suggestedStrokeWidth} on a 24px grid; ${colorPart}.`;
}
