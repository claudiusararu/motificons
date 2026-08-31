import type { APIRoute } from "astro";
import {
  addIconToCollection,
  isValidIconId,
  removeIconFromCollection,
} from "../../../../lib/workspace/collection-items";
import { requireSessionWorkspace } from "../../../../lib/workspace/session-workspace";

export const prerender = false;

/** Collections live on an account, so every route here needs a signed-in
    visitor. Accounts are free - this is the only thing standing between a
    caller and collections. */
const SIGN_IN_REQUIRED_ERROR = "Sign in with your free account to use collections.";

/** Save an icon to one of the caller's own collections. Idempotent - saving
    an icon that is already in the collection is a 200 success, not an
    error. Unlimited saved icons - the only
    collection-related cap is on the number of collections themselves, see
    api/collections/index.ts. */
export const POST: APIRoute = async ({ request, locals, params }) => {
  const ctx = await requireSessionWorkspace(locals.user);
  if (!ctx) return json({ error: SIGN_IN_REQUIRED_ERROR }, 401);

  const collectionId = params.id ?? "";

  let payload: { icon?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ error: "Send JSON with an icon field." }, 400);
  }

  if (!isValidIconId(payload.icon)) {
    return json({ error: "That icon id is not valid." }, 400);
  }
  const iconId = payload.icon;

  const result = await addIconToCollection(ctx.database, ctx.workspaceId, collectionId, iconId);

  if (!result.ok) {
    return json({ error: "That collection could not be found." }, 404);
  }

  return json({ saved: true, item: result.item });
};

/** Remove an icon from one of the caller's own collections. Idempotent in
    the other direction - removing an icon that was never saved (or was
    already removed) is still a success. */
export const DELETE: APIRoute = async ({ request, locals, params }) => {
  const ctx = await requireSessionWorkspace(locals.user);
  if (!ctx) return json({ error: SIGN_IN_REQUIRED_ERROR }, 401);

  const collectionId = params.id ?? "";

  let payload: { icon?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ error: "Send JSON with an icon field." }, 400);
  }

  if (!isValidIconId(payload.icon)) {
    return json({ error: "That icon id is not valid." }, 400);
  }
  const iconId = payload.icon;

  const removed = await removeIconFromCollection(ctx.database, ctx.workspaceId, collectionId, iconId);
  if (!removed) return json({ error: "That collection could not be found." }, 404);

  return json({ saved: false });
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
