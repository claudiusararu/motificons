/**
 * One source for absolute URLs and social metadata.
 *
 * Canonicals must be absolute and must not carry query strings or the search
 * meter's state, so they are always built from a path here rather than from
 * Astro.url, which carries whatever the visitor arrived with.
 */

export const SITE_ORIGIN =
  import.meta.env["PUBLIC_SITE_ORIGIN"] ?? "https://motificons.app";

export const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/og-default.png`;

/** Canonical PNG size for social previews of a single icon. */
export const OG_ICON_SIZE = 512;

/**
 * Absolute URL for a path, with one canonical spelling.
 *
 * Trailing slashes are stripped (root excepted) because prerendered routes
 * report `/sets/` from Astro.url while SSR routes report `/sets`. Both the
 * canonical tag and the sitemap are built through here, so they cannot
 * disagree about which URL a page actually lives at - a mismatch there splits
 * ranking signals between two spellings of the same page.
 */
export function absolute(path: string): string {
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  const [pathname = "/", ...rest] = withSlash.split("?");
  const trimmed =
    pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : "/";
  const query = rest.length > 0 ? `?${rest.join("?")}` : "";
  return `${SITE_ORIGIN}${trimmed}${query}`;
}

/** The PNG an icon page advertises to social cards and image sitemaps. */
export function iconImageUrl(prefix: string, name: string): string {
  return absolute(
    `/api/export/${prefix}/${name}?format=png&size=${OG_ICON_SIZE}`,
  );
}

/** One crumb in a page's trail. `path` is relative; the schema below makes it
    absolute the same way every other URL on the site is made absolute. */
export interface BreadcrumbItem {
  name: string;
  path: string;
}

/**
 * BreadcrumbList JSON-LD from the same trail data the visible breadcrumb nav
 * renders from - icon, set, category and tool pages all build one `<nav
 * aria-label="Breadcrumb">` by hand today with no matching structured data.
 * Lives here rather than next to faqSchema (lib/site.ts) because every item
 * needs `absolute()`, which is this module's job.
 */
export function breadcrumbSchema(items: BreadcrumbItem[]): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absolute(item.path),
    })),
  });
}

/**
 * Organization + WebSite JSON-LD, site-wide (one block, via @graph rather
 * than two separate script tags - both describe the same site and Google
 * treats a single @graph as one document). Wired once from Layout.astro so
 * every page carries it instead of each page template remembering to.
 *
 * SearchAction targets /search?q= - the same "q" param search.astro reads
 * off Astro.url.searchParams and url-state.ts writes when it builds a search
 * URL, so an answer engine that follows this template lands on a working
 * search.
 */
export function siteSchema(): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: "Motificons",
        url: SITE_ORIGIN,
        logo: DEFAULT_OG_IMAGE,
      },
      {
        "@type": "WebSite",
        name: "Motificons",
        url: SITE_ORIGIN,
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${SITE_ORIGIN}/search?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
    ],
  });
}

/**
 * BlogPosting JSON-LD for a single post - schema.org's structured type for
 * dated, authored articles. `author` and `publisher` are both the Motificons
 * org (no bylined writers yet), same as `siteSchema()`'s Organization block
 * above, kept as a separate literal here rather than shared since the two
 * schema types nest it differently (publisher additionally wants a `logo`
 * ImageObject, which Organization-as-author does not).
 */
export interface BlogPostingInput {
  title: string;
  description: string;
  path: string;
  pubDate: Date;
  updatedDate?: Date;
}

export function blogPostingSchema(input: BlogPostingInput): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: input.title,
    description: input.description,
    datePublished: input.pubDate.toISOString(),
    dateModified: (input.updatedDate ?? input.pubDate).toISOString(),
    author: { "@type": "Organization", name: "Motificons", url: SITE_ORIGIN },
    publisher: {
      "@type": "Organization",
      name: "Motificons",
      url: SITE_ORIGIN,
      logo: { "@type": "ImageObject", url: DEFAULT_OG_IMAGE },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": absolute(input.path) },
  });
}

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
