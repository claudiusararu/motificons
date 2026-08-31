/**
 * Thin REST surface for the desktop app - same worker, same
 * bearer mk_ auth and rate limit as /mcp (index.ts runs both gates before
 * routing here), same app-lib reuse as the MCP tools. One key, two
 * consumers: agents speak MCP, the Mac app speaks these routes.
 *
 *   GET  /v1/validate                 -> { ok: true } (auth gate already passed)
 *   GET  /v1/collections              -> { collections: [{ id, name, iconCount }] }
 *   GET  /v1/collections/:id/icons    -> { id, name, icons: ["prefix:name", ...] }
 *   POST /v1/collections/:id/icons    -> { ok: true, iconCount } (idempotent add)
 *
 * Collections are addressed by id only (the app lists them first); ownership
 * is enforced by getCollection's workspace scoping - another account's id
 * 404s identically to a missing one, no existence oracle.
 */

import { db } from "../../app/src/db/client";
import { getIcon, getSet } from "../../app/src/lib/data";
import { toSwiftUi, type IconEdits } from "../../app/src/lib/transforms";
import {
  addIconToCollection,
  countIconsInCollection,
  isValidIconId,
  listCollectionItems,
  removeIconFromCollection,
} from "../../app/src/lib/workspace/collection-items";
import { getCollection, listCollections } from "../../app/src/lib/workspace/collections";
import type { MotificonsAuthExtra } from "./auth";

export const REST_PREFIX = "/v1/";

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, { status });
}

export async function handleRest(
  request: Request,
  url: URL,
  extra: MotificonsAuthExtra,
): Promise<Response> {
  const segments = url.pathname.split("/").filter(Boolean);
  const database = await db();

  if (request.method === "GET" && url.pathname === "/v1/validate") {
    return json({ ok: true });
  }

  // SwiftUI needs the real path translator (transforms/swiftui.ts) - the one
  // format the app cannot generate locally; everything else stays offline.
  if (request.method === "POST" && url.pathname === "/v1/render") {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Body must be JSON." }, 400);
    }
    const { icon, format } = (body as { icon?: unknown; format?: unknown } | null) ?? {};
    if (!isValidIconId(icon)) {
      return json({ error: 'Pass icon as "prefix:name".' }, 400);
    }
    if (format !== "swiftui") {
      return json({ error: 'Only format "swiftui" renders server-side.' }, 400);
    }
    const [prefix = "", name = ""] = icon.split(":", 2);
    const [source, set] = await Promise.all([getIcon(prefix, name), getSet(prefix)]);
    if (!source || !set) {
      return json({ error: "Icon not found." }, 404);
    }
    const edits: IconEdits = {};
    const result = toSwiftUi(source, edits, set.tier);
    return json({ kind: result.kind, code: result.code });
  }

  if (request.method === "GET" && url.pathname === "/v1/collections") {
    const collections = await listCollections(database, extra.workspaceId);
    const rows = await Promise.all(
      collections.map(async (collection) => ({
        id: collection.id,
        name: collection.name,
        iconCount: await countIconsInCollection(database, collection.id),
      })),
    );
    return json({ collections: rows });
  }

  if (segments.length === 4 && segments[1] === "collections" && segments[3] === "icons") {
    const collectionId = decodeURIComponent(segments[2] ?? "");
    const owned = await getCollection(database, extra.workspaceId, collectionId);
    if (!owned) {
      return json({ error: "Collection not found." }, 404);
    }

    if (request.method === "GET") {
      const items = await listCollectionItems(database, collectionId);
      return json({ id: owned.id, name: owned.name, icons: items.map((item) => item.iconId) });
    }

    if (request.method === "POST") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Body must be JSON." }, 400);
      }
      const icon = (body as { icon?: unknown } | null)?.icon;
      if (!isValidIconId(icon)) {
        return json({ error: 'Pass icon as "prefix:name".' }, 400);
      }
      const result = await addIconToCollection(database, extra.workspaceId, collectionId, icon);
      if (!result.ok) {
        return json({ error: "Collection not found." }, 404);
      }
      return json({ ok: true, iconCount: await countIconsInCollection(database, collectionId) });
    }

    if (request.method === "DELETE") {
      const icon = url.searchParams.get("icon");
      if (!isValidIconId(icon)) {
        return json({ error: 'Pass ?icon=prefix:name.' }, 400);
      }
      const removed = await removeIconFromCollection(database, extra.workspaceId, collectionId, icon);
      if (!removed) {
        return json({ error: "Collection not found." }, 404);
      }
      return json({ ok: true, iconCount: await countIconsInCollection(database, collectionId) });
    }
  }

  return json({ error: "Not found." }, 404);
}
