import { and, count, eq, isNull } from "drizzle-orm";
import type { Database } from "../../db/client";
import { collection } from "../../db/schema";

export interface CollectionDTO {
  id: string;
  name: string;
  createdAt: string;
}

function toDTO(row: { id: string; name: string; createdAt: Date }): CollectionDTO {
  return { id: row.id, name: row.name, createdAt: row.createdAt.toISOString() };
}

/**
 * Every collection is a workspace-level, standalone entity (projects are
 * gone). The `isNull`
 * check on `projectId` is defensive rather than load-bearing: that column is
 * dead (see the schema deviation note on the `collection` table in
 * db/schema.ts) and always null going forward.
 */
function scopedToWorkspace(workspaceId: string) {
  return and(eq(collection.workspaceId, workspaceId), isNull(collection.projectId));
}

export async function listCollections(
  database: Database,
  workspaceId: string,
): Promise<CollectionDTO[]> {
  const rows = await database
    .select()
    .from(collection)
    .where(scopedToWorkspace(workspaceId))
    .orderBy(collection.createdAt);
  return rows.map(toDTO);
}

export async function countCollections(
  database: Database,
  workspaceId: string,
): Promise<number> {
  const rows = await database
    .select({ n: count() })
    .from(collection)
    .where(scopedToWorkspace(workspaceId));
  return rows[0]?.n ?? 0;
}

export async function createCollection(
  database: Database,
  workspaceId: string,
  name: string,
): Promise<CollectionDTO> {
  const now = new Date();
  const id = crypto.randomUUID();
  await database
    .insert(collection)
    .values({ id, workspaceId, projectId: null, name, createdAt: now });
  return toDTO({ id, name, createdAt: now });
}

/** `null` if no row matched - nonexistent id or a different workspace's
    collection. Both read as "not found" to the caller. */
export async function getCollection(
  database: Database,
  workspaceId: string,
  collectionId: string,
): Promise<CollectionDTO | null> {
  const rows = await database
    .select()
    .from(collection)
    .where(and(eq(collection.id, collectionId), scopedToWorkspace(workspaceId)))
    .limit(1);
  const row = rows[0];
  return row ? toDTO(row) : null;
}

export async function renameCollection(
  database: Database,
  workspaceId: string,
  collectionId: string,
  name: string,
): Promise<CollectionDTO | null> {
  const rows = await database
    .update(collection)
    .set({ name })
    .where(and(eq(collection.id, collectionId), scopedToWorkspace(workspaceId)))
    .returning();
  const row = rows[0];
  return row ? toDTO(row) : null;
}

export async function deleteCollection(
  database: Database,
  workspaceId: string,
  collectionId: string,
): Promise<boolean> {
  const rows = await database
    .delete(collection)
    .where(and(eq(collection.id, collectionId), scopedToWorkspace(workspaceId)))
    .returning({ id: collection.id });
  return rows.length > 0;
}
