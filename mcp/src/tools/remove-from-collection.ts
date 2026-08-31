/**
 * remove_from_collection: removes one icon from one of the
 * caller's collections, resolved by name or id (collection-shared.ts).
 * Reuses `removeIconFromCollection` from lib/workspace/collection-items.ts
 * verbatim - same ownership check, same idempotence in the OTHER direction
 * (removing an icon that is not, or no longer, saved is still a success) as
 * the web's DELETE /api/collections/[id]/icons.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { db } from "../../../app/src/db/client";
import {
  countIconsInCollection,
  isValidIconId,
  removeIconFromCollection,
} from "../../../app/src/lib/workspace/collection-items";
import type { MotificonsAuthExtra } from "../auth";
import { errorResult, resolveCollection } from "./collection-shared";

export const removeFromCollectionInputSchema = z.object({
  collection: z.string().describe("The collection's name (case-insensitive exact match) or id."),
  icon_id: z
    .string()
    .describe('Icon id in "prefix:name" form, exactly as returned by search_icons, suggest_icons or get_collection (e.g. "tabler:arrow-right").'),
});

export type RemoveFromCollectionInput = z.infer<typeof removeFromCollectionInputSchema>;

export async function runRemoveFromCollection(
  input: RemoveFromCollectionInput,
  extra: MotificonsAuthExtra,
): Promise<CallToolResult> {
  const database = await db();
  const resolved = await resolveCollection(database, extra.workspaceId, input.collection);
  if (!resolved.ok) return resolved.result;
  const { collection } = resolved;

  if (!isValidIconId(input.icon_id)) {
    return errorResult(`"${input.icon_id}" is not a valid icon id - expected "prefix:name".`);
  }

  const removed = await removeIconFromCollection(database, extra.workspaceId, collection.id, input.icon_id);
  if (!removed) {
    return errorResult(`"${collection.name}" could not be found.`);
  }

  const iconCount = await countIconsInCollection(database, collection.id);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          { removed: true, collection: { id: collection.id, name: collection.name }, iconCount },
          null,
          2,
        ),
      },
    ],
  };
}
