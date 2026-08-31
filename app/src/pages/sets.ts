import type { APIRoute } from "astro";

export const prerender = false;

/**
 * /sets moved to /search: the library page and the search page were always
 * the same thing, and /search is the name for it.
 *
 * A permanent redirect rather than a duplicate page, so the accumulated links
 * and any indexing transfer instead of competing with the canonical.
 */
export const GET: APIRoute = () =>
  new Response(null, {
    status: 301,
    headers: {
      Location: "/search",
      "Cache-Control": "public, max-age=3600",
    },
  });
