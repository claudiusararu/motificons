import { describe, expect, it } from "vitest";
import {
  createIconTools,
  editableProperties,
  type IconCapability,
  type IconEditState,
  type IconFormat,
  type IconIdentity,
  type IconStylePatch,
  type IconToolHandle,
} from "./icon-tools";
import type { WebMcpTool } from "./bridge";

/**
 * The icon page's tools are pure translation between an agent's JSON and the
 * editor's handle, so they test with a fake handle - no React, no DOM, no
 * icon data.
 *
 * What these are really guarding:
 *   - capability honesty survives the trip to the agent: an icon that cannot
 *     be recolored refuses a recolor with the page's own sentence, and a
 *     refused call changes NOTHING (no setter is touched at all);
 *   - the values the tools accept are the values the buttons offer, so an
 *     agent cannot reach a state a human could not have clicked to;
 *   - code and downloads go through the one path the panel uses, and a format
 *     this icon does not offer comes back as a listed, actionable error.
 */

const T1: IconCapability = {
  tier: "T1",
  label: "Full restyle",
  summary: "Stroke width, color, size and optical padding are all editable.",
  canRecolor: true,
  canRetargetStroke: true,
  recolorAbsentReason: "",
  strokeAbsentReason: "",
};

const T4: IconCapability = {
  tier: "T4",
  label: "Ships as drawn",
  summary: "This artwork uses masks or gradients, so it exports as drawn.",
  canRecolor: false,
  canRetargetStroke: false,
  recolorAbsentReason:
    "This set uses masks or gradients, so recoloring would change the artwork rather than restyle it. Size and export still work.",
  strokeAbsentReason:
    "This artwork is already expanded to filled shapes, so there is no stroke to retarget.",
};

const DEFAULT_EDITS: IconEditState = {
  size: 128,
  color: "#183153",
  strokeWidth: null,
  cssStyleable: false,
  rotate: 0,
  flipH: false,
  flipV: false,
  padding: 0,
};

const FORMATS: IconFormat[] = [
  { id: "svg", label: "SVG", kind: "code", supported: true },
  { id: "png", label: "PNG", kind: "image", supported: true },
  { id: "swiftui", label: "SwiftUI", kind: "code", supported: true },
  { id: "catalog", label: "Xcode asset catalog", kind: "files", supported: true },
];

interface Fake {
  handle: IconToolHandle;
  calls: { method: string; input: unknown }[];
  edits: IconEditState;
}

/** Records every call and answers with whatever the test set up. */
function fakeHandle(
  capability: IconCapability = T1,
  overrides: Partial<{
    edits: IconEditState;
    formats: IconFormat[];
    activeFormat: string;
    code: { code: string; lang: string; note?: string };
  }> = {},
): Fake {
  const calls: { method: string; input: unknown }[] = [];
  const state: IconEditState = { ...DEFAULT_EDITS, ...(overrides.edits ?? {}) };
  const identity: IconIdentity = {
    name: "star",
    set: "Tabler Icons",
    prefix: "tabler",
    style: "outline",
    license: "MIT",
    attributionRequired: false,
    capability,
  };

  const fake: Fake = {
    calls,
    edits: state,
    handle: {
      identity: () => identity,
      constraints: () => ({
        sizes: [24, 48, 64, 128, 256, 512, 1024],
        strokeWidths: [1, 1.5, 2, 2.5, 3],
        maxPadding: 0.4,
      }),
      edits: () => ({ ...state }),
      formats: () => overrides.formats ?? FORMATS,
      activeFormat: () => overrides.activeFormat ?? "svg",
      applyStyle: (patch: IconStylePatch) => {
        calls.push({ method: "applyStyle", input: patch });
        Object.assign(state, patch);
        return { ...state };
      },
      code: (format: string) => {
        calls.push({ method: "code", input: format });
        return overrides.code ?? { code: `<svg data-format="${format}"/>`, lang: "markup" };
      },
      download: (format: string) => {
        calls.push({ method: "download", input: format });
        return `/api/export/tabler/star?format=${format}&size=128`;
      },
    },
  };
  return fake;
}

