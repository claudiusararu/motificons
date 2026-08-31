import { describe, expect, it } from "vitest";
import { EXPORT_FORMATS } from "../../lib/transforms/formats";
import { TOOLS, toolBySlug } from "./_tool-data";

/* Formats with no dedicated converter page - see _tool-data.ts's own header
   comment for why (no "SVG to SVG" page; asset catalog explicitly deferred). */
const UNTOOLED_FORMATS = new Set(["svg", "catalog"]);

describe("tools registry stays in sync with the format registry (rule 8)", () => {
  it("has exactly one tool per convertible export format", () => {
    const expectedKinds = EXPORT_FORMATS.map((format) => format.id)
      .filter((id) => !UNTOOLED_FORMATS.has(id))
      .sort();
    const actualKinds = TOOLS.map((tool) => tool.kind).sort();
    expect(actualKinds).toEqual(expectedKinds);
  });

  it("every tool kind is a real export format id", () => {
    const formatIds = new Set(EXPORT_FORMATS.map((format) => format.id));
    for (const tool of TOOLS) {
      expect(formatIds.has(tool.kind)).toBe(true);
    }
  });

  it("has unique slugs that resolve back through toolBySlug", () => {
    const slugs = TOOLS.map((tool) => tool.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const tool of TOOLS) {
      expect(toolBySlug(tool.slug)).toBe(tool);
    }
  });

  it("every page has non-empty SEO copy", () => {
    for (const tool of TOOLS) {
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.h1.length).toBeGreaterThan(0);
      expect(tool.lead.length).toBeGreaterThan(0);
      expect(tool.notes.length).toBeGreaterThan(0);
    }
  });
});
