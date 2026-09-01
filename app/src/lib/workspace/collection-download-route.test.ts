import { unzipSync, strFromU8 } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
import type { CollectionIcon } from "./collection-icons";

/**
 * /api/collections/[id]/download/[name].zip - the gate, the headers and the
 * archive itself.
 *
 * It lives here rather than beside the route because everything under
 * src/pages is a route: a test file next to the endpoint is built and
 * prerendered as a page of its own, and the build fails on it (the same
 * reason lib/search/search-route.test.ts sits where it does).
 *
 * The database is stubbed at the three functions the route actually reaches
 * for, because the subject is the route: who is allowed to ask for this zip,
 * what ends up inside it, and what the browser is told to call it. The zip
 * builder underneath is exercised for real - the assertions unzip the bytes
 * the response carries.
 */

const requireSessionWorkspaceMock = vi.fn(async () => sessionContext as unknown);
vi.mock("./session-workspace", () => ({
  requireSessionWorkspace: requireSessionWorkspaceMock,
}));

const getCollectionMock = vi.fn(async () => collectionRow as unknown);
vi.mock("./collections", () => ({
  getCollection: getCollectionMock,
}));

const getCollectionStyleSettingsMock = vi.fn(async () => styleSettings as unknown);
vi.mock("./collection-style", () => ({
  getCollectionStyleSettings: getCollectionStyleSettingsMock,
}));

const loadCollectionIconsMock = vi.fn(async () => savedIcons);
vi.mock("./collection-icons", () => ({
  loadCollectionIcons: loadCollectionIconsMock,
}));

const { GET } = await import("../../pages/api/collections/[id]/download/[name].zip");

/* The signed-in owner, their collection, and its remembered look. Each test
   that cares about a different world overwrites one of these. */
const sessionContext = { database: {}, userId: "user_1", workspaceId: "ws_1" };
const collectionRow = { id: "col_1", name: "My UI Icons" };
let styleSettings: Record<string, unknown>;
let savedIcons: CollectionIcon[];

function icon(prefix: string, name: string, tier: CollectionIcon["tier"] = "T1"): CollectionIcon {
  return {
    iconId: `${prefix}:${name}`,
    prefix,
    name,
    body: '<path d="M4 4h16v16H4z" stroke="currentColor" stroke-width="2" fill="none"/>',
    width: 24,
    height: 24,
    tier,
    license: {
      setName: "Lucide",
      authorName: "Lucide Contributors",
      authorUrl: "https://github.com/lucide-icons/lucide",
      licenseName: "ISC License",
      licenseSpdx: "ISC",
      licenseUrl: "https://opensource.org/license/isc",
      attributionRequired: false,
    },
  };
}

/** Just enough APIContext for this route: a session, the two path params and
    the URL its query string comes from. */
function call(query = "", user: unknown = { id: "user_1" }): Promise<Response> {
  const context = {
    locals: { user },
    params: { id: "col_1", name: "my-ui-icons" },
    request: new Request(`https://motificons.app/api/collections/col_1/download/my-ui-icons.zip${query}`),
  } as unknown as APIContext;
  return GET(context) as Promise<Response>;
}

beforeEach(() => {
  vi.clearAllMocks();
  styleSettings = {
    collectionId: "col_1",
    anchorIconId: null,
    computedTargets: null,
    color: null,
    strokeWidth: null,
    size: null,
    exportFormat: "svg",
    updatedAt: null,
  };
  savedIcons = [icon("lucide", "star"), icon("lucide", "trash"), icon("tabler", "arrow-right")];
  requireSessionWorkspaceMock.mockResolvedValue(sessionContext);
  getCollectionMock.mockResolvedValue(collectionRow);
  getCollectionStyleSettingsMock.mockResolvedValue(styleSettings);
  loadCollectionIconsMock.mockImplementation(async () => savedIcons);
});

async function entriesIn(response: Response): Promise<string[]> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  return Object.keys(unzipSync(bytes)).sort();
}

describe("GET /api/collections/[id]/download/[name].zip", () => {
  it("refuses a signed-out caller with the plain sign-in sentence", async () => {
    requireSessionWorkspaceMock.mockResolvedValue(null);
    const response = await call("", null);

    expect(response.status).toBe(401);
    expect(await response.text()).toContain("Sign in with your free account to use collections.");
    /* Nothing about the collection is read, let alone answered with. */
    expect(loadCollectionIconsMock).not.toHaveBeenCalled();
  });

  it("404s on someone else's collection, exactly as a missing one", async () => {
    getCollectionMock.mockResolvedValue(null);
    const response = await call();

    expect(response.status).toBe(404);
    expect(await response.text()).toContain("That collection could not be found.");
    expect(loadCollectionIconsMock).not.toHaveBeenCalled();
  });

  it("answers with a zip the browser is told to save under the collection's name", async () => {
    const response = await call();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="my-ui-icons.zip"',
    );
    /* Someone else's icons, restyled to their own collection - never a
       shared cache. */
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("puts every icon plus LICENSES.txt inside", async () => {
    const response = await call();
    expect(await entriesIn(response)).toEqual([
      "LICENSES.txt",
      "lucide-star.svg",
      "lucide-trash.svg",
      "tabler-arrow-right.svg",
    ]);
  });

  it("uses the collection's remembered format when the URL names none", async () => {
    styleSettings["exportFormat"] = "vue";
    const response = await call();
    expect(await entriesIn(response)).toEqual([
      "LICENSES.txt",
      "lucide-star.vue",
      "lucide-trash.vue",
      "tabler-arrow-right.vue",
    ]);
  });

  it("lets ?format= override it for this one download", async () => {
    const response = await call("?format=tsx");
    expect(await entriesIn(response)).toEqual([
      "LICENSES.txt",
      "lucide-star.tsx",
      "lucide-trash.tsx",
      "tabler-arrow-right.tsx",
    ]);
    /* The override is for this request only - the route never writes the
       collection's remembered format. */
    expect(getCollectionStyleSettingsMock).toHaveBeenCalledTimes(1);
  });

  it("names the formats it does know when handed one it does not", async () => {
    const response = await call("?format=pdf");
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).toContain('"pdf" is not an export format here');
    expect(body).toContain("svg, png");
  });

  it("applies the collection's saved look to every icon in the zip", async () => {
    styleSettings["color"] = "#183153";
    const response = await call();
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(strFromU8(files["lucide-star.svg"]!)).toContain("#183153");
  });

  it("carries the licence text the collection page promises", async () => {
    const response = await call();
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    const licenses = strFromU8(files["LICENSES.txt"]!);
    expect(licenses).toContain("Icon licenses - My UI Icons");
    expect(licenses).toContain("License: ISC License (ISC) - no attribution required");
  });

  it("says so plainly when the collection is empty rather than sending an empty zip", async () => {
    savedIcons = [];
    const response = await call();
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("no icons in it yet");
  });

  it("drops an icon whose set left the pipeline instead of failing the download", async () => {
    savedIcons = [icon("lucide", "star"), icon("gone", "glyph", null)];
    const response = await call();
    expect(response.status).toBe(200);
    expect(await entriesIn(response)).toEqual(["LICENSES.txt", "lucide-star.svg"]);
  });

  it("refuses to build one enormous zip, and says what to do instead", async () => {
    savedIcons = Array.from({ length: 301 }, (_, index) => icon("lucide", `icon-${index}`));
    const response = await call();
    expect(response.status).toBe(413);
    expect(await response.text()).toContain("at most 300");
  });
});
