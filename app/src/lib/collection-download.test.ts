import { describe, expect, it } from "vitest";
import {
  buildLicensesText,
  dedupeFilename,
  defaultExtensionFor,
  fallbackFilename,
  parseContentDispositionFilename,
  resolveExportSize,
  slugifyFilename,
  summarizeCollectionStyles,
  type CollectionIconLicense,
} from "./collection-download";

describe("defaultExtensionFor / fallbackFilename", () => {
  it("maps every format to the extension the export route actually uses", () => {
    expect(defaultExtensionFor("svg")).toBe("svg");
    expect(defaultExtensionFor("png")).toBe("png");
    expect(defaultExtensionFor("jsx")).toBe("jsx");
    expect(defaultExtensionFor("tsx")).toBe("tsx");
    expect(defaultExtensionFor("vue")).toBe("vue");
    expect(defaultExtensionFor("svelte")).toBe("svelte");
    expect(defaultExtensionFor("swiftui")).toBe("swift");
    expect(defaultExtensionFor("catalog")).toBe("imageset.zip");
    expect(defaultExtensionFor("datauri")).toBe("txt");
  });

  it("builds the same prefix-name stem the server uses", () => {
    expect(fallbackFilename("lucide", "star", "svg")).toBe("lucide-star.svg");
    expect(fallbackFilename("lucide", "star", "catalog")).toBe("lucide-star.imageset.zip");
  });
});

describe("parseContentDispositionFilename", () => {
  it("reads a quoted filename", () => {
    expect(parseContentDispositionFilename('attachment; filename="lucide-star.svg"')).toBe(
      "lucide-star.svg",
    );
  });

  it("reads an unquoted filename", () => {
    expect(parseContentDispositionFilename("attachment; filename=lucide-star.svg")).toBe(
      "lucide-star.svg",
    );
  });

  it("returns null for a missing or unreadable header", () => {
    expect(parseContentDispositionFilename(null)).toBeNull();
    expect(parseContentDispositionFilename("attachment")).toBeNull();
  });
});

describe("dedupeFilename", () => {
  it("returns the name unchanged when it is not taken", () => {
    expect(dedupeFilename("lucide-star.svg", new Set())).toBe("lucide-star.svg");
  });

  it("appends -2 on a single collision", () => {
    const used = new Set(["lucide-star.svg"]);
    expect(dedupeFilename("lucide-star.svg", used)).toBe("lucide-star-2.svg");
  });

  it("keeps incrementing past multiple collisions", () => {
    const used = new Set(["lucide-star.svg", "lucide-star-2.svg", "lucide-star-3.svg"]);
    expect(dedupeFilename("lucide-star.svg", used)).toBe("lucide-star-4.svg");
  });

  it("does not mutate the set it was given", () => {
    const used = new Set(["a.svg"]);
    dedupeFilename("a.svg", used);
    expect(used.size).toBe(1);
  });

  it("handles a name with no extension", () => {
    const used = new Set(["StarShape"]);
    expect(dedupeFilename("StarShape", used)).toBe("StarShape-2");
  });
});

describe("slugifyFilename", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyFilename("My UI Icons")).toBe("my-ui-icons");
  });

  it("strips punctuation and collapses repeats", () => {
    expect(slugifyFilename("Nav / Footer!!  Icons")).toBe("nav-footer-icons");
  });

  it("trims leading/trailing dashes", () => {
    expect(slugifyFilename("  -Weird Name-  ")).toBe("weird-name");
  });

  it("never returns empty", () => {
    expect(slugifyFilename("!!!")).toBe("collection");
    expect(slugifyFilename("")).toBe("collection");
  });
});

describe("summarizeCollectionStyles", () => {
  it("names both when both are set", () => {
    expect(summarizeCollectionStyles({ color: "#f783ac", strokeWidth: 1.5 })).toBe(
      "Icons export with this collection's look: color #f783ac, stroke width 1.5.",
    );
  });

  it("omits the unset part - color only", () => {
    expect(summarizeCollectionStyles({ color: "#f783ac", strokeWidth: null })).toBe(
      "Icons export with this collection's look: color #f783ac.",
    );
  });

  it("omits the unset part - stroke only", () => {
    expect(summarizeCollectionStyles({ color: null, strokeWidth: 2 })).toBe(
      "Icons export with this collection's look: stroke width 2.",
    );
  });

  it("says so plainly when nothing is set", () => {
    expect(summarizeCollectionStyles({ color: null, strokeWidth: null })).toBe(
      "Icons export exactly as they look in the library - no collection styles applied.",
    );
  });
});

