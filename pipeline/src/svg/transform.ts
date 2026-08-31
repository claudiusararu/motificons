/** SVG transform lists as 2x3 affine matrices. */

import type { Point } from "./path.ts";

/** [a, b, c, d, e, f] as in the SVG matrix() form. */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function apply(m: Matrix, [x, y]: Point): Point {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function isIdentity(m: Matrix): boolean {
  return (
    m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0
  );
}

const FUNCTION = /([a-zA-Z]+)\s*\(([^)]*)\)/g;

/** Returns null when the list contains something we cannot represent. */
export function parseTransform(value: string): Matrix | null {
  let result: Matrix = IDENTITY;
  let matched = false;

  FUNCTION.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FUNCTION.exec(value)) !== null) {
    matched = true;
    const name = match[1]!;
    const args = (match[2] ?? "")
      .split(/[\s,]+/)
      .filter((part) => part.length > 0)
      .map(Number);
    if (args.some((arg) => !Number.isFinite(arg))) return null;

    let next: Matrix;
    switch (name) {
      case "translate":
        next = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
        break;
      case "scale":
        next = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
        break;
      case "rotate": {
        const angle = ((args[0] ?? 0) * Math.PI) / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const rotation: Matrix = [cos, sin, -sin, cos, 0, 0];
        if (args.length >= 3) {
          const cx = args[1]!;
          const cy = args[2]!;
          next = multiply(
            multiply([1, 0, 0, 1, cx, cy], rotation),
            [1, 0, 0, 1, -cx, -cy],
          );
        } else {
          next = rotation;
        }
        break;
      }
      case "skewX":
        next = [1, 0, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case "skewY":
        next = [1, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
      case "matrix":
        if (args.length !== 6) return null;
        next = [args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, args[5]!];
        break;
      default:
        return null;
    }
    result = multiply(result, next);
  }

  return matched ? result : null;
}
