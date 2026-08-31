/**
 * The WebMCP tools one icon's detail page offers to an agent.
 *
 * Same contract as search-tools.ts, one page further in: the agent and the
 * human are looking at the same screen, so a tool call here does not render a
 * private copy of the icon on the side. `style_icon` presses the very setters
 * the size, color, stroke and transform controls press, so the preview the
 * person is watching changes under their eyes and every format tab below it
 * re-renders with it. `get_icon_code` reads the code out of the same tab the
 * human would click, and `download_icon` starts the same download the
 * Download button starts.
 *
 * Two rules this module exists to hold:
 *
 *   - **Capability honesty travels to the agent.** The page never shows a
 *     control the artwork cannot honour, and these tools never accept one
 *     either. An icon that ships as drawn refuses a recolor with the same
 *     sentence the page prints where the color control would be, and changes
 *     nothing. Silently ignoring the request would leave the agent telling the
 *     human about a color that is not on the screen.
 *   - **Validate everything, then apply.** Chrome does not enforce
 *     `inputSchema.required`, and a half-applied restyle is worse than a
 *     refused one, so every property is checked before any setter is called.
 *
 * Pure, like its sibling: it takes an `IconToolHandle` - the imperative handle
 * IconEditor.tsx hands out - and never touches React, the DOM or the network,
 * which is what makes icon-tools.test.ts a real test rather than a render.
 */

import type { Tier } from "../data";
import type { WebMcpTool } from "./bridge";

/** What this icon is, in the words the page itself uses. */
export interface IconIdentity {
  name: string;
  /** Human-readable set name, e.g. "Tabler Icons". */
  set: string;
  /** Set prefix, e.g. "tabler" - the first segment of this page's path. */
  prefix: string;
  /** The set's style when it declares exactly one ("outline", "filled"),
      null when it mixes several or declares none. */
  style: string | null;
  /** SPDX id where there is one, the license title otherwise. */
  license: string;
  attributionRequired: boolean;
  capability: IconCapability;
}

/**
 * What the artwork can take, plus the exact sentences the page prints when it
 * cannot take something. Sharing the sentences rather than writing new ones
 * here is the point: the agent's refusal and the human's on-screen
 * explanation are the same words.
 */
export interface IconCapability {
  tier: Tier;
  label: string;
  summary: string;
  canRecolor: boolean;
  canRetargetStroke: boolean;
  recolorAbsentReason: string;
  strokeAbsentReason: string;
}

/** The editor's live state - what the controls on the right are set to. */
export interface IconEditState {
  size: number;
  color: string;
  /** null is the "Original" choice: keep the stroke the artwork was drawn with. */
  strokeWidth: number | null;
  cssStyleable: boolean;
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  /** Inset as a fraction of the viewBox: 0.1 is the 10% the button toggles. */
  padding: number;
}

/** The values the on-page controls offer, so the tools accept exactly what a
    human could have clicked and the input schema advertises the same list. */
export interface IconConstraints {
  sizes: readonly number[];
  strokeWidths: readonly number[];
  /** Ceiling the transform pipeline clamps to (svg-doc.ts). */
  maxPadding: number;
}

/** One export tab, as the panel actually offers it for this icon. */
export interface IconFormat {
  id: string;
  label: string;
  /** "code" is copyable source, "image" is a rendered raster, "files" is the
      zip's file listing plus its Contents.json. */
  kind: "code" | "image" | "files";
  /** false when the artwork defeats this format - SwiftUI Path codegen on
      masked or gradient artwork, for instance. */
  supported: boolean;
  /** The note the panel prints under that tab, when it prints one. */
  note?: string;
}

/** A validated restyle. Absent keys are left exactly as the human set them. */
export interface IconStylePatch {
  size?: number;
  color?: string;
  strokeWidth?: number | null;
  rotate?: 0 | 90 | 180 | 270;
  flipH?: boolean;
  flipV?: boolean;
  padding?: number;
}

/**
 * The imperative handle IconEditor.tsx exposes to these tools.
 *
 * Everything is synchronous: unlike search, nothing here waits on a fetch.
 * `applyStyle` drives React state setters and returns the state that state
 * will settle on, so the agent's answer and the human's screen agree.
 */
