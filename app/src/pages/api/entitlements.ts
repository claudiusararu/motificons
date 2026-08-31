import type { APIRoute } from "astro";
import { resolveAccount } from "../../lib/entitlements";

export const prerender = false;

/**
 * Whether the current visitor is signed in - fetched client-side by
 * useAccount.ts and AuthMenu.tsx, never server-rendered into the icon detail
 * page.
 *
 * That page is edge-cached for a day (`s-maxage=86400` in
 * `[prefix]/[name].astro`, deliberate at 337k-page scale) and shared across
 * every visitor, so nothing session-specific can go into its HTML. This
 * endpoint is the uncached, per-request side channel that keeps the page
 * itself cacheable.
 *
 * Nothing here decides what a visitor may DO: the product is free, so every
 * icon, every export format and every tool works signed out. The answer only
 * says whose collections and API key the page should show.
 */
export const GET: APIRoute = async (ctx) => {
  const account = await resolveAccount(ctx);

  return json({
    signedIn: account.signedIn,
    email: account.email ?? null,
  });
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      /* Per-visitor - must never be shared by a cache. */
      "Cache-Control": "private, no-store",
    },
  });
}
