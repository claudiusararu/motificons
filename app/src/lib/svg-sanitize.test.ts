import { describe, expect, it } from "vitest";
import { MAX_SVG_BYTES, validateSvg } from "./svg-sanitize";

const CLEAN =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2 2 12" fill="currentColor"/></svg>';

describe("validateSvg", () => {
  it("passes clean markup", () => {
    expect(validateSvg(CLEAN)).toEqual({ ok: true });
  });

  it("allows fragment refs and data: URIs, which are normal and safe", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"/></defs>' +
      '<rect fill="url(#g)" width="10" height="10"/>' +
      '<image xlink:href="data:image/png;base64,AAAA" width="4" height="4"/></svg>';
    expect(validateSvg(svg)).toEqual({ ok: true });
  });

  it("rejects markup with no <svg> tag", () => {
    const result = validateSvg("<div>not an svg</div>");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/does not look like an SVG/);
  });

  it("rejects a script element", () => {
    const result = validateSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/script tag/);
  });

  it("rejects foreignObject", () => {
    const result = validateSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml">hi</body></foreignObject></svg>',
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/foreignObject/);
  });

  it("rejects an event-handler attribute", () => {
    const result = validateSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="alert(1)" width="10" height="10"/></svg>',
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/event-handler/);
  });

  it("rejects a javascript: URL", () => {
    const result = validateSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect width="10" height="10"/></a></svg>',
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/javascript:/);
  });

  it("rejects an external href", () => {
    const result = validateSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png" width="10" height="10"/></svg>',
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/external URL/);
  });

  it("rejects an external CSS url() reference", () => {
    const result = validateSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(https://evil.example/x.png#a)" width="10" height="10"/></svg>',
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/external URL/);
  });

  it("rejects a DOCTYPE / custom entity (XXE-style) declaration", () => {
    const result = validateSvg(
      '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><text>&xxe;</text></svg>',
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/DOCTYPE/);
  });

  it("rejects markup over the size cap", () => {
    const huge = `<svg xmlns="http://www.w3.org/2000/svg">${"a".repeat(MAX_SVG_BYTES)}</svg>`;
    const result = validateSvg(huge);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/larger than/);
  });

  it("does not corrupt results across repeated calls (no /g lastIndex bugs)", () => {
    const bad = '<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>';
    expect(validateSvg(bad).ok).toBe(false);
    expect(validateSvg(bad).ok).toBe(false);
    expect(validateSvg(CLEAN).ok).toBe(true);
  });
});
