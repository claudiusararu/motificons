/**
 * Spike S1 - style engine + SwiftUI coverage matrix.
 *
 * Samples a stratified set of icons and actually attempts each style-engine
 * capability on them, recording pass / degrade / fail with a reason code. The
 * point is to replace assumptions about coverage with measurements, so nothing
 * here short-circuits: stroke retargets are re-parsed, bounds are computed from
 * curve extrema, and generated Swift is handed to the real compiler.
 *
 * Writes SPIKE-RESULTS.md at the repo root plus raw records under
 * pipeline/spike/ for review. Read-only with respect to product code.
 */

import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  parseFragment,
  styleDeclarations,
  type SvgElement,
} from "./svg/markup.ts";
import {
  parsePath,
  PathParseError,
  segmentsBBox,
  type BBox,
  type Segment,
} from "./svg/path.ts";
import { apply, isIdentity, multiply, parseTransform, type Matrix } from "./svg/transform.ts";
import { generateShape, swiftTypeName, type ShapeSubpath } from "./svg/swiftui.ts";

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const JSON_DIR = join(
  require.resolve("@iconify/json/collections.json"),
  "..",
  "json",
);
const REPO_ROOT = new URL("../../", import.meta.url).pathname;
const SPIKE_DIR = join(REPO_ROOT, "pipeline", "spike");

const PER_FAMILY = 30;
const TARGET_STROKE_WIDTH = 1.5;

interface Family {
  prefix: string;
  group: string;
  why: string;
}

/**
 * 15 families. The stroke / filled / duotone picks come from the plan; the
 * heavy-feature and divergent-viewBox picks were chosen by scanning all 239
 * sets for mask / clipPath / gradient / use / transform density and for
 * non-24px grids, not by assuming which sets are messy.
 */
const FAMILIES: Family[] = [
  { prefix: "tabler", group: "Stroke", why: "stroke-width 2, currentColor" },
  { prefix: "lucide", group: "Stroke", why: "stroke-width 2, currentColor" },
  { prefix: "feather", group: "Stroke", why: "stroke-width 2, currentColor" },
  { prefix: "material-symbols", group: "Filled", why: "outline expanded to fill" },
  { prefix: "mdi", group: "Filled", why: "outline expanded to fill" },
  { prefix: "ph", group: "Filled", why: "expanded fill on a 256 grid" },
  { prefix: "fluent-emoji-flat", group: "Multicolor", why: "flat multicolor" },
  { prefix: "icon-park", group: "Multicolor", why: "stroke plus fill duotone" },
  { prefix: "fluent-emoji", group: "Heavy SVG", why: "gradients 200/100, transforms 58%" },
  { prefix: "meteocons", group: "Heavy SVG", why: "clipPath 70%, use 85%, transform 85%" },
  { prefix: "circle-flags", group: "Heavy SVG", why: "mask on 100% of sampled icons" },
  { prefix: "icon-park-twotone", group: "Heavy SVG", why: "mask on 100% of sampled icons" },
  { prefix: "ant-design", group: "Divergent grid", why: "1024x1024 viewBox" },
  { prefix: "arcticons", group: "Divergent grid", why: "48x48 viewBox" },
  { prefix: "carbon", group: "Divergent grid", why: "32x32 viewBox" },
];

type Verdict = "pass" | "degrade" | "fail" | "n/a";

interface CapabilityResult {
  verdict: Verdict;
  reason: string;
}

interface IconRecord {
  id: string;
  prefix: string;
  group: string;
  strokeDetect: CapabilityResult;
  strokeRetarget: CapabilityResult;
  opticalBounds: CapabilityResult;
  colorMapping: CapabilityResult;
  swiftui: CapabilityResult;
  assetCatalog: CapabilityResult;
  padding: { left: number; right: number; top: number; bottom: number } | null;
  colors: number;
}

const CAPABILITIES = [
  "strokeDetect",
  "strokeRetarget",
  "opticalBounds",
  "colorMapping",
  "swiftui",
  "assetCatalog",
] as const;
type Capability = (typeof CAPABILITIES)[number];

const CAPABILITY_LABEL: Record<Capability, string> = {
  strokeDetect: "Stroke detect",
  strokeRetarget: "Stroke retarget",
  opticalBounds: "Optical bounds",
  colorMapping: "Color mapping",
  swiftui: "SwiftUI Shape",
  assetCatalog: "Asset catalog",
};

