import { describe, expect, it } from "vitest";
import {
  createCollectionTools,
  type CollectionSnapshot,
  type CollectionStyleRequest,
  type CollectionToolHandle,
} from "./collection-tools";
import type { WebMcpTool } from "./bridge";

/**
 * The collection tools are pure translation between an agent's JSON and the
 * workspace island's handle, so they test with no DOM, no React and no
 * network - hand them a fake handle and assert on what it was asked to do
 * and what came back.
 *
 * What these are really guarding:
 *   - adding the same icon twice is a calm success, never a false failure or
 *     a duplicate tile;
 *   - an anchor icon that is not in the collection is refused WITH the list
 *     of icons that would work, so the agent can correct itself;
 *   - nothing that leaves this file carries an SVG body;
 *   - a refusal from the API reaches the agent as the API's own sentence.
 */

const ICONS = [
  { prefix: "tabler", name: "arrow-right", set: "Tabler Icons" },
  { prefix: "lucide", name: "trash", set: "Lucide" },
];

const snapshot = (patch: Partial<CollectionSnapshot> = {}): CollectionSnapshot => ({
  id: "col_1",
  name: "Settings screen",
  count: ICONS.length,
  icons: ICONS,
  styles: {
    anchorIcon: null,
    color: null,
    strokeWidth: null,
    size: null,
    exportFormat: "svg",
  },
  ...patch,
});

