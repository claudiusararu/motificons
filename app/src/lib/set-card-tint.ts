/**
 * Deterministic tint for a set card.
 *
 * The colour is a hash of the prefix, not an index into the render order, so a
 * set keeps the same colour forever - across pages, across re-sorts, across
 * pipeline runs. Tying it to position would mean tabler changing colour the
 * day a bigger set arrives, and the colour is a recognition cue.
 *
 * Level-1 pastel backgrounds read washed-out next to the rest of the
 * system, so each tint pairs the accent scale's Open Color level-3 as the
 * background with its level-8 sibling as the hard shadow - the SAME level-8
 * relationship the colored-card rule already uses, just applied to twelve
 * hues instead of five.
 */

export interface SetTint {
  name: string;
  background: string;
  shadow: string;
}

/** Exported (read-only) so the styleguide can render every swatch and build
    a real distribution histogram, instead of the page and the palette
    silently drifting apart. */
export const TINTS: readonly SetTint[] = [
  { name: "red", background: "#FF8787", shadow: "#E03131" },
  { name: "pink", background: "#FAA2C1", shadow: "#C2255C" },
  { name: "grape", background: "#E599F7", shadow: "#9C36B5" },
  { name: "violet", background: "#B197FC", shadow: "#6741D9" },
  { name: "indigo", background: "#91A7FF", shadow: "#3B5BDB" },
  { name: "blue", background: "#74C0FC", shadow: "#146EBE" },
  { name: "cyan", background: "#66D9E8", shadow: "#0C8599" },
  { name: "teal", background: "#63E6BE", shadow: "#099268" },
  { name: "green", background: "#8CE99A", shadow: "#2F9E44" },
  { name: "lime", background: "#C0EB75", shadow: "#66A80F" },
  { name: "yellow", background: "#FFE066", shadow: "#F08C00" },
  { name: "orange", background: "#FFC078", shadow: "#E8590C" },
];

/** FNV-1a: tiny, stable across runtimes, and well spread for short strings. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Which tint a prefix hashes to, as an index into `TINTS` - the primitive
    both `tintFor` and the styleguide's histogram build on. */
export function tintIndexFor(prefix: string): number {
  return hash(prefix) % TINTS.length;
}

export function tintFor(prefix: string): SetTint {
  return TINTS[tintIndexFor(prefix)]!;
}