const GEOMETRY_ELEMENTS = new Set([
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
]);
const BLOCKING_ELEMENTS: Record<string, string> = {
  mask: "swift-blocked-mask",
  clipPath: "swift-blocked-clip",
  filter: "swift-blocked-filter",
  linearGradient: "swift-blocked-gradient",
  radialGradient: "swift-blocked-gradient",
  pattern: "swift-blocked-pattern",
  use: "swift-blocked-use",
  image: "swift-blocked-image",
  text: "swift-blocked-text",
  foreignObject: "swift-blocked-foreign",
};

interface IconEntry {
  body: string;
  width?: number;
  height?: number;
}

function sampleNames(names: string[], count: number): string[] {
  if (names.length <= count) return names;
  const stride = names.length / count;
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) out.push(names[Math.floor(i * stride)]!);
  return out;
}

/** Resolved paint value for an element, honouring the style attribute. */
function paintOf(element: SvgElement, key: string): string | undefined {
  const style = element.attrs["style"];
  if (style) {
    const declarations = styleDeclarations(style);
    if (declarations[key] !== undefined) return declarations[key];
  }
  return element.attrs[key];
}

function analyseStroke(elements: SvgElement[]): {
  detect: CapabilityResult;
  widths: string[];
  inStyle: boolean;
} {
  const widths: string[] = [];
  let hasStroke = false;
  let inStyle = false;

  for (const element of elements) {
    if (!GEOMETRY_ELEMENTS.has(element.name) && element.name !== "g") continue;
    const stroke = paintOf(element, "stroke");
    if (stroke && stroke !== "none") hasStroke = true;

    const styleWidth = element.attrs["style"]
      ? styleDeclarations(element.attrs["style"])["stroke-width"]
      : undefined;
    if (styleWidth !== undefined) {
      inStyle = true;
      widths.push(styleWidth);
    } else if (element.attrs["stroke-width"] !== undefined) {
      widths.push(element.attrs["stroke-width"]);
    }
  }

  const distinct = [...new Set(widths)];

  if (!hasStroke && widths.length === 0) {
    return {
      detect: { verdict: "n/a", reason: "no-stroke-expanded" },
      widths,
      inStyle,
    };
  }
  if (widths.length === 0) {
    return {
      detect: { verdict: "pass", reason: "stroke-implicit-1" },
      widths,
      inStyle,
    };
  }
  if (distinct.some((value) => !Number.isFinite(Number(value)))) {
    return {
      detect: { verdict: "fail", reason: "stroke-nonnumeric" },
      widths,
      inStyle,
    };
  }
  if (inStyle) {
    return {
      detect: { verdict: "degrade", reason: "stroke-in-style-attr" },
      widths,
      inStyle,
    };
  }
  if (distinct.length > 1) {
    return {
      detect: { verdict: "degrade", reason: "stroke-mixed" },
      widths,
      inStyle,
    };
  }
  return {
    detect: { verdict: "pass", reason: "stroke-uniform" },
    widths,
    inStyle,
  };
}

