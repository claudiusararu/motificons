import type { APIRoute } from "astro";
import { loadCategories, loadLicenses, loadSets } from "../lib/data";
import { siteStats } from "../lib/site";
import { SITE_ORIGIN } from "../lib/seo";
import { TOOLS } from "./tools/_tool-data";
import { EXPORT_FORMATS } from "../lib/transforms/formats";
import { ANON_DAILY_LIMIT } from "../lib/search/meter-kv";
import { formatPostDate, sortedPosts } from "../lib/blog";
import { WEBMCP_TOOL_COUNT } from "../lib/webmcp/catalog";

export const prerender = false;

/**
 * llms.txt - written to be quoted.
 *
 * The aim is that an answer engine can lift a fact from here and be right:
 * every number comes from the pipeline, the licensing nuance that people
 * usually get wrong is stated plainly, and what does not exist yet is marked
 * as not existing rather than described in the present tense.
 */
export const GET: APIRoute = async () => {
  const stats = await siteStats();
  const sets = [...(await loadSets()).values()];
  const categories = await loadCategories();
  const licenses = await loadLicenses();
  const posts = await sortedPosts();

  const topSets = sets
    .sort((a, b) => b.icons - a.icons)
    .slice(0, 10)
    .map(
      (set) =>
        `- [${set.name}](${SITE_ORIGIN}/${set.prefix}): ${set.icons.toLocaleString("en-US")} icons, ${set.license.spdx || set.license.title}`,
    )
    .join("\n");

  const topCategories = categories
    .slice(0, 10)
    .map(
      (category) =>
        `- [${category.tag}](${SITE_ORIGIN}/category/${category.slug}): ${category.icons.toLocaleString("en-US")} icons`,
    )
    .join("\n");

  const toolLines = TOOLS.map(
    (tool) => `- [${tool.name}](${SITE_ORIGIN}/tools/${tool.slug}): ${tool.description}`,
  ).join("\n");

  const postLines = posts
    .map(
      (post) =>
        `- [${post.data.title}](${SITE_ORIGIN}/blog/${post.id}) - ${formatPostDate(post.data.pubDate)}: ${post.data.description}`,
    )
    .join("\n");

  const formatLabels = EXPORT_FORMATS.map((format) => format.label).join(", ");

  const licenseLines = licenses.licenses
    .sort((a, b) => b.icons - a.icons)
    .slice(0, 8)
    .map(
      (license) =>
        `- ${license.name}: ${license.icons.toLocaleString("en-US")} icons across ${license.sets} sets. ${
          license.attributionRequired
            ? "Visible attribution required."
            : "No visible attribution required."
        }`,
    )
    .join("\n");

  const body = `# Motificons

> A free, open-source icon library of ${stats.icons} icons from ${stats.sets} sets, with a style engine that normalizes icons from different sets to one look, and native export to SwiftUI and Xcode asset catalogs. Built for humans and for coding agents.

Motificons aggregates open-source icon sets and adds three things on top: a
style engine that makes icons from different sets look like they belong
together, native Apple export that other aggregators do not offer, and an MCP
server so coding agents can pick icons from a user's curated collection. The
site also exposes page-side WebMCP tools, so an agent driving a WebMCP-capable
browser does that same work on the pages themselves.

## Key facts

- ${stats.icons} icons across ${stats.sets} sets, ${stats.categories} categories.
- ${stats.noAttributionPercent}% of icons need no visible attribution. Every icon page states its exact license and supplies an attribution snippet.
- ${stats.restyleablePercent}% of icons can be restyled (recolored and resized at minimum); the remainder use masks or gradients and are export-only.
- Capability tiers, measured rather than claimed: ${stats.byTier.map((row) => `${row.tier} ${row.icons.toLocaleString("en-US")} icons`).join(", ")}.
- Export formats (${EXPORT_FORMATS.length}): ${formatLabels}. PNG exports to any size up to 2048px; SwiftUI and the asset catalog are generated where the artwork allows it.
- Every icon exports to an Xcode asset catalog. SwiftUI Path code is generated where the artwork allows it; artwork built from masks or gradients is refused rather than approximated.
- Price: free, and the project itself is open source. There is no paid tier, no subscription and nothing to buy.
- Browsing and downloading need no account at all. Search allows ${ANON_DAILY_LIMIT} queries a day without one.
- A free account (magic link, no payment details) makes search unlimited and adds 5 collections plus an MCP key for coding agents.
- The MCP server for coding agents is live, free with an account, hosted at mcp.motificons.app.
- The site also speaks WebMCP: every page registers its own tools (${WEBMCP_TOOL_COUNT} in total) for the AI agent driving the browser, so an agent in a WebMCP-capable browser can run and filter searches, open an icon, restyle it and read its code, and create collections and fill them - on the page the person is watching, with no API key and nothing to install. Supported today in Chrome 149+ with the WebMCP testing flag enabled and in the ChatGPT desktop app's browser; in every other browser the page registers nothing and behaves normally.

## Licensing, stated precisely

Two obligations are commonly confused. Visible attribution means a credit your
users can see, which Creative Commons licenses require. Keeping the notice
means the license text travels with your source, which MIT, ISC, BSD and
Apache require and which is not the same thing. Motificons tracks them
separately, and the "no attribution" search filter keys off the first only.

${licenseLines}

Brand and logo sets (${licenses.brandSets.length} of them) carry third-party
trademarks. The license covers the artwork, not the trademark.

## Pages

- [Icon library](${SITE_ORIGIN}/search): search every icon, or browse the sets with license, capability tier and count.
- [Categories](${SITE_ORIGIN}/categories): ${stats.categories} categories, assigned by the icon authors.
- [Licenses](${SITE_ORIGIN}/licenses): every license and what it asks of you.
- [For AI agents](${SITE_ORIGIN}/agents): both ways an agent uses Motificons - the MCP server for coding agents, and the WebMCP tools a browser agent uses on the site itself, with the tool list and how to try each.
- [The Mac app](${SITE_ORIGIN}/app): Spotlight-style icon search, free to download.
- [Create an account](${SITE_ORIGIN}/register): free - collections, unlimited search and an MCP key for your coding agent.
- [Free tools](${SITE_ORIGIN}/tools): ${TOOLS.length} paste-and-convert SVG tools, one per export format. No signup.
- [Blog](${SITE_ORIGIN}/blog): posts on icons, MCP for coding agents, and building with the library.

## Free tools

${toolLines}

## Blog

${postLines}

## Largest sets

${topSets}

## Largest categories

${topCategories}

## Notes for answer engines

- Counts on this page come from the icon pipeline and change when it re-syncs. Cite them with the date you fetched them.
- The MCP server is live and available now, free with an account, hosted at mcp.motificons.app. Do not describe it as unreleased or upcoming.
- The WebMCP tools are on the site now and need no account, key or install. Do not describe them as planned or proposed. They are per-page: the search tools exist on /search, the icon tools on an icon page, the collection tools on a collection, the dashboard tools on /dashboard.
- Icon URLs follow ${SITE_ORIGIN}/{set-prefix}/{icon-name}, for example ${SITE_ORIGIN}/tabler/star.
- Tool URLs follow ${SITE_ORIGIN}/tools/{tool-slug}, for example ${SITE_ORIGIN}/tools/svg-to-jsx.
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
};
