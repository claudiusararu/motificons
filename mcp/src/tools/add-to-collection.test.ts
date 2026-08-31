import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../../app/src/db/client";
import type { AddIconResult } from "../../../app/src/lib/workspace/collection-items";
import type { MotificonsAuthExtra } from "../auth";
import type { ResolveCollectionResult } from "./collection-shared";

const dbMock = vi.fn<() => Promise<Database>>();
vi.mock("../../../app/src/db/client", () => ({ db: () => dbMock() }));

const addIconToCollectionMock =
  vi.fn<(database: Database, workspaceId: string, collectionId: string, iconId: string) => Promise<AddIconResult>>();
const countIconsInCollectionMock = vi.fn<(database: Database, collectionId: string) => Promise<number>>();
vi.mock("../../../app/src/lib/workspace/collection-items", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../app/src/lib/workspace/collection-items")>();
  return {
    ...actual,
    addIconToCollection: (database: Database, workspaceId: string, collectionId: string, iconId: string) =>
      addIconToCollectionMock(database, workspaceId, collectionId, iconId),
    countIconsInCollection: (database: Database, collectionId: string) => countIconsInCollectionMock(database, collectionId),
  };
});

const resolveCollectionMock = vi.fn<(database: Database, workspaceId: string, nameOrId: string) => Promise<ResolveCollectionResult>>();
vi.mock("./collection-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./collection-shared")>();
  return {
    ...actual,
    resolveCollection: (database: Database, workspaceId: string, nameOrId: string) =>
      resolveCollectionMock(database, workspaceId, nameOrId),
  };
});

const { runAddToCollection } = await import("./add-to-collection");
const { errorResult } = await import("./collection-shared");

const DB = {} as Database;
const EXTRA: MotificonsAuthExtra = { userId: "u1", workspaceId: "ws-1", keyId: "k1" };
const COLLECTION = { id: "col-1", name: "Icons", createdAt: new Date(0).toISOString() };

function textOf(result: { content: { type: string; text?: string }[] }): string {
  const [content] = result.content;
  if (content?.type !== "text" || content.text === undefined) throw new Error("expected text content");
  return content.text;
}

beforeEach(() => {
  dbMock.mockReset().mockResolvedValue(DB);
  addIconToCollectionMock.mockReset();
  countIconsInCollectionMock.mockReset();
  resolveCollectionMock.mockReset();
});

describe("runAddToCollection", () => {
  it("propagates a collection-resolution failure verbatim", async () => {
    const failure = errorResult('No collection named "Nope" was found.');
    resolveCollectionMock.mockResolvedValue({ ok: false, result: failure });

    const result = await runAddToCollection({ collection: "Nope", icon_id: "tabler:star" }, EXTRA);
    expect(result).toBe(failure);
    expect(addIconToCollectionMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed icon id before touching the DB", async () => {
    resolveCollectionMock.mockResolvedValue({ ok: true, collection: COLLECTION });

    const result = await runAddToCollection({ collection: "Icons", icon_id: "not-an-id" }, EXTRA);
    expect(result.isError).toBe(true);
    expect(addIconToCollectionMock).not.toHaveBeenCalled();
  });

  it("adds the icon and returns the new count", async () => {
    resolveCollectionMock.mockResolvedValue({ ok: true, collection: COLLECTION });
    addIconToCollectionMock.mockResolvedValue({
      ok: true,
      item: { id: "item-1", collectionId: "col-1", iconId: "tabler:star", createdAt: new Date(0).toISOString() },
    });
    countIconsInCollectionMock.mockResolvedValue(4);

    const result = await runAddToCollection({ collection: "Icons", icon_id: "tabler:star" }, EXTRA);
    expect(addIconToCollectionMock).toHaveBeenCalledWith(DB, "ws-1", "col-1", "tabler:star");
    expect(JSON.parse(textOf(result))).toEqual({
      added: true,
      collection: { id: "col-1", name: "Icons" },
      iconCount: 4,
    });
    expect(result.isError).toBeUndefined();
  });

  it("adding an already-saved icon is still a success (idempotent)", async () => {
    resolveCollectionMock.mockResolvedValue({ ok: true, collection: COLLECTION });
    addIconToCollectionMock.mockResolvedValue({
      ok: true,
      item: { id: "item-1", collectionId: "col-1", iconId: "tabler:star", createdAt: new Date(0).toISOString() },
    });
    countIconsInCollectionMock.mockResolvedValue(1);

    const result = await runAddToCollection({ collection: "Icons", icon_id: "tabler:star" }, EXTRA);
    expect(result.isError).toBeUndefined();
  });

  it("surfaces a not-found error if the collection vanished between resolve and write", async () => {
    resolveCollectionMock.mockResolvedValue({ ok: true, collection: COLLECTION });
    addIconToCollectionMock.mockResolvedValue({ ok: false, reason: "not-found" });

    const result = await runAddToCollection({ collection: "Icons", icon_id: "tabler:star" }, EXTRA);
    expect(result.isError).toBe(true);
    expect(countIconsInCollectionMock).not.toHaveBeenCalled();
  });
});
