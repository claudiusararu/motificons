/**
 * Shared definitions for the free SVG tool pages: one paste-and-convert
 * page per export format the library actually produces.
 *
 * `kind` is typed against `ToolKind`, which is derived from
 * `EXPORT_FORMATS` (../../lib/transforms/formats.ts) rather than hand-rolled
 * here - see `_tool-data.test.ts` and the runtime guard below, both of which
 * fail loudly if this list ever drifts out of sync with the format registry
 * (no hand-maintained duplicate list). The per-page copy
 * below (title, h1, lead, notes) still has to be written by hand - that is
 * the actual SEO content, and templating it from the format label alone
 * would read as thin, generic filler.
 */
import { EXPORT_FORMATS, type ToolKind } from "../../lib/transforms/formats";

export interface ToolDef {
  slug: string;
  kind: ToolKind;
  name: string;
  title: string;
  description: string;
  h1: string;
  lead: string;
  notes: string[];
}

export const TOOLS: ToolDef[] = [
  {
    slug: "svg-to-jsx",
    kind: "jsx",
    name: "SVG to JSX",
    title: "SVG to JSX converter - React, free",
    description:
      "Convert SVG into a React component with correctly camelCased attributes. Runs entirely in your browser - the markup never leaves your machine.",
    h1: "SVG to JSX",
    lead: "Paste an SVG and get a React component back, with every attribute renamed the way React actually wants it.",
    notes: [
      "This one runs entirely in your browser. The markup never leaves your machine.",
      "Attribute renaming comes from an explicit table, not a blanket kebab-to-camel rule, because SVG has exceptions in both directions.",
      "Props are spread onto the root svg, so size and color are yours to control.",
    ],
  },
  {
    slug: "svg-to-tsx",
    kind: "tsx",
    name: "SVG to TSX",
    title: "SVG to TSX converter - typed React, free",
    description:
      "Convert SVG into a typed React TSX component with SVGProps<SVGSVGElement> already wired up. Runs entirely in your browser.",
    h1: "SVG to TSX",
    lead: "Paste an SVG and get a typed React component back - props typed as SVGProps<SVGSVGElement>, ready to drop into a TypeScript project.",
    notes: [
      "This one runs entirely in your browser. The markup never leaves your machine.",
      "Same attribute renaming as the JSX converter, plus a typed props signature so the component type-checks immediately.",
      "Props are spread onto the root svg, so size and color are yours to control.",
    ],
  },
  {
    slug: "svg-to-vue",
    kind: "vue",
    name: "SVG to Vue",
    title: "SVG to Vue converter - Vue 3 SFC, free",
    description:
      "Convert SVG into a Vue 3 single-file component with size and color props already wired up, color defaulting to currentColor. Runs entirely in your browser.",
    h1: "SVG to Vue",
    lead: "Paste an SVG and get a Vue 3 single-file component back, with size and color props already wired up.",
    notes: [
      "This one runs entirely in your browser. The markup never leaves your machine.",
      "Vue takes SVG attributes as written, so unlike JSX there is no attribute renaming to do - the artwork passes through untouched.",
      "Color defaults to currentColor, so the icon inherits from whatever it sits inside, the way an icon font would.",
    ],
  },
  {
    slug: "svg-to-svelte",
    kind: "svelte",
    name: "SVG to Svelte",
    title: "SVG to Svelte converter - Svelte 5, free",
    description:
      "Convert SVG into a Svelte 5 component using runes for its size and color props, color defaulting to currentColor. Runs entirely in your browser.",
    h1: "SVG to Svelte",
    lead: "Paste an SVG and get a Svelte 5 component back, with size and color props declared with $props().",
    notes: [
      "This one runs entirely in your browser. The markup never leaves your machine.",
      "Written for Svelte 5's runes API, not the older export-let syntax.",
      "Color defaults to currentColor, so the icon inherits from whatever it sits inside, the way an icon font would.",
    ],
  },
  {
    slug: "svg-to-swiftui",
    kind: "swiftui",
    name: "SVG to SwiftUI",
    title: "SVG to SwiftUI converter - free, no signup",
    description:
      "Convert any SVG into a SwiftUI Shape - fill it, stroke it, animate it like a built-in shape. Free, no signup, no watermark.",
    h1: "SVG to SwiftUI",
    lead: "Paste an SVG and get a SwiftUI Shape back - fill it, stroke it, animate it like a built-in shape.",
    notes: [
      "Multicolor artwork comes back as a layered View, one Shape per color, because a Shape holds exactly one fill.",
      "Artwork built from masks or gradients has no honest Path equivalent. We say so rather than emitting code that does not match your drawing.",
      "The same engine that powers every SwiftUI export on the site, with nothing held back.",
    ],
  },
  {
    slug: "svg-to-png",
    kind: "png",
    name: "SVG to PNG",
    title: "SVG to PNG converter - any size, free, no watermark",
    description:
      "Rasterize any SVG to a transparent PNG at any size up to 2048px. Free, no signup, no watermark, nothing stored.",
    h1: "SVG to PNG",
    lead: "Paste an SVG, pick a size, get a transparent PNG. Up to 2048px, no watermark, no signup.",
    notes: [
      "Rendered with resvg, the same renderer behind every PNG on this site.",
      "The background stays transparent. If you need a solid background, add a rect to your SVG.",
      "Nothing is stored. Your file is rendered in memory and returned.",
    ],
  },
  {
    slug: "svg-to-data-uri",
    kind: "datauri",
    name: "SVG to Data URI",
    title: "SVG to Data URI converter - base64, free",
    description:
      "Convert SVG into a base64-encoded data URI, ready for an img src, a CSS background-image or a mask-image. Runs entirely in your browser.",
    h1: "SVG to Data URI",
    lead: "Paste an SVG and get a base64 data URI back - drop it into an img src, a CSS background-image or a mask-image.",
    notes: [
      "This one runs entirely in your browser. The markup never leaves your machine.",
      "Base64 encoding makes the string larger than the plain SVG - the tradeoff for embedding it inline with no extra request.",
      "Works anywhere a URL works: an img tag, a CSS background-image, or a mask-image for a monochrome icon.",
    ],
  },
];

/* Runtime guard, not just the test file: a mismatch here is a coding
   mistake, not a data problem, so failing loudly (in dev, in `astro check`'s
   build pass, in CI) beats silently shipping a stale tool list. Written
   without Set.prototype.difference() - too new to trust across every runtime
   this module ends up bundled for (the Cloudflare Workers build included). */
const TOOL_KINDS = new Set(TOOLS.map((tool) => tool.kind));
for (const format of EXPORT_FORMATS) {
  if (format.id === "svg" || format.id === "catalog") continue;
  if (!TOOL_KINDS.has(format.id)) {
    throw new Error(
      `tools/_tool-data.ts: no tool page for export format "${format.id}" - add one or update EXPORT_FORMATS.`,
    );
  }
}
if (TOOL_KINDS.size !== TOOLS.length) {
  throw new Error("tools/_tool-data.ts: duplicate tool kind in TOOLS.");
}

export function toolBySlug(slug: string): ToolDef | undefined {
  return TOOLS.find((tool) => tool.slug === slug);
}