describe("resolveExportSize", () => {
  it("PNG always gets a size - the panel's own default when the collection has none", () => {
    expect(resolveExportSize("png", 512, null)).toBe(512);
    expect(resolveExportSize("png", 512, 256)).toBe(512);
  });

  it("other formats follow the collection's size setting", () => {
    expect(resolveExportSize("svg", 512, 128)).toBe(128);
  });

  it("other formats omit size entirely when the collection's is Unset", () => {
    expect(resolveExportSize("svg", 512, null)).toBeUndefined();
  });
});

describe("buildLicensesText", () => {
  const lucide: CollectionIconLicense = {
    setName: "Lucide",
    authorName: "Lucide Contributors",
    authorUrl: "https://lucide.dev",
    licenseName: "ISC License",
    licenseSpdx: "ISC",
    licenseUrl: "https://lucide.dev/license",
    attributionRequired: false,
  };

  const fluent: CollectionIconLicense = {
    setName: "Fluent System Icons",
    authorName: "Microsoft Corporation",
    authorUrl: "https://github.com/microsoft/fluentui-system-icons",
    licenseName: "MIT License",
    licenseSpdx: "MIT",
    licenseUrl: "https://github.com/microsoft/fluentui-system-icons/blob/main/LICENSE",
    attributionRequired: false,
  };

  const degraded: CollectionIconLicense = {
    setName: "Tabler Icons",
    authorName: null,
    authorUrl: null,
    licenseName: "MIT",
    licenseSpdx: null,
    licenseUrl: null,
    attributionRequired: false,
  };

  it("includes the collection name in the header", () => {
    const text = buildLicensesText({ collectionName: "Nav icons", items: [] });
    expect(text).toContain("Icon licenses - Nav icons");
  });

  it("emits one block per set, not per icon", () => {
    const text = buildLicensesText({
      collectionName: "Nav icons",
      items: [
        { prefix: "lucide", license: lucide },
        { prefix: "lucide", license: lucide },
        { prefix: "lucide", license: lucide },
      ],
    });
    expect(text.match(/License: ISC/g)?.length).toBe(1);
  });

  it("sorts blocks alphabetically by set name", () => {
    const text = buildLicensesText({
      collectionName: "Nav icons",
      items: [
        { prefix: "lucide", license: lucide },
        { prefix: "fluent", license: fluent },
      ],
    });
    expect(text.indexOf("Fluent System Icons")).toBeLessThan(text.indexOf("Lucide"));
  });

  it("reuses the exact icon-detail-page attribution snippet formula", () => {
    const text = buildLicensesText({ collectionName: "Nav icons", items: [{ prefix: "lucide", license: lucide }] });
    expect(text).toContain(
      "Lucide by Lucide Contributors (https://lucide.dev), licensed under ISC License - https://lucide.dev/license",
    );
  });

  it("degrades honestly (no fabricated author) when author info is missing", () => {
    const text = buildLicensesText({
      collectionName: "Nav icons",
      items: [{ prefix: "tabler", license: degraded }],
    });
    expect(text).toContain("Tabler Icons, licensed under MIT");
    expect(text).not.toContain("by null");
    expect(text).not.toContain("(null)");
  });

  it("skips icons whose set metadata never resolved", () => {
    const text = buildLicensesText({
      collectionName: "Nav icons",
      items: [{ prefix: "ghost", license: null }],
    });
    expect(text).not.toContain("ghost");
  });

  it("notes when attribution is required", () => {
    const text = buildLicensesText({
      collectionName: "Nav icons",
      items: [{ prefix: "fluent", license: { ...fluent, attributionRequired: true } }],
    });
    expect(text).toContain("attribution required");
    expect(text).not.toContain("no attribution required");
  });
});
