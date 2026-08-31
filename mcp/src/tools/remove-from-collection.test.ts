import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../../app/src/db/client";
import type { MotificonsAuthExtra } from "../auth";
import type { ResolveCollectionResult } from "./collection-shared";

const dbMock = vi.fn<() => Promise<Database>>();
vi.mock("../../../app/src/db/client", () => ({ db: () => dbMock() }));

const removeIconFromCollectionMock =
  vi.fn<(database: Database, workspaceId: string, collectionId: string, iconId: string) => Promise<boolean>>();
const countIconsInCollectionMock = vi.fn<(database: Database, collectionId: string) => Promise<number>>();
vi.mock("../../../app/src/lib/workspace/collection-items", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../app/src/lib/workspace/collection-items")>();
  return {
    ...actual,
    removeIconFromCollection: (database: Database, workspaceId: string, collectionId: string, iconId: string) =>
      removeIconFromCollectionMock(database, workspaceId, collectionId, iconId),
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

const { runRemoveFromCollection } = await import("./remove-from-collection");
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
  removeIconFromCollectionMock.mockReset();
  countIconsInCollectionMock.mockReset();
  resolveCollectionMock.mockReset();
});

describe("runRemoveFromCollection", () => {
  it("propagates a collection-resolution failure verbatim", async () => {
    const failure = errorResult('No collection named "Nope" was found.');
    resolveCollectionMock.mockResolvedValue({ ok: false, result: failure });

    const result = await runRemoveFromCollection({ collection: "Nope", icon_id: "tabler:star" }, EXTRA);
    expect(result).toBe(failure);
    expect(removeIconFromCollectionMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed icon id before touching the DB", async () => {
    resolveCollectionMock.mockResolvedValue({ ok: true, collection: COLLECTION });

    const result = await runRemoveFromCollection({ collection: "Icons", icon_id: "not-an-id" }, EXTRA);
    expect(result.isError).toBe(true);
    expect(removeIconFromCollectionMock).not.toHaveBeenCalled();
  });

  it("removes the icon and returns the new count", async () => {
    resolveCollectionMock.mockResolvedValue({ ok: true, collection: COLLECTION });
    removeIconFromCollectionMock.mockResolvedValue(true);
    countIconsInCollectionMock.mockResolvedValue(2);

    const result = await runRemoveFromCollection({ collection: "Icons", icon_id: "tabler:star" }, EXTRA);
    expect(removeIconFromCollectionMock).toHaveBeenCalledWith(DB, "ws-1", "col-1", "tabler:star");
    expect(JSON.parse(textOf(result))).toEqual({
      removed: true,
      collection: { id: "col-1", name: "Icons" },
      iconCount: 2,
    });
    expect(result.isError).toBeUndefined();
  });

  it("removing an icon that was never saved is still a success (idempotent)", async () => {
    resolveCollectionMock.mockResolvedValue({ ok: true, collection: COLLECTION });
    removeIconFromCollectionMock.mockResolvedValue(true);
    countIconsInCollectionMock.mockResolvedValue(0);

    const result = await runRemoveFromCollection({ collection: "Icons", icon_id: "tabler:never-saved" }, EXTRA);
    expect(result.isError).toBeUndefined();
  });

  it("surfaces a not-found error only when the collection itself is gone", async () => {
    resolveCollectionMock.mockResolvedValue({ ok: true, collection: COLLECTION });
    removeIconFromCollectionMock.mockResolvedValue(false);

    const result = await runRemoveFromCollection({ collection: "Icons", icon_id: "tabler:star" }, EXTRA);
    expect(result.isError).toBe(true);
    expect(countIconsInCollectionMock).not.toHaveBeenCalled();
  });
});
