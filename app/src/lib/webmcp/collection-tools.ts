/**
 * The WebMCP tools a collection workspace page (/collections/[id]) offers to
 * an agent.
 *
 * This is the collaboration surface, and it is the reason the whole WebMCP
 * bridge is worth building. The human is signed in and looking at their own
 * collection. The agent adds icons, sets one shared look and opens the
 * add-panel for approval - and every one of those lands in the grid the
 * person is watching, tile by tile, while they keep the mouse. They can veto
 * anything by removing a tile themselves; nothing here happens in a place
 * they cannot see.
 *
 * Same construction as search-tools.ts, for the same reasons:
 *
 *   - Pure. Every tool is a translation between the agent's JSON and a
 *     `CollectionToolHandle` the mounted island hands out, so this file
 *     tests with no DOM, no React and no network (collection-tools.test.ts).
 *   - No private path. The handle drives the exact fetches the human's own
 *     buttons drive - the same POST/DELETE the save-star sends, the same
 *     full-replace style PUT the Save styles button sends, the same zip URL
 *     the Download link points at. An agent cannot reach a collection
 *     through a back door that skips the UI.
 *   - Small payloads. Names, sets and counts; never SVG bodies. An agent
 *     that wants artwork opens the icon's own page.
 *
 * These tools only exist while a signed-in owner has the page open, so every
 * description says plainly that they act on this person's own collection, in
 * front of them.
 */

import { EXPORT_FORMATS, type ExportFormat } from "../transforms/formats";
import type { WebMcpTool } from "./bridge";

/** One saved icon, in the compact shape the tools report. */
export interface CollectionIconSummary {
  /** The icon's name, e.g. "arrow-right". */
  name: string;
  /** Human-readable set name, e.g. "Tabler Icons". */
  set: string;
  /** Set prefix, e.g. "tabler" - what every tool here takes back as input. */
  prefix: string;
}

/** The collection's saved look, in the shape an agent reads and writes. */
export interface CollectionStyleReport {
  /** The icon whose measurements the look was taken from, if one is set. */
  anchorIcon: { prefix: string; name: string } | null;
  color: string | null;
  strokeWidth: number | null;
  size: number | null;
  exportFormat: ExportFormat;
}

/** What the page is showing right now. */
export interface CollectionSnapshot {
  id: string;
  name: string;
  count: number;
  icons: CollectionIconSummary[];
  styles: CollectionStyleReport;
}

/** What `add_icon_to_collection` gets back from the island. */
export interface CollectionAddResult {
  /** False when the icon was already saved - an idempotent no-op, not a
      failure. */
  added: boolean;
  /** The collection's icon count after the call. */
  count: number;
  /** Human-readable set name for the icon that was added. */
  set: string;
}

/** What `download_collection` gets back once the browser has been pointed at
    the zip. */
export interface CollectionDownloadResult {
  ok: boolean;
  count: number;
  format: ExportFormat;
  /** The name the browser saves the file under, e.g. "dashboard-icons.zip". */
  filename: string;
  /** The tokened download URL the panel's anchor points at. Empty only on
      the timeout fallback. */
  url: string;
  /** Present when `ok` is false: the panel's own error sentence. */
  error?: string;
}

/** Fields `set_collection_styles` can change. Absent means "leave it". */
export interface CollectionStyleRequest {
  anchorIcon?: { prefix: string; name: string } | null;
  color?: string | null;
  strokeWidth?: number | null;
  size?: number | null;
  exportFormat?: ExportFormat;
}

/**
 * The imperative handle CollectionWorkspace.tsx exposes to these tools.
 *
 * The mutating methods RESOLVE once the page has actually changed - the
 * fetch landed and the grid re-rendered - so an agent never narrates a tile
 * that is not on screen yet. They REJECT (which the bridge turns into
 * `{ error }`) when the underlying request refused, carrying the API's own
 * sentence.
 */
