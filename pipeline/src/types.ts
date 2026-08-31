/** The slice of @iconify/json we actually read. */

import type { Tier } from "./tiers.ts";

export interface IconifyAuthor {
  name: string;
  url?: string;
}

export interface IconifyLicense {
  title: string;
  spdx?: string;
  url?: string;
}

export interface IconifyInfo {
  name: string;
  total?: number;
  version?: string;
  author: IconifyAuthor;
  license: IconifyLicense;
  samples?: string[];
  height?: number | number[];
  category?: string;
  tags?: string[];
  palette?: boolean;
}

export interface IconifyAlias {
  parent: string;
}

export interface IconifyJSON {
  prefix: string;
  info?: IconifyInfo;
  icons: Record<string, unknown>;
  aliases?: Record<string, IconifyAlias>;
  /** Category name -> icon names. Only some sets ship this. */
  categories?: Record<string, string[]>;
  /** Name suffix -> human style label, e.g. { "": "Regular", fill: "Fill" }. */
  suffixes?: Record<string, string>;
  /** Set-level default grid; Iconify falls back to 16 when absent. */
  width?: number;
  height?: number;
  lastModified?: number;
}

/** What a license obliges a user to do. Hand-maintained in licenses.ts. */
export interface LicensePolicy {
  spdx: string;
  name: string;
  url: string;
  /** Visible credit required in the product using the icon. */
  attributionRequired: boolean;
  /** License/copyright text must ship, but no user-visible credit. */
  noticeRequired: boolean;
  shareAlike: boolean;
  nonCommercial: boolean;
  /** True when the SPDX id was not in the table and defaults were applied. */
  unknown: boolean;
}

export interface SetMetadata {
  /** Capability tier. See tiers.ts. */
  tier: Tier;
  tierEvidence: { blockedShare: number; multicolorShare: number; strokedShare: number; sampled: number };
  prefix: string;
  name: string;
  author: IconifyAuthor;
  license: IconifyLicense & { policy: LicensePolicy };
  attributionRequired: boolean;
  /** Carries third-party trademarks: needs the brand disclaimer. */
  brand: boolean;
  category: string | null;
  tags: string[];
  palette: boolean;
  height: number | null;
  version: string | null;
  /** Distinct glyphs. This is the number that counts. */
  icons: number;
  /** Extra addressable names pointing at those glyphs. */
  aliases: number;
  /** info.total as Iconify declares it, for cross-checking only. */
  declaredTotal: number | null;
  /** Style labels derived from the set's own suffix map. */
  styles: string[];
  samples: string[];
  /** Sample glyphs with their markup, so browse grids need no body reads. */
  sampleGlyphs: { name: string; body: string; width: number; height: number }[];
}

export interface IconDoc {
  tier: Tier;
  id: string;
  prefix: string;
  name: string;
  aliases: string[];
  categories: string[];
  style: string | null;
  palette: boolean;
  license: string;
  attributionRequired: boolean;
  brand: boolean;
}

export interface Stats {
  generatedAt: string;
  iconifyVersion: string;
  totals: {
    sets: number;
    icons: number;
    aliases: number;
    brandSets: number;
    noAttributionIcons: number;
    categories: number;
  };
  perSet: { prefix: string; icons: number; aliases: number; tier: Tier }[];
  byTier: { tier: Tier; sets: number; icons: number }[];
  byLicense: { spdx: string; sets: number; icons: number }[];
}
