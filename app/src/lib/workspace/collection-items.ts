import { and, count, eq } from "drizzle-orm";
import type { Database } from "../../db/client";
import { collection, collectionItem } from "../../db/schema";
import { getCollection } from "./collections";

/** Same shape as the id everywhere else in the app - see the `collectionItem`
    schema comment in db/schema.ts. Each half mirrors lib/data.ts's `SAFE`
    segment pattern (icon prefixes/names are filenames on disk, one directory
    deep), so a malformed id is rejected before it ever reaches the DB. */
const ICON_ID = /^[a-zA-Z0-9._-]+:[a-zA-Z0-9._-]+$/;

export function isValidIconId(value: unknown): value is string {
  return typeof value === "string" && ICON_ID.test(value) && !value.includes("..");
}

export interface CollectionItemDTO {
  id: string;
  collectionId: string;
  iconId: string;
  createdAt: string;
}

function toDTO(row: { id: string; collectionId: string; iconId: string; createdAt: Date }): CollectionItemDTO {
  return {
    id: row.id,
    collectionId: row.collectionId,
    iconId: row.iconId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Which of the caller's own collections already contain this icon - the
    picker's checked state. Scoped through the `collection` join so a
    differently-owned collectionId can never leak in. */
export async function collectionsContainingIcon(
  database: Database,
  workspaceId: string,
  iconId: string,
): Promise<Set<string>> {
  const rows = await database
    .select({ collectionId: collectionItem.collectionId })
    .from(collectionItem)
    .innerJoin(collection, eq(collection.id, collectionItem.collectionId))
    .where(and(eq(collection.workspaceId, workspaceId), eq(collectionItem.iconId, iconId)));
  return new Set(rows.map((row) => row.collectionId));
}

/** Saved icons in one collection, newest first - the collection detail
    page's tile grid. `getCollection` already scopes ownership; this trusts
    the caller passed an id that resolved through it. */
export async function listCollectionItems(
  database: Database,
  collectionId: string,
): Promise<CollectionItemDTO[]> {
  const rows = await database
    .select()
    .from(collectionItem)
    .where(eq(collectionItem.collectionId, collectionId))
    .orderBy(collectionItem.createdAt);
  return rows.map(toDTO);
}

/** How many icons are saved in one collection - the dashboard row count.
    Same ownership trust as `listCollectionItems`. */
export async function countIconsInCollection(
  database: Database,
  collectionId: string,
): Promise<number> {
  const rows = await database
    .select({ n: count() })
    .from(collectionItem)
    .where(eq(collectionItem.collectionId, collectionId));
  return rows[0]?.n ?? 0;
}

export type AddIconResult =
  | { ok: true; item: CollectionItemDTO }
  | { ok: false; reason: "not-found" };

/**
 * Adds an icon to a collection, ownership-checked and idempotent: saving the
 * same icon to the same collection twice is a success both times, not an
 * error. No cap here - the collection-capacity limit is on the NUMBER OF
 * COLLECTIONS (lib/workspace/limits.ts's COLLECTION_LIMIT, enforced at
 * create/duplicate); saved icons within a collection are unlimited.
 */
export async function addIconToCollection(
  database: Database,
  workspaceId: string,
  collectionId: string,
  iconId: string,
): Promise<AddIconResult> {
  const owned = await getCollection(database, workspaceId, collectionId);
  if (!owned) return { ok: false, reason: "not-found" };

  const existing = await database
    .select()
    .from(collectionItem)
    .where(and(eq(collectionItem.collectionId, collectionId), eq(collectionItem.iconId, iconId)))
    .limit(1);
  const already = existing[0];
  if (already) return { ok: true, item: toDTO(already) };

  const now = new Date();
  const id = crypto.randomUUID();
  await database.insert(collectionItem).values({ id, collectionId, iconId, sort: 0, createdAt: now });
  return { ok: true, item: toDTO({ id, collectionId, iconId, createdAt: now }) };
}

/** Copies every saved icon from one collection to another, preserving sort
    order - the icons half of DUPLICATE (which copies icons AND style
    settings). Callers are responsible for ownership checks on
    both ids; api/collections/[id]/duplicate.ts checks the source through
    `getCollection` and the destination is a collection it just created in
    the same request, so neither needs re-checking here. */
export async function copyCollectionItems(
  database: Database,
  sourceCollectionId: string,
  destCollectionId: string,
): Promise<void> {
  const items = await listCollectionItems(database, sourceCollectionId);
  if (items.length === 0) return;

  const now = new Date();
  await database.insert(collectionItem).values(
    items.map((item) => ({
      id: crypto.randomUUID(),
      collectionId: destCollectionId,
      iconId: item.iconId,
      sort: 0,
      createdAt: now,
    })),
  );
}

/** `false` only when the collection itself is missing/not owned - removing
    an icon that was never saved (or already removed) is still a success,
    the same idempotence as the add path. */
export async function removeIconFromCollection(
  database: Database,
  workspaceId: string,
  collectionId: string,
  iconId: string,
): Promise<boolean> {
  const owned = await getCollection(database, workspaceId, collectionId);
  if (!owned) return false;

  await database
    .delete(collectionItem)
    .where(and(eq(collectionItem.collectionId, collectionId), eq(collectionItem.iconId, iconId)));
  return true;
}