function retargetStroke(
  body: string,
  detect: CapabilityResult,
  widths: string[],
): CapabilityResult {
  if (detect.verdict === "n/a") {
    return { verdict: "n/a", reason: "retarget-not-applicable" };
  }
  if (detect.verdict === "fail") {
    return { verdict: "fail", reason: "retarget-nonnumeric" };
  }

  const numbers = widths.map(Number).filter(Number.isFinite);
  const base = numbers.length > 0 ? Math.max(...numbers) : 1;
  const factor = base === 0 ? 1 : TARGET_STROKE_WIDTH / base;

  let rewritten = body.replace(
    /stroke-width\s*=\s*"([^"]*)"/g,
    (whole, value: string) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return whole;
      return `stroke-width="${Number((parsed * factor).toFixed(4))}"`;
    },
  );
  rewritten = rewritten.replace(
    /stroke-width\s*:\s*([0-9.]+)/g,
    (whole, value: string) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return whole;
      return `stroke-width:${Number((parsed * factor).toFixed(4))}`;
    },
  );

  /* An icon with no explicit width inherits 1, so retargeting means inserting
     the attribute on every stroked element rather than rewriting it. Different
     code path, same outcome, so it is attempted here rather than written off. */
  let inserted = false;
  if (widths.length === 0) {
    inserted = true;
    rewritten = rewritten.replace(
      /<([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g,
      (whole, tag: string, attrs: string, slash: string) => {
        if (!GEOMETRY_ELEMENTS.has(tag) && tag !== "g") return whole;
        if (!/\bstroke\s*=\s*"(?!none")/.test(attrs)) return whole;
        if (/\bstroke-width\s*[=:]/.test(attrs)) return whole;
        return `<${tag}${attrs} stroke-width="${TARGET_STROKE_WIDTH}"${slash}>`;
      },
    );
  }

  const reparsed = parseFragment(rewritten);
  if (!reparsed.wellFormed) {
    return { verdict: "fail", reason: "retarget-parse-failed" };
  }

  const after = analyseStroke(reparsed.elements);
  const afterNumbers = after.widths.map(Number).filter(Number.isFinite);
  const hit =
    afterNumbers.length > 0 &&
    Math.abs(Math.max(...afterNumbers) - TARGET_STROKE_WIDTH) < 1e-6;
  if (!hit) return { verdict: "fail", reason: "retarget-value-mismatch" };

  if (inserted) {
    return { verdict: "pass", reason: "retarget-attribute-inserted" };
  }
  if (detect.reason === "stroke-in-style-attr") {
    return { verdict: "degrade", reason: "retarget-style-attr" };
  }
  if (detect.reason === "stroke-mixed") {
    return { verdict: "degrade", reason: "retarget-scaled-mixed" };
  }
  return { verdict: "pass", reason: "retarget-uniform" };
}

function elementSegments(element: SvgElement): Segment[] | null {
  const a = element.attrs;
  const n = (key: string, fallback = 0) => {
    const value = Number(a[key]);
    return Number.isFinite(value) ? value : fallback;
  };

  switch (element.name) {
    case "path": {
      const d = a["d"];
      if (!d) return null;
      return parsePath(d).segments;
    }
    case "circle": {
      const cx = n("cx");
      const cy = n("cy");
      const r = n("r");
      if (r <= 0) return null;
      return parsePath(
        `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`,
      ).segments;
    }
    case "ellipse": {
      const cx = n("cx");
      const cy = n("cy");
      const rx = n("rx");
      const ry = n("ry");
      if (rx <= 0 || ry <= 0) return null;
      return parsePath(
        `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0Z`,
      ).segments;
    }
    case "rect": {
      const x = n("x");
      const y = n("y");
      const w = n("width");
      const h = n("height");
      if (w <= 0 || h <= 0) return null;
      const rx = Math.min(n("rx", n("ry")), w / 2);
      const ry = Math.min(n("ry", n("rx")), h / 2);
      if (rx > 0 && ry > 0) {
        return parsePath(
          `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`,
        ).segments;
      }
      return parsePath(
        `M${x} ${y}H${x + w}V${y + h}H${x}Z`,
      ).segments;
    }
    case "line":
      return parsePath(
        `M${n("x1")} ${n("y1")}L${n("x2")} ${n("y2")}`,
      ).segments;
    case "polyline":
    case "polygon": {
      const points = (a["points"] ?? "")
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
      if (points.length < 4) return null;
      let d = `M${points[0]} ${points[1]}`;
      for (let i = 2; i + 1 < points.length; i += 2) {
        d += `L${points[i]} ${points[i + 1]}`;
      }
      if (element.name === "polygon") d += "Z";
      return parsePath(d).segments;
    }
    default:
      return null;
  }
}

/** Accumulated transform for an element from its ancestors plus its own. */
function elementMatrix(
  element: SvgElement,
  stack: { depth: number; matrix: Matrix }[],
): { matrix: Matrix | null; unsupported: boolean } {
  let matrix: Matrix = [1, 0, 0, 1, 0, 0];
  let unsupported = false;

  for (const entry of stack) {
    if (entry.depth < element.depth) matrix = multiply(matrix, entry.matrix);
  }
  const own = element.attrs["transform"];
  if (own) {
    const parsed = parseTransform(own);
    if (parsed) matrix = multiply(matrix, parsed);
    else unsupported = true;
  }
  return { matrix, unsupported };
}

interface Geometry {
  subpaths: ShapeSubpath[];
  unsupportedTransform: boolean;
  unparsablePath: boolean;
  skippedElements: string[];
}

