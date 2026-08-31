import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IconSource } from "../data";
import {
  extractPalette,
  recolor,
  recolorPalette,
  toCurrentColor,
} from "./color";
import {
  hasStroke,
  opticalStrokeTarget,
  retargetStroke,
  strokeRatio,
  strokeWidths,
} from "./stroke";
import { applyEdits, buildSvg, capabilitiesFor } from "./svg-doc";
import { componentName, toJsxBody, toJsxComponent } from "./jsx";
import { toBase64DataUri } from "./data-uri";
import { componentFilename, toSvelteComponent, toVueComponent } from "./components";
import { EXPORT_FORMATS } from "./index";
import { toSwiftColor, toSwiftUi } from "./swiftui";
import { assetName, contentsJson, toAssetCatalog } from "./asset-catalog";
import { createZip, crc32 } from "./zip";
import { clampPngSize } from "./png";

/* Real bodies, copied from @iconify/json so the tests exercise the shapes the
   product actually meets rather than invented markup. */

const TABLER_STAR: IconSource = {
  prefix: "tabler",
  name: "star",
  width: 24,
  height: 24,
  body: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m12 17.75l-6.172 3.245l1.179-6.873l-5-4.867l6.9-1l3.086-6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873z"/>',
};

const MATERIAL_STAR: IconSource = {
  prefix: "material-symbols",
  name: "star",
  width: 24,
  height: 24,
  body: '<path fill="currentColor" d="m5.825 21l1.625-7.025L2 9.25l7.2-.625L12 2l2.8 6.625l7.2.625l-5.45 4.725L18.175 21L12 17.275z"/>',
};

const MULTICOLOR: IconSource = {
  prefix: "demo",
  name: "duo",
  width: 24,
  height: 24,
  body: '<path fill="#FF8787" d="M2 2h10v10H2z"/><path fill="#74C0FC" d="M12 12h10v10H12z"/>',
};

const MASKED: IconSource = {
  prefix: "demo",
  name: "masked",
  width: 24,
  height: 24,
  body: '<mask id="a"><rect width="24" height="24" fill="#fff"/></mask><g mask="url(#a)"><path fill="currentColor" d="M0 0h24v24H0z"/></g>',
};

const ARC_ICON: IconSource = {
  prefix: "demo",
  name: "circle",
  width: 24,
  height: 24,
  body: '<path fill="currentColor" d="M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0Z"/>',
};

describe("color", () => {
  it("finds hardcoded colors and ignores currentColor and none", () => {
    expect(extractPalette(MULTICOLOR.body)).toEqual(["#FF8787", "#74C0FC"]);
    expect(extractPalette(TABLER_STAR.body)).toEqual([]);
  });

  it("recolors every paint, including currentColor", () => {
    const out = recolor(MATERIAL_STAR.body, "#146EBE");
    expect(out).toContain('fill="#146EBE"');
    expect(out).not.toContain("currentColor");
  });

  it("leaves fill=none alone so structure survives recoloring", () => {
    const out = recolor(TABLER_STAR.body, "#146EBE");
    expect(out).toContain('fill="none"');
    expect(out).toContain('stroke="#146EBE"');
  });

  it("maps colors per path, case-insensitively", () => {
    const out = recolorPalette(MULTICOLOR.body, { "#ff8787": "#000000" });
    expect(out).toContain('fill="#000000"');
    /* Unmapped colors must survive untouched. */
    expect(out).toContain('fill="#74C0FC"');
  });

  it("hands every paint to CSS for the styleable export", () => {
    const out = toCurrentColor(MULTICOLOR.body);
    expect(out).not.toContain("#FF8787");
    expect(out.match(/currentColor/g)).toHaveLength(2);
  });
});

describe("stroke", () => {
  it("reads declared widths", () => {
    expect(strokeWidths(TABLER_STAR.body)).toEqual([2]);
    expect(strokeWidths(MATERIAL_STAR.body)).toEqual([]);
    expect(hasStroke(MATERIAL_STAR.body)).toBe(false);
  });

  it("retargets to the requested width", () => {
    expect(retargetStroke(TABLER_STAR.body, 1.5)).toContain('stroke-width="1.5"');
  });

  it("scales mixed widths proportionally instead of flattening them", () => {
    const mixed = '<path stroke="#000" stroke-width="4" d="M0 0"/><path stroke="#000" stroke-width="2" d="M0 0"/>';
    const out = retargetStroke(mixed, 2);
    expect(out).toContain('stroke-width="2"');
    expect(out).toContain('stroke-width="1"');
  });

  it("inserts the attribute when the stroke relies on the implicit default", () => {
    const implicit = '<path stroke="currentColor" d="M0 0h24"/>';
    expect(retargetStroke(implicit, 1.5)).toContain('stroke-width="1.5"');
  });

  it("does nothing to artwork with no stroke at all", () => {
    expect(retargetStroke(MATERIAL_STAR.body, 1.5)).toBe(MATERIAL_STAR.body);
  });
});

