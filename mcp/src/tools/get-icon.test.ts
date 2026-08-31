import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IconSource, SetMetadata } from "../../../app/src/lib/data";
import type { SwiftUiResult } from "../../../app/src/lib/transforms";

const getIconMock = vi.fn<(prefix: string, name: string) => Promise<IconSource | null>>();
const getSetMock = vi.fn<(prefix: string) => Promise<SetMetadata | null>>();
vi.mock("../../../app/src/lib/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../app/src/lib/data")>();
  return { ...actual, getIcon: getIconMock, getSet: getSetMock };
});

const buildSvgMock = vi.fn(() => "<svg>mock</svg>");
const toJsxComponentMock = vi.fn(() => "const Icon = () => null;");
const toVueComponentMock = vi.fn(() => "<template />");
const toSvelteComponentMock = vi.fn(() => "<svelte />");
const toSwiftUiMock = vi.fn<() => SwiftUiResult>(() => ({
  kind: "shape",
  typeName: "Icon",
  code: "struct Icon {}",
}));
const toPngMock = vi.fn(async () => new Uint8Array([137, 80, 78, 71]));

vi.mock("../../../app/src/lib/transforms", () => ({
  buildSvg: buildSvgMock,
  toJsxComponent: toJsxComponentMock,
  toVueComponent: toVueComponentMock,
  toSvelteComponent: toSvelteComponentMock,
  toSwiftUi: toSwiftUiMock,
  toPng: toPngMock,
}));

const { runGetIcon } = await import("./get-icon");

const ICON: IconSource = { prefix: "tabler", name: "arrow-right", body: "<path/>", width: 24, height: 24 };
const SET = { tier: "T1" } as SetMetadata;

beforeEach(() => {
  getIconMock.mockReset();
  getSetMock.mockReset();
  buildSvgMock.mockClear();
  toPngMock.mockClear();
});

describe("runGetIcon - id validation (no lookup)", () => {
  it("rejects an id with no ':' separator", async () => {
    const result = await runGetIcon({ id: "not-an-id", format: "svg" });
    expect(result.isError).toBe(true);
    expect(getIconMock).not.toHaveBeenCalled();
  });

  it("rejects an id with unsafe segments", async () => {
    const result = await runGetIcon({ id: "../etc:passwd", format: "svg" });
    expect(result.isError).toBe(true);
    expect(getIconMock).not.toHaveBeenCalled();
  });
});

describe("runGetIcon - not found", () => {
  it("returns a helpful error, not a crash, for an unknown icon", async () => {
    getIconMock.mockResolvedValue(null);
    getSetMock.mockResolvedValue(SET);

    const result = await runGetIcon({ id: "tabler:does-not-exist", format: "svg" });
    expect(result.isError).toBe(true);
    const [content] = result.content;
    if (content?.type !== "text") throw new Error("expected text content");
    expect(content.text).toContain("search_icons");
  });
});

describe("runGetIcon - format dispatch", () => {
  beforeEach(() => {
    getIconMock.mockResolvedValue(ICON);
    getSetMock.mockResolvedValue(SET);
  });

  it("defaults to svg and returns text content", async () => {
    const result = await runGetIcon({ id: "tabler:arrow-right", format: "svg" });
    expect(buildSvgMock).toHaveBeenCalledWith(ICON, { size: undefined, color: undefined, strokeWidth: undefined }, "T1");
    expect(result.content).toEqual([{ type: "text", text: "<svg>mock</svg>" }]);
  });

  it("passes color/size/stroke through as IconEdits", async () => {
    await runGetIcon({ id: "tabler:arrow-right", format: "svg", color: "#183153", size: 32, stroke: 1.5 });
    expect(buildSvgMock).toHaveBeenCalledWith(
      ICON,
      { size: 32, color: "#183153", strokeWidth: 1.5 },
      "T1",
    );
  });

  it("returns swiftui code verbatim, including an honest refusal", async () => {
    toSwiftUiMock.mockReturnValueOnce({
      kind: "unsupported",
      typeName: "Icon",
      reason: "mask",
      code: "// cannot be expressed as a SwiftUI Path",
    });
    const result = await runGetIcon({ id: "tabler:arrow-right", format: "swiftui" });
    const [content] = result.content;
    if (content?.type !== "text") throw new Error("expected text content");
    expect(content.text).toContain("cannot be expressed as a SwiftUI Path");
    expect(result.isError).toBeUndefined();
  });

  it("returns png as base64 image content", async () => {
    const result = await runGetIcon({ id: "tabler:arrow-right", format: "png", size: 64 });
    expect(toPngMock).toHaveBeenCalledWith(ICON, { size: 64, color: undefined, strokeWidth: undefined }, "T1", 64);
    expect(result.content).toEqual([
      { type: "image", data: expect.any(String), mimeType: "image/png" },
    ]);
  });
});
