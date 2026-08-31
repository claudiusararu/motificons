/**
 * Values marketing copy is allowed to use.
 *
 * Every count comes from stats.json, so a number in copy is never
 * hand-typed. Copy tokens of the form {stat.*} resolve through here.
 */

import { loadStats, type Stats } from "./data";

export interface SiteStats {
  icons: string;
  iconsRaw: number;
  sets: string;
  categories: string;
  noAttributionPercent: number;
  restyleablePercent: number;
  restyleable: string;
  byTier: Stats["byTier"];
}

export async function siteStats(): Promise<SiteStats> {
  const stats = await loadStats();
  const format = (value: number) => value.toLocaleString("en-US");

  const restyleable = stats.byTier
    .filter((row) => row.tier !== "T4")
    .reduce((sum, row) => sum + row.icons, 0);

  return {
    icons: format(stats.totals.icons),
    iconsRaw: stats.totals.icons,
    sets: format(stats.totals.sets),
    categories: format(stats.totals.categories),
    noAttributionPercent: Math.round(
      (stats.totals.noAttributionIcons / stats.totals.icons) * 100,
    ),
    restyleablePercent: Math.round((restyleable / stats.totals.icons) * 100),
    restyleable: format(restyleable),
    byTier: stats.byTier,
  };
}

export interface Faq {
  q: string;
  a: string;
}

export function faqSchema(faqs: Faq[]): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: { "@type": "Answer", text: faq.a },
    })),
  });
}