export interface IconToolHandle {
  identity(): IconIdentity;
  constraints(): IconConstraints;
  edits(): IconEditState;
  /** The formats this icon's panel offers, in tab order. */
  formats(): IconFormat[];
  /** The tab currently open in the format panel. */
  activeFormat(): string;
  /** Presses the real controls. Only ever called with a validated patch. */
  applyStyle(patch: IconStylePatch): IconEditState;
  /** Switches the panel to `format` and returns what that tab is showing. */
  code(format: string): { code: string; lang: string; note?: string };
  /** Switches the panel to `format` and starts the same download the button
      starts. Returns the export URL the browser was sent to. */
  download(format: string): string;
}

/** Hex colors, in the two shapes the page's own color input emits. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const ROTATIONS = [0, 90, 180, 270] as const;

/** The properties `style_icon` understands, in the order the controls appear
    down the right-hand column. */
const STYLE_PROPERTIES = [
  "size",
  "color",
  "strokeWidth",
  "rotate",
  "flipH",
  "flipV",
  "padding",
] as const;

function list(values: readonly (string | number)[]): string {
  return values.join(", ");
}

/** What `style_icon` will accept for this particular icon - the honest answer
    to "what can I change here?", used in every refusal. */
export function editableProperties(capability: IconCapability): string[] {
  return STYLE_PROPERTIES.filter((property) => {
    if (property === "color") return capability.canRecolor;
    if (property === "strokeWidth") return capability.canRetargetStroke;
    return true;
  });
}

/** Joins a refusal to the page's explanation for it. The explanation can be
    empty - TIER_COPY leaves it blank for tiers that never refuse - so it is
    appended only when there is one, rather than trailing a double space. */
function refusal(property: string, reason: string): string {
  const explanation = reason.trim();
  return explanation
    ? `${property} is not editable for this icon. ${explanation}`
    : `${property} is not editable for this icon.`;
}

function capabilityLine(capability: IconCapability): string {
  return (
    `This icon is ${capability.label} (${capability.tier}). ` +
    `style_icon can change: ${list(editableProperties(capability))}.`
  );
}

interface StyleReading {
  patch: IconStylePatch;
  problems: string[];
  /** Keys the caller sent that this tool understands, valid or not. */
  seen: number;
}

/**
 * Reads and checks every property in one pass. Nothing is applied from here -
 * the caller applies only when `problems` is empty, so a request that is half
 * legal changes nothing at all.
 */
function readStyle(
  input: Record<string, unknown>,
  capability: IconCapability,
  constraints: IconConstraints,
): StyleReading {
  const patch: IconStylePatch = {};
  const problems: string[] = [];
  let seen = 0;

  for (const property of STYLE_PROPERTIES) {
    if (!(property in input)) continue;
    seen += 1;
    const value = input[property];

    switch (property) {
      case "size": {
        if (typeof value === "number" && constraints.sizes.includes(value)) {
          patch.size = value;
        } else {
          problems.push(`size must be one of ${list(constraints.sizes)}.`);
        }
        break;
      }
      case "color": {
        if (!capability.canRecolor) {
          problems.push(refusal("color", capability.recolorAbsentReason));
        } else if (typeof value === "string" && HEX.test(value)) {
          patch.color = value;
        } else {
          problems.push("color must be a hex string like '#183153' or '#f60'.");
        }
        break;
      }
      case "strokeWidth": {
        if (!capability.canRetargetStroke) {
          problems.push(refusal("strokeWidth", capability.strokeAbsentReason));
        } else if (value === null) {
          /* The "Original" choice: hand the artwork back its drawn stroke. */
          patch.strokeWidth = null;
        } else if (
          typeof value === "number" &&
          constraints.strokeWidths.includes(value)
        ) {
          patch.strokeWidth = value;
        } else {
          problems.push(
            `strokeWidth must be null (the icon's original stroke) or one of ${list(constraints.strokeWidths)}.`,
          );
        }
        break;
      }
      case "rotate": {
        const rotation = ROTATIONS.find((candidate) => candidate === value);
        if (rotation === undefined) {
          problems.push("rotate must be 0, 90, 180 or 270.");
        } else {
          patch.rotate = rotation;
        }
        break;
      }
      case "flipH":
      case "flipV": {
        if (typeof value !== "boolean") {
          problems.push(`${property} must be true or false.`);
        } else {
          patch[property] = value;
        }
        break;
      }
      case "padding": {
        if (
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          value < 0 ||
          value > constraints.maxPadding
        ) {
          problems.push(
            `padding must be a fraction of the icon box between 0 and ${constraints.maxPadding} (0.1 is the 10% the button toggles).`,
          );
        } else {
          patch.padding = value;
        }
        break;
      }
    }
  }

  return { patch, problems, seen };
}

