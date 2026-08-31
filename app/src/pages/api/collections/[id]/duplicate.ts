import type { APIRoute } from "astro";
import {
  COLLECTION_LIMIT,
  canCreateResource,
  collectionCapUpsell,
  validateResourceName,
} from "../../../../lib/workspace/limits";
import { countCollections, createCollection, getCollection } from "../../../../lib/workspace/collections";
import { copyCollectionItems } from "../../../../lib/workspace/collection-items";
import { copyStyleSettings } from "../../../../lib/workspace/collection-style";
import { requireSessionWorkspace } from "../../../../lib/workspace/session-workspace";

export const prerender = false;

/** Collections live on an account, so every route here needs a signed-in
    visitor. Accounts are free - this is the only thing standing between a
    caller and collections. */
const SIGN_IN_REQUIRED_ERROR = "Sign in with your free account to use collections.";

/**
 * DUPLICATE: copies a collection's
 * icons AND style settings into a new collection under a name the caller
 * supplies (the modal prefills "<name> (duplicate)", editable). Follows the
 * same session + ownership + cap pattern as api/collections/index.ts's
 * POST - duplicating counts against COLLECTION_LIMIT exactly like create
 * - a duplicate counts against the cap like a create - checked before
 * anything is written so a workspace already at the cap never gets a
 * half-created copy.
 */
export const POST: APIRoute = async ({ request, locals, params }) => {
  const ctx = await requireSessionWorkspace(locals.user);
  if (!ctx) return json({ error: SIGN_IN_REQUIRED_ERROR }, 401);

  const sourceId = params.id ?? "";
  const source = await getCollection(ctx.database, ctx.workspaceId, sourceId);
  if (!source) return json({ error: "That collection could not be found." }, 404);

  let payload: { name?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ error: "Send JSON with a name field." }, 400);
  }

  const validation = validateResourceName(payload.name, "collection");
  if (!validation.ok) return json({ error: validation.error }, 400);

  const existing = await countCollections(ctx.database, ctx.workspaceId);
  if (!canCreateResource(existing, COLLECTION_LIMIT)) {
    return json(collectionCapUpsell());
  }

  const copy = await createCollection(ctx.database, ctx.workspaceId, validation.name);
  await Promise.all([
    copyCollectionItems(ctx.database, source.id, copy.id),
    copyStyleSettings(ctx.database, source.id, copy.id),
  ]);

  return json({ collection: copy });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}
