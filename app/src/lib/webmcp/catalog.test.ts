import { describe, expect, it } from "vitest";
import { WEBMCP_SURFACES, WEBMCP_TOOL_COUNT } from "./catalog";
import { createSearchTools, type SearchToolHandle } from "./search-tools";
import { createIconTools, type IconToolHandle } from "./icon-tools";
import { createCollectionTools, type CollectionToolHandle } from "./collection-tools";
import { createDashboardTools, type DashboardToolHandle } from "./dashboard-tools";

/**
 * The catalog is what /agents prints. This test is the reason a person can
 * trust that page: it builds every real tool set and asserts the catalog
 * names are exactly the registered names - so a tool that is added, renamed
 * or dropped breaks the build rather than quietly making the page a lie.
 *
 * Only the tool NAMES are checked. The catalog's sentences are for people and
 * the modules' descriptions are for agents; they are meant to differ.
 *
 * Handles are stubbed rather than faked. Building a tool list touches the
 * handle in exactly one place - createIconTools bakes the size and stroke
 * options into its input schema - so that is the only method stubbed for
 * real; every `execute` closure is created but never called.
 */

const iconHandle = {
  constraints: () => ({
    sizes: [24, 48],
    strokeWidths: [1, 1.5, 2],
    maxPadding: 0.4,
  }),
} as unknown as IconToolHandle;

const registeredNames = [
  ...createSearchTools({} as SearchToolHandle),
  ...createIconTools(iconHandle),
  ...createCollectionTools({} as CollectionToolHandle),
  ...createDashboardTools({} as DashboardToolHandle),
].map((tool) => tool.name);

describe("webmcp catalog", () => {
  it("describes exactly the tools the site registers", () => {
    const listed = WEBMCP_SURFACES.flatMap((surface) =>
      surface.tools.map((tool) => tool.name),
    );

    expect([...listed].sort()).toEqual([...registeredNames].sort());
  });

  it("counts the tools it lists", () => {
    expect(WEBMCP_TOOL_COUNT).toBe(registeredNames.length);
  });

  it("gives every tool a sentence a person can read", () => {
    for (const surface of WEBMCP_SURFACES) {
      expect(surface.surface.length).toBeGreaterThan(0);
      expect(surface.where.length).toBeGreaterThan(0);
      for (const tool of surface.tools) {
        expect(tool.does.length).toBeGreaterThan(20);
        expect(tool.does.endsWith(".")).toBe(true);
        /* No em-dashes anywhere in copy (AGENTS.md). */
        expect(tool.does).not.toContain("—");
      }
    }
  });
});