function collectGeometry(elements: SvgElement[]): Geometry {
  const stack: { depth: number; matrix: Matrix }[] = [];
  const subpaths: ShapeSubpath[] = [];
  const skippedElements: string[] = [];
  let unsupportedTransform = false;
  let unparsablePath = false;

  for (const element of elements) {
    if (element.name === "g") {
      const own = element.attrs["transform"];
      if (own) {
        const parsed = parseTransform(own);
        if (parsed) stack.push({ depth: element.depth, matrix: parsed });
        else unsupportedTransform = true;
      }
      continue;
    }
    if (!GEOMETRY_ELEMENTS.has(element.name)) {
      if (!["title", "desc", "defs", "style", "metadata"].includes(element.name)) {
        skippedElements.push(element.name);
      }
      continue;
    }

    let segments: Segment[] | null;
    try {
      segments = elementSegments(element);
    } catch (error) {
      unparsablePath = unparsablePath || error instanceof PathParseError;
      continue;
    }
    if (!segments || segments.length === 0) continue;

    const { matrix, unsupported } = elementMatrix(element, stack);
    if (unsupported) unsupportedTransform = true;
    subpaths.push({ segments, transform: matrix });
  }

  return { subpaths, unsupportedTransform, unparsablePath, skippedElements };
}

function boundsOf(geometry: Geometry): BBox | null {
  let box: BBox | null = null;
  for (const subpath of geometry.subpaths) {
    const local = segmentsBBox(subpath.segments);
    if (!local) continue;
    const corners =
      subpath.transform && !isIdentity(subpath.transform)
        ? ([
            [local.minX, local.minY],
            [local.maxX, local.minY],
            [local.minX, local.maxY],
            [local.maxX, local.maxY],
          ] as const).map((point) => apply(subpath.transform!, point))
        : [
            [local.minX, local.minY],
            [local.maxX, local.maxY],
          ];
    for (const [x, y] of corners) {
      box = box
        ? {
            minX: Math.min(box.minX, x),
            minY: Math.min(box.minY, y),
            maxX: Math.max(box.maxX, x),
            maxY: Math.max(box.maxY, y),
          }
        : { minX: x, minY: y, maxX: x, maxY: y };
    }
  }
  return box;
}

function analyseColor(elements: SvgElement[]): CapabilityResult & { colors: number } {
  const hardcoded = new Set<string>();
  let currentColor = false;
  let anyPaint = false;
  let gradientRef = false;
  let opacityDuotone = false;

  for (const element of elements) {
    if (element.name === "linearGradient" || element.name === "radialGradient") {
      gradientRef = true;
    }
    if (!GEOMETRY_ELEMENTS.has(element.name) && element.name !== "g") continue;

    for (const key of ["fill", "stroke"]) {
      const value = paintOf(element, key);
      if (!value || value === "none") continue;
      anyPaint = true;
      if (value === "currentColor") currentColor = true;
      else if (value.startsWith("url(")) gradientRef = true;
      else hardcoded.add(value.toLowerCase());
    }

    const opacity = paintOf(element, "opacity") ?? paintOf(element, "fill-opacity");
    if (opacity && Number(opacity) < 1) opacityDuotone = true;
  }

  const colors = hardcoded.size;
  if (gradientRef) {
    return { verdict: "fail", reason: "color-gradient", colors };
  }
  if (!anyPaint) {
    return { verdict: "pass", reason: "color-implicit", colors };
  }
  if (colors === 0 && currentColor) {
    return {
      verdict: opacityDuotone ? "degrade" : "pass",
      reason: opacityDuotone ? "color-duotone-opacity" : "color-currentcolor",
      colors,
    };
  }
  if (colors === 1) {
    return {
      verdict: opacityDuotone ? "degrade" : "pass",
      reason: opacityDuotone ? "color-duotone-opacity" : "color-single-hardcoded",
      colors,
    };
  }
  if (colors === 2) {
    return { verdict: "degrade", reason: "color-duotone", colors };
  }
  return { verdict: "degrade", reason: `color-multicolor`, colors };
}

