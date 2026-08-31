/**
 * Shared helpers for the blog collection - kept out of the page templates so
 * /blog, /blog/[slug], /blog/rss.xml and sitemap-blog.xml all sort and date
 * posts the same way instead of four independent implementations drifting
 * apart.
 */

import { getCollection, type CollectionEntry } from "astro:content";

export type BlogPost = CollectionEntry<"blog">;

/** Newest first - the only order any surface on this site lists posts in. */
export async function sortedPosts(): Promise<BlogPost[]> {
  const posts = await getCollection("blog");
  return posts.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

/** `updatedDate` when present, else `pubDate` - the "last touched" date used
    by the sitemap's <lastmod> and the post page's "Updated" line. */
export function lastTouched(post: BlogPost): Date {
  return post.data.updatedDate ?? post.data.pubDate;
}

/** "August 13, 2026" - matches the long-form date reading used elsewhere
    (privacy.astro/terms.astro print a plain ISO "Last updated" line; a blog
    post reads better spelled out, so this does not reuse that literal
    format). */
export function formatPostDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