export interface CollectionToolHandle {
  snapshot(): CollectionSnapshot;
  addIcon(input: { prefix: string; name: string }): Promise<CollectionAddResult>;
  removeIcon(input: { prefix: string; name: string }): Promise<{ count: number }>;
  setStyles(input: CollectionStyleRequest): Promise<CollectionStyleReport>;
  /** Opens the real "Add icons" slide-over, optionally with the embedded
      search already run for `query`. */
  openAddPanel(query: string | null): void;
  /** Opens the download panel and points the browser at the collection's zip
      URL, the same link the human's own Download button is. */
  download(format: ExportFormat | null): Promise<CollectionDownloadResult>;
}

/** Set prefixes and icon names are lowercase slugs; anything else is a
    caller mistake worth naming rather than a request worth sending. */
const SLUG = /^[a-z0-9][a-z0-9._-]*$/i;

const FORMAT_LIST = EXPORT_FORMATS.map((format) => format.id).join(", ");

function readString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

/** Three states, all meaningful: absent = leave it, null = clear it, a
    number = set it. Chrome does not enforce `required` or types for us. */
function readNullableNumber(
  input: Record<string, unknown>,
  key: string,
): { present: false } | { present: true; value: number | null } | { present: true; bad: true } {
  if (!(key in input)) return { present: false };
  const value = input[key];
  if (value === null || value === "") return { present: true, value: null };
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return { present: true, bad: true };
  return { present: true, value: parsed };
}

function readNullableString(
  input: Record<string, unknown>,
  key: string,
): { present: false } | { present: true; value: string | null } {
  if (!(key in input)) return { present: false };
  const value = input[key];
  if (value === null || value === "") return { present: true, value: null };
  return typeof value === "string" ? { present: true, value } : { present: false };
}

/** Reads a `{ prefix, name }` pair, the identity every tool here takes. */
function readIconRef(
  input: Record<string, unknown>,
  key: string,
): { present: false } | { present: true; value: { prefix: string; name: string } | null } | { present: true; bad: true } {
  if (!(key in input)) return { present: false };
  const value = input[key];
  if (value === null || value === "") return { present: true, value: null };
  if (typeof value !== "object") return { present: true, bad: true };
  const record = value as Record<string, unknown>;
  const prefix = typeof record["prefix"] === "string" ? record["prefix"].trim() : "";
  const name = typeof record["name"] === "string" ? record["name"].trim() : "";
  if (!SLUG.test(prefix) || !SLUG.test(name)) return { present: true, bad: true };
  return { present: true, value: { prefix, name } };
}

/** The pair every mutating tool needs, or the sentence to send back instead. */
function readIcon(
  input: Record<string, unknown>,
  toolName: string,
): { prefix: string; name: string } | { error: string } {
  const prefix = readString(input, "prefix")?.trim() ?? "";
  const name = readString(input, "name")?.trim() ?? "";
  if (!SLUG.test(prefix) || !SLUG.test(name)) {
    return {
      error:
        `${toolName} needs a set prefix and an icon name, for example ` +
        `prefix "tabler", name "arrow-right". Use search_icons on the ` +
        `library page, or get_collection here, to get exact ones.`,
    };
  }
  return { prefix, name };
}

/** "tabler:arrow-right, lucide:trash" - the members an anchor can be picked
    from, so a refusal is a correction rather than a dead end. */
function listMembers(state: CollectionSnapshot): string {
  if (state.icons.length === 0) return "this collection has no icons yet";
  return state.icons.map((icon) => `${icon.prefix}:${icon.name}`).join(", ");
}

function isInCollection(
  state: CollectionSnapshot,
  icon: { prefix: string; name: string },
): boolean {
  return state.icons.some(
    (member) => member.prefix === icon.prefix && member.name === icon.name,
  );
}

/**
 * Builds the tool set for one mounted CollectionWorkspace.
 *
 * Pure: pass the result straight to `registerWebMcpTools`.
 */
