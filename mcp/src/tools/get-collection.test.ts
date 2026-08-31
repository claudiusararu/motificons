import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../../app/src/db/client";
import type { IconSource, SetMetadata } from "../../../app/src/lib/data";
import type { CollectionItemDTO } from "../../../app/src/lib/workspace/collection-items";
import type { CollectionStyleSettingsDTO } from "../../../app/src/lib/workspace/collection-style";
import type { SwiftUiResult } from "../../../app/src/lib/transforms";
import type { MotificonsAuthExtra } from "../auth";
import type { ResolveCollectionResult } from "./collection-shared";

const dbMock = vi.fn<() => Promise<Database>>();
vi.mock("../../../app/src/db/client", () => ({ db: () => dbMock() }));

const listCollectionItemsMock = vi.fn<(database: Database, collectionId: string) => Promise<CollectionItemDTO[]>>();
vi.mock("../../../app/src/lib/workspace/collection-items", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../app/src/lib/workspace/collection-items")>();
  return {
    ...actual,
    listCollectionItems: (database: Database, collectionId: string) => listCollectionItemsMock(database, collectionId),
  };
});

const getCollectionStyleSettingsMock =
  vi.fn<(database: Database, workspaceId: string, collectionId: string) => Promise<CollectionStyleSettingsDTO | null>>();
vi.mock("../../../app/src/lib/workspace/collection-style", () => ({
  getCollectionStyleSettings: (database: Database, workspaceId: string, collectionId: string) =>
    getCollectionStyleSettingsMock(database, workspaceId, collectionId),
}));

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
const toSwiftUiMock = vi.fn<() => SwiftUiResult>(() => ({ kind: "shape", typeName: "Icon", code: "struct Icon {}" }));
const toPngMock = vi.fn(async () => new Uint8Array([137, 80, 78, 71]));
const toBase64DataUriMock = vi.fn((svg: string) => `data:image/svg+xml;base64,MOCK(${svg})`);
vi.mock("../../../app/src/lib/transforms", () => ({
  buildSvg: buildSvgMock,
  toJsxComponent: toJsxComponentMock,
  toVueComponent: toVueComponentMock,
  toSvelteComponent: toSvelteComponentMock,
  toSwiftUi: toSwiftUiMock,
  toPng: toPngMock,
  toBase64DataUri: toBase64DataUriMock,
}));

const resolveCollectionMock = vi.fn<(database: Database, workspaceId: string, nameOrId: string) => Promise<ResolveCollectionResult>>();
vi.mock("./collection-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./collection-shared")>();
  return {
    ...actual,
    resolveCollection: (database: Database, workspaceId: string, nameOrId: string) =>
      resolveCollectionMock(database, workspaceId, nameOrId),
  };
});

const { runGetCollection, MAX_COLLECTION_ICONS } = await import("./get-collection");
const { errorResult } = await import("./collection-shared");

const DB = {} as Database;
const EXTRA: MotificonsAuthExtra = { userId: "u1", workspaceId: "ws-1", keyId: "k1" };
const COLLECTION = { id: "col-1", name: "Icons", createdAt: new Date(0).toISOString() };

const ICON: IconSource = { prefix: "tabler", name: "arrow-right", body: "<path/>", width: 24, height: 24 };
const SET = { tier: "T1", name: "Tabler Icons" } as SetMetadata;

function item(iconId: string): CollectionItemDTO {
  return { id: `item-${iconId}`, collectionId: "col-1", iconId, createdAt: new Date(0).toISOString() };
}

function style(overrides: Partial<CollectionStyleSettingsDTO> = {}): CollectionStyleSettingsDTO {
  return {
    collectionId: "col-1",
    anchorIconId: null,
    computedTargets: null,
    color: null,
    strokeWidth: null,
    size: null,
    exportFormat: "svg",
    updatedAt: null,
    ...overrides,
  };
}

function bodyOf(result: { content: { type: string; text?: string }[] }): Record<string, unknown> {
  const [content] = result.content;
  if (content?.type !== "text" || content.text === undefined) throw new Error("expected text content");
  return JSON.parse(content.text) as Record<string, unknown>;
}

beforeEach(() => {
  dbMock.mockReset().mockResolvedValue(DB);
  listCollectionItemsMock.mockReset();
  getCollectionStyleSettingsMock.mockReset();
  getIconMock.mockReset().mockResolvedValue(ICON);
  getSetMock.mockReset().mockResolvedValue(SET);
  buildSvgMock.mockClear();
  toPngMock.mockClear();
  resolveCollectionMock.mockReset();
});

