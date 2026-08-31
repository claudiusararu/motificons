/**
 * SwiftUI Shape codegen for the clean subset.
 *
 * The generated struct scales the source viewBox into the given rect while
 * preserving aspect ratio, which is what makes an icon usable at any point
 * size. Everything here is geometry only: colors, masks and gradients are out
 * of scope by design and route to the asset-catalog tier instead.
 */

import { apply, isIdentity, type Matrix } from "./transform.ts";
import type { Point, Segment } from "./path.ts";

export interface ShapeSubpath {
  segments: Segment[];
  transform: Matrix | null;
}

function num(value: number): string {
  if (!Number.isFinite(value)) return "0.0";
  const rounded = Number(value.toFixed(4));
  return Number.isInteger(rounded) ? `${rounded}.0` : `${rounded}`;
}

function pt(point: Point, transform: Matrix | null): string {
  const [x, y] = transform && !isIdentity(transform) ? apply(transform, point) : point;
  return `p(${num(x)}, ${num(y)})`;
}

/** Upper camel case, safe as a Swift type name. */
export function swiftTypeName(prefix: string, name: string): string {
  const camel = `${prefix}-${name}`
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return /^[0-9]/.test(camel) ? `Icon${camel}` : camel;
}

export function generateShape(
  typeName: string,
  viewBox: { width: number; height: number },
  subpaths: ShapeSubpath[],
): string {
  const lines: string[] = [];
  lines.push("import SwiftUI");
  lines.push("");
  lines.push(`struct ${typeName}: Shape {`);
  lines.push("    func path(in rect: CGRect) -> Path {");
  lines.push(`        let vw = ${num(viewBox.width)}`);
  lines.push(`        let vh = ${num(viewBox.height)}`);
  lines.push("        let s = min(rect.width / vw, rect.height / vh)");
  lines.push("        let ox = rect.minX + (rect.width - vw * s) / 2");
  lines.push("        let oy = rect.minY + (rect.height - vh * s) / 2");
  lines.push(
    "        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }",
  );
  lines.push("        var path = Path()");

  for (const subpath of subpaths) {
    for (const segment of subpath.segments) {
      switch (segment.type) {
        case "M":
          lines.push(`        path.move(to: ${pt(segment.to, subpath.transform)})`);
          break;
        case "L":
          lines.push(
            `        path.addLine(to: ${pt(segment.to, subpath.transform)})`,
          );
          break;
        case "C":
          lines.push(
            `        path.addCurve(to: ${pt(segment.to, subpath.transform)}, control1: ${pt(segment.c1, subpath.transform)}, control2: ${pt(segment.c2, subpath.transform)})`,
          );
          break;
        case "Q":
          lines.push(
            `        path.addQuadCurve(to: ${pt(segment.to, subpath.transform)}, control: ${pt(segment.c, subpath.transform)})`,
          );
          break;
        case "Z":
          lines.push("        path.closeSubpath()");
          break;
      }
    }
  }

  lines.push("        return path");
  lines.push("    }");
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}