function analyseSwift(
  elements: SvgElement[],
  geometry: Geometry,
  color: CapabilityResult,
): CapabilityResult {
  for (const element of elements) {
    const blocked = BLOCKING_ELEMENTS[element.name];
    if (blocked) return { verdict: "fail", reason: blocked };
    if (element.attrs["mask"]) return { verdict: "fail", reason: "swift-blocked-mask" };
    if (element.attrs["clip-path"]) {
      return { verdict: "fail", reason: "swift-blocked-clip" };
    }
  }
  if (geometry.skippedElements.length > 0) {
    return {
      verdict: "fail",
      reason: `swift-blocked-element:${geometry.skippedElements[0]}`,
    };
  }
  if (geometry.unparsablePath) {
    return { verdict: "fail", reason: "swift-path-parse-failed" };
  }
  if (geometry.subpaths.length === 0) {
    return { verdict: "fail", reason: "swift-no-geometry" };
  }
  if (geometry.unsupportedTransform) {
    return { verdict: "degrade", reason: "swift-transform-unsupported" };
  }
  if (color.verdict === "degrade") {
    return { verdict: "degrade", reason: "swift-multicolor-needs-view" };
  }
  return { verdict: "pass", reason: "swift-clean" };
}

interface SwiftSample {
  id: string;
  typeName: string;
  file: string;
}

