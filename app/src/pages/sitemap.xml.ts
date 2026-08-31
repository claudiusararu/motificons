import type { APIRoute } from "astro";
import { absolute } from "../lib/seo";
import { lastmod, renderSitemapIndex, SITEMAP_HEADERS } from "../lib/sitemap";

export const prerender = false;

/**
 * The index every crawler starts from; robots.txt points here.
 *
 * Individual icon pages are deliberately NOT sitemapped: ~337k
 * near-identical thin pages are a crawl-cost and thin-content liability,
 * not an SEO asset. We index the pages that carry real, distinct content -
 * statics, all sets (by name), and all categories - which `sitemap-pages.xml`
 * already lists - plus the blog (`sitemap-blog.xml`: /blog and every post,
 * a separate shard since it changes on its own schedule, independent of an
 * icon-pipeline re-sync). The icon pages themselves stay reachable for
 * humans and direct links but carry `noindex` (see [prefix]/[name].astro).
 * The former `sitemap-icons-*` / `sitemap-images-*` shards (each generation
 * was blowing the Worker CPU limit) are gone.
 */
export const GET: APIRoute = async () => {
  const modified = await lastmod();
  const maps = [
    { loc: absolute("/sitemap-pages.xml"), lastmod: modified },
    { loc: absolute("/sitemap-blog.xml"), lastmod: modified },
  ];
  return new Response(renderSitemapIndex(maps), { headers: SITEMAP_HEADERS });
};
