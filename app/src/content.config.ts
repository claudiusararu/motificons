import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

/**
 * Blog posts - src/content/blog/*.md. One post per file, frontmatter only
 * (no per-post components needed yet, so the plain glob loader is enough).
 *
 * `pubDate`/`updatedDate` are `z.coerce.date()` so a plain `2026-08-13`
 * string in frontmatter parses straight into a `Date`, the same convenience
 * Astro's own starter schema uses - no ISO-with-time discipline required of
 * whoever writes the next post.
 */
const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { blog };
