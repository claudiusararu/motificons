import type { APIRoute } from "astro";
import { createApiKey, revokeApiKey } from "../../../lib/workspace/api-keys";
import { requireSessionWorkspace } from "../../../lib/workspace/session-workspace";

export const prerender = false;

/** API keys belong to an account, so every route here needs a signed-in
    visitor. Accounts are free - there is nothing to buy. */
const SIGN_IN_REQUIRED_ERROR = "Sign in with your free account to create an API key.";

/**
 * Regenerate = revoke + create (task's exact definition): invalidates
 * whatever active key the caller has (if any - regenerating with no
 * existing key is just a create, not an error) and mints a new one,
 * returning the new plaintext once. The dashboard confirms this action
 * first (ConfirmDeleteModal pattern) since it destroys the old key.
 */
export const POST: APIRoute = async ({ locals }) => {
  const ctx = await requireSessionWorkspace(locals.user);
  if (!ctx) return json({ error: SIGN_IN_REQUIRED_ERROR }, 401);

  await revokeApiKey(ctx.database, ctx.userId);
  const { key, plaintext } = await createApiKey(ctx.database, ctx.userId, ctx.workspaceId);

  return json({ key, plaintext });
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
