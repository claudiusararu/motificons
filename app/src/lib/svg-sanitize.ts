/**
 * Validates pasted SVG markup from the free tool pages before it is ever
 * converted or previewed.
 *
 * This is a REJECT, not a repair. `transforms/untrusted-svg.ts` strips
 * dangerous content before handing markup to the server-side rasterizer,
 * which is the right move for a rendering pipeline - but the rule for the
 * paste box is explicit: no silent truncation or auto-fixing. Deleting a
 * <script> tag and converting whatever survives would hide the problem
 * instead of naming it. So this module only answers one question - "is this
 * safe to touch at all" - and hands back a plain-language reason when the
 * answer is no. Nothing here mutates the input.
 *
 * Pure and isomorphic (no DOM, no Node built-ins), so the exact same checks
 * run client-side the moment something is pasted and again on the server
 * before any output is produced - one function, two checkpoints, described
 * at each call site.
 */

/** 512KB: generous for any hand-drawn icon or small illustration, small
    enough that nobody can use the paste box to smuggle megabytes of text
    through the conversion endpoints. The single named cap both checkpoints
    enforce. */
export const MAX_SVG_BYTES = 512 * 1024;

export interface SvgValidation {
  ok: boolean;
  /** Plain-language explanation, present only when ok is false. Names the
      actual problem ("this SVG contains a script tag") rather than a generic
      "invalid input" - the point is the visitor can fix it and paste again. */
  reason?: string;
}

function byteLength(input: string): number {
  return new TextEncoder().encode(input).length;
}

interface RejectionRule {
  test: RegExp;
  reason: string;
}

/* Order is the order reasons are checked in, not a severity ranking - every
   rule runs against the raw, unmodified string. None of these use the /g
   flag: they are only ever used with .test(), and a global flag would leave
   lastIndex state that corrupts the *next* call on the same regex object. */
const REJECTIONS: RejectionRule[] = [
  {
    test: /<!DOCTYPE\b|<!ENTITY\b/i,
    reason:
      "This SVG has a DOCTYPE or a custom entity declaration - remove it and paste again.",
  },
  {
    test: /<\s*script\b/i,
    reason: "This SVG contains a script tag - remove it and paste again.",
  },
  {
    test: /<\s*foreignObject\b/i,
    reason:
      "This SVG contains a foreignObject element - remove it and paste again.",
  },
  {
    test: /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i,
    reason:
      "This SVG has an event-handler attribute (like onclick or onload) - remove it and paste again.",
  },
  {
    test: /javascript\s*:/i,
    reason: "This SVG has a javascript: URL - remove it and paste again.",
  },
  {
    /* href/xlink:href pointing at an external http(s) URL. Fragment
       references (#gradient1) and data: URIs are left alone - both are
       normal, safe parts of everyday SVG (gradients, embedded raster
       images). */
    test: /\s(?:xlink:)?href\s*=\s*("https?:[^"]*"|'https?:[^']*')/i,
    reason: "This SVG references an external URL - remove it and paste again.",
  },
  {
    /* The CSS-function form: fill="url(https://...)" etc. */
    test: /url\(\s*["']?\s*https?:/i,
    reason: "This SVG references an external URL - remove it and paste again.",
  },
];

/**
 * Validates pasted SVG markup. Checks run in this fixed order and the first
 * failure wins - callers get exactly one plain-language reason, never a list.
 */
export function validateSvg(markup: string): SvgValidation {
  if (byteLength(markup) > MAX_SVG_BYTES) {
    return {
      ok: false,
      reason: `That SVG is larger than ${MAX_SVG_BYTES / 1024}KB - trim it and paste again.`,
    };
  }

  if (!markup.includes("<svg")) {
    return {
      ok: false,
      reason: "That does not look like an SVG. It should contain an <svg> tag.",
    };
  }

  for (const rule of REJECTIONS) {
    if (rule.test.test(markup)) return { ok: false, reason: rule.reason };
  }

  return { ok: true };
}
