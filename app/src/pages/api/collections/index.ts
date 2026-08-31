import type { APIRoute } from "astro";
import {
  COLLECTION_LIMIT,
  canCreateResource,
  collectionCapUpsell,
  validateResourceName,
} from "../../../lib/workspace/limits";
import { countCollections, createCollection, listCollections } from "../../../lib/workspace/collections";
import { collectionsContainingIcon, isValidIconId } from "../../../lib/workspace/collection-items";
import { requireSessionWorkspace } from "../../../lib/workspace/session-workspace";

export const prerender = false;

/** Collections live on an account, so every route here needs a signed-in
    visitor. Accounts are free - this is the only thing standing between a
    caller and collections. */
const SIGN_IN_REQUIRED_ERROR = "Sign in with your free account to use collections.";

/**
 * List the caller's own standalone collections. With `?icon=prefix:name`,
 * each collection also carries a `saved` flag for that icon - the one round
 * trip the save-to-collection picker on the icon detail page needs to render
 * its full checked/unchecked state (SaveButton.tsx).
 */
export const GET: APIRoute = async ({ locals, url }) => {
  const ctx = await requireSessionWorkspace(locals.user);
  if (!ctx) return json({ error: SIGN_IN_REQUIRED_ERROR }, 401);

  const collections = await listCollections(ctx.database, ctx.workspaceId);

  const iconId = url.searchParams.get("icon");
  if (!iconId || !isValidIconId(iconId)) {
    return json({ collections: collections.map((c) => ({ ...c, saved: false })) });
  }

  const saved = await collectionsContainingIcon(ctx.database, ctx.workspaceId, iconId);
  return json({
    collections: collections.map((c) => ({ ...c, saved: saved.has(c.id) })),
  });
};

/** Create a collection in the caller's personal workspace. Same 401/
    limited-200 conventions as every other write route in lib/workspace/. */
export const POST: APIRoute = async ({ request, locals }) => {
  const ctx = await requireSessionWorkspace(locals.user);
  if (!ctx) return json({ error: SIGN_IN_REQUIRED_ERROR }, 401);

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

  const collection = await createCollection(ctx.database, ctx.workspaceId, validation.name);
  return json({ collection });
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
