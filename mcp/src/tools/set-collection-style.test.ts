import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../../app/src/db/client";
import type {
  CollectionStyleSettingsDTO,
  SaveStyleSettingsResult,
} from "../../../app/src/lib/workspace/collection-style";
import type { MotificonsAuthExtra } from "../auth";
import type { ResolveCollectionResult } from "./collection-shared";

const dbMock = vi.fn<() => Promise<Database>>();
vi.mock("../../../app/src/db/client", () => ({ db: () => dbMock() }));

const getCollectionStyleSettingsMock =
  vi.fn<(database: Database, workspaceId: string, collectionId: string) => Promise<CollectionStyleSettingsDTO | null>>();
const saveCollectionStyleSettingsMock = vi.fn<
  (
    database: Database,
    workspaceId: string,
    collectionId: string,
    input: { anchorIconId: string | null; color: string | null; strokeWidth: number | null; size: number | null; exportFormat: string },
  ) => Promise<SaveStyleSettingsResult>
>();
vi.mock("../../../app/src/lib/workspace/collection-style", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../app/src/lib/workspace/collection-style")>();
  return {
    ...actual,
    getCollectionStyleSettings: (database: Database, workspaceId: string, collectionId: string) =>
      getCollectionStyleSettingsMock(database, workspaceId, collectionId),
    saveCollectionStyleSettings: (
      database: Database,
      workspaceId: string,
      collectionId: string,
      input: {
        anchorIconId: string | null;
        color: string | null;
        strokeWidth: number | null;
        size: number | null;
        exportFormat: string;
      },
    ) => saveCollectionStyleSettingsMock(database, workspaceId, collectionId, input),
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

const { runSetCollectionStyle } = await import("./set-collection-style");
const { errorResult } = await import("./collection-shared");

const DB = {} as Database;
const EXTRA: MotificonsAuthExtra = { userId: "u1", workspaceId: "ws-1", keyId: "k1" };
const COLLECTION = { id: "col-1", name: "Icons", createdAt: new Date(0).toISOString() };

function currentSettings(overrides: Partial<CollectionStyleSettingsDTO> = {}): CollectionStyleSettingsDTO {
  return {
    collectionId: "col-1",
    anchorIconId: "tabler:star",
    computedTargets: null,
    color: "#111111",
    strokeWidth: 1,
    size: 24,
    exportFormat: "svg",
    updatedAt: null,
    ...overrides,
  };
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
  const [content] = result.content;
  if (content?.type !== "text" || content.text === undefined) throw new Error("expected text content");
  return content.text;
}

function saved(settings: CollectionStyleSettingsDTO): SaveStyleSettingsResult {
  return { ok: true, settings };
}

beforeEach(() => {
  dbMock.mockReset().mockResolvedValue(DB);
  getCollectionStyleSettingsMock.mockReset();
  saveCollectionStyleSettingsMock.mockReset();
  resolveCollectionMock.mockReset();
});

describe("runSetCollectionStyle", () => {
  it("propagates a collection-resolution failure verbatim", async () => {
    const failure = errorResult('No collection named "Nope" was found.');
    resolveCollectionMock.mockResolvedValue({ ok: false, result: failure });

    const result = await runSetCollectionStyle({ collection: "Nope" }, EXTRA);
    expect(result).toBe(failure);
    expect(getCollectionStyleSettingsMock).not.toHaveBeenCalled();
  });

  it("leaves omitted fields unchanged - the merge-with-current PUT semantics", async () => {
    resolveCollectionMock.mockResolvedValue({ ok: true, collection: COLLECTION });
    const current = currentSettings();
    getCollectionStyleSettingsMock.mockResolvedValue(current);
    saveCollectionStyleSettingsMock.mockResolvedValue(saved(current));

    await runSetCollectionStyle({ collection: "Icons", color: "#f783ac" }, EXTRA);

    expect(saveCollectionStyleSettingsMock).toHaveBeenCalledWith(DB, "ws-1", "col-1", {
      anchorIconId: "tabler:star",
      color: "#f783ac",
      strokeWidth: 1,
      size: 24,
      exportFormat: "svg",
    });
  });

  it("clears a field when explicitly passed null", async () => {
    resolveCollectionMock.mockResolvedValue({ ok: true, collection: COLLECTION });
    const current = currentSettings();
    getCollectionStyleSettingsMock.mockResolvedValue(current);
    saveCollectionStyleSettingsMock.mockResolvedValue(saved({ ...current, color: null }));

    await runSetCollectionStyle({ collection: "Icons", color: null }, EXTRA);

    expect(saveCollectionStyleSettingsMock).toHaveBeenCalledWith(
      DB,
      "ws-1",
      "col-1",
      expect.objectContaining({ color: null, strokeWidth: 1, size: 24 }),
    );
  });

  it("rejects an invalid color with the same message the web validator produces", async () => {
    resolveCollectionMock.mockResolvedValue({ ok: true, collection: COLLECTION });
    getCollectionStyleSettingsMock.mockResolvedValue(currentSettings());

    const result = await runSetCollectionStyle({ collection: "Icons", color: "not-a-hex" }, EXTRA);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("hex value");
    expect(saveCollectionStyleSettingsMock).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range stroke width", async () => {
    resolveCollectionMock.mockResolvedValue({ ok: true, collection: COLLECTION });
    getCollectionStyleSettingsMock.mockResolvedValue(currentSettings());

    const result = await runSetCollectionStyle({ collection: "Icons", stroke: 999 }, EXTRA);
    expect(result.isError).toBe(true);
    expect(saveCollectionStyleSettingsMock).not.toHaveBeenCalled();
  });

  it("returns the saved summary, reusing summarizeCollectionStyles wording", async () => {
    resolveCollectionMock.mockResolvedValue({ ok: true, collection: COLLECTION });
    getCollectionStyleSettingsMock.mockResolvedValue(currentSettings());
    saveCollectionStyleSettingsMock.mockResolvedValue(
      saved(currentSettings({ color: "#f783ac", strokeWidth: 1.5 })),
    );

    const result = await runSetCollectionStyle({ collection: "Icons", color: "#f783ac", stroke: 1.5 }, EXTRA);
    const parsed = JSON.parse(textOf(result)) as { summary: string; style: Record<string, unknown> };
    expect(parsed.summary).toBe("Icons export with this collection's look: color #f783ac, stroke width 1.5.");
    expect(parsed.style).toEqual({ color: "#f783ac", strokeWidth: 1.5, size: 24, exportFormat: "svg" });
  });

  it("surfaces an honest error when the anchor icon fell out of the collection", async () => {
    resolveCollectionMock.mockResolvedValue({ ok: true, collection: COLLECTION });
    getCollectionStyleSettingsMock.mockResolvedValue(currentSettings());
    saveCollectionStyleSettingsMock.mockResolvedValue({ ok: false, reason: "invalid-anchor" });

    const result = await runSetCollectionStyle({ collection: "Icons", color: "#f783ac" }, EXTRA);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("style anchor icon is no longer in the collection");
  });
});
