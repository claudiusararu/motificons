/**
 * get_icon: the icon in a requested export format, production
 * ready. Reuses the transforms lib verbatim (app/src/lib/transforms) - the
 * exact functions api/export/[prefix]/[name].ts calls, so a format an agent
 * gets here is byte-for-byte what the web download button would produce for
 * the same id + edits.
 *
 * Format list is svg, jsx, tsx, vue, svelte, swiftui and png - not the
 * web's full nine-format menu
 * (catalog/datauri are web-only exports; a zip and a data: string are not
 * useful shapes for an agent to receive back from a tool call).
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { getIcon, getSet, isSafeSegment } from "../../../app/src/lib/data";
import {
  buildSvg,
  toJsxComponent,
  toPng,
  toSvelteComponent,
  toSwiftUi,
  toVueComponent,
  type IconEdits,
} from "../../../app/src/lib/transforms";

const FORMATS = ["svg", "jsx", "tsx", "vue", "svelte", "swiftui", "png"] as const;

export const getIconInputSchema = z.object({
  id: z
    .string()
    .describe('Icon id in "prefix:name" form, exactly as returned by search_icons or suggest_icons (e.g. "tabler:arrow-right").'),
  format: z
    .enum(FORMATS)
    .default("svg")
    .describe(
      'Output format. Default "svg". "png" returns a rasterized image; every other value returns source code as text.',
    ),
  color: z
    .string()
    .optional()
    .describe(
      'Hex color, e.g. "#183153", to recolor the icon. Has no effect on a multicolor icon (nothing to flatten to one color) or on a set whose tier does not support recoloring.',
    ),
  size: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Pixel size. Sets the SVG width/height attributes for code formats, and the rendered width for \"png\" (default 512 there).",
    ),
  stroke: z
    .number()
    .positive()
    .optional()
    .describe(
      "Stroke width override. Only applies to stroke-based (T1) sets; silently ignored on every other tier.",
    ),
});

export type GetIconInput = z.infer<typeof getIconInputSchema>;

function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Chunked to avoid `String.fromCharCode(...bytes)` blowing the call stack
    on a large rasterized PNG. */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

export async function runGetIcon(input: GetIconInput): Promise<CallToolResult> {
  const { id, format, color, size, stroke } = input;
  const separator = id.indexOf(":");
  if (separator < 0) {
    return errorResult(`"${id}" is not a valid icon id - expected "prefix:name".`);
  }

  const prefix = id.slice(0, separator);
  const name = id.slice(separator + 1);
  if (!isSafeSegment(prefix) || !isSafeSegment(name)) {
    return errorResult(`"${id}" is not a valid icon id.`);
  }

  const [icon, set] = await Promise.all([getIcon(prefix, name), getSet(prefix)]);
  if (!icon || !set) {
    return errorResult(`No icon found for "${id}". Use search_icons to find a valid id.`);
  }

  const edits: IconEdits = { size, color, strokeWidth: stroke };
  const tier = set.tier;

  switch (format) {
    case "svg":
      return textResult(buildSvg(icon, edits, tier));
    case "jsx":
      return textResult(toJsxComponent(icon, edits, tier, { typescript: false }));
    case "tsx":
      return textResult(toJsxComponent(icon, edits, tier, { typescript: true }));
    case "vue":
      return textResult(toVueComponent(icon, edits, tier, { typescript: false }));
    case "svelte":
      return textResult(toSvelteComponent(icon, edits, tier, { typescript: false }));
    case "swiftui": {
      /* toSwiftUi() IS the capability-honesty check: "unsupported"
         returns a code-comment explaining why, in the same `code` field a
         real Shape/View would occupy - there is nothing extra to gate here,
         only to pass through. */
      const result = toSwiftUi(icon, edits, tier);
      return textResult(result.code);
    }
    case "png": {
      const png = await toPng(icon, edits, tier, size ?? 512);
      return {
        content: [{ type: "image", data: toBase64(png), mimeType: "image/png" }],
      };
    }
  }
}
