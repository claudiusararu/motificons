import type { LicensePolicy } from "./types.ts";

/**
 * What each license actually obliges a user to do (SPEC section 5).
 *
 * The distinction that matters for the product: `attributionRequired` means a
 * visible credit in the thing you ship, which is what the "no attribution"
 * search filter keys off. `noticeRequired` means you must keep the license
 * text with the source, which MIT and friends require but which no designer
 * thinks of as attribution. Conflating the two would make the filter useless.
 *
 * Not legal advice, and deliberately conservative: an unknown SPDX id is
 * treated as the strictest case and flagged so it shows up in review.
 */
const POLICIES: Record<string, Omit<LicensePolicy, "spdx" | "unknown">> = {
  "CC0-1.0": {
    name: "CC0 1.0 Universal",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
    attributionRequired: false,
    noticeRequired: false,
    shareAlike: false,
    nonCommercial: false,
  },
  Unlicense: {
    name: "The Unlicense",
    url: "https://unlicense.org/",
    attributionRequired: false,
    noticeRequired: false,
    shareAlike: false,
    nonCommercial: false,
  },
  MIT: {
    name: "MIT License",
    url: "https://opensource.org/license/mit",
    attributionRequired: false,
    noticeRequired: true,
    shareAlike: false,
    nonCommercial: false,
  },
  ISC: {
    name: "ISC License",
    url: "https://opensource.org/license/isc-license-txt",
    attributionRequired: false,
    noticeRequired: true,
    shareAlike: false,
    nonCommercial: false,
  },
  "BSD-3-Clause": {
    name: "BSD 3-Clause License",
    url: "https://opensource.org/license/bsd-3-clause",
    attributionRequired: false,
    noticeRequired: true,
    shareAlike: false,
    nonCommercial: false,
  },
  "Apache-2.0": {
    name: "Apache License 2.0",
    url: "https://www.apache.org/licenses/LICENSE-2.0",
    attributionRequired: false,
    noticeRequired: true,
    shareAlike: false,
    nonCommercial: false,
  },
  "MPL-2.0": {
    name: "Mozilla Public License 2.0",
    url: "https://www.mozilla.org/en-US/MPL/2.0/",
    attributionRequired: false,
    noticeRequired: true,
    shareAlike: false,
    nonCommercial: false,
  },
  "OFL-1.1": {
    name: "SIL Open Font License 1.1",
    url: "https://openfontlicense.org/",
    attributionRequired: false,
    noticeRequired: true,
    shareAlike: false,
    nonCommercial: false,
  },
  "CC-BY-3.0": {
    name: "Creative Commons Attribution 3.0",
    url: "https://creativecommons.org/licenses/by/3.0/",
    attributionRequired: true,
    noticeRequired: true,
    shareAlike: false,
    nonCommercial: false,
  },
  "CC-BY-4.0": {
    name: "Creative Commons Attribution 4.0",
    url: "https://creativecommons.org/licenses/by/4.0/",
    attributionRequired: true,
    noticeRequired: true,
    shareAlike: false,
    nonCommercial: false,
  },
  "CC-BY-SA-3.0": {
    name: "Creative Commons Attribution-ShareAlike 3.0",
    url: "https://creativecommons.org/licenses/by-sa/3.0/",
    attributionRequired: true,
    noticeRequired: true,
    shareAlike: true,
    nonCommercial: false,
  },
  "CC-BY-SA-4.0": {
    name: "Creative Commons Attribution-ShareAlike 4.0",
    url: "https://creativecommons.org/licenses/by-sa/4.0/",
    attributionRequired: true,
    noticeRequired: true,
    shareAlike: true,
    nonCommercial: false,
  },
  "CC-BY-NC-4.0": {
    name: "Creative Commons Attribution-NonCommercial 4.0",
    url: "https://creativecommons.org/licenses/by-nc/4.0/",
    attributionRequired: true,
    noticeRequired: true,
    shareAlike: false,
    nonCommercial: true,
  },
  "CC-BY-NC-SA-4.0": {
    name: "Creative Commons Attribution-NonCommercial-ShareAlike 4.0",
    url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    attributionRequired: true,
    noticeRequired: true,
    shareAlike: true,
    nonCommercial: true,
  },
  "GPL-2.0-only": {
    name: "GNU General Public License v2.0 only",
    url: "https://www.gnu.org/licenses/old-licenses/gpl-2.0.html",
    attributionRequired: true,
    noticeRequired: true,
    shareAlike: true,
    nonCommercial: false,
  },
  "GPL-2.0-or-later": {
    name: "GNU General Public License v2.0 or later",
    url: "https://www.gnu.org/licenses/old-licenses/gpl-2.0.html",
    attributionRequired: true,
    noticeRequired: true,
    shareAlike: true,
    nonCommercial: false,
  },
  "GPL-3.0": {
    name: "GNU General Public License v3.0",
    url: "https://www.gnu.org/licenses/gpl-3.0.html",
    attributionRequired: true,
    noticeRequired: true,
    shareAlike: true,
    nonCommercial: false,
  },
  "GPL-3.0-or-later": {
    name: "GNU General Public License v3.0 or later",
    url: "https://www.gnu.org/licenses/gpl-3.0.html",
    attributionRequired: true,
    noticeRequired: true,
    shareAlike: true,
    nonCommercial: false,
  },
};

export function licensePolicy(spdx: string | undefined, title: string): LicensePolicy {
  const id = spdx?.trim();
  const known = id ? POLICIES[id] : undefined;
  if (id && known) return { spdx: id, unknown: false, ...known };

  return {
    spdx: id ?? title,
    name: title,
    url: "",
    attributionRequired: true,
    noticeRequired: true,
    shareAlike: false,
    nonCommercial: false,
    unknown: true,
  };
}

/**
 * Brand sets carry third-party trademarks and need the disclaimer.
 * Iconify's own "Logos" category catches most of them; these are the ones it
 * files elsewhere, so they have to be named.
 */
const BRAND_SET_SUPPLEMENT = new Set([
  "devicon",
  "devicon-plain",
  "devicon-line",
  "devicon-original",
  "skill-icons",
  "vscode-icons",
  "fa-brands",
  "fa6-brands",
  "unjs",
]);

export function isBrandSet(prefix: string, category: string | undefined): boolean {
  return category === "Logos" || BRAND_SET_SUPPLEMENT.has(prefix);
}