describe("optical stroke normalization", () => {
  it("treats equal ratios on different grids as equal weight", () => {
    /* tabler 2-on-24 and icon-park-outline 4-on-48 look identical. */
    expect(strokeRatio(2, 24)).toBeCloseTo(strokeRatio(4, 48));
  });

  it("scales the anchor to each grid", () => {
    const anchor = strokeRatio(1.5, 24);
    expect(opticalStrokeTarget(anchor, 24)).toBe(1.5);
    expect(opticalStrokeTarget(anchor, 48)).toBe(3);
    expect(opticalStrokeTarget(anchor, 256)).toBe(16);
  });

  it("produces the same optical weight across grids after retargeting", () => {
    const anchor = strokeRatio(1.5, 24);
    const small = retargetStroke(
      '<path stroke="currentColor" stroke-width="2" d="M0 0h24"/>',
      opticalStrokeTarget(anchor, 24),
    );
    const large = retargetStroke(
      '<path stroke="currentColor" stroke-width="4" d="M0 0h48"/>',
      opticalStrokeTarget(anchor, 48),
    );
    expect(strokeRatio(Number(/stroke-width="([\d.]+)"/.exec(small)![1]), 24)).toBeCloseTo(
      strokeRatio(Number(/stroke-width="([\d.]+)"/.exec(large)![1]), 48),
    );
  });

  it("falls back to a 24 grid rather than dividing by zero", () => {
    expect(opticalStrokeTarget(strokeRatio(1.5, 24), 0)).toBe(1.5);
  });
});

describe("tier gating", () => {
  it("only lets T1 retarget stroke", () => {
    expect(capabilitiesFor("T1").strokeRetarget).toBe(true);
    for (const tier of ["T2", "T3", "T4"] as const) {
      expect(capabilitiesFor(tier).strokeRetarget).toBe(false);
    }
  });

  it("refuses recolor on T4 but always allows the asset catalog", () => {
    expect(capabilitiesFor("T4").recolor).toBe(false);
    for (const tier of ["T1", "T2", "T3", "T4"] as const) {
      expect(capabilitiesFor(tier).assetCatalog).toBe(true);
    }
  });

  it("drops edits the tier does not support rather than throwing", () => {
    const out = applyEdits(TABLER_STAR, { strokeWidth: 1 }, "T2");
    expect(out).toContain('stroke-width="2"');
  });

  it("applies the same edit when the tier allows it", () => {
    const out = applyEdits(TABLER_STAR, { strokeWidth: 1 }, "T1");
    expect(out).toContain('stroke-width="1"');
  });
});

describe("svg document", () => {
  it("keeps the intrinsic viewBox while resizing the box", () => {
    const svg = buildSvg(MATERIAL_STAR, { size: 128 }, "T2");
    expect(svg).toContain('width="128" height="128"');
    expect(svg).toContain('viewBox="0 0 24 24"');
  });

  it("wraps transforms in a group so the body is untouched", () => {
    const svg = buildSvg(MATERIAL_STAR, { rotate: 90 }, "T2");
    expect(svg).toContain("<g transform=\"rotate(90 12 12)\">");
  });

  it("insets the artwork for padding", () => {
    const svg = buildSvg(MATERIAL_STAR, { padding: 0.1 }, "T2");
    expect(svg).toContain("scale(0.8)");
  });
});

describe("jsx", () => {
  it("camelCases SVG attributes React would otherwise drop", () => {
    const out = toJsxBody(TABLER_STAR.body);
    expect(out).toContain("strokeLinecap=");
    expect(out).toContain("strokeWidth=");
    expect(out).not.toContain("stroke-width=");
  });

  it("does not touch path data that looks like an attribute", () => {
    expect(toJsxBody('<path d="M0 0h24"/>')).toContain('d="M0 0h24"');
  });

  it("names components in PascalCase and guards leading digits", () => {
    expect(componentName("tabler", "arrow-right")).toBe("TablerArrowRight");
    /* Digits inside the name are fine; only a leading one is illegal, and it
       can only come from the prefix since the prefix is always first. */
    expect(componentName("mdi", "24-hours")).toBe("Mdi24Hours");
    expect(componentName("3dicons", "cube")).toBe("Icon3diconsCube");
  });

  it("emits a typed component when asked", () => {
    const out = toJsxComponent(TABLER_STAR, {}, "T1", { typescript: true });
    expect(out).toContain('import type { SVGProps } from "react";');
    expect(out).toContain("export function TablerStar(props: SVGProps<SVGSVGElement>)");
    expect(out).toContain('viewBox="0 0 24 24"');
  });

  it("omits the type import for plain JSX", () => {
    const out = toJsxComponent(TABLER_STAR, {}, "T1");
    expect(out).not.toContain("SVGProps");
  });
});

