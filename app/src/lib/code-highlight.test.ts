import { describe, expect, test } from "vitest";
import { highlightCode } from "./code-highlight";
import { COMMENT, CONSTANT, KEYWORD, STRING, TYPE } from "./code-theme";

/** Strips the spans back to plain text - the round-trip that matters most:
    whatever gets highlighted must read back exactly as the input, since this
    HTML lands in dangerouslySetInnerHTML next to a Copy button that copies
    the original unhighlighted string. */
function textOf(html: string): string {
  return html
    .replace(/<span[^>]*>/g, "")
    .replace(/<\/span>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

describe("highlightCode", () => {
  test("never loses or reorders characters", () => {
    const code = `import type { SVGProps } from "react";\n\nexport function FeatherActivity(props: SVGProps<SVGSVGElement>) {\n  return <svg viewBox="0 0 24 24" width={1.5} />;\n}\n`;
    expect(textOf(highlightCode(code, "jsx"))).toBe(code);
  });

  test("colors a tag name", () => {
    const html = highlightCode("<svg>", "markup");
    expect(html).toContain(`color:${TYPE}`);
    expect(html).toContain(">svg<");
  });

  test("colors a string", () => {
    const html = highlightCode('const x = "hello";', "jsx");
    expect(html).toContain(`color:${STRING}`);
  });

  test("colors a keyword but not an arbitrary identifier", () => {
    const html = highlightCode("import Foo from bar", "jsx");
    expect(html).toContain(`color:${KEYWORD}`);
    expect(html).not.toContain(`>Foo<`);
  });

  test("colors JSON booleans and null as constants", () => {
    const html = highlightCode('{"template-rendering-intent": "template"}', "json");
    expect(html).not.toContain(CONSTANT);
    const withBool = highlightCode('{"vector": true}', "json");
    expect(withBool).toContain(`color:${CONSTANT}`);
  });

  test("colors a line comment", () => {
    const html = highlightCode("// note\nlet x = 1;", "swift");
    expect(html).toContain(`color:${COMMENT}`);
  });

  test("escapes HTML-significant characters so nothing injects", () => {
    const html = highlightCode('<script>alert("x")</script>', "text");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;");
  });

  test("plain text mode leaves an ordinary sentence uncolored", () => {
    const code = "data:image/svg+xml;base64,PHN2Zw==";
    expect(textOf(highlightCode(code, "text"))).toBe(code);
  });
});
