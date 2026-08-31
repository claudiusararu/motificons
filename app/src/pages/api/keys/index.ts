import type { APIRoute } from "astro";
import { createApiKey, getActiveApiKey, revokeApiKey } from "../../../lib/workspace/api-keys";
import { requireSessionWorkspace } from "../../../lib/workspace/session-workspace";

export const prerender = false;

/** API keys belong to an account, so every route here needs a signed-in
    visitor. Accounts are free - there is nothing to buy. */
const SIGN_IN_REQUIRED_ERROR = "Sign in with your free account to create an API key.";

/** Current key metadata (no plaintext, no hash) - `{ key: null }` when the
    caller has none. */
export const GET: APIRoute = async ({ locals }) => {
  const ctx = await requireSessionWorkspace(locals.user);
  if (!ctx) return json({ error: SIGN_IN_REQUIRED_ERROR }, 401);

  const key = await getActiveApiKey(ctx.database, ctx.userId);
  return json({ key });
};

/**
 * Create the caller's API key. One active key per user for v1 (task/SPEC
 * 3.3: the API key belongs to the account) - a caller who already has
 * one gets 409 with the existing key's metadata rather than a silent second
 * key, so the dashboard can point them at Regenerate instead.
 */
export const POST: APIRoute = async ({ locals }) => {
  const ctx = await requireSessionWorkspace(locals.user);
  if (!ctx) return json({ error: SIGN_IN_REQUIRED_ERROR }, 401);

  const existing = await getActiveApiKey(ctx.database, ctx.userId);
  if (existing) {
    return json(
      { error: "You already have an API key. Revoke it, or regenerate to replace it.", key: existing },
      409,
    );
  }

  const { key, plaintext } = await createApiKey(ctx.database, ctx.userId, ctx.workspaceId);
  return json({ key, plaintext });
};

/** Revoke the caller's active key. 404 if they have none - the same
    "nothing to act on" convention api/collections/[id].ts's DELETE uses. */
export const DELETE: APIRoute = async ({ locals }) => {
  const ctx = await requireSessionWorkspace(locals.user);
  if (!ctx) return json({ error: SIGN_IN_REQUIRED_ERROR }, 401);

  const revoked = await revokeApiKey(ctx.database, ctx.userId);
  if (!revoked) return json({ error: "You don't have an API key to revoke." }, 404);

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
