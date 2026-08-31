/**
 * Generates the site-wide OG image from the logo mark.
 *
 * Script rather than a checked-in binary: the mark is defined by the design
 * tokens, so when the chip or the wordmark changes this regenerates instead of
 * quietly going stale. Runs before every build; the output is gitignored.
 *
 * Hex colors only - OKLCH in SVG is unreliable (AGENTS.md).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const INK = "#183153";
const CANVAS = "#F0F1F3";
const PRIMARY = "#FFD43B";
const MUTED = "#616D8A";

/* 1200x630 is the size every social platform crops from. */
const WIDTH = 1200;
const HEIGHT = 630;

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "public", "og-default.png");

/* The chip from Logo.astro, scaled up: yellow fill, 2px ink border at 28px,
   so the stroke scales with it, plus the same 0 2px 0 hard shadow. */
const CHIP = 132;
const CHIP_X = 96;
const CHIP_Y = 188;
const SCALE = CHIP / 28;
const STAR =
  "m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${CANVAS}"/>
  <rect x="${CHIP_X}" y="${CHIP_Y + 2 * SCALE}" width="${CHIP}" height="${CHIP}" rx="${8 * SCALE}" fill="${INK}"/>
  <rect x="${CHIP_X}" y="${CHIP_Y}" width="${CHIP}" height="${CHIP}" rx="${8 * SCALE}" fill="${PRIMARY}" stroke="${INK}" stroke-width="${2 * SCALE}"/>
  <g transform="translate(${CHIP_X + CHIP / 2 - 12 * (CHIP / 24) * 0.62} ${CHIP_Y + CHIP / 2 - 12 * (CHIP / 24) * 0.62}) scale(${(CHIP / 24) * 0.62})">
    <path d="${STAR}" fill="${INK}" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
  </g>
  <text x="${CHIP_X + CHIP + 36}" y="${CHIP_Y + CHIP / 2 + 26}" font-family="Nunito, Helvetica, Arial, sans-serif" font-size="76" font-weight="800" fill="${INK}">Motificons</text>
  <text x="${CHIP_X}" y="${CHIP_Y + CHIP + 96}" font-family="Nunito, Helvetica, Arial, sans-serif" font-size="42" font-weight="600" fill="${INK}">Any icon. Your style. Every platform.</text>
  <text x="${CHIP_X}" y="${CHIP_Y + CHIP + 158}" font-family="Nunito, Helvetica, Arial, sans-serif" font-size="30" font-weight="400" fill="${MUTED}">Open-source icons for humans and coding agents</text>
</svg>`;

const renderer = new Resvg(svg, {
  fitTo: { mode: "width", value: WIDTH },
  font: { loadSystemFonts: true, defaultFontFamily: "Helvetica" },
});

await mkdir(dirname(out), { recursive: true });
await writeFile(out, renderer.render().asPng());
console.log(`og-default.png ${WIDTH}x${HEIGHT} written`);