describe("vue and svelte components", () => {
  it("emits a single-file component with defaulted props", () => {
    const out = toVueComponent(TABLER_STAR, {}, "T1");
    expect(out).toContain("<script setup>");
    expect(out).toContain("<template>");
    expect(out).toContain('viewBox="0 0 24 24"');
    expect(out).toContain(':width="size"');
    expect(out).toContain('default: "currentColor"');
    expect(out).toContain("v-bind=\"$attrs\"");
  });

  it("types the Vue props when asked", () => {
    const out = toVueComponent(TABLER_STAR, {}, "T1", { typescript: true });
    expect(out).toContain('<script setup lang="ts">');
    expect(out).toContain("defineProps<{ size?: number | string; color?: string }>()");
  });

  it("keeps SVG attributes as written - unlike JSX, neither framework renames", () => {
    for (const out of [
      toVueComponent(TABLER_STAR, {}, "T1"),
      toSvelteComponent(TABLER_STAR, {}, "T1"),
    ]) {
      expect(out).toContain("stroke-width=");
      expect(out).not.toContain("strokeWidth=");
    }
  });

  it("emits a Svelte component with prop passthrough", () => {
    const out = toSvelteComponent(TABLER_STAR, {}, "T1");
    expect(out).toContain("<script>");
    expect(out).toContain("$props()");
    expect(out).toContain("{...rest}");
    expect(out).toContain("width={size}");
  });

  it("types the Svelte props when asked", () => {
    const out = toSvelteComponent(TABLER_STAR, {}, "T1", { typescript: true });
    expect(out).toContain('<script lang="ts">');
    expect(out).toContain("SVGAttributes");
  });

  it("applies edits before wrapping, like every other format", () => {
    const vue = toVueComponent(TABLER_STAR, { strokeWidth: 1 }, "T1");
    const svelte = toSvelteComponent(TABLER_STAR, { strokeWidth: 1 }, "T1");
    expect(vue).toContain('stroke-width="1"');
    expect(svelte).toContain('stroke-width="1"');
  });

  it("names files after the component", () => {
    expect(componentFilename(TABLER_STAR, "vue")).toBe("TablerStar.vue");
    expect(componentFilename(TABLER_STAR, "svelte")).toBe("TablerStar.svelte");
  });
});

describe("export formats", () => {
  it("is the single source for the count quoted in copy", () => {
    expect(EXPORT_FORMATS).toHaveLength(9);
    expect(new Set(EXPORT_FORMATS.map((f) => f.id)).size).toBe(
      EXPORT_FORMATS.length,
    );
    for (const id of ["vue", "svelte"]) {
      expect(EXPORT_FORMATS.map((f) => f.id)).toContain(id);
    }
  });
});

