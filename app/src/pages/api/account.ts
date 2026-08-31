import type { APIRoute } from "astro";
import { deleteUserAccount } from "../../lib/workspace/account-deletion";
import { requireSessionWorkspace } from "../../lib/workspace/session-workspace";

export const prerender = false;

/**
 * Self-service account deletion (dashboard's Danger zone) - the GDPR right
 * to erasure. A signed-in session is the only requirement: deleting your own
 * account is a right, not a feature.
 *
 * `deleteUserAccount` (lib/workspace/account-deletion.ts) removes the
 * `session` rows as part of its FK-safe cascade, so the cookie the browser
 * is still holding is already worthless server-side by the time this
 * responds - the client also calls `authClient.signOut()` right after (same
 * mechanism AuthMenu.tsx's sign-out uses) to clear it client-side too,
 * belt-and-suspenders rather than relying on the next `getSession()` call
 * failing closed.
 */
export const DELETE: APIRoute = async ({ locals }) => {
  const ctx = await requireSessionWorkspace(locals.user);
  if (!ctx) return json({ error: "Sign in to continue." }, 401);

  const summary = await deleteUserAccount(ctx.database, ctx.userId);
  return json({ ok: true, deleted: summary });
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
