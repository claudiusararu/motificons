import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../../app/src/db/client";
import type { IconSource, SetMetadata } from "../../../app/src/lib/data";
import type { CollectionItemDTO } from "../../../app/src/lib/workspace/collection-items";
import type { CollectionStyleSettingsDTO } from "../../../app/src/lib/workspace/collection-style";
import type { CollectionDTO } from "../../../app/src/lib/workspace/collections";
import type { SwiftUiResult } from "../../../app/src/lib/transforms";
import type { MotificonsAuthExtra } from "../auth";

const dbMock = vi.fn<() => Promise<Database>>();
vi.mock("../../../app/src/db/client", () => ({ db: () => dbMock() }));

const listCollectionsMock = vi.fn<(database: Database, workspaceId: string) => Promise<CollectionDTO[]>>();
vi.mock("../../../app/src/lib/workspace/collections", () => ({
  listCollections: (database: Database, workspaceId: string) => listCollectionsMock(database, workspaceId),
}));

const listCollectionItemsMock = vi.fn<(database: Database, collectionId: string) => Promise<CollectionItemDTO[]>>();
vi.mock("../../../app/src/lib/workspace/collection-items", () => ({
  listCollectionItems: (database: Database, collectionId: string) => listCollectionItemsMock(database, collectionId),
}));

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

const {
  classifyIdentifier,
  extractIconName,
  nameSimilarity,
  bestCollectionMatch,
  analyzeFindings,
  summarizeClassification,
  summarizeCoverage,
  buildSummary,
  runAuditRepoIcons,
  COVERED_THRESHOLD,
} = await import("./audit-repo-icons");

const DB = {} as Database;
const EXTRA: MotificonsAuthExtra = { userId: "u1", workspaceId: "ws-1", keyId: "k1" };

const ICON: IconSource = { prefix: "tabler", name: "arrow-right", body: "<path/>", width: 24, height: 24 };
const SET = { tier: "T1", name: "Tabler Icons" } as SetMetadata;

function collection(id: string, name: string): CollectionDTO {
  return { id, name, createdAt: new Date(0).toISOString() };
}

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
  /* Sane default so every test that passes collection: "col-1" resolves
     without also having to seed this mock - tests exercising the
     zero/one/many-collections defaulting paths override it explicitly. */
  listCollectionsMock.mockReset().mockResolvedValue([collection("col-1", "Icons")]);
  listCollectionItemsMock.mockReset();
  getCollectionStyleSettingsMock.mockReset();
  getIconMock.mockReset().mockResolvedValue(ICON);
  getSetMock.mockReset().mockResolvedValue(SET);
  buildSvgMock.mockClear();
});

/* ------------------------------------------------------------------------ *
 * Pure parts - classification
 * ------------------------------------------------------------------------ */

describe("classifyIdentifier", () => {
  it.each([
    ["lucide-react: ArrowRight", "Lucide"],
    ["import { Trash2 } from 'lucide-react'", "Lucide"],
    ["fa fa-arrow-right", "Font Awesome"],
    ["fas fa-trash", "Font Awesome"],
    ["@fortawesome/react-fontawesome: FontAwesomeIcon", "Font Awesome"],
    ["bi bi-trash3-fill", "Bootstrap Icons"],
    ["bootstrap-icons/icons/arrow-right.svg", "Bootstrap Icons"],
    ["@heroicons/react/24/outline: ArrowRightIcon", "Heroicons"],
    ["mdi mdi-arrow-right", "Material Design Icons"],
    ["material-icons: home", "Material Icons"],
    ["@mui/icons-material: Home", "Material Icons"],
    ["react-icons/fa: FaTrash", "Font Awesome"],
    ["@tabler/icons-react: IconArrowRight", "Tabler Icons"],
  ])("classifies %s as %s", (identifier, expected) => {
    expect(classifyIdentifier(identifier)).toBe(expected);
  });

  it("returns null (honest unrecognized) for an identifier matching no known ecosystem", () => {
    expect(classifyIdentifier("acme-internal-icons: Widget")).toBeNull();
    expect(classifyIdentifier("assets/brand/logo-mark.svg")).toBeNull();
  });
});

