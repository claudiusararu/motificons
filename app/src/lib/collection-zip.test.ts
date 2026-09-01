import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildCollectionZip, type CollectionZipIcon } from "./collection-zip";
import type { CollectionIconLicense } from "./collection-download";

/**
 * The collection zip, read back as a real archive.
 *
 * Every assertion here unzips what the builder produced rather than
 * inspecting the object it was given, because the whole point of moving this
 * to the server was that the file a browser receives is the thing that
 * matters. Formats are kept to the text ones - PNG would pull resvg's wasm
 * into a unit test to prove nothing this file is about.
 */

const LUCIDE: CollectionIconLicense = {
  setName: "Lucide",
  authorName: "Lucide Contributors",
  authorUrl: "https://github.com/lucide-icons/lucide",
  licenseName: "ISC License",
  licenseSpdx: "ISC",
  licenseUrl: "https://opensource.org/license/isc",
  attributionRequired: false,
};

const TABLER: CollectionIconLicense = {
  setName: "Tabler Icons",
  authorName: "Paweł Kuna",
  authorUrl: "https://github.com/tabler/tabler-icons",
  licenseName: "MIT License",
  licenseSpdx: "MIT",
  licenseUrl: "https://opensource.org/license/mit",
  attributionRequired: true,
};

function icon(
  prefix: string,
  name: string,
  license: CollectionIconLicense | null,
  tier: CollectionZipIcon["tier"] = "T1",
): CollectionZipIcon {
  return {
    icon: {
      prefix,
      name,
      body: '<path d="M4 4h16v16H4z" stroke="currentColor" stroke-width="2" fill="none"/>',
      width: 24,
      height: 24,
    },
    tier,
    license,
  };
}

async function entriesOf(icons: CollectionZipIcon[], format: "svg" | "tsx" | "catalog" = "svg") {
  const zip = await buildCollectionZip({
    collectionName: "My UI Icons",
    icons,
    format,
    edits: {},
  });
  const unzipped = unzipSync(zip.bytes);
  return { zip, unzipped, names: Object.keys(unzipped).sort() };
}

describe("buildCollectionZip", () => {
  it("puts one file per icon in the archive, named exactly as a single-icon download would be", async () => {
    const { names } = await entriesOf([
      icon("lucide", "star", LUCIDE),
      icon("lucide", "trash", LUCIDE),
      icon("tabler", "arrow-right", TABLER),
    ]);

    expect(names).toEqual([
      "LICENSES.txt",
      "lucide-star.svg",
      "lucide-trash.svg",
      "tabler-arrow-right.svg",
    ]);
  });

  it("writes real, openable SVG for each icon", async () => {
    const { unzipped } = await entriesOf([icon("lucide", "star", LUCIDE)]);
    const svg = strFromU8(unzipped["lucide-star.svg"]!);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('viewBox="0 0 24 24"');
  });

  it("always includes LICENSES.txt, with one block per set", async () => {
    const { unzipped } = await entriesOf([
      icon("lucide", "star", LUCIDE),
      icon("lucide", "trash", LUCIDE),
      icon("tabler", "arrow-right", TABLER),
    ]);

    const licenses = strFromU8(unzipped["LICENSES.txt"]!);
    expect(licenses).toContain("Icon licenses - My UI Icons");
    expect(licenses).toContain("License: ISC License (ISC) - no attribution required");
    expect(licenses).toContain("License: MIT License (MIT) - attribution required");
    /* One block per set, not per icon: two Lucide icons, one Lucide block. */
    expect(licenses.match(/^Lucide$/gm)).toHaveLength(1);
  });

  it("names the file after the collection", async () => {
    const { zip } = await entriesOf([icon("lucide", "star", LUCIDE)]);
    expect(zip.filename).toBe("my-ui-icons.zip");
    expect(zip.included).toBe(1);
    expect(zip.skipped).toEqual([]);
  });

  it("honors the requested format for every icon", async () => {
    const { names } = await entriesOf([icon("lucide", "star", LUCIDE)], "tsx");
    expect(names).toEqual(["LICENSES.txt", "lucide-star.tsx"]);
  });

  it("never drops an icon to a filename collision", async () => {
    /* "a-b" + "c" and "a" + "b-c" produce the same `prefix-name` stem. The
       archive is keyed by filename, so without dedupeFilename one of these
       two icons would silently not be in the download at all. */
    const { names } = await entriesOf([icon("a-b", "c", LUCIDE), icon("a", "b-c", LUCIDE)]);
    expect(names).toEqual(["LICENSES.txt", "a-b-c-2.svg", "a-b-c.svg"]);
  });

  it("nests a per-icon asset catalog for the Xcode format", async () => {
    const { names } = await entriesOf([icon("lucide", "star", LUCIDE)], "catalog");
    expect(names).toEqual(["LICENSES.txt", "lucide-star.imageset.zip"]);
  });

  it("leaves out an icon whose set has no licence rather than inventing one", async () => {
    const { unzipped, names } = await entriesOf([
      icon("lucide", "star", LUCIDE),
      icon("mystery", "glyph", null),
    ]);
    /* The artwork is still exported - only the licence block is missing,
       because there is nothing honest to attribute it to. */
    expect(names).toEqual(["LICENSES.txt", "lucide-star.svg", "mystery-glyph.svg"]);
    expect(strFromU8(unzipped["LICENSES.txt"]!)).not.toContain("mystery");
  });
});
