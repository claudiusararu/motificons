/**
 * get_collection: one of the caller's collections, resolved by
 * name or id (collection-shared.ts), with every saved icon rendered in the
 * collection's remembered export format and its saved style settings
 * (color/stroke/size) already applied - the same output the web dashboard's
 * Download button would produce for that icon (reuses
 * lib/collection-download.ts's `resolveExportSize`, the exact size-resolution
 * rule CollectionDownloadPanel.tsx uses, so the two never disagree). Bodies
 * resolve through the same `getIcon`/`getSet` storage path get-icon.ts uses.
 *
 * Rendered formats mirror get_icon's own dispatch (svg, jsx, tsx, vue,
 * svelte, swiftui, png) plus "datauri" - a short `data:` string, cheap to
 * inline per icon, unlike "catalog" (an Xcode asset-catalog ZIP per icon -
 * not a useful shape for a JSON tool result, same reasoning get_icon's own
 * doc comment gives for excluding it there). A collection remembered as
 * "catalog" downgrades to "svg" here, with an honest `formatNote` explaining
 * why - the capability-honesty pattern get_icon's swiftui refusal already
 * established, not a silent substitution.
 *
 * The per-icon render dispatch itself lives in collection-shared.ts's
 * `renderIconInFormat` - audit_repo_icons reuses that same function to
 * render its suggested replacements, so the two tools can never disagree on
 * what a given format/style combination produces for the same icon.
 *
 * Capped at MAX_COLLECTION_ICONS per call (state in the tool description,
 * per the task brief) - a collection with more than that is truncated,
 * oldest-saved icons first (listCollectionItems's own order), with
 * `truncated: true` in the response so a calling agent knows to ask for a
 * narrower slice rather than assuming it saw everything.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { db } from "../../../app/src/db/client";
import { resolveExportSize } from "../../../app/src/lib/collection-download";
import type { IconEdits } from "../../../app/src/lib/transforms";
import { listCollectionItems } from "../../../app/src/lib/workspace/collection-items";
import { getCollectionStyleSettings } from "../../../app/src/lib/workspace/collection-style";
import type { MotificonsAuthExtra } from "../auth";
import { isRenderable, renderIconInFormat, resolveCollection, type RenderableFormat } from "./collection-shared";

export const MAX_COLLECTION_ICONS = 100;
const DEFAULT_PNG_SIZE = 512;

export const getCollectionInputSchema = z.object({
  collection: z.string().describe("The collection's name (case-insensitive exact match) or id."),
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_COLLECTION_ICONS)
    .default(MAX_COLLECTION_ICONS)
    .describe(
      `Max icons to return (default and hard cap ${MAX_COLLECTION_ICONS}). A collection with more saved icons than this is truncated, oldest-saved first.`,
    ),
});

export type GetCollectionInput = z.infer<typeof getCollectionInputSchema>;

export async function runGetCollection(
  input: GetCollectionInput,
  extra: MotificonsAuthExtra,
): Promise<CallToolResult> {
  const database = await db();
  const resolved = await resolveCollection(database, extra.workspaceId, input.collection);
  if (!resolved.ok) return resolved.result;
  const { collection } = resolved;

  const [items, style] = await Promise.all([
    listCollectionItems(database, collection.id),
    getCollectionStyleSettings(database, extra.workspaceId, collection.id),
  ]);

  const page = items.slice(0, input.limit);

  const rememberedFormat = style?.exportFormat ?? "svg";
  const downgradedFromCatalog = rememberedFormat === "catalog";
  const format: RenderableFormat = isRenderable(rememberedFormat) ? rememberedFormat : "svg";

  const edits: IconEdits = {
    color: style?.color ?? undefined,
    strokeWidth: style?.strokeWidth ?? undefined,
    size: resolveExportSize(format, DEFAULT_PNG_SIZE, style?.size ?? null),
  };

  const icons = await Promise.all(
    page.map((item) => renderIconInFormat(item.iconId, format, edits)),
  );

  const body: Record<string, unknown> = {
    collection: { id: collection.id, name: collection.name },
    format,
    totalIcons: items.length,
    returned: icons.length,
    truncated: items.length > icons.length,
    icons,
  };

  if (downgradedFromCatalog) {
    body.formatNote =
      'This collection\'s remembered export format is "catalog" (an Xcode asset-catalog ZIP per icon) - not a useful shape for a tool result, so icons are returned as "svg" instead. Use the web dashboard\'s Download to get the real asset catalog.';
  }

  return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
}