describe("runGetCollection", () => {
  it("propagates a collection-resolution failure verbatim", async () => {
    const failure = errorResult('No collection named "Nope" was found.');
    resolveCollectionMock.mockResolvedValue({ ok: false, result: failure });

    const result = await runGetCollection({ collection: "Nope", limit: MAX_COLLECTION_ICONS }, EXTRA);
    expect(result).toBe(failure);
    expect(listCollectionItemsMock).not.toHaveBeenCalled();
  });

  it("renders every icon as svg with no style settings saved yet", async () => {
    resolveCollectionMock.mockResolvedValue({ ok: true, collection: COLLECTION });
    listCollectionItemsMock.mockResolvedValue([item("tabler:arrow-right")]);
    getCollectionStyleSettingsMock.mockResolvedValue(null);

    const result = await runGetCollection({ collection: "Icons", limit: MAX_COLLECTION_ICONS }, EXTRA);
    const body = bodyOf(result);

    expect(body.format).toBe("svg");
    expect(body.totalIcons).toBe(1);
    expect(body.returned).toBe(1);
    expect(body.truncated).toBe(false);
    expect(body.icons).toEqual([
      { id: "tabler:arrow-right", name: "arrow-right", set: "Tabler Icons", code: "<svg>mock</svg>" },
    ]);
    expect(buildSvgMock).toHaveBeenCalledWith(ICON, { color: undefined, strokeWidth: undefined, size: undefined }, "T1");
  });

  it("applies the collection's saved color/stroke/size to every rendered icon", async () => {
    resolveCollectionMock.mockResolvedValue({ ok: true, collection: COLLECTION });
    listCollectionItemsMock.mockResolvedValue([item("tabler:arrow-right")]);
    getCollectionStyleSettingsMock.mockResolvedValue(
      style({ color: "#183153", strokeWidth: 1.5, size: 32, exportFormat: "svg" }),
    );

    await runGetCollection({ collection: "Icons", limit: MAX_COLLECTION_ICONS }, EXTRA);

    expect(buildSvgMock).toHaveBeenCalledWith(ICON, { color: "#183153", strokeWidth: 1.5, size: 32 }, "T1");
  });

  it("renders png as base64 image data, defaulting size to 512", async () => {
    resolveCollectionMock.mockResolvedValue({ ok: true, collection: COLLECTION });
    listCollectionItemsMock.mockResolvedValue([item("tabler:arrow-right")]);
    getCollectionStyleSettingsMock.mockResolvedValue(style({ exportFormat: "png" }));

    const result = await runGetCollection({ collection: "Icons", limit: MAX_COLLECTION_ICONS }, EXTRA);
    const body = bodyOf(result);

    expect(toPngMock).toHaveBeenCalledWith(ICON, { color: undefined, strokeWidth: undefined, size: 512 }, "T1", 512);
    expect(body.icons).toEqual([
      { id: "tabler:arrow-right", name: "arrow-right", set: "Tabler Icons", data: expect.any(String), mimeType: "image/png" },
    ]);
  });

  it("downgrades a remembered \"catalog\" format to svg with an honest formatNote", async () => {
    resolveCollectionMock.mockResolvedValue({ ok: true, collection: COLLECTION });
    listCollectionItemsMock.mockResolvedValue([item("tabler:arrow-right")]);
    getCollectionStyleSettingsMock.mockResolvedValue(style({ exportFormat: "catalog" }));

    const result = await runGetCollection({ collection: "Icons", limit: MAX_COLLECTION_ICONS }, EXTRA);
    const body = bodyOf(result);

    expect(body.format).toBe("svg");
    expect(String(body.formatNote)).toContain("catalog");
    expect(buildSvgMock).toHaveBeenCalled();
  });

  it("renders datauri as a compact data: string via toBase64DataUri", async () => {
    resolveCollectionMock.mockResolvedValue({ ok: true, collection: COLLECTION });
    listCollectionItemsMock.mockResolvedValue([item("tabler:arrow-right")]);
    getCollectionStyleSettingsMock.mockResolvedValue(style({ exportFormat: "datauri" }));

    const result = await runGetCollection({ collection: "Icons", limit: MAX_COLLECTION_ICONS }, EXTRA);
    const body = bodyOf(result);

    expect(toBase64DataUriMock).toHaveBeenCalled();
    const [icon] = body.icons as { code: string }[];
    if (!icon) throw new Error("expected one rendered icon");
    expect(icon.code).toContain("data:image/svg+xml;base64,");
  });

  it("truncates to the requested limit and reports totalIcons/returned/truncated honestly", async () => {
    resolveCollectionMock.mockResolvedValue({ ok: true, collection: COLLECTION });
    listCollectionItemsMock.mockResolvedValue([
      item("tabler:one"),
      item("tabler:two"),
      item("tabler:three"),
    ]);
    getCollectionStyleSettingsMock.mockResolvedValue(null);

    const result = await runGetCollection({ collection: "Icons", limit: 2 }, EXTRA);
    const body = bodyOf(result);

    expect(body.totalIcons).toBe(3);
    expect(body.returned).toBe(2);
    expect(body.truncated).toBe(true);
    expect((body.icons as unknown[]).length).toBe(2);
  });

  it("reports a saved icon whose set left the pipeline as an honest per-icon error, not a crash", async () => {
    resolveCollectionMock.mockResolvedValue({ ok: true, collection: COLLECTION });
    listCollectionItemsMock.mockResolvedValue([item("ghost:icon")]);
    getCollectionStyleSettingsMock.mockResolvedValue(null);
    getIconMock.mockResolvedValueOnce(null);
    getSetMock.mockResolvedValueOnce(null);

    const result = await runGetCollection({ collection: "Icons", limit: MAX_COLLECTION_ICONS }, EXTRA);
    const body = bodyOf(result);

    expect(body.icons).toEqual([
      { id: "ghost:icon", name: "icon", set: null, error: "This icon's set is no longer available." },
    ]);
  });

  it("returns swiftui code verbatim, including an honest refusal, same as get_icon", async () => {
    resolveCollectionMock.mockResolvedValue({ ok: true, collection: COLLECTION });
    listCollectionItemsMock.mockResolvedValue([item("tabler:arrow-right")]);
    getCollectionStyleSettingsMock.mockResolvedValue(style({ exportFormat: "swiftui" }));
    toSwiftUiMock.mockReturnValueOnce({
      kind: "unsupported",
      typeName: "Icon",
      reason: "mask",
      code: "// cannot be expressed as a SwiftUI Path",
    });

    const result = await runGetCollection({ collection: "Icons", limit: MAX_COLLECTION_ICONS }, EXTRA);
    const body = bodyOf(result);
    const [icon] = body.icons as { code: string }[];
    if (!icon) throw new Error("expected one rendered icon");
    expect(icon.code).toContain("cannot be expressed as a SwiftUI Path");
  });
});
