import type { APIRoute } from "astro";
import { getIcon, getSet } from "../../../../lib/data";
import type { CollectionIconLicense } from "../../../../lib/collection-download";

export const prerender = false;

/**
 * Serves one icon's raw data - body, width, height, its set's style-engine
 * tier and its set's license line - as JSON. The client-side twin of what
 * /collections/[id].astro already does server-side with getIcon()+getSet()
 * for every saved item, field for field.
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
 * `license` rides along for the same reason `tier` does: an icon added to a
 * collection client-side has to end up carrying everything a page-load icon
 * carries, or the collection's LICENSES.txt would quietly be missing a set
 * until the next reload. `getSet(prefix)` was already being read here for
 * the tier, so this costs nothing extra and closes the gap for both the
 * Add-icons panel and the WebMCP `add_icon_to_collection` tool.
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

  /* `policy` (not `set.license` directly) is the exact object
     [prefix]/[name].astro's attribution snippet and /collections/[id].astro's
     own item mapping read from - reused here so no two surfaces phrase a
     set's license differently. */
  const policy = set?.license.policy ?? null;
  const license: CollectionIconLicense | null =
    set && policy
      ? {
          setName: set.name,
          authorName: set.author.name,
          authorUrl: set.author.url || null,
          licenseName: policy.name,
          licenseSpdx: policy.spdx || null,
          licenseUrl: policy.url || null,
          attributionRequired: policy.attributionRequired,
        }
      : null;

  return new Response(
    JSON.stringify({
      prefix: icon.prefix,
      name: icon.name,
      body: icon.body,
      width: icon.width,
      height: icon.height,
      tier: set?.tier ?? null,
      license,
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
