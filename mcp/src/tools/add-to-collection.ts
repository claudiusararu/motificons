/**
 * add_to_collection: saves one icon into one of the caller's
 * collections, resolved by name or id (collection-shared.ts). Reuses
 * `addIconToCollection` from lib/workspace/collection-items.ts verbatim -
 * same ownership check, same idempotence (saving an already-saved icon is
 * still a success) as the web's POST /api/collections/[id]/icons.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { db } from "../../../app/src/db/client";
import { addIconToCollection, countIconsInCollection, isValidIconId } from "../../../app/src/lib/workspace/collection-items";
import type { MotificonsAuthExtra } from "../auth";
import { errorResult, resolveCollection } from "./collection-shared";

export const addToCollectionInputSchema = z.object({
  collection: z.string().describe("The collection's name (case-insensitive exact match) or id."),
  icon_id: z
    .string()
    .describe('Icon id in "prefix:name" form, exactly as returned by search_icons or suggest_icons (e.g. "tabler:arrow-right").'),
});

export type AddToCollectionInput = z.infer<typeof addToCollectionInputSchema>;

export async function runAddToCollection(
  input: AddToCollectionInput,
  extra: MotificonsAuthExtra,
): Promise<CallToolResult> {
  const database = await db();
  const resolved = await resolveCollection(database, extra.workspaceId, input.collection);
  if (!resolved.ok) return resolved.result;
  const { collection } = resolved;

  if (!isValidIconId(input.icon_id)) {
    return errorResult(`"${input.icon_id}" is not a valid icon id - expected "prefix:name".`);
  }

  const result = await addIconToCollection(database, extra.workspaceId, collection.id, input.icon_id);
  if (!result.ok) {
    return errorResult(`"${collection.name}" could not be found.`);
  }

  const iconCount = await countIconsInCollection(database, collection.id);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          { added: true, collection: { id: collection.id, name: collection.name }, iconCount },
          null,
          2,
        ),
      },
    ],
  };
}
