/**
 * Preparing a pasted SVG for server-side processing.
 *
 * The free tools accept arbitrary markup from anyone, and that markup then
 * goes to a rasterizer running in our process. SVG can reference external
 * resources - <image href="file:///etc/passwd">, <use href="http://internal">
 * - so anything that could reach the filesystem or the network is removed
 * before rendering. Scripts and event handlers go too: they do nothing in
 * resvg, but the sanitized markup is also what we hand back to the browser.
 *
 * This is defense-in-depth *after* the real gate: ../svg-sanitize.ts rejects
 * (rather than silently repairs) markup that has any of this content in the
 * first place, with a plain-language error, before it ever reaches here. If
 * something still shows up at this layer it means a caller skipped that
 * check - the stripping below keeps the rasterizer safe regardless.
 */

export { MAX_SVG_BYTES } from "../svg-sanitize";

export interface ParsedSvg {
  body: string;
  width: number;
  height: number;
}

const DANGEROUS_ELEMENTS =
  /<\s*(script|foreignObject|iframe|image|audio|video|animate|set|handler)\b[\s\S]*?(<\/\s*\1\s*>|\/>)/gi;
const SELF_CLOSING_DANGEROUS =
  /<\s*(script|foreignObject|iframe|image|audio|video|animate|set|handler)\b[^>]*\/?>/gi;
const EVENT_HANDLERS = /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
/** Any href that is not a same-document fragment or an inline data URI. */
const EXTERNAL_HREF =
  /\s(?:xlink:)?href\s*=\s*("(?!#|data:)[^"]*"|'(?!#|data:)[^']*')/gi;

export function sanitizeSvg(markup: string): string {
  return markup
    .replace(DANGEROUS_ELEMENTS, "")
    .replace(SELF_CLOSING_DANGEROUS, "")
    .replace(EVENT_HANDLERS, "")
    .replace(EXTERNAL_HREF, "");
}

/**
 * Splits a pasted document into the inner markup and its intrinsic size.
 * Falls back to width/height attributes, then to a 24 grid, because plenty of
 * real-world SVGs ship one or the other but not both.
 */
export function parseSvgDocument(markup: string): ParsedSvg | null {
  const clean = sanitizeSvg(markup);
  const open = /<svg\b([^>]*)>/i.exec(clean);
  if (!open) return null;

  const inner = /<svg\b[^>]*>([\s\S]*)<\/svg\s*>/i.exec(clean)?.[1]?.trim();
  if (inner === undefined) return null;

  const attrs = open[1] ?? "";
  const viewBox = /viewBox\s*=\s*"([^"]*)"/i.exec(attrs)?.[1];

  let width = 0;
  let height = 0;

  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((part) => Number.isFinite(part))) {
      width = parts[2]!;
      height = parts[3]!;
    }
  }

  if (width <= 0 || height <= 0) {
    width = Number.parseFloat(/\bwidth\s*=\s*"([\d.]+)/i.exec(attrs)?.[1] ?? "");
    height = Number.parseFloat(
      /\bheight\s*=\s*"([\d.]+)/i.exec(attrs)?.[1] ?? "",
    );
  }

  if (!Number.isFinite(width) || width <= 0) width = 24;
  if (!Number.isFinite(height) || height <= 0) height = 24;

  return { body: inner, width, height };
}
