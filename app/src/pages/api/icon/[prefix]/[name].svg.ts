import type { APIRoute } from "astro";
import { getIcon } from "../../../../lib/data";

export const prerender = false;

/**
 * Serves one icon as an SVG document.
 *
 * Backed by the byte-offset body store, so this reads exactly one icon's
 * bytes rather than a set file that reaches 99MB for fluent-emoji. Used for
 * the ~9% of icons whose body is too large to inline on a search document,
 * and by anything that wants a plain URL to an icon.
 */
export const GET: APIRoute = async ({ params }) => {
  const icon = await getIcon(params["prefix"] ?? "", params["name"] ?? "");
  if (!icon) return new Response("Not found", { status: 404 });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${icon.width} ${icon.height}" width="${icon.width}" height="${icon.height}">${icon.body}</svg>`;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      /* Icon bytes only change when the library is re-synced and the URL
         carries the identity, so this is safe to cache hard - coordinator
         correction, 2026-08-10: the shorter policy was a regression versus
         what this route already had. */
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
