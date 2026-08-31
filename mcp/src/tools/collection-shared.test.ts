import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../../app/src/db/client";
import type { CollectionDTO } from "../../../app/src/lib/workspace/collections";

const listCollectionsMock = vi.fn<(database: Database, workspaceId: string) => Promise<CollectionDTO[]>>();
vi.mock("../../../app/src/lib/workspace/collections", () => ({
  listCollections: (database: Database, workspaceId: string) => listCollectionsMock(database, workspaceId),
}));

const { resolveCollection, errorResult, missingAuthExtraResult } = await import("./collection-shared");

const DB = {} as Database;

function collection(id: string, name: string): CollectionDTO {
  return { id, name, createdAt: new Date(0).toISOString() };
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
  const [content] = result.content;
  if (content?.type !== "text" || content.text === undefined) throw new Error("expected text content");
  return content.text;
}

beforeEach(() => {
  listCollectionsMock.mockReset();
});

describe("resolveCollection", () => {
  it("matches by exact id, even if the id happens to look like a name", async () => {
    const target = collection("col-1", "Icons");
    listCollectionsMock.mockResolvedValue([collection("col-0", "Other"), target]);

    const result = await resolveCollection(DB, "ws-1", "col-1");
    expect(result).toEqual({ ok: true, collection: target });
  });

  it("matches by case-insensitive exact name", async () => {
    const target = collection("col-1", "Tab Bar Icons");
    listCollectionsMock.mockResolvedValue([target]);

    const result = await resolveCollection(DB, "ws-1", "tab bar icons");
    expect(result).toEqual({ ok: true, collection: target });
  });

  it("trims surrounding whitespace before matching", async () => {
    const target = collection("col-1", "Icons");
    listCollectionsMock.mockResolvedValue([target]);

    const result = await resolveCollection(DB, "ws-1", "  Icons  ");
    expect(result).toEqual({ ok: true, collection: target });
  });

  it("errors with the caller's collection names when nothing matches", async () => {
    listCollectionsMock.mockResolvedValue([collection("col-1", "Icons"), collection("col-2", "Logos")]);

    const result = await resolveCollection(DB, "ws-1", "Nope");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.result.isError).toBe(true);
    const text = textOf(result.result);
    expect(text).toContain('No collection named "Nope"');
    expect(text).toContain('"Icons"');
    expect(text).toContain('"Logos"');
  });

  it("errors with a create-one hint when the caller has no collections at all", async () => {
    listCollectionsMock.mockResolvedValue([]);

    const result = await resolveCollection(DB, "ws-1", "Anything");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(textOf(result.result)).toContain("don't have any collections yet");
  });

  it("errors as ambiguous when two collections share a name, listing them for disambiguation by id", async () => {
    listCollectionsMock.mockResolvedValue([collection("col-1", "Icons"), collection("col-2", "Icons")]);

    const result = await resolveCollection(DB, "ws-1", "icons");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(textOf(result.result)).toContain("More than one collection is named");
  });

  it("errors on blank/whitespace-only input without matching anything", async () => {
    listCollectionsMock.mockResolvedValue([collection("col-1", "Icons")]);

    const result = await resolveCollection(DB, "ws-1", "   ");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(textOf(result.result)).toContain("Provide a collection name or id");
  });

  it("scopes to the given workspaceId, never leaking another workspace's collections", async () => {
    listCollectionsMock.mockResolvedValue([]);
    await resolveCollection(DB, "ws-mine", "Icons");
    expect(listCollectionsMock).toHaveBeenCalledWith(DB, "ws-mine");
  });
});

describe("errorResult / missingAuthExtraResult", () => {
  it("errorResult marks the tool result as an error with the given message", () => {
    const result = errorResult("boom");
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("boom");
  });

  it("missingAuthExtraResult is a plain-language error, not a crash", () => {
    const result = missingAuthExtraResult();
    expect(result.isError).toBe(true);
    expect(textOf(result).length).toBeGreaterThan(0);
  });
});
