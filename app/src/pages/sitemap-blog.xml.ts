import type { APIRoute } from "astro";
import { absolute } from "../lib/seo";
import { lastTouched, sortedPosts } from "../lib/blog";
import { renderUrlset, SITEMAP_HEADERS, type UrlEntry } from "../lib/sitemap";

export const prerender = false;

/** /blog plus every post - kept as its own shard (rather than folded into
    sitemap-pages.xml) since it is content that changes on its own schedule,
    independent of an icon-pipeline re-sync. */
export const GET: APIRoute = async () => {
  const posts = await sortedPosts();
  const newest = posts[0] ? lastTouched(posts[0]).toISOString() : undefined;

  const entries: UrlEntry[] = [
    { loc: absolute("/blog"), lastmod: newest, changefreq: "weekly", priority: "0.7" },
    ...posts.map(
      (post): UrlEntry => ({
        loc: absolute(`/blog/${post.id}`),
        lastmod: lastTouched(post).toISOString(),
        changefreq: "monthly",
        priority: "0.6",
      }),
    ),
  ];

  return new Response(renderUrlset(entries), { headers: SITEMAP_HEADERS });
};