/* ------------------------------------------------------------------------ *
 * Pure parts - icon-name extraction
 * ------------------------------------------------------------------------ */

describe("extractIconName", () => {
  it("uses the file basename minus extension for svg-file findings", () => {
    expect(extractIconName({ kind: "svg-file", identifier: "assets/icons/arrow-right.svg" })).toBe("arrow-right");
    expect(extractIconName({ kind: "svg-file", identifier: "arrow-right.svg" })).toBe("arrow-right");
  });

  it("prefers the explicit path over the identifier for svg-file findings", () => {
    expect(
      extractIconName({ kind: "svg-file", identifier: "trash icon", path: "src/assets/icons/Trash2.svg" }),
    ).toBe("Trash2");
  });

  it("takes everything after the last colon for import findings", () => {
    expect(extractIconName({ kind: "import", identifier: "lucide-react: ArrowRight" })).toBe("ArrowRight");
    expect(extractIconName({ kind: "import", identifier: "@heroicons/react/24/outline: ArrowRightIcon" })).toBe(
      "ArrowRightIcon",
    );
  });

  it("strips the base class from a two-token icon-font class", () => {
    expect(extractIconName({ kind: "icon-font-class", identifier: "fa fa-arrow-right" })).toBe("arrow-right");
    expect(extractIconName({ kind: "icon-font-class", identifier: "bi bi-trash3-fill" })).toBe("trash3-fill");
  });

  it("strips a known short prefix from a single-token icon-font class", () => {
    expect(extractIconName({ kind: "icon-font-class", identifier: "fa-arrow-right" })).toBe("arrow-right");
  });

  it("falls back to the identifier verbatim when no shape is recognized", () => {
    expect(extractIconName({ kind: "other", identifier: "arrow-right" })).toBe("arrow-right");
  });
});

/* ------------------------------------------------------------------------ *
 * Pure parts - similarity + matching
 * ------------------------------------------------------------------------ */

describe("nameSimilarity", () => {
  it("scores 1 for an exact match after case/word-boundary normalization", () => {
    expect(nameSimilarity("ArrowRight", "arrow-right")).toBe(1);
    expect(nameSimilarity("arrow-right", "arrow-right")).toBe(1);
  });

  it("scores a one-letter typo well above the covered threshold", () => {
    expect(nameSimilarity("arow-right", "arrow-right")).toBeGreaterThanOrEqual(COVERED_THRESHOLD);
  });

  it("scores an unrelated name well below the covered threshold", () => {
    expect(nameSimilarity("trash", "arrow-right")).toBeLessThan(COVERED_THRESHOLD);
  });

  it("rewards word-order-independent overlap via token matching", () => {
    const score = nameSimilarity("right-arrow", "arrow-right");
    expect(score).toBeGreaterThan(0.9);
  });
});

describe("bestCollectionMatch", () => {
  it("returns null against an empty collection", () => {
    expect(bestCollectionMatch("arrow-right", [])).toBeNull();
  });

  it("picks the highest-scoring icon", () => {
    const icons = [
      { id: "a:trash", name: "trash" },
      { id: "b:arrow-right", name: "arrow-right" },
    ];
    const match = bestCollectionMatch("ArrowRight", icons);
    expect(match?.icon.id).toBe("b:arrow-right");
    expect(match?.score).toBe(1);
  });
});

/* ------------------------------------------------------------------------ *
 * Pure parts - analyze/rollups
 * ------------------------------------------------------------------------ */

