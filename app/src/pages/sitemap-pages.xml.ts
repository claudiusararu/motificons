import type { APIRoute } from "astro";
import { loadCategories, loadSets } from "../lib/data";
import { absolute } from "../lib/seo";
import { TOOLS } from "./tools/_tool-data";
import {
  lastmod,
  renderUrlset,
  SITEMAP_HEADERS,
  type UrlEntry,
} from "../lib/sitemap";

export const prerender = false;

/* Everything that is not an icon: statics, all 239 sets, all 477 categories.
   /search is deliberately absent - it is metered and thin, and robots.txt
   disallows it. The individual /tools/* pages are appended below from the
   TOOLS registry rather than hand-listed here - a new
   converter page used to ship without ever reaching the sitemap. */
const STATIC_PAGES: { path: string; priority: string; changefreq: UrlEntry["changefreq"] }[] = [
  { path: "/", priority: "1.0", changefreq: "weekly" },
  { path: "/search", priority: "0.9", changefreq: "weekly" },
  { path: "/categories", priority: "0.9", changefreq: "weekly" },
  { path: "/agents", priority: "0.8", changefreq: "monthly" },
  { path: "/tools", priority: "0.7", changefreq: "monthly" },
  { path: "/app", priority: "0.8", changefreq: "monthly" },
  { path: "/licenses", priority: "0.6", changefreq: "monthly" },
  { path: "/privacy", priority: "0.3", changefreq: "monthly" },
  { path: "/terms", priority: "0.3", changefreq: "monthly" },
];

export const GET: APIRoute = async () => {
  const modified = await lastmod();
  const [sets, categories] = await Promise.all([loadSets(), loadCategories()]);

  const entries: UrlEntry[] = STATIC_PAGES.map((page) => ({
    loc: absolute(page.path),
    lastmod: modified,
    changefreq: page.changefreq,
    priority: page.priority,
  }));

  for (const tool of TOOLS) {
    entries.push({
      loc: absolute(`/tools/${tool.slug}`),
      lastmod: modified,
      changefreq: "monthly",
      priority: "0.7",
    });
  }

  for (const set of [...sets.values()].sort((a, b) => b.icons - a.icons)) {
    entries.push({
      loc: absolute(`/${set.prefix}`),
      lastmod: modified,
      changefreq: "weekly",
      priority: "0.8",
    });
  }

  for (const category of categories) {
    entries.push({
      loc: absolute(`/category/${category.slug}`),
      lastmod: modified,
      changefreq: "weekly",
      priority: "0.7",
    });
  }

  return new Response(renderUrlset(entries), { headers: SITEMAP_HEADERS });
};
