import type { APIRoute } from "astro";
import { absolute, xmlEscape } from "../../lib/seo";
import { sortedPosts } from "../../lib/blog";

export const prerender = true;

/** Hand-rolled RSS 2.0 - no dependency needed for three items and growing
    slowly; xmlEscape is the same helper the sitemap module already uses, so
    escaping stays consistent across every XML endpoint on the site. */
export const GET: APIRoute = async () => {
  const posts = await sortedPosts();

  const items = posts
    .map((post) => {
      const url = absolute(`/blog/${post.id}`);
      return [
        "<item>",
        `<title>${xmlEscape(post.data.title)}</title>`,
        `<link>${xmlEscape(url)}</link>`,
        `<guid>${xmlEscape(url)}</guid>`,
        `<description>${xmlEscape(post.data.description)}</description>`,
        `<pubDate>${post.data.pubDate.toUTCString()}</pubDate>`,
        "</item>",
      ].join("");
    })
    .join("");

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>Motificons Blog</title>
<link>${absolute("/blog")}</link>
<description>Notes on icons, MCP for coding agents, and building with the Motificons icon library.</description>
${items}
</channel>
</rss>`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
};
