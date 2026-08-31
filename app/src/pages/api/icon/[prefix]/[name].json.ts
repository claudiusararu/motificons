import type { APIRoute } from "astro";
import { getIcon, getSet } from "../../../../lib/data";

export const prerender = false;

/**
 * Serves one icon's raw data - body, width, height, and its set's
 * style-engine tier - as JSON. The client-side twin of what
 * /collections/[id].astro already does server-side with getIcon()+getSet()
 * for every saved item.
 *
 * Exists to close a real data-flow gap: every SearchHit carries
 * `body: null` BY DESIGN (search-config.ts's own
 * doc comment - the island renders search-result tiles from /api/icon
 * instead of inlining a body per query), so an icon added to a collection
 * from the Add-icons panel starts life with no body to style client-side -
 * unlike a page-load icon, which /collections/[id].astro always resolves a
 * real body for. Two callers use this to fetch the real body once, so an
 * icon renders identically regardless of when it was added:
 * CollectionWorkspace.tsx's handlePanelToggle (closes the gap
 * proactively, right after adding) and IconQuickView.tsx (fetches on open
 * when the icon it was handed has no body - the quick-view opened straight
 * from a search result, entry 2).
 *
 * Deliberately NOT the existing /api/icon/[prefix]/[name].svg.ts: that
 * returns a wrapped, unstyled SVG DOCUMENT (a byte stream to point an <img>
 * at), not the raw body string `applyEdits`/`buildInlineSvg` need to run the
 * style engine against client-side.
 */
export const GET: APIRoute = async ({ params }) => {
  const prefix = params["prefix"] ?? "";
  const name = params["name"] ?? "";

  const [icon, set] = await Promise.all([getIcon(prefix, name), getSet(prefix)]);
  if (!icon) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  return new Response(
    JSON.stringify({
      prefix: icon.prefix,
      name: icon.name,
      body: icon.body,
      width: icon.width,
      height: icon.height,
      tier: set?.tier ?? null,
    }),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        /* Icon bytes only change when the library is re-synced and the URL
           carries the identity - same cache contract as the .svg sibling. */
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    },
  );
};