/** Records every call, and answers the way a real, healthy page would. */
function fakeHandle(state: CollectionSnapshot = snapshot()) {
  const calls: { method: string; input: unknown }[] = [];
  let current = state;

  const handle: CollectionToolHandle = {
    snapshot() {
      return current;
    },
    async addIcon(input) {
      calls.push({ method: "addIcon", input });
      const already = current.icons.some(
        (icon) => icon.prefix === input.prefix && icon.name === input.name,
      );
      if (already) return { added: false, count: current.count, set: "Tabler Icons" };
      current = {
        ...current,
        icons: [...current.icons, { ...input, set: "Tabler Icons" }],
        count: current.count + 1,
      };
      return { added: true, count: current.count, set: "Tabler Icons" };
    },
    async removeIcon(input) {
      calls.push({ method: "removeIcon", input });
      current = {
        ...current,
        icons: current.icons.filter(
          (icon) => !(icon.prefix === input.prefix && icon.name === input.name),
        ),
        count: current.count - 1,
      };
      return { count: current.count };
    },
    async setStyles(input: CollectionStyleRequest) {
      calls.push({ method: "setStyles", input });
      current = {
        ...current,
        styles: {
          anchorIcon: input.anchorIcon === undefined ? current.styles.anchorIcon : input.anchorIcon,
          color: input.color === undefined ? current.styles.color : input.color,
          strokeWidth:
            input.strokeWidth === undefined ? current.styles.strokeWidth : input.strokeWidth,
          size: input.size === undefined ? current.styles.size : input.size,
          exportFormat: input.exportFormat ?? current.styles.exportFormat,
        },
      };
      return current.styles;
    },
    openAddPanel(query) {
      calls.push({ method: "openAddPanel", input: query });
    },
    async download(format) {
      calls.push({ method: "download", input: format });
      return {
        ok: true,
        count: current.count,
        format: format ?? current.styles.exportFormat,
        filename: "my-icons.zip",
        url: "/api/collections/c1/download/my-icons.zip?format=svg&token=test-token",
      };
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

describe("createCollectionTools", () => {
  it("offers exactly the six collection tools, with only the reader marked read-only", () => {
    const tools = createCollectionTools(fakeHandle().handle);
    expect(tools.map((tool) => tool.name)).toEqual([
      "get_collection",
      "add_icon_to_collection",
      "remove_icon_from_collection",
      "set_collection_styles",
      "open_add_icons_panel",
      "download_collection",
    ]);
    expect(
      tools.filter((tool) => tool.annotations?.readOnlyHint).map((tool) => tool.name),
    ).toEqual(["get_collection"]);
  });

  it("describes every tool for an agent that has never seen the page", () => {
    for (const tool of createCollectionTools(fakeHandle().handle)) {
      expect(tool.description.length).toBeGreaterThan(120);
      expect(tool.title).toBeTruthy();
    }
  });

  describe("get_collection", () => {
    it("reports the name, count, members and current look", async () => {
      const { handle } = fakeHandle();
      const result = await run(createCollectionTools(handle), "get_collection", {});
      expect(result).toEqual({
        id: "col_1",
        name: "Settings screen",
        count: 2,
        styles: {
          anchorIcon: null,
          color: null,
          strokeWidth: null,
          size: null,
          exportFormat: "svg",
        },
        icons: ICONS,
      });
    });

    it("never carries an SVG body, however the page is styled", async () => {
      const { handle } = fakeHandle(
        snapshot({
          styles: {
            anchorIcon: { prefix: "tabler", name: "arrow-right" },
            color: "#183153",
            strokeWidth: 1.5,
            size: 24,
            exportFormat: "png",
          },
        }),
      );
      const result = await run(createCollectionTools(handle), "get_collection", {});
      const json = JSON.stringify(result);
      expect(json).not.toContain("<path");
      expect(json).not.toContain("<svg");
      expect(json).not.toContain("body");
      expect(json).not.toContain("viewBox");
    });
  });

  describe("add_icon_to_collection", () => {
    it("adds through the handle and reports the new count", async () => {
      const { handle, calls } = fakeHandle();
      const result = await run(createCollectionTools(handle), "add_icon_to_collection", {
        prefix: "tabler",
        name: "settings",
      });
      expect(calls).toEqual([
        { method: "addIcon", input: { prefix: "tabler", name: "settings" } },
      ]);
      expect(result["added"]).toBe(true);
      expect(result["count"]).toBe(3);
      expect(String(result["message"])).toContain("tabler:settings");
    });

    it("is idempotent: adding an icon already in the collection succeeds and changes nothing", async () => {
      const { handle, state } = fakeHandle();
      const tools = createCollectionTools(handle);
      const result = await run(tools, "add_icon_to_collection", {
        prefix: "tabler",
        name: "arrow-right",
      });
      expect(result["error"]).toBeUndefined();
      expect(result["added"]).toBe(false);
      expect(result["count"]).toBe(2);
      expect(String(result["message"])).toContain("already");
      expect(state().icons).toHaveLength(2);
    });

    it("refuses a prefix or name that is not a plain slug, without calling the handle", async () => {
      const { handle, calls } = fakeHandle();
      const result = await run(createCollectionTools(handle), "add_icon_to_collection", {
        prefix: "../etc",
        name: "passwd",
      });
      expect(String(result["error"])).toContain("add_icon_to_collection");
      expect(calls).toEqual([]);
    });

    it("returns the API's own sentence when the save is refused", async () => {
      const { handle } = fakeHandle();
      handle.addIcon = async () => {
        throw new Error("That icon id is not valid.");
      };
      /* The bridge is what converts a throw into { error } - here we assert
         the tool lets it through rather than swallowing it into a fake
         success. */
      await expect(
        run(createCollectionTools(handle), "add_icon_to_collection", {
          prefix: "tabler",
          name: "settings",
        }),
      ).rejects.toThrow("That icon id is not valid.");
    });
  });

  describe("remove_icon_from_collection", () => {
    it("removes through the handle and reports the new count", async () => {
      const { handle, calls } = fakeHandle();
      const result = await run(createCollectionTools(handle), "remove_icon_from_collection", {
        prefix: "lucide",
        name: "trash",
      });
      expect(calls).toEqual([
        { method: "removeIcon", input: { prefix: "lucide", name: "trash" } },
      ]);
      expect(result["removed"]).toBe(true);
      expect(result["count"]).toBe(1);
    });

    it("refuses an icon that is not in the collection, and lists what is", async () => {
      const { handle, calls } = fakeHandle();
      const result = await run(createCollectionTools(handle), "remove_icon_from_collection", {
        prefix: "tabler",
        name: "never-added",
      });
      expect(String(result["error"])).toContain("tabler:never-added");
      expect(String(result["error"])).toContain("tabler:arrow-right");
      expect(String(result["error"])).toContain("lucide:trash");
      expect(calls).toEqual([]);
    });
  });

  describe("set_collection_styles", () => {
    it("passes the fields it was given, and leaves the rest alone", async () => {
      const { handle, calls } = fakeHandle();
      const result = await run(createCollectionTools(handle), "set_collection_styles", {
        color: "#183153",
        strokeWidth: 1.5,
      });
      expect(calls).toEqual([
        { method: "setStyles", input: { color: "#183153", strokeWidth: 1.5 } },
      ]);
      expect(result["applied"]).toEqual({
        anchorIcon: null,
        color: "#183153",
        strokeWidth: 1.5,
        size: null,
        exportFormat: "svg",
      });
    });

    it("takes an anchor icon that is in the collection", async () => {
      const { handle, calls } = fakeHandle();
      await run(createCollectionTools(handle), "set_collection_styles", {
        anchorIcon: { prefix: "lucide", name: "trash" },
      });
      expect(calls).toEqual([
        { method: "setStyles", input: { anchorIcon: { prefix: "lucide", name: "trash" } } },
      ]);
    });

    it("refuses an anchor icon that is not in the collection, and names the ones that are", async () => {
      const { handle, calls } = fakeHandle();
      const result = await run(createCollectionTools(handle), "set_collection_styles", {
        anchorIcon: { prefix: "tabler", name: "not-here" },
        color: "#183153",
      });
      expect(String(result["error"])).toContain("tabler:not-here");
      expect(String(result["error"])).toContain("tabler:arrow-right");
      expect(String(result["error"])).toContain("lucide:trash");
      expect(calls).toEqual([]);
    });

    it("clears a field on null and keeps an omitted one", async () => {
      const { handle, calls } = fakeHandle(
        snapshot({
          styles: {
            anchorIcon: { prefix: "tabler", name: "arrow-right" },
            color: "#183153",
            strokeWidth: 2,
            size: 24,
            exportFormat: "svg",
          },
        }),
      );
      const result = await run(createCollectionTools(handle), "set_collection_styles", {
        color: null,
      });
      expect(calls).toEqual([{ method: "setStyles", input: { color: null } }]);
      expect(result["applied"]).toEqual({
        anchorIcon: { prefix: "tabler", name: "arrow-right" },
        color: null,
        strokeWidth: 2,
        size: 24,
        exportFormat: "svg",
      });
    });

    it("refuses an export format the product does not have", async () => {
      const { handle, calls } = fakeHandle();
      const result = await run(createCollectionTools(handle), "set_collection_styles", {
        exportFormat: "webp",
      });
      expect(String(result["error"])).toContain("webp");
      expect(String(result["error"])).toContain("svg");
      expect(calls).toEqual([]);
    });

    it("asks for at least one field rather than sending an empty save", async () => {
      const { handle, calls } = fakeHandle();
      const result = await run(createCollectionTools(handle), "set_collection_styles", {});
      expect(String(result["error"])).toContain("at least one");
      expect(calls).toEqual([]);
    });
  });

  describe("open_add_icons_panel", () => {
    it("opens the panel with a query and tells the agent the human is now choosing", async () => {
      const { handle, calls } = fakeHandle();
      const result = await run(createCollectionTools(handle), "open_add_icons_panel", {
        query: " arrow right ",
      });
      expect(calls).toEqual([{ method: "openAddPanel", input: "arrow right" }]);
      expect(String(result)).toContain("arrow right");
      expect(String(result)).toContain("star");
    });

    it("opens the resting panel when no query is given", async () => {
      const { handle, calls } = fakeHandle();
      await run(createCollectionTools(handle), "open_add_icons_panel", {});
      expect(calls).toEqual([{ method: "openAddPanel", input: null }]);
    });
  });

  describe("download_collection", () => {
    it("starts the real download and names the file the browser is saving", async () => {
      const { handle, calls } = fakeHandle();
      const result = await run(createCollectionTools(handle), "download_collection", {
        format: "png",
      });
      expect(calls).toEqual([{ method: "download", input: "png" }]);
      expect(result["downloading"]).toBe(true);
      expect(result["filename"]).toBe("my-icons.zip");
      expect(result["count"]).toBe(2);
      expect(result["format"]).toBe("png");
      /* The agent gets the filename, the count, and the direct URL - some
         embedded browsers only start downloads from a human click or from
         the agent's own download action on a URL, so the URL is the
         reliable path. Nothing claims the file has landed. */
      expect(String(result["message"])).toContain("my-icons.zip");
      expect(String(result["message"])).toContain("2 icons");
      expect(String(result["downloadUrl"])).toContain("/api/collections/c1/download/my-icons.zip");
      expect(String(result["downloadUrl"])).toContain("token=");
      expect(String(result["message"])).toContain("If no save dialog appeared");
    });

    it("uses the remembered format when none is given", async () => {
      const { handle, calls } = fakeHandle();
      const result = await run(createCollectionTools(handle), "download_collection", {});
      expect(calls).toEqual([{ method: "download", input: null }]);
      expect(result["format"]).toBe("svg");
    });

    it("refuses an empty collection instead of handing over an empty zip", async () => {
      const { handle, calls } = fakeHandle(snapshot({ icons: [], count: 0 }));
      const result = await run(createCollectionTools(handle), "download_collection", {});
      expect(String(result["error"])).toContain("no icons yet");
      expect(calls).toEqual([]);
    });

    it("passes the panel's own error sentence back when the download cannot start", async () => {
      const { handle } = fakeHandle();
      handle.download = async () => ({
        ok: false,
        count: 0,
        format: "svg",
        filename: "",
        url: "",
        error: "The download panel did not open in time.",
      });
      const result = await run(createCollectionTools(handle), "download_collection", {});
      expect(result["error"]).toBe("The download panel did not open in time.");
    });
  });
});