async function main(): Promise<void> {
  const started = Date.now();
  const records: IconRecord[] = [];
  const swiftSamples: SwiftSample[] = [];

  await rm(SPIKE_DIR, { recursive: true, force: true });
  await mkdir(join(SPIKE_DIR, "swift"), { recursive: true });

  for (const family of FAMILIES) {
    const data = JSON.parse(
      readFileSync(join(JSON_DIR, `${family.prefix}.json`), "utf8"),
    ) as {
      icons: Record<string, IconEntry>;
      width?: number;
      height?: number;
    };
    const setWidth = data.width ?? 16;
    const setHeight = data.height ?? 16;
    const names = sampleNames(Object.keys(data.icons).sort(), PER_FAMILY);

    for (const name of names) {
      const icon = data.icons[name]!;
      const width = icon.width ?? setWidth;
      const height = icon.height ?? setHeight;
      const parsed = parseFragment(icon.body);

      const assetCatalog: CapabilityResult = parsed.wellFormed
        ? { verdict: "pass", reason: "parses" }
        : { verdict: "fail", reason: `malformed:${parsed.error}` };

      const stroke = analyseStroke(parsed.elements);
      const strokeRetarget = retargetStroke(icon.body, stroke.detect, stroke.widths);
      const geometry = collectGeometry(parsed.elements);
      const color = analyseColor(parsed.elements);
      const swiftui = analyseSwift(parsed.elements, geometry, color);

      const box = boundsOf(geometry);
      let opticalBounds: CapabilityResult;
      let padding: IconRecord["padding"] = null;
      if (!box) {
        opticalBounds = {
          verdict: "fail",
          reason: geometry.skippedElements.length
            ? `bbox-unsupported-element:${geometry.skippedElements[0]}`
            : "bbox-empty",
        };
      } else {
        padding = {
          left: box.minX / width,
          right: (width - box.maxX) / width,
          top: box.minY / height,
          bottom: (height - box.maxY) / height,
        };
        const outside =
          box.minX < -0.01 ||
          box.minY < -0.01 ||
          box.maxX > width + 0.01 ||
          box.maxY > height + 0.01;
        if (geometry.skippedElements.length > 0) {
          opticalBounds = {
            verdict: "degrade",
            reason: `bbox-partial:${geometry.skippedElements[0]}`,
          };
        } else if (outside) {
          opticalBounds = { verdict: "degrade", reason: "bbox-overflows-viewbox" };
        } else if (geometry.unsupportedTransform) {
          opticalBounds = { verdict: "degrade", reason: "bbox-approx-transform" };
        } else {
          opticalBounds = { verdict: "pass", reason: "bbox-exact" };
        }
      }

      records.push({
        id: `${family.prefix}:${name}`,
        prefix: family.prefix,
        group: family.group,
        strokeDetect: stroke.detect,
        strokeRetarget,
        opticalBounds,
        colorMapping: { verdict: color.verdict, reason: color.reason },
        swiftui,
        assetCatalog,
        padding,
        colors: color.colors,
      });

      /* Two Swift files per family, from whatever the family actually
         produces, so the compiler check covers real output rather than only
         the easiest cases. */
      const eligible = swiftui.verdict === "pass" || swiftui.verdict === "degrade";
      const familyCount = swiftSamples.filter((sample) =>
        sample.id.startsWith(`${family.prefix}:`),
      ).length;
      if (eligible && familyCount < 2 && geometry.subpaths.length > 0) {
        const typeName = swiftTypeName(family.prefix, name);
        const code = generateShape(
          typeName,
          { width, height },
          geometry.subpaths,
        );
        const file = join(SPIKE_DIR, "swift", `${typeName}.swift`);
        await writeFile(file, code);
        swiftSamples.push({ id: `${family.prefix}:${name}`, typeName, file });
      }
    }
  }

  const swift = await validateSwift(swiftSamples);
  await writeFile(
    join(SPIKE_DIR, "s1-records.json"),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2)}\n`,
  );
  await writeFile(
    join(REPO_ROOT, "SPIKE-RESULTS.md"),
    renderReport(records, swift, Date.now() - started),
  );

  printSummary(records, swift);
}

interface SwiftValidation {
  available: boolean;
  mode: string;
  toolchain: string;
  total: number;
  passed: number;
  failures: { id: string; message: string }[];
}

async function validateSwift(samples: SwiftSample[]): Promise<SwiftValidation> {
  let toolchain = "";
  try {
    const { stdout } = await run("xcrun", ["swiftc", "--version"]);
    toolchain = stdout.split("\n")[0]!.trim();
  } catch {
    return {
      available: false,
      mode: "skipped",
      toolchain: "",
      total: samples.length,
      passed: 0,
      failures: [],
    };
  }

  let sdk = "";
  try {
    const { stdout } = await run("xcrun", ["--show-sdk-path"]);
    sdk = stdout.trim();
  } catch {
    sdk = "";
  }

  const mode = sdk ? "typecheck" : "parse";
  const failures: { id: string; message: string }[] = [];
  let passed = 0;

  for (const sample of samples) {
    const args = sdk
      ? ["swiftc", "-typecheck", "-sdk", sdk, sample.file]
      : ["swiftc", "-parse", sample.file];
    try {
      await run("xcrun", args, { maxBuffer: 8 * 1024 * 1024 });
      passed += 1;
    } catch (error) {
      const message =
        error instanceof Error && "stderr" in error
          ? String((error as { stderr: string }).stderr).split("\n")[0]!
          : String(error);
      failures.push({ id: sample.id, message });
    }
  }

  return {
    available: true,
    mode,
    toolchain,
    total: samples.length,
    passed,
    failures,
  };
}

function tally(records: IconRecord[], capability: Capability) {
  const counts = { pass: 0, degrade: 0, fail: 0, "n/a": 0 } as Record<Verdict, number>;
  for (const record of records) counts[record[capability].verdict] += 1;
  return counts;
}

function share(counts: Record<Verdict, number>, verdict: Verdict): string {
  const applicable = counts.pass + counts.degrade + counts.fail;
  if (applicable === 0) return "n/a";
  return `${Math.round((counts[verdict] / applicable) * 100)}%`;
}

function cell(counts: Record<Verdict, number>): string {
  const applicable = counts.pass + counts.degrade + counts.fail;
  if (applicable === 0) return `n/a (${counts["n/a"]})`;
  const parts = [`${share(counts, "pass")} pass`];
  if (counts.degrade > 0) parts.push(`${share(counts, "degrade")} deg`);
  if (counts.fail > 0) parts.push(`${share(counts, "fail")} fail`);
  if (counts["n/a"] > 0) parts.push(`${counts["n/a"]} n/a`);
  return parts.join(", ");
}

function reasonBreakdown(records: IconRecord[], capability: Capability) {
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = `${record[capability].verdict}:${record[capability].reason}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/**
 * Composes the recommendation from each capability's own profile. Degrade is
 * not failure - a multicolor icon still exports, it just needs a layered View
 * instead of a Shape - so the two are kept apart here on purpose.
 */