function toolNamed(tools: WebMcpTool[], name: string): WebMcpTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`no tool named ${name}`);
  return tool;
}

async function run(
  handle: IconToolHandle,
  name: string,
  input: Record<string, unknown> = {},
): Promise<Record<string, unknown> | string> {
  const tool = toolNamed(createIconTools(handle), name);
  return (await tool.execute(input, {})) as Record<string, unknown> | string;
}

describe("the tool set", () => {
  it("registers exactly the four icon-page tools", () => {
    const names = createIconTools(fakeHandle().handle).map((tool) => tool.name);
    expect(names).toEqual(["get_icon", "style_icon", "get_icon_code", "download_icon"]);
  });

  it("marks the two reading tools read-only and the two acting ones not", () => {
    const tools = createIconTools(fakeHandle().handle);
    expect(toolNamed(tools, "get_icon").annotations?.readOnlyHint).toBe(true);
    expect(toolNamed(tools, "get_icon_code").annotations?.readOnlyHint).toBe(true);
    expect(toolNamed(tools, "style_icon").annotations?.readOnlyHint).toBeUndefined();
    expect(toolNamed(tools, "download_icon").annotations?.readOnlyHint).toBeUndefined();
  });

  it("bakes the buttons' own values into the style schema", () => {
    const style = toolNamed(createIconTools(fakeHandle().handle), "style_icon");
    const properties = style.inputSchema?.["properties"] as Record<
      string,
      Record<string, unknown>
    >;
    expect(properties["size"]?.["enum"]).toEqual([24, 48, 64, 128, 256, 512, 1024]);
    /* null first: "Original" is a real choice, not a missing value. */
    expect(properties["strokeWidth"]?.["enum"]).toEqual([null, 1, 1.5, 2, 2.5, 3]);
    expect(properties["rotate"]?.["enum"]).toEqual([0, 90, 180, 270]);
  });

  it("describes every tool and every input for an agent that has never seen the page", () => {
    for (const tool of createIconTools(fakeHandle().handle)) {
      expect(tool.description.length).toBeGreaterThan(120);
      const properties = (tool.inputSchema?.["properties"] ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      for (const [name, schema] of Object.entries(properties)) {
        expect(typeof schema["description"], `${tool.name}.${name}`).toBe("string");
      }
    }
  });
});

describe("get_icon", () => {
  it("reports identity, capability, live edits and the formats on offer", async () => {
    const fake = fakeHandle(T1, { activeFormat: "jsx" });
    const result = (await run(fake.handle, "get_icon")) as Record<string, unknown>;

    expect(result["name"]).toBe("star");
    expect(result["set"]).toBe("Tabler Icons");
    expect(result["prefix"]).toBe("tabler");
    expect(result["style"]).toBe("outline");
    expect(result["license"]).toBe("MIT");
    expect(result["attributionRequired"]).toBe(false);
    expect(result["currentEdits"]).toEqual(DEFAULT_EDITS);
    expect(result["availableFormats"]).toEqual(FORMATS);
    expect(result["activeFormat"]).toBe("jsx");
    expect(result["capability"]).toMatchObject({
      tier: "T1",
      canRecolor: true,
      canRetargetStroke: true,
      editable: ["size", "color", "strokeWidth", "rotate", "flipH", "flipV", "padding"],
    });
  });

  it("says what a ships-as-drawn icon can still do", async () => {
    const result = (await run(fakeHandle(T4).handle, "get_icon")) as Record<string, unknown>;
    expect(result["capability"]).toMatchObject({
      tier: "T4",
      canRecolor: false,
      canRetargetStroke: false,
      editable: ["size", "rotate", "flipH", "flipV", "padding"],
    });
  });

  it("passes an unsupported format through honestly instead of hiding it", async () => {
    const formats: IconFormat[] = [
      {
        id: "swiftui",
        label: "SwiftUI",
        kind: "code",
        supported: false,
        note: "This artwork uses masks or gradients.",
      },
    ];
    const result = (await run(fakeHandle(T4, { formats }).handle, "get_icon")) as Record<
      string,
      unknown
    >;
    expect(result["availableFormats"]).toEqual(formats);
  });
});

describe("style_icon", () => {
  it("applies every property in one call and reports the state the page settles on", async () => {
    const fake = fakeHandle();
    const result = (await run(fake.handle, "style_icon", {
      size: 256,
      color: "#f60",
      strokeWidth: 2.5,
      rotate: 90,
      flipH: true,
      flipV: true,
      padding: 0.1,
    })) as Record<string, unknown>;

    expect(fake.calls).toEqual([
      {
        method: "applyStyle",
        input: {
          size: 256,
          color: "#f60",
          strokeWidth: 2.5,
          rotate: 90,
          flipH: true,
          flipV: true,
          padding: 0.1,
        },
      },
    ]);
    expect(result["edits"]).toMatchObject({ size: 256, color: "#f60", rotate: 90 });
    expect(result["changed"]).toEqual([
      "size",
      "color",
      "strokeWidth",
      "rotate",
      "flipH",
      "flipV",
      "padding",
    ]);
  });

  it("leaves out what the agent left out", async () => {
    const fake = fakeHandle();
    await run(fake.handle, "style_icon", { color: "#000000" });
    expect(fake.calls[0]?.input).toEqual({ color: "#000000" });
  });

  it("takes null strokeWidth as the icon's original stroke", async () => {
    const fake = fakeHandle(T1, { edits: { ...DEFAULT_EDITS, strokeWidth: 3 } });
    const result = (await run(fake.handle, "style_icon", { strokeWidth: null })) as Record<
      string,
      unknown
    >;
    expect(fake.calls[0]?.input).toEqual({ strokeWidth: null });
    expect(result["edits"]).toMatchObject({ strokeWidth: null });
  });

  it("refuses a recolor on a ships-as-drawn icon, in the page's own words", async () => {
    const fake = fakeHandle(T4);
    const result = (await run(fake.handle, "style_icon", { color: "#ff0000" })) as Record<
      string,
      unknown
    >;
    expect(String(result["error"])).toContain("masks or gradients");
    expect(String(result["error"])).toContain("Nothing was changed");
    expect(String(result["error"])).toContain("size, rotate, flipH, flipV, padding");
    expect(fake.calls).toEqual([]);
  });

  it("still lets a ships-as-drawn icon be resized and turned", async () => {
    const fake = fakeHandle(T4);
    const result = (await run(fake.handle, "style_icon", {
      size: 512,
      rotate: 180,
    })) as Record<string, unknown>;
    expect(result["edits"]).toMatchObject({ size: 512, rotate: 180 });
    expect(fake.calls).toHaveLength(1);
  });

  it("refuses a stroke on artwork with no stroke to retarget", async () => {
    /* T2: recolors happily, but the artwork is expanded to filled shapes. */
    const fake = fakeHandle({
      ...T1,
      tier: "T2",
      label: "Recolor and resize",
      canRetargetStroke: false,
      strokeAbsentReason: T4.strokeAbsentReason,
    });
    const result = (await run(fake.handle, "style_icon", { strokeWidth: 2 })) as Record<
      string,
      unknown
    >;
    expect(String(result["error"])).toContain("no stroke to retarget");
    expect(fake.calls).toEqual([]);
  });

  it("refuses a size no button offers", async () => {
    const fake = fakeHandle();
    const result = (await run(fake.handle, "style_icon", { size: 137 })) as Record<
      string,
      unknown
    >;
    expect(String(result["error"])).toContain("24, 48, 64, 128, 256, 512, 1024");
    expect(fake.calls).toEqual([]);
  });

  it("refuses a stroke width no button offers", async () => {
    const fake = fakeHandle();
    const result = (await run(fake.handle, "style_icon", { strokeWidth: 7 })) as Record<
      string,
      unknown
    >;
    expect(String(result["error"])).toContain("1, 1.5, 2, 2.5, 3");
    expect(fake.calls).toEqual([]);
  });

  it("refuses a color that is not a hex value", async () => {
    const fake = fakeHandle();
    const result = (await run(fake.handle, "style_icon", { color: "cornflower" })) as Record<
      string,
      unknown
    >;
    expect(String(result["error"])).toContain("hex string");
    expect(fake.calls).toEqual([]);
  });

  it("takes both hex shapes the color control emits", async () => {
    for (const value of ["#f60", "#FF6600"]) {
      const fake = fakeHandle();
      await run(fake.handle, "style_icon", { color: value });
      expect(fake.calls[0]?.input).toEqual({ color: value });
    }
  });

  it("refuses a rotation that is not a quarter turn", async () => {
    const fake = fakeHandle();
    const result = (await run(fake.handle, "style_icon", { rotate: 45 })) as Record<
      string,
      unknown
    >;
    expect(String(result["error"])).toContain("0, 90, 180 or 270");
    expect(fake.calls).toEqual([]);
  });

  it("refuses a flip that is not a boolean", async () => {
    const fake = fakeHandle();
    const result = (await run(fake.handle, "style_icon", { flipH: "yes" })) as Record<
      string,
      unknown
    >;
    expect(String(result["error"])).toContain("flipH must be true or false");
    expect(fake.calls).toEqual([]);
  });

  it("refuses padding outside the range the transform honours", async () => {
    for (const value of [-0.1, 0.9, "wide"]) {
      const fake = fakeHandle();
      const result = (await run(fake.handle, "style_icon", { padding: value })) as Record<
        string,
        unknown
      >;
      expect(String(result["error"])).toContain("between 0 and 0.4");
      expect(fake.calls).toEqual([]);
    }
  });

  it("changes nothing at all when only part of the request is legal", async () => {
    const fake = fakeHandle();
    const result = (await run(fake.handle, "style_icon", {
      size: 256,
      rotate: 33,
    })) as Record<string, unknown>;
    expect(String(result["error"])).toContain("0, 90, 180 or 270");
    expect(fake.calls).toEqual([]);
    expect(fake.edits.size).toBe(128);
  });

  it("collects every problem in one reply rather than one per round trip", async () => {
    const result = (await run(fakeHandle(T4).handle, "style_icon", {
      color: "#fff",
      strokeWidth: 2,
      size: 3,
    })) as Record<string, unknown>;
    const error = String(result["error"]);
    expect(error).toContain("color is not editable");
    expect(error).toContain("strokeWidth is not editable");
    expect(error).toContain("size must be one of");
  });

  it("asks for a property when given none, and ignores keys it does not know", async () => {
    const fake = fakeHandle();
    for (const input of [{}, { sparkle: true }]) {
      const result = (await run(fake.handle, "style_icon", input)) as Record<string, unknown>;
      expect(String(result["error"])).toContain("needs at least one of");
    }
    expect(fake.calls).toEqual([]);
  });

  it("warns that a recolor is preview-only while CSS-styleable output is on", async () => {
    const fake = fakeHandle(T1, { edits: { ...DEFAULT_EDITS, cssStyleable: true } });
    const result = (await run(fake.handle, "style_icon", { color: "#123456" })) as Record<
      string,
      unknown
    >;
    expect(String(result["note"])).toContain("currentColor");
  });
});

describe("get_icon_code", () => {
  it("returns the code, its language and the format it came from", async () => {
    const fake = fakeHandle(T1, { code: { code: "struct Star {}", lang: "swift" } });
    const result = (await run(fake.handle, "get_icon_code", {
      format: "swiftui",
    })) as Record<string, unknown>;

    expect(fake.calls).toEqual([{ method: "code", input: "swiftui" }]);
    expect(result).toMatchObject({
      format: "swiftui",
      lang: "swift",
      code: "struct Star {}",
    });
  });

  it("passes the panel's own note through, and flags an unsupported format", async () => {
    const formats: IconFormat[] = [
      { id: "swiftui", label: "SwiftUI", kind: "code", supported: false },
    ];
    const fake = fakeHandle(T4, {
      formats,
      code: { code: "// no honest Path", lang: "swift", note: "masks or gradients" },
    });
    const result = (await run(fake.handle, "get_icon_code", {
      format: "swiftui",
    })) as Record<string, unknown>;
    expect(result["supported"]).toBe(false);
    expect(result["note"]).toBe("masks or gradients");
  });

  it("lists the valid formats when the one asked for is not one of them", async () => {
    const fake = fakeHandle();
    const result = (await run(fake.handle, "get_icon_code", { format: "webp" })) as Record<
      string,
      unknown
    >;
    expect(String(result["error"])).toContain("svg, png, swiftui, catalog");
    expect(fake.calls).toEqual([]);
  });

  it("sends a raster request to download_icon instead of inventing code", async () => {
    const fake = fakeHandle();
    const result = (await run(fake.handle, "get_icon_code", { format: "png" })) as Record<
      string,
      unknown
    >;
    expect(String(result["error"])).toContain("download_icon");
    expect(fake.calls).toEqual([]);
  });

  it("asks for a format when given none, rather than guessing one", async () => {
    const fake = fakeHandle();
    for (const input of [{}, { format: "  " }, { format: 12 }]) {
      const result = (await run(fake.handle, "get_icon_code", input)) as Record<
        string,
        unknown
      >;
      expect(String(result["error"])).toContain("needs a format");
    }
    expect(fake.calls).toEqual([]);
  });

  it("reads the asset catalog tab, which is files rather than a code export", async () => {
    const fake = fakeHandle(T1, { code: { code: "{ }", lang: "json" } });
    const result = (await run(fake.handle, "get_icon_code", {
      format: "catalog",
    })) as Record<string, unknown>;
    expect(result).toMatchObject({ format: "catalog", lang: "json" });
  });
});

describe("download_icon", () => {
  it("downloads the format asked for and says what it saved", async () => {
    const fake = fakeHandle();
    const result = await run(fake.handle, "download_icon", { format: "png" });
    expect(fake.calls).toEqual([{ method: "download", input: "png" }]);
    expect(String(result)).toContain("tabler:star");
    expect(String(result)).toContain("PNG");
    expect(String(result)).toContain("/api/export/tabler/star?format=png");
  });

  it("falls back to the tab the human is looking at", async () => {
    const fake = fakeHandle(T1, { activeFormat: "swiftui" });
    await run(fake.handle, "download_icon", {});
    expect(fake.calls).toEqual([{ method: "download", input: "swiftui" }]);
  });

  it("refuses a format this icon does not offer, and downloads nothing", async () => {
    const fake = fakeHandle();
    const result = (await run(fake.handle, "download_icon", { format: "ico" })) as Record<
      string,
      unknown
    >;
    expect(String(result["error"])).toContain("svg, png, swiftui, catalog");
    expect(fake.calls).toEqual([]);
  });
});

describe("editableProperties", () => {
  it("is the one list every refusal quotes", () => {
    expect(editableProperties(T1)).toEqual([
      "size",
      "color",
      "strokeWidth",
      "rotate",
      "flipH",
      "flipV",
      "padding",
    ]);
    expect(editableProperties(T4)).toEqual(["size", "rotate", "flipH", "flipV", "padding"]);
  });
});
