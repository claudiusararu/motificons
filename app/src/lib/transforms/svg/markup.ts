/**
 * Tolerant tokenizer for Iconify body fragments.
 *
 * Iconify bodies are well-formed XML fragments, but "well-formed" is exactly
 * what the asset-catalog fallback check has to prove rather than assume, so
 * this validates nesting instead of trusting it.
 */

export interface SvgElement {
  name: string;
  attrs: Record<string, string>;
  depth: number;
  /** Ancestor elements, outermost first. */
  ancestors: string[];
}

export interface ParsedFragment {
  elements: SvgElement[];
  wellFormed: boolean;
  error: string | null;
}

const TAG_START = /<([a-zA-Z][\w:-]*)/y;
const ATTR = /\s*([a-zA-Z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/y;
const CLOSE_TAG = /<\/([a-zA-Z][\w:-]*)\s*>/y;

export function parseFragment(body: string): ParsedFragment {
  const elements: SvgElement[] = [];
  const stack: string[] = [];
  let index = 0;

  while (index < body.length) {
    const next = body.indexOf("<", index);
    if (next === -1) break;

    if (body.startsWith("<!--", next)) {
      const end = body.indexOf("-->", next);
      if (end === -1) {
        return { elements, wellFormed: false, error: "unterminated-comment" };
      }
      index = end + 3;
      continue;
    }

    if (body.startsWith("</", next)) {
      CLOSE_TAG.lastIndex = next;
      const match = CLOSE_TAG.exec(body);
      if (!match) {
        return { elements, wellFormed: false, error: "bad-close-tag" };
      }
      const open = stack.pop();
      if (open !== match[1]) {
        return { elements, wellFormed: false, error: "mismatched-tag" };
      }
      index = CLOSE_TAG.lastIndex;
      continue;
    }

    TAG_START.lastIndex = next;
    const start = TAG_START.exec(body);
    if (!start) {
      return { elements, wellFormed: false, error: "bad-open-tag" };
    }

    const name = start[1]!;
    const attrs: Record<string, string> = {};
    let cursor = TAG_START.lastIndex;

    for (;;) {
      ATTR.lastIndex = cursor;
      const attr = ATTR.exec(body);
      if (!attr) break;
      attrs[attr[1]!] = attr[3] ?? attr[4] ?? "";
      cursor = ATTR.lastIndex;
    }

    while (cursor < body.length && /\s/.test(body[cursor]!)) cursor += 1;

    let selfClosing = false;
    if (body.startsWith("/>", cursor)) {
      selfClosing = true;
      cursor += 2;
    } else if (body[cursor] === ">") {
      cursor += 1;
    } else {
      return { elements, wellFormed: false, error: "unterminated-tag" };
    }

    elements.push({ name, attrs, depth: stack.length, ancestors: [...stack] });
    if (!selfClosing) stack.push(name);
    index = cursor;
  }

  if (stack.length > 0) {
    return { elements, wellFormed: false, error: "unclosed-tag" };
  }
  return { elements, wellFormed: true, error: null };
}

/** Inline `style="stroke-width:2"` declarations, which hide from attributes. */
export function styleDeclarations(style: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of style.split(";")) {
    const colon = part.indexOf(":");
    if (colon === -1) continue;
    const key = part.slice(0, colon).trim();
    const value = part.slice(colon + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}
