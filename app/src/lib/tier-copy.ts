/**
 * How each capability tier is described to a person.
 *
 * The capability-honesty rule: the UI states what an icon can and cannot do, in
 * plain words, on the page itself. These strings are the single source for
 * that so a set page, a detail page and an FAQ answer never disagree.
 */

import type { Tier } from "./data";

export interface TierCopy {
  label: string;
  summary: string;
  /** Shown in place of the stroke control when retargeting does not apply. */
  strokeAbsentReason: string;
  /** Used in the detail-page FAQ. */
  recolorAnswer: string;
  swiftAnswer: string;
  /** One sentence for the set page's SEO paragraph. */
  setSentence: string;
}

export const TIER_COPY: Record<Tier, TierCopy> = {
  T1: {
    label: "Full restyle",
    summary:
      "Stroke width, color, size and optical padding are all editable, and it exports as a SwiftUI Shape you can fill, stroke and animate.",
    strokeAbsentReason: "",
    recolorAnswer:
      "Yes. The icon draws in a single color, so you can recolor it here, export it as CSS-styleable so it inherits the surrounding text color, or set any hex you like.",
    swiftAnswer:
      "Yes. It exports as a SwiftUI Shape, which you can fill, stroke and animate like any built-in shape. An Xcode asset catalog export is available too.",
    setSentence:
      "Every icon in this set can be fully restyled: stroke width, color, size and optical padding, plus SwiftUI Shape export.",
  },
  T2: {
    label: "Recolor and resize",
    summary:
      "Color, size and optical padding are editable. The artwork is already expanded to filled shapes, so there is no stroke width to retarget. Exports as a SwiftUI Shape.",
    strokeAbsentReason:
      "This artwork is already expanded to filled shapes, so there is no stroke to retarget.",
    recolorAnswer:
      "Yes. The icon is a single-color filled shape, so any hex works, and the CSS-styleable export makes it inherit the surrounding text color.",
    swiftAnswer:
      "Yes. It exports as a SwiftUI Shape, plus an Xcode asset catalog if you would rather ship the vector directly.",
    setSentence:
      "These icons are drawn as filled shapes, so color, size and padding are editable but stroke width is not - there is no stroke left to change.",
  },
  T3: {
    label: "Multicolor",
    summary:
      "Multicolor artwork. Resize freely and recolor per path; it exports as a layered SwiftUI View rather than a single Shape, because a Shape holds only one fill.",
    strokeAbsentReason:
      "Multicolor artwork is drawn as filled shapes, so there is no stroke width to retarget.",
    recolorAnswer:
      "Partly. The artwork uses several colors, so picking one flattens it. Per-path recoloring, which keeps the color relationships intact, arrives with the style engine.",
    swiftAnswer:
      "Yes, as a layered SwiftUI View: one Shape per color stacked in a ZStack. A single Shape cannot hold more than one fill, so flattening it would lose the artwork.",
    setSentence:
      "These are multicolor icons: resize and export freely, recolor per path, and export to SwiftUI as a layered View.",
  },
  T4: {
    label: "Export only",
    summary:
      "This set uses masks, clipping or gradients, so it ships as drawn: resize and export, no restyling. Native export is the Xcode asset catalog, which reproduces it exactly.",
    strokeAbsentReason:
      "This artwork uses masks or gradients and ships exactly as drawn, so there is no stroke to retarget.",
    recolorAnswer:
      "No. The artwork uses masks or gradients, so changing colors would alter the drawing rather than restyle it. You can still resize and export it at any size.",
    swiftAnswer:
      "Through the Xcode asset catalog, yes - it ships the SVG with preserve-vector-data so it stays crisp at any size. There is no honest SwiftUI Path for artwork built from masks and gradients, so we do not generate one.",
    setSentence:
      "This set uses masks, clipping or gradients, so icons export exactly as drawn rather than being restyled - resize and export at any size.",
  },
};