export function createCollectionTools(handle: CollectionToolHandle): WebMcpTool[] {
  return [
    {
      name: "get_collection",
      title: "Read this collection",
      description:
        "Read the collection the signed-in person has open: its name, how " +
        "many icons it holds, every icon in it (name, set and set prefix), " +
        "and the shared look currently applied - anchor icon, color, stroke " +
        "width, size and export format. Changes nothing. Call it first, " +
        "before adding or restyling, so you work from what is actually on " +
        "their screen rather than from what you added earlier in the " +
        "conversation. Never returns SVG source: open an icon's own page for " +
        "the artwork and downloads.",
      annotations: { readOnlyHint: true },
      inputSchema: { type: "object", properties: {} },
      execute() {
        const state = handle.snapshot();
        return {
          id: state.id,
          name: state.name,
          count: state.count,
          styles: state.styles,
          icons: state.icons,
        };
      },
    },

    {
      name: "add_icon_to_collection",
      title: "Add an icon to this collection",
      description:
        "Save one icon into the collection the person has open. The tile " +
        "appears in the grid in front of them straight away, wearing the " +
        "collection's shared look - so they can see what you picked and pull " +
        "anything they do not want. This is the same save the star on a " +
        "search result performs, against their own account. Pass the set " +
        "prefix and icon name exactly as a search hit or get_collection " +
        "reports them. Adding an icon that is already in the collection is a " +
        "success that changes nothing, so it is safe to retry. Add icons one " +
        "at a time and say what each one is for - a person watching six " +
        "tiles land with no explanation has no way to judge them.",
      inputSchema: {
        type: "object",
        properties: {
          prefix: {
            type: "string",
            description: "The icon set's prefix, e.g. 'tabler' or 'lucide'.",
          },
          name: {
            type: "string",
            description: "The icon's name, e.g. 'arrow-right'.",
          },
        },
        required: ["prefix", "name"],
      },
      async execute(input) {
        const icon = readIcon(input, "add_icon_to_collection");
        if ("error" in icon) return icon;

        const result = await handle.addIcon(icon);
        return {
          added: result.added,
          icon: { prefix: icon.prefix, name: icon.name, set: result.set },
          count: result.count,
          message: result.added
            ? `Added ${icon.prefix}:${icon.name}. The tile is now in the grid the person is looking at - the collection holds ${result.count} ${result.count === 1 ? "icon" : "icons"}.`
            : `${icon.prefix}:${icon.name} was already in this collection - nothing changed. It holds ${result.count} ${result.count === 1 ? "icon" : "icons"}.`,
        };
      },
    },

    {
      name: "remove_icon_from_collection",
      title: "Remove an icon from this collection",
      description:
        "Take one icon back out of the collection the person has open. The " +
        "tile disappears from the grid they are watching. Use it to undo an " +
        "add they did not want, or when they ask for something to go. Only " +
        "icons that are actually in the collection can be removed - call " +
        "get_collection if you are not sure what is in there. This deletes " +
        "from their real account, so do it when they asked for it, not to " +
        "tidy up on your own initiative.",
      inputSchema: {
        type: "object",
        properties: {
          prefix: {
            type: "string",
            description: "The icon set's prefix, e.g. 'tabler'.",
          },
          name: {
            type: "string",
            description: "The icon's name, e.g. 'arrow-right'.",
          },
        },
        required: ["prefix", "name"],
      },
      async execute(input) {
        const icon = readIcon(input, "remove_icon_from_collection");
        if ("error" in icon) return icon;

        const state = handle.snapshot();
        if (!isInCollection(state, icon)) {
          return {
            error:
              `${icon.prefix}:${icon.name} is not in this collection, so there ` +
              `is nothing to remove. It currently holds: ${listMembers(state)}.`,
          };
        }

        const result = await handle.removeIcon(icon);
        return {
          removed: true,
          count: result.count,
          message: `Removed ${icon.prefix}:${icon.name}. The tile is gone from the grid - the collection holds ${result.count} ${result.count === 1 ? "icon" : "icons"}.`,
        };
      },
    },

    {
      name: "set_collection_styles",
      title: "Set this collection's shared look",
      description:
        "Give every icon in the open collection one shared look - the same " +
        "save the 'Set collection styles' panel performs. The grid re-renders " +
        "in front of the person the moment it saves, so they see the new " +
        "color and stroke weight on their own icons rather than reading about " +
        "them. Two ways to drive it, and they combine: pass anchorIcon to " +
        "take the look from one icon already in the collection (that icon's " +
        "own stroke weight and geometry become the target), and/or set color, " +
        "strokeWidth and size by hand. Every field is three-state: leave it " +
        "out to keep what is set, pass null to clear it, pass a value to set " +
        "it. Icons whose artwork cannot take a restyle keep their own look - " +
        "that is honest, not a failure. Use it when someone asks for a " +
        "consistent set, e.g. 'make them all navy with a 1.5 stroke'.",
      inputSchema: {
        type: "object",
        properties: {
          anchorIcon: {
            type: "object",
            properties: {
              prefix: { type: "string" },
              name: { type: "string" },
            },
            description:
              "The icon to take the shared look from. Must already be IN this " +
              "collection - call get_collection for the members. null clears it.",
          },
          color: {
            type: ["string", "null"],
            description:
              "Hex color for every icon, e.g. '#183153'. null clears it and each icon keeps its own color.",
          },
          strokeWidth: {
            type: ["number", "null"],
            description:
              "Stroke weight for icons drawn with strokes, e.g. 1.5 or 2. null clears it.",
          },
          size: {
            type: ["number", "null"],
            description:
              "Pixel size used when exporting, e.g. 24. null clears it. Does not change the on-page tiles.",
          },
          exportFormat: {
            type: "string",
            description: `Remembered download format. One of: ${FORMAT_LIST}.`,
          },
        },
      },
      async execute(input) {
        const state = handle.snapshot();
        const request: CollectionStyleRequest = {};

        const anchor = readIconRef(input, "anchorIcon");
        if (anchor.present && "bad" in anchor) {
          return {
            error:
              "anchorIcon must be an object like { \"prefix\": \"tabler\", \"name\": \"arrow-right\" }, or null to clear it.",
          };
        }
        if (anchor.present) {
          if (anchor.value && !isInCollection(state, anchor.value)) {
            return {
              error:
                `The style-guide icon has to be one of this collection's own ` +
                `icons, and ${anchor.value.prefix}:${anchor.value.name} is not ` +
                `in it. Pick from: ${listMembers(state)}. Add it first with ` +
                `add_icon_to_collection if you meant to use it.`,
            };
          }
          request.anchorIcon = anchor.value;
        }

        const color = readNullableString(input, "color");
        if (color.present) request.color = color.value;

        const strokeWidth = readNullableNumber(input, "strokeWidth");
        if (strokeWidth.present && "bad" in strokeWidth) {
          return { error: "strokeWidth must be a number, e.g. 1.5, or null to clear it." };
        }
        if (strokeWidth.present) request.strokeWidth = strokeWidth.value;

        const size = readNullableNumber(input, "size");
        if (size.present && "bad" in size) {
          return { error: "size must be a whole number of pixels, e.g. 24, or null to clear it." };
        }
        if (size.present) request.size = size.value;

        const format = readString(input, "exportFormat")?.trim();
        if (format !== undefined) {
          if (!EXPORT_FORMATS.some((option) => option.id === format)) {
            return { error: `'${format}' is not an export format here. Pick one of: ${FORMAT_LIST}.` };
          }
          request.exportFormat = format as ExportFormat;
        }

        if (Object.keys(request).length === 0) {
          return {
            error:
              "set_collection_styles needs at least one of anchorIcon, color, strokeWidth, size or exportFormat.",
          };
        }

        const applied = await handle.setStyles(request);
        return {
          applied,
          message:
            "Saved. The collection's grid has re-rendered with this look on the person's screen.",
        };
      },
    },

    {
      name: "open_add_icons_panel",
      title: "Open the Add icons panel for the human",
      description:
        "Slide open the collection's real 'Add icons' panel, optionally with " +
        "a search already run, and hand the choice to the person. Use this " +
        "when the pick is theirs to make rather than yours: taste calls " +
        "('which of these arrows feels right?'), a set you cannot narrow for " +
        "them, or any moment you would otherwise be guessing on their behalf. " +
        "They then star what they want, one click per icon, and the tiles " +
        "land in the grid. Prefer this over adding six near-identical icons " +
        "and asking them to prune. It changes nothing on its own - it opens a " +
        "panel and stops.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Optional search to run in the panel, in plain singular words: 'arrow right', 'calendar'. Omit to open the panel at its resting set grid.",
          },
        },
      },
      execute(input) {
        const query = readString(input, "query")?.trim() ?? "";
        handle.openAddPanel(query || null);
        return query
          ? `The Add icons panel is open on this person's screen, showing results for "${query}". They can star the ones they want - each star adds that icon to this collection. Wait for them to choose, then call get_collection to see what they picked.`
          : "The Add icons panel is open on this person's screen at its icon-set grid. They can search and star what they want; each star adds that icon to this collection. Call get_collection afterwards to see what they picked.";
      },
    },

    {
      name: "download_collection",
      title: "Download this collection as a zip",
      description:
        "Start the collection's real download: every icon exported in one " +
        "format, wearing the collection's shared look, zipped by the server " +
        "with a LICENSES.txt listing what each icon set asks of them. The " +
        "download panel opens in front of the person and their browser saves " +
        "the file, exactly as if they had clicked the button - this is their " +
        "download, on their machine, so only call it when they have asked " +
        "for one. Optionally pass a format; leaving it out uses the format " +
        "the collection already remembers. Returns once the browser has the " +
        "download; how long the file itself takes to arrive is the browser's " +
        "business, so do not promise them it has finished.",
      inputSchema: {
        type: "object",
        properties: {
          format: {
            type: "string",
            description: `Export format for every icon. One of: ${FORMAT_LIST}. Omit to use the collection's remembered format.`,
          },
        },
      },
      async execute(input) {
        const state = handle.snapshot();
        if (state.count === 0) {
          return {
            error:
              "This collection has no icons yet, so there is nothing to " +
              "download. Add some with add_icon_to_collection, or open the Add " +
              "icons panel so the person can pick their own.",
          };
        }

        const format = readString(input, "format")?.trim();
        if (format !== undefined && !EXPORT_FORMATS.some((option) => option.id === format)) {
          return { error: `'${format}' is not an export format here. Pick one of: ${FORMAT_LIST}.` };
        }

        const result = await handle.download((format as ExportFormat) ?? null);
        if (!result.ok) {
          return { error: result.error ?? "The download did not start. Ask the person to try the Download button." };
        }
        /* Some embedded browsers only honor downloads started by a real
           human click, and this one was started by a tool call. So besides
           reporting the handoff, give the agent the direct URL: navigating
           the browser to it downloads the same file, and the Download button
           stays ready on the open panel for the person to press. */
        /* Absolutized in the browser; in a DOM-less test the relative form
           is already the right answer. */
        const downloadUrl =
          result.url && typeof window !== "undefined"
            ? new URL(result.url, window.location.origin).toString()
            : result.url;
        return {
          downloading: true,
          filename: result.filename,
          count: result.count,
          format: result.format,
          downloadUrl,
          message:
            `The download panel is open on the person's screen and their browser was handed ${result.filename} - ` +
            `${result.count} ${result.count === 1 ? "icon" : "icons"} exported as ${result.format}, with a LICENSES.txt inside. ` +
            `Some browsers only start downloads from a human click. If no save dialog appeared, ` +
            `open ${downloadUrl || "the panel's Download link"} directly - it downloads the same zip - ` +
            `or tell the person the Download button is ready on the open panel.`,
        };
      },
    },
  ];
}