describe("analyzeFindings", () => {
  const collectionIcons = [{ id: "tabler:arrow-right", name: "arrow-right" }];

  it("marks a strong match as covered", () => {
    const [result] = analyzeFindings(
      [{ kind: "import", identifier: "lucide-react: ArrowRight" }],
      collectionIcons,
    );
    expect(result?.verdict).toBe("covered");
    expect(result?.match?.icon.id).toBe("tabler:arrow-right");
  });

  it("marks a weak-match import/icon-font-class/other finding as off-collection, not orphan", () => {
    const [result] = analyzeFindings(
      [{ kind: "import", identifier: "@fortawesome/react-fontawesome: FaTrash" }],
      collectionIcons,
    );
    expect(result?.verdict).toBe("off-collection");
  });

  it("marks a weak-match svg-file finding as orphan", () => {
    const [result] = analyzeFindings([{ kind: "svg-file", identifier: "assets/icons/legacy-trash.svg" }], collectionIcons);
    expect(result?.verdict).toBe("orphan");
  });

  it("carries count/path through untouched, defaulting to null when omitted", () => {
    const [result] = analyzeFindings(
      [{ kind: "import", identifier: "lucide-react: ArrowRight", count: 5, path: "src/Header.tsx" }],
      collectionIcons,
    );
    expect(result?.count).toBe(5);
    expect(result?.path).toBe("src/Header.tsx");

    const [bare] = analyzeFindings([{ kind: "other", identifier: "widget" }], collectionIcons);
    expect(bare?.count).toBeNull();
    expect(bare?.path).toBeNull();
  });
});

describe("summarizeClassification", () => {
  it("counts distinct recognized sets and flags mixing at two or more", () => {
    const analyzed = analyzeFindings(
      [
        { kind: "import", identifier: "lucide-react: ArrowRight" },
        { kind: "icon-font-class", identifier: "fa fa-trash" },
      ],
      [],
    );
    const summary = summarizeClassification(analyzed);
    expect(summary.distinctSets).toBe(2);
    expect(summary.mixed).toBe(true);
    expect(summary.sets.sort()).toEqual(["Font Awesome", "Lucide"]);
  });

  it("does not flag mixing for a single recognized set", () => {
    const analyzed = analyzeFindings(
      [
        { kind: "import", identifier: "lucide-react: ArrowRight" },
        { kind: "import", identifier: "lucide-react: Trash2" },
      ],
      [],
    );
    expect(summarizeClassification(analyzed).mixed).toBe(false);
  });

  it("weights bySet counts by each finding's own count, defaulting to 1", () => {
    const analyzed = analyzeFindings(
      [{ kind: "import", identifier: "lucide-react: ArrowRight", count: 4 }],
      [],
    );
    expect(summarizeClassification(analyzed).bySet["Lucide"]).toBe(4);
  });

  it("buckets unclassified findings into unrecognizedCount, not a fake set", () => {
    const analyzed = analyzeFindings([{ kind: "other", identifier: "acme-internal: Widget" }], []);
    const summary = summarizeClassification(analyzed);
    expect(summary.unrecognizedCount).toBe(1);
    expect(summary.distinctSets).toBe(0);
  });
});

describe("summarizeCoverage", () => {
  it("tallies covered/off-collection/orphan independently", () => {
    const collectionIcons = [{ id: "tabler:arrow-right", name: "arrow-right" }];
    const analyzed = analyzeFindings(
      [
        { kind: "import", identifier: "lucide-react: ArrowRight" },
        { kind: "icon-font-class", identifier: "fa fa-trash" },
        { kind: "svg-file", identifier: "assets/legacy-star.svg" },
      ],
      collectionIcons,
    );
    expect(summarizeCoverage(analyzed)).toEqual({ covered: 1, offCollection: 1, orphanSvgs: 1 });
  });
});

