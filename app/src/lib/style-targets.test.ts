import { describe, expect, it } from "vitest";
import { computeStyleTargets, targetsSummary } from "./style-targets";

/* Shared across both describe blocks below: targetsSummary is a pure
   function OF computeStyleTargets's output, so its own tests reuse the same
   fixture bodies rather than re-deriving hasStroke/paletteSize by hand. */
const strokedIcon = {
  prefix: "test",
  name: "stroked",
  body: '<path stroke="#000" stroke-width="2" d="M0 0h24v24H0z"/>',
  width: 24,
  height: 24,
};

const filledIcon = {
  prefix: "test",
  name: "filled",
  body: '<path fill="#ff0000" d="M0 0h24v24H0z"/>',
  width: 24,
  height: 24,
};

const multicolorIcon = {
  prefix: "test",
  name: "multi",
  body: '<path fill="#ff0000" d="M0 0h12v12H0z"/><path fill="#00ff00" d="M12 12h12v12H12z"/>',
  width: 24,
  height: 24,
};

const cssStyleableIcon = {
  prefix: "test",
  name: "css",
  body: '<path fill="currentColor" d="M0 0h24v24H0z"/>',
  width: 24,
  height: 24,
};

describe("computeStyleTargets", () => {
  it("derives a stroke ratio and suggested width from a stroked icon", () => {
    const targets = computeStyleTargets(strokedIcon);
    expect(targets.hasStroke).toBe(true);
    expect(targets.strokeRatio).toBeCloseTo(2 / 24);
    expect(targets.suggestedStrokeWidth).toBeCloseTo(2);
  });

  it("reports no derivable stroke for a filled icon", () => {
    const targets = computeStyleTargets(filledIcon);
    expect(targets.hasStroke).toBe(false);
    expect(targets.strokeRatio).toBeNull();
    expect(targets.suggestedStrokeWidth).toBeNull();
  });

  it("suggests the single color of a monochrome icon", () => {
    const targets = computeStyleTargets(filledIcon);
    expect(targets.paletteSize).toBe(1);
    expect(targets.suggestedColor).toBe("#ff0000");
  });

  it("does not suggest a color for a multicolor icon", () => {
    const targets = computeStyleTargets(multicolorIcon);
    expect(targets.paletteSize).toBe(2);
    expect(targets.suggestedColor).toBeNull();
  });

  it("does not suggest a color for a CSS-styleable icon", () => {
    const targets = computeStyleTargets(cssStyleableIcon);
    expect(targets.paletteSize).toBe(0);
    expect(targets.suggestedColor).toBeNull();
  });

  it("always reports the intrinsic size", () => {
    expect(computeStyleTargets(strokedIcon).intrinsicSize).toBe(24);
  });
});

describe("targetsSummary", () => {
  /* The exact wording for a filled-shape anchor (repro:
     fluent:accessibility-28-filled) - two distinct, honest sentences, not
     folded into the color clause, and phrased so it complements (rather than
     repeats) the Stroke Width group's own "Icons without a stroke to
     retarget keep their own look..." sentence in CollectionStylePanel.tsx. */
  it("explains a no-stroke anchor in two distinct parts", () => {
    const summary = targetsSummary(computeStyleTargets(filledIcon));
    expect(summary).toContain("This icon is drawn as filled shapes");
    expect(summary).toContain("there's no stroke width to read from it");
    expect(summary).toContain(
      "The stroke control still applies to any of this collection's icons that do have one",
    );
  });

  it("names the single suggested color for a monochrome no-stroke anchor", () => {
    const summary = targetsSummary(computeStyleTargets(filledIcon));
    expect(summary).toContain("its color is #ff0000");
  });

  it("reports a stroke reading for a stroked anchor, no filled-shape wording", () => {
    const summary = targetsSummary(computeStyleTargets(strokedIcon));
    expect(summary).toContain("stroke reads about 2 on a 24px grid");
    expect(summary).not.toContain("filled shapes");
  });

  it("points to manual color picking for a multicolor anchor", () => {
    const summary = targetsSummary(computeStyleTargets(multicolorIcon));
    expect(summary).toContain("it uses 2 colors - pick one manually below");
  });

  it("explains a CSS-styleable (currentColor) anchor has no fixed color", () => {
    const summary = targetsSummary(computeStyleTargets(cssStyleableIcon));
    expect(summary).toContain("no fixed color to read (it takes the color around it)");
  });
});
