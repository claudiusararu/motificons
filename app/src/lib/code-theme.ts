/**
 * "motificons-dark" - the Shiki theme for the navy code panel.
 *
 * Every pair is AA-checked against --ink #183153 and the hex values are
 * fixed: do not substitute them, and do not add an eighth color. Scopes that are not listed below inherit the default text
 * color, which is deliberate - SVG attribute names and plain identifiers stay
 * #F0F1F3 so the seven roles keep their meaning.
 */

/* Exported (not just local consts) so the lightweight client-side highlighter
   in code-highlight.ts - used where Shiki cannot run, i.e. live in the icon
   detail page's format preview panel - draws from the exact same seven
   values instead of a second guess at them. */
export const TEXT = "#F0F1F3";
export const KEYWORD = "#FFD43B"; // --primary, 9.1:1
export const STRING = "#63E6BE"; // --teal, 8.4:1
export const TYPE = "#74C0FC"; // --blue, 6.6:1
export const CONSTANT = "#E599F7"; // --grape, 6.3:1
export const COMMENT = "#8E9CB8"; // 4.7:1
export const PUNCTUATION = "#C3C6D1"; // --card-shadow, 7.8:1

export const motificonsDark = {
  name: "motificons-dark",
  type: "dark" as const,
  colors: {
    /* Transparent so the panel's navy shows through - no double background. */
    "editor.background": "transparent",
    "editor.foreground": TEXT,
  },
  settings: [
    { settings: { foreground: TEXT, background: "transparent" } },
    {
      scope: [
        "keyword",
        "keyword.control",
        "keyword.other",
        "storage",
        "storage.type",
        "storage.modifier",
        "variable.language",
      ],
      settings: { foreground: KEYWORD },
    },
    {
      scope: [
        "string",
        "string.quoted",
        "string.template",
        "constant.character",
        /* Delimiters ride with the string so it reads as one token. */
        "punctuation.definition.string",
      ],
      settings: { foreground: STRING },
    },
    {
      scope: [
        "entity.name.function",
        "support.function",
        "meta.function-call",
        "entity.name.type",
        "entity.name.class",
        "entity.other.inherited-class",
        "support.type",
        "support.class",
        /* Markup tags and JSX components read as types. */
        "entity.name.tag",
      ],
      settings: { foreground: TYPE },
    },
    {
      scope: [
        "constant.numeric",
        "constant.language",
        "constant.other",
        "support.constant",
      ],
      settings: { foreground: CONSTANT },
    },
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: COMMENT },
    },
    {
      scope: [
        "punctuation",
        "punctuation.separator",
        "punctuation.terminator",
        "punctuation.definition.tag",
        "keyword.operator",
        "meta.brace",
      ],
      settings: { foreground: PUNCTUATION },
    },
  ],
};

/** Languages the code panel is allowed to ask Shiki for. */
export const CODE_LANGUAGES = [
  "swift",
  "tsx",
  "html",
  "xml",
  "css",
  "vue",
  "svelte",
  "json",
] as const;

export type CodeLanguage = (typeof CODE_LANGUAGES)[number];
