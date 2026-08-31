import type { APIRoute } from "astro";
import { relatedIcons } from "../../../../lib/related";

export const prerender = false;

/**
 * Related icons for an icon detail page, fetched client-side by the
 * RelatedIcons island AFTER that page's SSR finishes.
 *
 * The shard search this runs is the expensive part that used to sit in the
 * icon page's own render - on long icon names it blew the Worker CPU limit
 * (10ms on the free plan) and returned 500s for the whole page, including
 * every Googlebot HEAD. Moving it here keeps the page render cheap. Crawlers
 * do not execute JS, so they never call this: the search only ever runs for a
 * real, JS-executing visitor. The response edge-caches hard, so it computes
 * once per icon and is free thereafter. Browse - never metered.
 */
export const GET: APIRoute = async ({ params }) => {
  const prefix = params["prefix"] ?? "";
  const name = params["name"] ?? "";
  const related = prefix && name ? await relatedIcons(prefix, name, []) : [];
  return new Response(JSON.stringify(related), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
};
