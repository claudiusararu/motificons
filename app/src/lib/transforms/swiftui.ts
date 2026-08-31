/**
 * SwiftUI code generation.
 *
 * Three outcomes, decided by what the artwork actually contains rather than by
 * optimism, measured across the real icon corpus:
 *
 *   Shape  - single-colour geometry becomes a `Shape` the caller can fill,
 *            stroke and animate like any other SwiftUI shape.
 *   View   - multicolour art becomes a `View` layering one Shape per colour,
 *            because a Shape has exactly one fill and pretending otherwise
 *            would silently flatten the artwork.
 *   Refuse - masks, clips and gradients have no honest Path equivalent. We say
 *            so and point at the asset catalog, which handles 100% of icons.
 *
 * Refusing is a feature. A generator that emits plausible-looking Swift for an
 * icon it cannot actually reproduce costs the user more than a clear no.
 */

import type { IconSource, Tier } from "../data";
import { applyEdits, type IconEdits } from "./svg-doc";
import { collectGeometry, type Subpath } from "./geometry";
import { apply, isIdentity, type Matrix } from "./svg/transform";
import type { Point } from "./svg/path";

export type SwiftUiKind = "shape" | "view" | "unsupported";

export interface SwiftUiResult {
  kind: SwiftUiKind;
  typeName: string;
  code: string;
  /** Present when kind is "unsupported". */
  reason?: string;
}

function num(value: number): string {
  if (!Number.isFinite(value)) return "0.0";
  const rounded = Number(value.toFixed(4));
  return Number.isInteger(rounded) ? `${rounded}.0` : `${rounded}`;
}

function pt(point: Point, transform: Matrix | null): string {
  const [x, y] =
    transform && !isIdentity(transform) ? apply(transform, point) : point;
  return `p(${num(x)}, ${num(y)})`;
}

export function swiftTypeName(prefix: string, name: string): string {
  const camel = `${prefix}-${name}`
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return /^[0-9]/.test(camel) ? `Icon${camel}` : camel;
}

function emitPath(subpaths: Subpath[], indent: string): string[] {
  const lines: string[] = [];
  for (const subpath of subpaths) {
    for (const segment of subpath.segments) {
      switch (segment.type) {
        case "M":
          lines.push(`${indent}path.move(to: ${pt(segment.to, subpath.transform)})`);
          break;
        case "L":
          lines.push(
            `${indent}path.addLine(to: ${pt(segment.to, subpath.transform)})`,
          );
          break;
        case "C":
          lines.push(
            `${indent}path.addCurve(to: ${pt(segment.to, subpath.transform)}, control1: ${pt(segment.c1, subpath.transform)}, control2: ${pt(segment.c2, subpath.transform)})`,
          );
          break;
        case "Q":
          lines.push(
            `${indent}path.addQuadCurve(to: ${pt(segment.to, subpath.transform)}, control: ${pt(segment.c, subpath.transform)})`,
          );
          break;
        case "Z":
          lines.push(`${indent}path.closeSubpath()`);
          break;
      }
    }
  }
  return lines;
}

function scalePreamble(
  icon: IconSource,
  indent: string,
): string[] {
  return [
    `${indent}let vw = ${num(icon.width)}`,
    `${indent}let vh = ${num(icon.height)}`,
    `${indent}let s = min(rect.width / vw, rect.height / vh)`,
    `${indent}let ox = rect.minX + (rect.width - vw * s) / 2`,
    `${indent}let oy = rect.minY + (rect.height - vh * s) / 2`,
    `${indent}func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }`,
  ];
}

/** #RGB, #RRGGBB or a named colour to a SwiftUI Color literal. */
export function toSwiftColor(paint: string): string {
  const hex = paint.trim().replace(/^#/, "");
  const expanded =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => char + char)
          .join("")
      : hex;

  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return ".primary";

  const channel = (offset: number) =>
    num(Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255);

  return `Color(red: ${channel(0)}, green: ${channel(2)}, blue: ${channel(4)})`;
}

export function toSwiftUi(
  icon: IconSource,
  edits: IconEdits,
  tier: Tier,
): SwiftUiResult {
  const typeName = swiftTypeName(icon.prefix, icon.name);
  const body = applyEdits(icon, edits, tier);
  const geometry = collectGeometry(body);

  if (geometry.blocked) {
    return {
      kind: "unsupported",
      typeName,
      reason: geometry.blockedBy ?? "unsupported-feature",
      code: unsupportedNote(icon, geometry.blockedBy ?? "an unsupported feature"),
    };
  }
  if (geometry.subpaths.length === 0) {
    return {
      kind: "unsupported",
      typeName,
      reason: "no-geometry",
      code: unsupportedNote(icon, "no path geometry"),
    };
  }

  /* Group by fill so a multicolour icon becomes one layer per colour rather
     than one layer per path - fewer shapes, and it matches how the artwork
     was drawn. */
  const byColor = new Map<string, Subpath[]>();
  for (const subpath of geometry.subpaths) {
    const key = subpath.fill ?? subpath.stroke ?? "currentColor";
    const list = byColor.get(key);
    if (list) list.push(subpath);
    else byColor.set(key, [subpath]);
  }

  const distinct = [...byColor.keys()].filter((key) => key !== "currentColor");

  if (byColor.size === 1 || distinct.length <= 1) {
    const lines = [
      "import SwiftUI",
      "",
      `struct ${typeName}: Shape {`,
      "    func path(in rect: CGRect) -> Path {",
      ...scalePreamble(icon, "        "),
      "        var path = Path()",
      ...emitPath(geometry.subpaths, "        "),
      "        return path",
      "    }",
      "}",
      "",
    ];
    return { kind: "shape", typeName, code: lines.join("\n") };
  }

  const layers = [...byColor.entries()];
  const lines: string[] = ["import SwiftUI", ""];

  layers.forEach(([, subpaths], index) => {
    lines.push(`private struct ${typeName}Layer${index}: Shape {`);
    lines.push("    func path(in rect: CGRect) -> Path {");
    lines.push(...scalePreamble(icon, "        "));
    lines.push("        var path = Path()");
    lines.push(...emitPath(subpaths, "        "));
    lines.push("        return path");
    lines.push("    }");
    lines.push("}");
    lines.push("");
  });

  lines.push(`struct ${typeName}: View {`);
  lines.push("    var body: some View {");
  lines.push("        ZStack {");
  layers.forEach(([paint], index) => {
    const color = paint === "currentColor" ? ".primary" : toSwiftColor(paint);
    lines.push(`            ${typeName}Layer${index}().fill(${color})`);
  });
  lines.push("        }");
  lines.push(`        .aspectRatio(${num(icon.width / icon.height)}, contentMode: .fit)`);
  lines.push("    }");
  lines.push("}");
  lines.push("");

  return { kind: "view", typeName, code: lines.join("\n") };
}

function unsupportedNote(icon: IconSource, reason: string): string {
  return `// ${icon.prefix}:${icon.name} cannot be expressed as a SwiftUI Path.
//
// It uses ${reason}, which has no direct Path equivalent. Generating Swift
// anyway would produce artwork that does not match the icon.
//
// Use the asset catalog export instead: it ships the SVG with
// preserve-vector-data, so it stays crisp at any size and renders exactly as
// designed. Every icon in the library exports that way.
`;
}
