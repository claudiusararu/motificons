import type { APIRoute } from "astro";

export const prerender = false;

/**
 * /pricing is gone: Motificons is free, so there is no price list to show.
 *
 * A permanent redirect to /register rather than a 404, so the accumulated
 * links land on the thing the old page was for - getting an account - and
 * any indexing transfers instead of dead-ending. Same mechanism as
 * /sets -> /search.
 */
export const GET: APIRoute = () =>
  new Response(null, {
    status: 301,
    headers: {
      Location: "/register",
      "Cache-Control": "public, max-age=3600",
    },
  });
