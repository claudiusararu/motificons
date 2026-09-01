import { describe, expect, it } from "vitest";
import {
  createDashboardTools,
  type DashboardCollectionSummary,
  type DashboardToolHandle,
} from "./dashboard-tools";
import { COLLECTION_LIMIT, collectionCapUpsell, MAX_NAME_LENGTH } from "../workspace/limits";
import type { WebMcpTool } from "./bridge";

/**
 * Pure translation, tested without a DOM or a network - same construction as
 * search-tools.test.ts and collection-tools.test.ts.
 *
 * The one that matters most: when the account is full, the agent is handed
 * the SAME sentence the person sees in the page, verbatim from
 * limits.ts's own copy - not a paraphrase, and never a suggested workaround.
 */

const rows: DashboardCollectionSummary[] = [
  { id: "col_1", name: "Settings screen", count: 4, url: "/collections/col_1" },
  { id: "col_2", name: "Onboarding icons", count: 0, url: "/collections/col_2" },
];

function fakeHandle(initial: DashboardCollectionSummary[] = rows) {
  const calls: { method: string; input: unknown }[] = [];
  let current = initial;

  const handle: DashboardToolHandle = {
    list() {
      calls.push({ method: "list", input: null });
      return current;
    },
    async create(name) {
      calls.push({ method: "create", input: name });
      if (current.length >= COLLECTION_LIMIT) {
        const { upsell } = collectionCapUpsell();
        return { ok: false, error: `${upsell.headline} ${upsell.body}` };
      }
      const collection = {
        id: `col_${current.length + 1}`,
        name,
        count: 0,
        url: `/collections/col_${current.length + 1}`,
      };
      current = [...current, collection];
      return { ok: true, collection };
    },
    navigate(url) {
      calls.push({ method: "navigate", input: url });
    },
  };

  return { handle, calls, state: () => current };
}

const byName = (tools: WebMcpTool[], name: string): WebMcpTool => {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`no tool named ${name}`);
  return tool;
};

const run = (tools: WebMcpTool[], name: string, input: Record<string, unknown>) =>
  Promise.resolve(byName(tools, name).execute(input, {})) as Promise<Record<string, unknown>>;

describe("createDashboardTools", () => {
  it("offers the two dashboard tools, with only the reader marked read-only", () => {
    const tools = createDashboardTools(fakeHandle().handle);
    expect(tools.map((tool) => tool.name)).toEqual(["list_collections", "create_collection"]);
    expect(
      tools.filter((tool) => tool.annotations?.readOnlyHint).map((tool) => tool.name),
    ).toEqual(["list_collections"]);
  });

  describe("list_collections", () => {
    it("reports id, name, count and page URL for each collection", async () => {
      const { handle } = fakeHandle();
      const result = await run(createDashboardTools(handle), "list_collections", {});
      expect(result["count"]).toBe(2);
      expect(result["collections"]).toEqual(rows);
    });

    it("says what to do next when there are none", async () => {
      const { handle } = fakeHandle([]);
      const result = await run(createDashboardTools(handle), "list_collections", {});
      expect(result["count"]).toBe(0);
      expect(String(result["note"])).toContain("create_collection");
    });
  });

  describe("create_collection", () => {
    it("creates through the handle and opens the new collection", async () => {
      const { handle, calls, state } = fakeHandle();
      const result = await run(createDashboardTools(handle), "create_collection", {
        name: "  Empty states  ",
      });
      /* Creating and then walking there is one step, not two: the scenario
         this exists for is one human sentence ("make a collection and add
         these icons"), and the collection's own tools only exist on the
         collection's page. */
      expect(calls).toEqual([
        { method: "create", input: "Empty states" },
        { method: "navigate", input: "/collections/col_3" },
      ]);
      expect(result["created"]).toBe(true);
      expect(result["opened"]).toBe(true);
      expect(result["collection"]).toEqual({
        id: "col_3",
        name: "Empty states",
        count: 0,
        url: "/collections/col_3",
      });
      expect(state()).toHaveLength(3);
    });

    it("tells the agent the page is navigating and what waits on the other side", async () => {
      const { handle } = fakeHandle();
      const result = await run(createDashboardTools(handle), "create_collection", {
        name: "Empty states",
      });
      const message = String(result["message"]);
      expect(message).toContain("/collections/col_3");
      expect(message).toContain("navigating");
      expect(message).toContain("add_icon_to_collection");
      expect(message).toContain("open_add_icons_panel");
    });

    it("stays on the dashboard when asked to with open: false", async () => {
      const { handle, calls, state } = fakeHandle();
      const result = await run(createDashboardTools(handle), "create_collection", {
        name: "For later",
        open: false,
      });
      expect(calls).toEqual([{ method: "create", input: "For later" }]);
      expect(result["created"]).toBe(true);
      expect(result["opened"]).toBe(false);
      expect(String(result["message"])).toContain("/collections/col_3");
      expect(state()).toHaveLength(3);
    });

    it("offers `open` in its schema and says it defaults to opening", () => {
      const tool = createDashboardTools(fakeHandle().handle).find(
        (candidate) => candidate.name === "create_collection",
      )!;
      expect(tool.inputSchema).toMatchObject({
        properties: { open: { type: "boolean" } },
      });
      expect(tool.description).toContain("OPENS it");
    });

    it("navigates nowhere when the create was refused", async () => {
      const full = Array.from({ length: COLLECTION_LIMIT }, (_, index) => ({
        id: `col_${index}`,
        name: `Collection ${index}`,
        count: 0,
        url: `/collections/col_${index}`,
      }));
      const { handle, calls } = fakeHandle(full);
      await run(createDashboardTools(handle), "create_collection", { name: "One too many" });
      expect(calls.map((call) => call.method)).toEqual(["create"]);
    });

    it("asks for a name instead of creating an unnamed collection", async () => {
      const { handle, calls } = fakeHandle();
      const result = await run(createDashboardTools(handle), "create_collection", { name: "   " });
      expect(String(result["error"])).toContain("name");
      expect(calls).toEqual([]);
    });

    it("refuses a name longer than the field allows, without a round trip", async () => {
      const { handle, calls } = fakeHandle();
      const result = await run(createDashboardTools(handle), "create_collection", {
        name: "x".repeat(MAX_NAME_LENGTH + 1),
      });
      expect(String(result["error"])).toContain(String(MAX_NAME_LENGTH));
      expect(calls).toEqual([]);
    });

    it("surfaces the full-account refusal verbatim, once five collections exist", async () => {
      const full = Array.from({ length: COLLECTION_LIMIT }, (_, index) => ({
        id: `col_${index}`,
        name: `Collection ${index}`,
        count: 0,
        url: `/collections/col_${index}`,
      }));
      const { handle, state } = fakeHandle(full);
      const result = await run(createDashboardTools(handle), "create_collection", {
        name: "One too many",
      });

      const { upsell } = collectionCapUpsell();
      expect(result["error"]).toBe(`${upsell.headline} ${upsell.body}`);
      expect(result["created"]).toBeUndefined();
      expect(state()).toHaveLength(COLLECTION_LIMIT);
    });
  });
});