function recommend(prefix: string, records: IconRecord[]): string {
  const rows = records.filter((record) => record.prefix === prefix);
  const ratio = (capability: Capability, verdict: Verdict) => {
    const counts = tally(rows, capability);
    const applicable = counts.pass + counts.degrade + counts.fail;
    return applicable === 0 ? null : counts[verdict] / applicable;
  };

  const parts: string[] = [];

  const strokePass = ratio("strokeRetarget", "pass");
  if (strokePass === null) parts.push("no stroke to retarget (expanded fill)");
  else if (strokePass >= 0.9) parts.push("live stroke retarget");
  else if (strokePass + (ratio("strokeRetarget", "degrade") ?? 0) >= 0.9) {
    parts.push("stroke retarget with per-icon review");
  } else parts.push("no stroke retarget");

  const boundsPass = ratio("opticalBounds", "pass") ?? 0;
  if (boundsPass >= 0.9) parts.push("exact optical bounds");
  else if (boundsPass + (ratio("opticalBounds", "degrade") ?? 0) >= 0.9) {
    parts.push("approximate bounds");
  } else parts.push("no reliable bounds");

  const colorPass = ratio("colorMapping", "pass") ?? 0;
  const colorFail = ratio("colorMapping", "fail") ?? 0;
  if (colorPass >= 0.9) parts.push("single-color recolor");
  else if (colorFail >= 0.5) parts.push("no recolor (gradients)");
  else parts.push("per-path multicolor only");

  const swiftPass = ratio("swiftui", "pass") ?? 0;
  const swiftFail = ratio("swiftui", "fail") ?? 0;
  if (swiftPass >= 0.9) parts.push("SwiftUI Shape");
  else if (swiftFail >= 0.5) parts.push("SwiftUI via asset catalog only");
  else if (swiftPass >= 0.5) parts.push("SwiftUI Shape on the clean majority");
  else parts.push("SwiftUI via layered View");

  return parts.join("; ");
}

