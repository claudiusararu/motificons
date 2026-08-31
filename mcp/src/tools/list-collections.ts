/**
 * list_collections: the caller's own collections - id, name,
 * saved icon count, and a one-line style summary reused verbatim from
 * app/src/lib/collection-download.ts's `summarizeCollectionStyles` (the same
 * text the "Download collection" panel shows on the web), so an agent can
 * pick a collection without a second round trip to inspect its style.
 *
 * No params - every caller only ever sees their own workspace's collections
 * (`listCollections` is already scoped by `workspaceId`), so there is
 * nothing to filter by.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { db } from "../../../app/src/db/client";
import { summarizeCollectionStyles } from "../../../app/src/lib/collection-download";
import { countIconsInCollection } from "../../../app/src/lib/workspace/collection-items";
import { getCollectionStyleSettings } from "../../../app/src/lib/workspace/collection-style";
import { listCollections } from "../../../app/src/lib/workspace/collections";
import type { MotificonsAuthExtra } from "../auth";

export const listCollectionsInputSchema = z.object({});
export type ListCollectionsInput = z.infer<typeof listCollectionsInputSchema>;

export async function runListCollections(extra: MotificonsAuthExtra): Promise<CallToolResult> {
  const database = await db();
  const collections = await listCollections(database, extra.workspaceId);

  const rows = await Promise.all(
    collections.map(async (collection) => {
      const [iconCount, style] = await Promise.all([
        countIconsInCollection(database, collection.id),
        getCollectionStyleSettings(database, extra.workspaceId, collection.id),
      ]);

      return {
        id: collection.id,
        name: collection.name,
        iconCount,
        style: summarizeCollectionStyles({
          color: style?.color ?? null,
          strokeWidth: style?.strokeWidth ?? null,
        }),
      };
    }),
  );

  return {
    content: [{ type: "text", text: JSON.stringify({ collections: rows }, null, 2) }],
  };
}