/** Reads an optional format id. Anything non-string is treated as absent so
    the caller can fall back to the tab the human is on. */
function readFormat(input: Record<string, unknown>): string | undefined {
  const value = input["format"];
  return typeof value === "string" && value ? value.trim() : undefined;
}

function findFormat(formats: IconFormat[], id: string): IconFormat | undefined {
  return formats.find((format) => format.id === id);
}

function formatList(formats: IconFormat[]): string {
  return formats.map((format) => format.id).join(", ");
}

/**
 * Builds the tool set for one mounted IconEditor.
 *
 * The input schemas are baked from `handle.constraints()` at build time, so
 * the enums an agent sees are the exact values the buttons offer.
 */
export function createIconTools(handle: IconToolHandle): WebMcpTool[] {
  const constraints = handle.constraints();

  return [
    {
      name: "get_icon",
      title: "Read this icon",
      description:
        "Read everything about the icon on this page: its name and set, the " +
        "license and whether it asks for attribution, what the artwork can be " +
        "restyled to, the values the controls are set to right now, and every " +
        "export format offered for it. Changes nothing. Call it first - the " +
        "capability block tells you whether style_icon can recolor this icon " +
        "or retarget its stroke at all, and availableFormats tells you which " +
        "formats are honest for this artwork rather than which ones exist.",
      annotations: { readOnlyHint: true },
      inputSchema: { type: "object", properties: {} },
      execute() {
        const identity = handle.identity();
        return {
          name: identity.name,
          set: identity.set,
          prefix: identity.prefix,
          style: identity.style,
          license: identity.license,
          attributionRequired: identity.attributionRequired,
          capability: {
            tier: identity.capability.tier,
            label: identity.capability.label,
            summary: identity.capability.summary,
            canRecolor: identity.capability.canRecolor,
            canRetargetStroke: identity.capability.canRetargetStroke,
            editable: editableProperties(identity.capability),
          },
          currentEdits: handle.edits(),
          availableFormats: handle.formats(),
          activeFormat: handle.activeFormat(),
        };
      },
    },

    {
      name: "style_icon",
      title: "Restyle this icon",
      description:
        "Change how the icon on this page is drawn - size, color, stroke " +
        "width, rotation, flips and optical padding. This presses the same " +
        "controls the human can press, so they watch the big preview change " +
        "and every export tab below it re-render with the new values; there " +
        "is no private copy. Leave a property out to keep whatever the human " +
        "already set it to. What the artwork accepts depends on how it was " +
        "drawn, so read get_icon first: an icon that ships as drawn refuses " +
        "color, and artwork with no stroke left to retarget refuses " +
        "strokeWidth. A request containing anything this icon cannot do is " +
        "refused whole - nothing is applied - and the reply says what it can " +
        "do instead. Returns the edit state the page settled on.",
      inputSchema: {
        type: "object",
        properties: {
          size: {
            type: "number",
            enum: [...constraints.sizes],
            description:
              "Export size in pixels. Only the sizes the size buttons offer.",
          },
          color: {
            type: "string",
            description:
              "Hex color for the whole icon, e.g. '#183153'. Only for icons that " +
              "can be recolored - check capability.canRecolor from get_icon.",
          },
          strokeWidth: {
            type: ["number", "null"],
            enum: [null, ...constraints.strokeWidths],
            description:
              "Stroke width to retarget the artwork to. null restores the stroke " +
              "the icon was drawn with. Only for icons with a stroke to retarget - " +
              "check capability.canRetargetStroke from get_icon.",
          },
          rotate: {
            type: "number",
            enum: [...ROTATIONS],
            description: "Rotation in degrees, about the icon's own centre.",
          },
          flipH: { type: "boolean", description: "Mirror horizontally." },
          flipV: { type: "boolean", description: "Mirror vertically." },
          padding: {
            type: "number",
            description:
              `Optical padding as a fraction of the icon box, 0 to ${constraints.maxPadding}. ` +
              "0.1 matches the 10% the padding button toggles; 0 removes it.",
          },
        },
      },
      execute(input) {
        const identity = handle.identity();
        const { patch, problems, seen } = readStyle(
          input,
          identity.capability,
          constraints,
        );

        if (seen === 0) {
          return {
            error:
              "style_icon needs at least one of " +
              `${list(editableProperties(identity.capability))}. ` +
              "Use get_icon to read the current values.",
          };
        }
        if (problems.length > 0) {
          return {
            error: `${problems.join(" ")} Nothing was changed. ${capabilityLine(identity.capability)}`,
          };
        }

        const edits = handle.applyStyle(patch);
        const changed = Object.keys(patch);
        return {
          changed,
          edits,
          note:
            edits.cssStyleable && changed.includes("color")
              ? "CSS-styleable output is on, so the exported code keeps currentColor - the color you set drives the preview on the page only."
              : "The preview and every export tab on the page now show these values.",
        };
      },
    },

    {
      name: "get_icon_code",
      title: "Read this icon's code in one format",
      description:
        "Return the icon's source in one export format, exactly as the panel " +
        "at the bottom of the page renders it - with the current color, size, " +
        "stroke and transforms already applied, not the raw artwork. This also " +
        "switches the panel to that tab, so the human sees the code you are " +
        "reading. Use it to hand over code the person can paste: 'svg', 'jsx', " +
        "'tsx', 'vue', 'svelte', 'swiftui', 'datauri', or 'catalog' for the " +
        "Xcode asset catalog's Contents.json. PNG has no code - use " +
        "download_icon for that. Returns the format, a language hint for " +
        "syntax highlighting, and the code itself.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: {
          format: {
            type: "string",
            description:
              "Which export to read. Call get_icon for the list this icon offers.",
          },
        },
        required: ["format"],
      },
      execute(input) {
        const formats = handle.formats();
        const id = readFormat(input);
        if (!id) {
          return {
            error: `get_icon_code needs a format. This icon offers: ${formatList(formats)}.`,
          };
        }
        const format = findFormat(formats, id);
        if (!format) {
          return {
            error: `'${id}' is not an export format for this icon. Valid formats: ${formatList(formats)}.`,
          };
        }
        if (format.kind === "image") {
          return {
            error: `${format.label} is a rendered image, not code. Use download_icon with format '${format.id}' to save it.`,
          };
        }

        const result = handle.code(format.id);
        return {
          format: format.id,
          lang: result.lang,
          code: result.code,
          ...(format.supported ? {} : { supported: false }),
          ...(result.note ? { note: result.note } : {}),
        };
      },
    },

    {
      name: "download_icon",
      title: "Download this icon",
      description:
        "Start the same download the Download button starts, with the icon " +
        "styled exactly as it is on screen. The file lands in the human's " +
        "downloads, so say what you are saving before you call this. Pass a " +
        "format to save that one - it also switches the panel to that tab - or " +
        "leave it out to save whichever tab is open. 'png' is rasterized at " +
        "the selected size; 'catalog' saves the Xcode asset catalog as a zip; " +
        "the code formats save as source files.",
      inputSchema: {
        type: "object",
        properties: {
          format: {
            type: "string",
            description:
              "Which export to save. Omit to save the format the panel is " +
              "already showing. Call get_icon for the list this icon offers.",
          },
        },
      },
      execute(input) {
        const formats = handle.formats();
        const id = readFormat(input) ?? handle.activeFormat();
        const format = findFormat(formats, id);
        if (!format) {
          return {
            error: `'${id}' is not an export format for this icon. Valid formats: ${formatList(formats)}.`,
          };
        }

        const identity = handle.identity();
        const url = handle.download(format.id);
        return (
          `Downloading ${identity.prefix}:${identity.name} as ${format.label} ` +
          `from ${url}. The panel is showing that tab, and the file is styled ` +
          `the way the preview is.`
        );
      },
    },
  ];
}