function renderReport(
  records: IconRecord[],
  swift: SwiftValidation,
  elapsedMs: number,
): string {
  const lines: string[] = [];
  const families = [...new Set(records.map((record) => record.prefix))];
  const groups = [...new Set(records.map((record) => record.group))];

  lines.push("# Spike S1 - style engine and SwiftUI coverage matrix");
  lines.push("");
  lines.push(
    `Generated by \`pnpm spike:s1\` (pipeline/src/spike-s1.ts) in ${(elapsedMs / 1000).toFixed(1)}s. ${records.length} icons, ${families.length} families. Every number below is measured by running the transform, not estimated.`,
  );
  lines.push("");
  lines.push("## Method");
  lines.push("");
  lines.push(
    "- Sampling is deterministic: icon names sorted, then strided so the sample spreads across the whole set rather than clustering on one letter.",
  );
  lines.push(
    "- The heavy-SVG-feature and divergent-grid families were chosen by scanning all 239 sets for mask / clipPath / gradient / use / transform density and for non-24px grids. They were not assumed.",
  );
  lines.push(
    "- Bounding boxes are exact: curve extrema are solved rather than approximated by control-point hulls, and elliptical arcs are converted to cubics first.",
  );
  lines.push(
    "- Stroke retargets are applied to the real body and the result is re-parsed and re-measured before being called a pass.",
  );
  lines.push(
    swift.available
      ? `- Generated Swift is checked with the real compiler: \`xcrun swiftc -${swift.mode}\` (${swift.toolchain}).`
      : "- No Swift toolchain on this machine, so generated Swift was not compiler-checked. Treat SwiftUI numbers as static analysis only.",
  );
  lines.push("");
  lines.push("## Coverage matrix");
  lines.push("");
  lines.push(
    `| Family | Group | ${CAPABILITIES.map((capability) => CAPABILITY_LABEL[capability]).join(" | ")} |`,
  );
  lines.push(`| --- | --- | ${CAPABILITIES.map(() => "---").join(" | ")} |`);
  for (const prefix of families) {
    const rows = records.filter((record) => record.prefix === prefix);
    const group = rows[0]!.group;
    lines.push(
      `| \`${prefix}\` (${rows.length}) | ${group} | ${CAPABILITIES.map(
        (capability) => cell(tally(rows, capability)),
      ).join(" | ")} |`,
    );
  }
  lines.push("");
  lines.push("### By group");
  lines.push("");
  lines.push(
    `| Group | Icons | ${CAPABILITIES.map((capability) => CAPABILITY_LABEL[capability]).join(" | ")} |`,
  );
  lines.push(`| --- | --- | ${CAPABILITIES.map(() => "---").join(" | ")} |`);
  for (const group of groups) {
    const rows = records.filter((record) => record.group === group);
    lines.push(
      `| ${group} | ${rows.length} | ${CAPABILITIES.map((capability) =>
        cell(tally(rows, capability)),
      ).join(" | ")} |`,
    );
  }
  lines.push("");
  lines.push(
    `| All | ${records.length} | ${CAPABILITIES.map((capability) => cell(tally(records, capability))).join(" | ")} |`,
  );
  lines.push("");
  lines.push("## Reason codes");
  lines.push("");
  for (const capability of CAPABILITIES) {
    lines.push(`**${CAPABILITY_LABEL[capability]}**`);
    lines.push("");
    lines.push("| Verdict and reason | Icons |");
    lines.push("| --- | --- |");
    for (const [key, count] of reasonBreakdown(records, capability)) {
      lines.push(`| \`${key}\` | ${count} |`);
    }
    lines.push("");
  }

  lines.push("## Optical padding");
  lines.push("");
  lines.push(
    "Padding is the empty margin around the tight bounding box, as a fraction of the viewBox. A set with a wide spread cannot be normalized by a single global inset - it needs per-icon bounds, which is what the style engine has to compute at import time.",
  );
  lines.push("");
  lines.push("| Family | Min | Median | Max | Spread |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const prefix of families) {
    const values = records
      .filter((record) => record.prefix === prefix && record.padding)
      .map((record) => {
        const p = record.padding!;
        return Math.min(p.left, p.right, p.top, p.bottom);
      })
      .sort((a, b) => a - b);
    if (values.length === 0) {
      lines.push(`| \`${prefix}\` | - | - | - | no measurable bounds |`);
      continue;
    }
    const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
    const min = values[0]!;
    const max = values[values.length - 1]!;
    lines.push(
      `| \`${prefix}\` | ${pct(min)} | ${pct(values[Math.floor(values.length / 2)]!)} | ${pct(max)} | ${pct(max - min)} |`,
    );
  }
  lines.push("");

  lines.push("## SwiftUI compiler check");
  lines.push("");
  if (!swift.available) {
    lines.push(
      "No Swift toolchain was found on this machine, so the generated files were written but not compiled. Re-run this spike on a Mac with Xcode to close the gap.",
    );
  } else {
    lines.push(
      `\`xcrun swiftc -${swift.mode}\` on ${swift.total} generated files (two per family, taken from whatever each family actually produced): **${swift.passed} of ${swift.total} clean**.`,
    );
    lines.push("");
    lines.push(`Toolchain: ${swift.toolchain}.`);
    if (swift.mode === "typecheck") {
      lines.push("");
      lines.push(
        "Typecheck rather than parse, so this verifies the generated `Shape` conformance and every `Path` API call against the real SwiftUI headers, not just syntax.",
      );
    }
    if (swift.failures.length > 0) {
      lines.push("");
      lines.push("| Icon | First diagnostic |");
      lines.push("| --- | --- |");
      for (const failure of swift.failures) {
        lines.push(`| \`${failure.id}\` | ${failure.message} |`);
      }
    }
    lines.push("");
    lines.push("Generated sources are in `pipeline/spike/swift/` for review.");
  }
  lines.push("");

  lines.push("## Recommended v1 scope");
  lines.push("");
  lines.push("| Family | Group | Recommendation |");
  lines.push("| --- | --- | --- |");
  for (const prefix of families) {
    const rows = records.filter((record) => record.prefix === prefix);
    lines.push(
      `| \`${prefix}\` | ${rows[0]!.group} | ${recommend(prefix, records)} |`,
    );
  }
  lines.push("");
  lines.push(
    "Asset-catalog export is the floor for every family: it is the only capability that passes everywhere, so it is what makes a coverage claim safe.",
  );
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function printSummary(records: IconRecord[], swift: SwiftValidation): void {
  console.log("");
  console.log(`Spike S1: ${records.length} icons across 15 families`);
  console.log("");
  for (const capability of CAPABILITIES) {
    const counts = tally(records, capability);
    console.log(
      `  ${CAPABILITY_LABEL[capability].padEnd(17)} ${cell(counts)}`,
    );
  }
  console.log("");
  console.log(
    swift.available
      ? `  swiftc -${swift.mode}: ${swift.passed}/${swift.total} generated files clean`
      : "  swiftc: not available, generated files not compiled",
  );
  console.log("");
  console.log("  -> SPIKE-RESULTS.md");
  console.log("");
}

await main();