describe("data uri", () => {
  it("round-trips base64", () => {
    const svg = buildSvg(MATERIAL_STAR, {}, "T2");
    const uri = toBase64DataUri(svg);
    expect(uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
    const decoded = Buffer.from(uri.split(",")[1]!, "base64").toString("utf8");
    expect(decoded).toBe(svg);
  });

});

describe("swiftui", () => {
  it("emits a Shape for single-color geometry", () => {
    const result = toSwiftUi(MATERIAL_STAR, {}, "T2");
    expect(result.kind).toBe("shape");
    expect(result.code).toContain("struct MaterialSymbolsStar: Shape");
    expect(result.code).toContain("path.move(to:");
    expect(result.code).toContain("path.closeSubpath()");
  });

  it("converts arcs to curves rather than dropping them", () => {
    const result = toSwiftUi(ARC_ICON, {}, "T2");
    expect(result.kind).toBe("shape");
    expect(result.code).toContain("path.addCurve(");
  });

  it("emits a layered View for multicolor artwork", () => {
    const result = toSwiftUi(MULTICOLOR, {}, "T3");
    expect(result.kind).toBe("view");
    expect(result.code).toContain("struct DemoDuo: View");
    expect(result.code).toContain("ZStack");
    expect(result.code).toContain("DemoDuoLayer0().fill(");
    expect(result.code).toContain("DemoDuoLayer1().fill(");
  });

  it("refuses masked artwork and points at the asset catalog", () => {
    const result = toSwiftUi(MASKED, {}, "T4");
    expect(result.kind).toBe("unsupported");
    expect(result.reason).toBe("mask");
    expect(result.code).toContain("asset catalog");
    /* A refusal must not look like usable code. */
    expect(result.code).not.toContain("struct DemoMasked: Shape");
  });

  it("converts hex paints to Color literals", () => {
    expect(toSwiftColor("#ffffff")).toBe(
      "Color(red: 1.0, green: 1.0, blue: 1.0)",
    );
    expect(toSwiftColor("#000")).toBe("Color(red: 0.0, green: 0.0, blue: 0.0)");
    expect(toSwiftColor("nonsense")).toBe(".primary");
  });
});

describe("swiftui golden files compile", () => {
  const swiftc = (() => {
    try {
      execFileSync("xcrun", ["--find", "swiftc"], { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!swiftc)(
    "typechecks generated Shape and View output against real SwiftUI",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "motificons-swift-"));
      const sdk = execFileSync("xcrun", ["--show-sdk-path"], {
        encoding: "utf8",
      }).trim();

      for (const [icon, tier] of [
        [TABLER_STAR, "T1"],
        [MATERIAL_STAR, "T2"],
        [ARC_ICON, "T2"],
        [MULTICOLOR, "T3"],
      ] as const) {
        const result = toSwiftUi(icon, {}, tier);
        const file = join(dir, `${result.typeName}.swift`);
        writeFileSync(file, result.code);
        expect(() =>
          execFileSync("xcrun", ["swiftc", "-typecheck", "-sdk", sdk, file], {
            stdio: "pipe",
          }),
        ).not.toThrow();
      }
    },
    120_000,
  );
});

describe("asset catalog", () => {
  it("builds an imageset with preserve-vector-data", () => {
    const result = toAssetCatalog(TABLER_STAR, {}, "T1");
    expect(result.filename).toBe("tabler-star.imageset.zip");
    expect(result.entries).toEqual([
      "tabler-star.imageset/Contents.json",
      "tabler-star.imageset/tabler-star.svg",
    ]);
    expect(contentsJson("x.svg")).toContain(
      '"preserves-vector-representation": true',
    );
  });

  it("sanitizes names Xcode would reject", () => {
    expect(assetName("simple-icons", "1001tracklists")).toBe(
      "simple-icons-1001tracklists",
    );
    expect(assetName("demo", "a.b/c")).toBe("demo-a-b-c");
  });
});

describe("zip", () => {
  it("computes the standard CRC32", () => {
    /* Known vector: CRC32("123456789") = 0xCBF43926. */
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("writes a structurally valid archive", () => {
    const zip = createZip([
      { path: "a/Contents.json", contents: "{}" },
      { path: "a/icon.svg", contents: "<svg/>" },
    ]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50); // local header
    /* End-of-central-directory record, last 22 bytes. */
    const end = zip.length - 22;
    expect(zip.readUInt32LE(end)).toBe(0x06054b50);
    expect(zip.readUInt16LE(end + 10)).toBe(2); // entry count
  });

  it("produces byte-identical output for identical input", () => {
    const entries = [{ path: "a.txt", contents: "hello" }];
    expect(createZip(entries).equals(createZip(entries))).toBe(true);
  });

  it("passes the system unzip integrity check", () => {
    const result = toAssetCatalog(TABLER_STAR, {}, "T1");
    const dir = mkdtempSync(join(tmpdir(), "motificons-zip-"));
    const file = join(dir, result.filename);
    writeFileSync(file, result.zip);

    const listing = execFileSync("unzip", ["-l", file], { encoding: "utf8" });
    expect(listing).toContain("tabler-star.imageset/Contents.json");
    expect(listing).toContain("tabler-star.imageset/tabler-star.svg");

    expect(
      execFileSync("unzip", ["-t", file], { encoding: "utf8" }),
    ).toContain("No errors detected");
  });
});

describe("png sizing", () => {
  it("clamps to a sane range and rounds", () => {
    expect(clampPngSize(0)).toBe(8);
    expect(clampPngSize(99_999)).toBe(2048);
    expect(clampPngSize(63.6)).toBe(64);
    expect(clampPngSize(Number.NaN)).toBe(512);
  });
});
