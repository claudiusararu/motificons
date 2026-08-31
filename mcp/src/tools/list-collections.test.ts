import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../../app/src/db/client";
import type { CollectionDTO } from "../../../app/src/lib/workspace/collections";
import type { CollectionStyleSettingsDTO } from "../../../app/src/lib/workspace/collection-style";
import type { MotificonsAuthExtra } from "../auth";

const dbMock = vi.fn<() => Promise<Database>>();
vi.mock("../../../app/src/db/client", () => ({ db: () => dbMock() }));

const listCollectionsMock = vi.fn<(database: Database, workspaceId: string) => Promise<CollectionDTO[]>>();
vi.mock("../../../app/src/lib/workspace/collections", () => ({
  listCollections: (database: Database, workspaceId: string) => listCollectionsMock(database, workspaceId),
}));

const countIconsInCollectionMock = vi.fn<(database: Database, collectionId: string) => Promise<number>>();
vi.mock("../../../app/src/lib/workspace/collection-items", () => ({
  countIconsInCollection: (database: Database, collectionId: string) => countIconsInCollectionMock(database, collectionId),
}));

const getCollectionStyleSettingsMock =
  vi.fn<(database: Database, workspaceId: string, collectionId: string) => Promise<CollectionStyleSettingsDTO | null>>();
vi.mock("../../../app/src/lib/workspace/collection-style", () => ({
  getCollectionStyleSettings: (database: Database, workspaceId: string, collectionId: string) =>
    getCollectionStyleSettingsMock(database, workspaceId, collectionId),
}));

const { runListCollections } = await import("./list-collections");

const DB = {} as Database;
const EXTRA: MotificonsAuthExtra = { userId: "u1", workspaceId: "ws-1", keyId: "k1" };

function collection(id: string, name: string): CollectionDTO {
  return { id, name, createdAt: new Date(0).toISOString() };
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

beforeEach(() => {
  dbMock.mockReset().mockResolvedValue(DB);
  listCollectionsMock.mockReset();
  countIconsInCollectionMock.mockReset();
  getCollectionStyleSettingsMock.mockReset();
});

describe("runListCollections", () => {
  it("scopes to the caller's own workspace", async () => {
    listCollectionsMock.mockResolvedValue([]);
    await runListCollections(EXTRA);
    expect(listCollectionsMock).toHaveBeenCalledWith(DB, "ws-1");
  });

  it("returns id/name/iconCount/style per collection, styled via summarizeCollectionStyles", async () => {
    listCollectionsMock.mockResolvedValue([collection("col-1", "Icons"), collection("col-2", "Logos")]);
    countIconsInCollectionMock.mockResolvedValueOnce(3).mockResolvedValueOnce(0);
    getCollectionStyleSettingsMock
      .mockResolvedValueOnce(style({ color: "#f783ac", strokeWidth: 1.5 }))
      .mockResolvedValueOnce(null);

    const output = await runListCollections(EXTRA);
    const [content] = output.content;
    if (content?.type !== "text") throw new Error("expected text content");
    const parsed = JSON.parse(content.text) as {
      collections: { id: string; name: string; iconCount: number; style: string }[];
    };

    expect(parsed.collections).toEqual([
      {
        id: "col-1",
        name: "Icons",
        iconCount: 3,
        style: "Icons export with this collection's look: color #f783ac, stroke width 1.5.",
      },
      {
        id: "col-2",
        name: "Logos",
        iconCount: 0,
        style: "Icons export exactly as they look in the library - no collection styles applied.",
      },
    ]);
  });

  it("returns an empty list, not an error, for a caller with no collections", async () => {
    listCollectionsMock.mockResolvedValue([]);
    const output = await runListCollections(EXTRA);
    const [content] = output.content;
    if (content?.type !== "text") throw new Error("expected text content");
    expect(JSON.parse(content.text)).toEqual({ collections: [] });
    expect(output.isError).toBeUndefined();
  });
});
