import type { APIRoute } from "astro";
import { validateResourceName } from "../../../lib/workspace/limits";
import { deleteCollection, renameCollection } from "../../../lib/workspace/collections";
import { requireSessionWorkspace } from "../../../lib/workspace/session-workspace";

export const prerender = false;

/** Collections live on an account, so every route here needs a signed-in
    visitor. Accounts are free - this is the only thing standing between a
    caller and collections. */
const SIGN_IN_REQUIRED_ERROR = "Sign in with your free account to use collections.";

/** Rename a collection. Scoped to the caller's own workspace - not-owned and
    not-existing both read as the same 404 to the caller. */
export const PATCH: APIRoute = async ({ request, locals, params }) => {
  const ctx = await requireSessionWorkspace(locals.user);
  if (!ctx) return json({ error: SIGN_IN_REQUIRED_ERROR }, 401);

  const id = params.id ?? "";

  let payload: { name?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ error: "Send JSON with a name field." }, 400);
  }

  const validation = validateResourceName(payload.name, "collection");
  if (!validation.ok) return json({ error: validation.error }, 400);

  const collection = await renameCollection(ctx.database, ctx.workspaceId, id, validation.name);
  if (!collection) return json({ error: "That collection could not be found." }, 404);

  return json({ collection });
};

export const DELETE: APIRoute = async ({ locals, params }) => {
  const ctx = await requireSessionWorkspace(locals.user);
  if (!ctx) return json({ error: SIGN_IN_REQUIRED_ERROR }, 401);

  const id = params.id ?? "";
  const deleted = await deleteCollection(ctx.database, ctx.workspaceId, id);
  if (!deleted) return json({ error: "That collection could not be found." }, 404);

  return json({ ok: true });
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
