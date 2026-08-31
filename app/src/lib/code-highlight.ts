/**
 * A tiny, dependency-free syntax highlighter for the format preview panel.
 *
 * The rest of the site highlights code with Shiki (CodePanel.astro, via
 * astro:components) - real grammars, server-rendered, zero client JS. That
 * only works because Shiki runs during Astro's render pass. The format
 * preview panel is different: it re-renders on every color/size/stroke edit
 * inside a hydrated React island, so the highlighting has to happen in the
 * browser, on every keystroke-adjacent state change, without shipping a
 * grammar engine into the bundle.
 *
 * This is not a real tokenizer - it is a handful of regexes that approximate
 * the same seven roles Shiki's motificons-dark theme uses (see code-theme.ts,
 * the single source for the actual hex values), applied in priority order:
 * comments, then strings, then tag names, then keywords/constants, then
 * numbers. Everything else - punctuation, attribute names, operators - stays
 * the default text color, same as the Shiki theme's own scope comment says
 * ("SVG attribute names and plain identifiers stay #F0F1F3"). Good enough to
 * read at a glance; not a claim of grammatical correctness.
 */

import {
  COMMENT,
  CONSTANT,
  KEYWORD,
  PUNCTUATION,
  STRING,
  TYPE,
} from "./code-theme";

export type HighlightLang =
  | "markup"
  | "jsx"
  | "swift"
  | "json"
  | "css"
  | "text";

interface LangSpec {
  keywords: string[];
  constants: string[];
}

const JS_KEYWORDS = [
  "import",
  "export",
  "default",
  "from",
  "function",
  "return",
  "const",
  "let",
  "var",
  "interface",
  "type",
  "extends",
  "script",
  "setup",
  "lang",
  "template",
];

const SWIFT_KEYWORDS = [
  "import",
  "struct",
  "func",
  "let",
  "var",
  "return",
  "private",
  "static",
  "some",
  "in",
  "if",
  "else",
];

const LANG_SPECS: Record<HighlightLang, LangSpec> = {
  markup: { keywords: [], constants: [] },
  jsx: { keywords: JS_KEYWORDS, constants: ["true", "false", "null", "undefined"] },
  swift: { keywords: SWIFT_KEYWORDS, constants: ["true", "false", "nil"] },
  json: { keywords: [], constants: ["true", "false", "null"] },
  css: { keywords: [], constants: [] },
  text: { keywords: [], constants: [] },
};

const TOKEN_RE =
  /(?<comment>\/\*[\s\S]*?\*\/|\/\/[^\n]*|<!--[\s\S]*?-->)|(?<string>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(?<tagpunct><\/?)(?<tagname>[A-Za-z][\w.:-]*)?|(?<word>[A-Za-z_$][\w$]*)|(?<number>-?\b\d+\.?\d*\b)/g;

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

function escapeHtml(input: string): string {
  return input.replace(/[&<>]/g, (char) => ESCAPE[char]!);
}

function span(color: string, text: string): string {
  return `<span style="color:${color}">${escapeHtml(text)}</span>`;
}

/** Renders inline-styled HTML spans matching motificons-dark. Escapes its
    input, so it is safe to drop straight into dangerouslySetInnerHTML. */
export function highlightCode(code: string, lang: HighlightLang): string {
  const spec = LANG_SPECS[lang];
  let out = "";
  let last = 0;

  for (const match of code.matchAll(TOKEN_RE)) {
    const index = match.index ?? 0;
    out += escapeHtml(code.slice(last, index));
    const g = match.groups!;

    if (g.comment) {
      out += span(COMMENT, g.comment);
    } else if (g.string) {
      out += span(STRING, g.string);
    } else if (g.tagpunct) {
      out += span(PUNCTUATION, g.tagpunct);
      if (g.tagname) out += span(TYPE, g.tagname);
    } else if (g.word) {
      if (spec.constants.includes(g.word)) out += span(CONSTANT, g.word);
      else if (spec.keywords.includes(g.word)) out += span(KEYWORD, g.word);
      else out += escapeHtml(g.word);
    } else if (g.number) {
      out += span(CONSTANT, g.number);
    }

    last = index + match[0].length;
  }

  out += escapeHtml(code.slice(last));
  return out;
}
