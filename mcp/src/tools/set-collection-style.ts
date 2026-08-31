/**
 * set_collection_style - the same style settings the web panel edits.
 * Validates through the exact same functions
 * app/src/pages/api/collections/[id]/style.ts's PUT route does
 * (lib/workspace/collection-style.ts's `validateColor`/`validateStrokeWidth`/
 * `validateSize`, plus `validateAnchorIconId`/`validateExportFormat` on the
 * two fields this tool does not expose), so an error message here reads
 * exactly like one from the web dashboard.
 *
 * The web PUT is "send the whole settings blob every time, not a partial
 * PATCH" (its own doc comment) - this tool only exposes color/stroke/size
 * (the tool signature has no anchor/format params), so it fetches
 * the collection's CURRENT settings first and carries `anchorIconId`/
 * `exportFormat` through unchanged, merging only the fields the caller sent.
 * "Sent" vs "omitted" is the zod-level signal: `undefined` (key omitted)
 * means "leave this field as it is", `null` means "clear it" - the same
 * null-clears-a-field convention `validateColor`/`validateStrokeWidth`/
 * `validateSize` already implement, now surfaced at the tool boundary too so
 * "mirror the web PUT exactly" (task brief) holds for unsetting as well as
 * setting.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { db } from "../../../app/src/db/client";
import { summarizeCollectionStyles } from "../../../app/src/lib/collection-download";
import {
  getCollectionStyleSettings,
  saveCollectionStyleSettings,
  validateAnchorIconId,
  validateColor,
  validateExportFormat,
  validateSize,
  validateStrokeWidth,
} from "../../../app/src/lib/workspace/collection-style";
import type { MotificonsAuthExtra } from "../auth";
import { errorResult, resolveCollection } from "./collection-shared";

export const setCollectionStyleInputSchema = z.object({
  collection: z.string().describe("The collection's name (case-insensitive exact match) or id."),
  color: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Hex color like "#183153" - every icon in the collection exports recolored to it (has no effect on a multicolor icon, or a set whose tier does not support recoloring). Pass null to clear it (icons export in their original colors). Omit to leave it unchanged.',
    ),
  stroke: z
    .number()
    .positive()
    .nullable()
    .optional()
    .describe(
      "Stroke width override, applied only to stroke-based (T1) icons in the collection - silently ignored on every other tier. Pass null to clear it. Omit to leave it unchanged.",
    ),
  size: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe(
      "Pixel size for non-PNG exports from this collection (PNG always defaults to 512 unless this is set). Pass null to clear it. Omit to leave it unchanged.",
    ),
});

export type SetCollectionStyleInput = z.infer<typeof setCollectionStyleInputSchema>;

export async function runSetCollectionStyle(
  input: SetCollectionStyleInput,
  extra: MotificonsAuthExtra,
): Promise<CallToolResult> {
  const database = await db();
  const resolved = await resolveCollection(database, extra.workspaceId, input.collection);
  if (!resolved.ok) return resolved.result;
  const { collection } = resolved;

  const current = await getCollectionStyleSettings(database, extra.workspaceId, collection.id);
  if (!current) return errorResult(`"${collection.name}" could not be found.`);

  const color = validateColor(input.color === undefined ? current.color : input.color);
  if (!color.ok) return errorResult(color.error);

  const strokeWidth = validateStrokeWidth(input.stroke === undefined ? current.strokeWidth : input.stroke);
  if (!strokeWidth.ok) return errorResult(strokeWidth.error);

  const size = validateSize(input.size === undefined ? current.size : input.size);
  if (!size.ok) return errorResult(size.error);

  const anchorIconId = validateAnchorIconId(current.anchorIconId);
  if (!anchorIconId.ok) return errorResult(anchorIconId.error);

  const exportFormat = validateExportFormat(current.exportFormat);
  if (!exportFormat.ok) return errorResult(exportFormat.error);

  const result = await saveCollectionStyleSettings(database, extra.workspaceId, collection.id, {
    anchorIconId: anchorIconId.value,
    color: color.value,
    strokeWidth: strokeWidth.value,
    size: size.value,
    exportFormat: exportFormat.value,
  });

  if (!result.ok) {
    return result.reason === "invalid-anchor"
      ? errorResult(
          `"${collection.name}"'s style anchor icon is no longer in the collection - clear it from the web dashboard, then try again.`,
        )
      : errorResult(`"${collection.name}" could not be found.`);
  }

  const { settings } = result;

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            collection: { id: collection.id, name: collection.name },
            style: {
              color: settings.color,
              strokeWidth: settings.strokeWidth,
              size: settings.size,
              exportFormat: settings.exportFormat,
            },
            summary: summarizeCollectionStyles({ color: settings.color, strokeWidth: settings.strokeWidth }),
          },
          null,
          2,
        ),
      },
    ],
  };
}
