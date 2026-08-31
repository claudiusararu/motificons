/**
 * Icon body to drawable subpaths, each carrying its resolved paint.
 *
 * Lifted from Spike S1, which stays frozen as evidence. The paint tracking is
 * the addition: the spike only had to know whether an icon was multicolour,
 * whereas a layered SwiftUI View has to know which colour each layer is.
 */

import { parseFragment, styleDeclarations, type SvgElement } from "./svg/markup";
import { parsePath, PathParseError, type Segment } from "./svg/path";
import { multiply, parseTransform, type Matrix } from "./svg/transform";

const GEOMETRY = new Set([
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
]);

const BLOCKING = new Set([
  "mask",
  "clipPath",
  "filter",
  "linearGradient",
  "radialGradient",
  "pattern",
  "use",
  "image",
  "foreignObject",
]);

export interface Subpath {
  segments: Segment[];
  transform: Matrix | null;
  /** Resolved fill, or null when the shape is stroke-only. */
  fill: string | null;
  stroke: string | null;
  strokeWidth: number | null;
  opacity: number;
}

export interface Geometry {
  subpaths: Subpath[];
  blocked: boolean;
  blockedBy: string | null;
  unparsable: boolean;
}

function elementSegments(element: SvgElement): Segment[] | null {
  const a = element.attrs;
  const n = (key: string, fallback = 0) => {
    const value = Number(a[key]);
    return Number.isFinite(value) ? value : fallback;
  };

  switch (element.name) {
    case "path":
      return a["d"] ? parsePath(a["d"]).segments : null;
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
      return parsePath(`M${x} ${y}H${x + w}V${y + h}H${x}Z`).segments;
    }
    case "line":
      return parsePath(`M${n("x1")} ${n("y1")}L${n("x2")} ${n("y2")}`).segments;
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

function resolved(
  element: SvgElement,
  inherited: Map<string, string>,
  key: string,
): string | undefined {
  const style = element.attrs["style"]
    ? styleDeclarations(element.attrs["style"])
    : undefined;
  return style?.[key] ?? element.attrs[key] ?? inherited.get(key);
}

export function collectGeometry(body: string): Geometry {
  const { elements } = parseFragment(body);
  const stack: { depth: number; matrix: Matrix; paint: Map<string, string> }[] = [];
  const subpaths: Subpath[] = [];
  let blocked = false;
  let blockedBy: string | null = null;
  let unparsable = false;

  const markBlocked = (reason: string) => {
    if (!blocked) {
      blocked = true;
      blockedBy = reason;
    }
  };

  for (const element of elements) {
    if (BLOCKING.has(element.name)) markBlocked(element.name);
    if (element.attrs["mask"]) markBlocked("mask");
    if (element.attrs["clip-path"]) markBlocked("clip-path");
    if (element.attrs["filter"]) markBlocked("filter");

    while (stack.length > 0 && stack[stack.length - 1]!.depth >= element.depth) {
      stack.pop();
    }

    const inherited = new Map(stack[stack.length - 1]?.paint ?? []);

    if (element.name === "g") {
      let matrix: Matrix = stack[stack.length - 1]?.matrix ?? [1, 0, 0, 1, 0, 0];
      const own = element.attrs["transform"];
      if (own) {
        const parsed = parseTransform(own);
        if (parsed) matrix = multiply(matrix, parsed);
      }
      for (const key of ["fill", "stroke", "stroke-width", "opacity"]) {
        const value = resolved(element, inherited, key);
        if (value !== undefined) inherited.set(key, value);
      }
      stack.push({ depth: element.depth, matrix, paint: inherited });
      continue;
    }

    if (!GEOMETRY.has(element.name)) continue;

    let segments: Segment[] | null;
    try {
      segments = elementSegments(element);
    } catch (error) {
      if (error instanceof PathParseError) unparsable = true;
      continue;
    }
    if (!segments || segments.length === 0) continue;

    let matrix: Matrix = stack[stack.length - 1]?.matrix ?? [1, 0, 0, 1, 0, 0];
    const own = element.attrs["transform"];
    if (own) {
      const parsed = parseTransform(own);
      if (parsed) matrix = multiply(matrix, parsed);
      else markBlocked("transform");
    }

    const fill = resolved(element, inherited, "fill") ?? "currentColor";
    const stroke = resolved(element, inherited, "stroke");
    const strokeWidth = Number(resolved(element, inherited, "stroke-width"));
    const opacity = Number(resolved(element, inherited, "opacity"));

    subpaths.push({
      segments,
      transform: matrix,
      fill: fill === "none" ? null : fill,
      stroke: stroke && stroke !== "none" ? stroke : null,
      strokeWidth: Number.isFinite(strokeWidth) ? strokeWidth : null,
      opacity: Number.isFinite(opacity) ? opacity : 1,
    });
  }

  return { subpaths, blocked, blockedBy, unparsable };
}