describe("buildSummary", () => {
  it("gives a plain sentence for zero findings", () => {
    const classification = summarizeClassification([]);
    const coverage = summarizeCoverage([]);
    const summary = buildSummary({
      totalFindings: 0,
      collectionName: null,
      collectionNote: null,
      classification,
      coverage,
      collectionEmpty: false,
    });
    expect(summary).toContain("No findings were submitted");
  });

  it("mentions set mixing, coverage counts and an empty collection honestly", () => {
    const classification = { bySet: { Lucide: 1, "Font Awesome": 1 }, sets: ["Font Awesome", "Lucide"], distinctSets: 2, unrecognizedCount: 0, mixed: true };
    const coverage = { covered: 0, offCollection: 0, orphanSvgs: 0 };
    const summary = buildSummary({
      totalFindings: 2,
      collectionName: "App Icons",
      collectionNote: null,
      classification,
      coverage,
      collectionEmpty: true,
    });
    expect(summary).toContain('"App Icons"');
    expect(summary).toContain("2 different icon sets are mixed in");
    expect(summary).toContain("no icons yet");
  });
});

/* ------------------------------------------------------------------------ *
 * Orchestration - runAuditRepoIcons
 * ------------------------------------------------------------------------ */

describe("runAuditRepoIcons", () => {
  it("returns a sane empty-findings report with no DB access", async () => {
    const result = await runAuditRepoIcons({ findings: [], collection: undefined }, EXTRA);
    const body = bodyOf(result);

    expect(body.collection).toBeNull();
    expect(body.totalFindings).toBe(0);
    expect(String(body.summary)).toContain("No findings were submitted");
    expect(dbMock).not.toHaveBeenCalled();
  });

  it("errors plainly on an unknown collection name", async () => {
    listCollectionsMock.mockResolvedValue([collection("col-1", "Icons")]);

    const result = await runAuditRepoIcons(
      { findings: [{ kind: "other", identifier: "widget" }], collection: "Nope" },
      EXTRA,
    );

    expect(result.isError).toBe(true);
    const [content] = result.content;
    if (content?.type !== "text") throw new Error("expected text content");
    expect(content.text).toContain('No collection named "Nope"');
    expect(listCollectionItemsMock).not.toHaveBeenCalled();
  });

  it("errors with a create-one hint when the caller has no collections and none was specified", async () => {
    listCollectionsMock.mockResolvedValue([]);

    const result = await runAuditRepoIcons({ findings: [{ kind: "other", identifier: "widget" }] }, EXTRA);

    expect(result.isError).toBe(true);
    const [content] = result.content;
    if (content?.type !== "text") throw new Error("expected text content");
    expect(content.text).toContain("don't have any collections yet");
  });

  it("defaults to the sole collection with an honest note when none was specified", async () => {
    listCollectionsMock.mockResolvedValue([collection("col-1", "Icons")]);
    listCollectionItemsMock.mockResolvedValue([]);
    getCollectionStyleSettingsMock.mockResolvedValue(null);

    const result = await runAuditRepoIcons({ findings: [{ kind: "other", identifier: "widget" }] }, EXTRA);
    const body = bodyOf(result);

    expect((body.collection as { name: string }).name).toBe("Icons");
    expect(String(body.collectionNote)).toContain("defaulted to your only collection");
  });

  it("defaults to the first of several collections with a count in the note", async () => {
    listCollectionsMock.mockResolvedValue([collection("col-1", "Icons"), collection("col-2", "Logos")]);
    listCollectionItemsMock.mockResolvedValue([]);
    getCollectionStyleSettingsMock.mockResolvedValue(null);

    const result = await runAuditRepoIcons({ findings: [{ kind: "other", identifier: "widget" }] }, EXTRA);
    const body = bodyOf(result);

    expect((body.collection as { name: string }).name).toBe("Icons");
    expect(String(body.collectionNote)).toContain("defaulted to your first collection");
    expect(String(body.collectionNote)).toContain("you have 2");
  });

  it("reports an empty collection honestly - no matches, no suggestions", async () => {
    listCollectionItemsMock.mockResolvedValue([]);
    getCollectionStyleSettingsMock.mockResolvedValue(null);

    const result = await runAuditRepoIcons(
      { findings: [{ kind: "import", identifier: "lucide-react: ArrowRight" }], collection: "col-1" },
      EXTRA,
    );
    const body = bodyOf(result);
    const [finding] = body.findings as Record<string, unknown>[];

    expect(finding?.verdict).toBe("off-collection");
    expect(finding?.suggestion).toBeUndefined();
    expect(String(body.summary)).toContain("no icons yet");
  });

  it("classifies mixed sets, matches a covered finding, suggests a replacement for an off-collection finding, and flags an orphan svg", async () => {
    listCollectionItemsMock.mockResolvedValue([item("tabler:arrow-right")]);
    getCollectionStyleSettingsMock.mockResolvedValue(null);

    const result = await runAuditRepoIcons(
      {
        findings: [
          { kind: "import", identifier: "lucide-react: ArrowRight" },
          { kind: "icon-font-class", identifier: "fa fa-trash" },
          { kind: "svg-file", identifier: "assets/icons/legacy-star.svg" },
        ],
        collection: "col-1",
      },
      EXTRA,
    );
    const body = bodyOf(result);
    const findings = body.findings as Record<string, unknown>[];
    const classification = body.classification as { distinctSets: number; mixed: boolean };
    const coverage = body.coverage as { covered: number; offCollection: number; orphanSvgs: number };

    expect(classification.mixed).toBe(true);
    expect(classification.distinctSets).toBe(2);
    expect(coverage).toEqual({ covered: 1, offCollection: 1, orphanSvgs: 1 });

    const covered = findings.find((f) => f.verdict === "covered");
    expect((covered?.matchedIcon as { id: string })?.id).toBe("tabler:arrow-right");
    expect(covered?.suggestion).toBeUndefined();

    const offCollection = findings.find((f) => f.verdict === "off-collection");
    expect((offCollection?.suggestion as { id: string; code: string })?.id).toBe("tabler:arrow-right");
    expect((offCollection?.suggestion as { code: string })?.code).toBe("<svg>mock</svg>");

    const orphan = findings.find((f) => f.verdict === "orphan");
    expect((orphan?.suggestion as { id: string })?.id).toBe("tabler:arrow-right");

    expect(String(body.summary)).toContain("2 different icon sets are mixed in");
  });

  it("renders the same suggested replacement only once even when multiple findings point at it", async () => {
    listCollectionItemsMock.mockResolvedValue([item("tabler:arrow-right")]);
    getCollectionStyleSettingsMock.mockResolvedValue(null);

    await runAuditRepoIcons(
      {
        findings: [
          { kind: "icon-font-class", identifier: "fa fa-trash" },
          { kind: "icon-font-class", identifier: "bi bi-star" },
        ],
        collection: "col-1",
      },
      EXTRA,
    );

    expect(buildSvgMock).toHaveBeenCalledTimes(1);
  });

  it("applies the collection's saved style settings to a rendered suggestion", async () => {
    listCollectionItemsMock.mockResolvedValue([item("tabler:arrow-right")]);
    getCollectionStyleSettingsMock.mockResolvedValue(style({ color: "#183153", strokeWidth: 1.5 }));

    await runAuditRepoIcons(
      { findings: [{ kind: "icon-font-class", identifier: "fa fa-trash" }], collection: "col-1" },
      EXTRA,
    );

    expect(buildSvgMock).toHaveBeenCalledWith(ICON, { color: "#183153", strokeWidth: 1.5, size: undefined }, "T1");
  });

  it("downgrades a remembered catalog format to svg for suggestions, with an honest formatNote", async () => {
    listCollectionItemsMock.mockResolvedValue([item("tabler:arrow-right")]);
    getCollectionStyleSettingsMock.mockResolvedValue(style({ exportFormat: "catalog" }));

    const result = await runAuditRepoIcons(
      { findings: [{ kind: "icon-font-class", identifier: "fa fa-trash" }], collection: "col-1" },
      EXTRA,
    );
    const body = bodyOf(result);
    const [finding] = body.findings as { suggestion?: { code?: string } }[];

    expect(String(body.formatNote)).toContain("catalog");
    expect(finding?.suggestion?.code).toBe("<svg>mock</svg>");
  });
});
