/**
 * Path data to absolute segments, with exact bounding boxes.
 *
 * Bounds are computed from curve extrema rather than control-point hulls,
 * because the padding numbers in the spike are only worth anything if the
 * boxes are tight. Elliptical arcs are converted to cubics first, so they get
 * the same treatment - which matters, since arcs turned out to be near
 * universal in rounded icon sets.
 */

export type Point = readonly [number, number];

export type Segment =
  | { type: "M"; to: Point }
  | { type: "L"; to: Point }
  | { type: "C"; c1: Point; c2: Point; to: Point }
  | { type: "Q"; c: Point; to: Point }
  | { type: "Z" };

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const NUMBER = /[+-]?(\d*\.\d+|\d+\.?)([eE][+-]?\d+)?/y;
const COMMAND = /[MmLlHhVvCcSsQqTtAaZz]/;

interface RawCommand {
  cmd: string;
  args: number[];
}

const ARG_COUNT: Record<string, number> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};

export class PathParseError extends Error {}

export function tokenizePath(d: string): RawCommand[] {
  const out: RawCommand[] = [];
  let index = 0;
  let current: string | null = null;

  const skipSeparators = () => {
    while (index < d.length && /[\s,]/.test(d[index]!)) index += 1;
  };

  skipSeparators();
  while (index < d.length) {
    if (COMMAND.test(d[index]!)) {
      current = d[index]!;
      index += 1;
      skipSeparators();
      if (current === "Z" || current === "z") {
        out.push({ cmd: "Z", args: [] });
        current = null;
        continue;
      }
    }

    if (current === null) throw new PathParseError("data-before-command");

    const upper = current.toUpperCase();
    const need = ARG_COUNT[upper];
    if (need === undefined) throw new PathParseError("unknown-command");

    const args: number[] = [];
    for (let i = 0; i < need; i += 1) {
      skipSeparators();
      NUMBER.lastIndex = index;
      const match = NUMBER.exec(d);
      if (!match) throw new PathParseError("missing-argument");
      args.push(Number(match[0]));
      index = NUMBER.lastIndex;
    }

    out.push({ cmd: current, args });
    /* An implicit repeat of M continues as L, per the SVG spec. */
    if (current === "M") current = "L";
    else if (current === "m") current = "l";
    skipSeparators();
  }

  return out;
}

/** Endpoint to centre parameterization, then centre arc to cubic beziers. */
function arcToCubics(
  from: Point,
  rxIn: number,
  ryIn: number,
  rotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  to: Point,
): { c1: Point; c2: Point; to: Point }[] {
  const [x1, y1] = from;
  const [x2, y2] = to;
  if (x1 === x2 && y1 === y2) return [];

  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [{ c1: from, c2: to, to }];

  const phi = (rotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  const scale = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (scale > 1) {
    const root = Math.sqrt(scale);
    rx *= root;
    ry *= root;
  }

  const numerator =
    rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const factor =
    (largeArc === sweep ? -1 : 1) *
    Math.sqrt(Math.max(0, numerator) / (denominator || 1));

  const cxp = (factor * (rx * y1p)) / ry;
  const cyp = (factor * -(ry * x1p)) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
    let value = Math.acos(Math.min(1, Math.max(-1, dot / (len || 1))));
    if (ux * vy - uy * vx < 0) value = -value;
    return value;
  };

  const startAngle = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let sweepAngle = angle(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry,
  );
  if (!sweep && sweepAngle > 0) sweepAngle -= 2 * Math.PI;
  if (sweep && sweepAngle < 0) sweepAngle += 2 * Math.PI;

  const steps = Math.max(1, Math.ceil(Math.abs(sweepAngle) / (Math.PI / 2)));
  const delta = sweepAngle / steps;
  const alpha = (4 / 3) * Math.tan(delta / 4);

  const onArc = (theta: number): Point => [
    cx + rx * cosPhi * Math.cos(theta) - ry * sinPhi * Math.sin(theta),
    cy + rx * sinPhi * Math.cos(theta) + ry * cosPhi * Math.sin(theta),
  ];
  const derivative = (theta: number): Point => [
    -rx * cosPhi * Math.sin(theta) - ry * sinPhi * Math.cos(theta),
    -rx * sinPhi * Math.sin(theta) + ry * cosPhi * Math.cos(theta),
  ];

  const out: { c1: Point; c2: Point; to: Point }[] = [];
  for (let i = 0; i < steps; i += 1) {
    const t1 = startAngle + i * delta;
    const t2 = t1 + delta;
    const p1 = onArc(t1);
    const p2 = onArc(t2);
    const d1 = derivative(t1);
    const d2 = derivative(t2);
    out.push({
      c1: [p1[0] + alpha * d1[0], p1[1] + alpha * d1[1]],
      c2: [p2[0] - alpha * d2[0], p2[1] - alpha * d2[1]],
      to: p2,
    });
  }
  return out;
}

export interface PathAnalysis {
  segments: Segment[];
  /** Raw command letters seen, uppercased. */
  commands: Set<string>;
  hadArcs: boolean;
}

export function parsePath(d: string): PathAnalysis {
  const raw = tokenizePath(d);
  const segments: Segment[] = [];
  const commands = new Set<string>();
  let hadArcs = false;

  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  let lastControl: Point | null = null;
  let lastQuadControl: Point | null = null;

  for (const { cmd, args } of raw) {
    const upper = cmd.toUpperCase();
    const relative = cmd !== upper;
    commands.add(upper);

    switch (upper) {
      case "M": {
        const x = relative ? cx + args[0]! : args[0]!;
        const y = relative ? cy + args[1]! : args[1]!;
        segments.push({ type: "M", to: [x, y] });
        cx = startX = x;
        cy = startY = y;
        lastControl = lastQuadControl = null;
        break;
      }
      case "L": {
        const x = relative ? cx + args[0]! : args[0]!;
        const y = relative ? cy + args[1]! : args[1]!;
        segments.push({ type: "L", to: [x, y] });
        cx = x;
        cy = y;
        lastControl = lastQuadControl = null;
        break;
      }
      case "H": {
        const x = relative ? cx + args[0]! : args[0]!;
        segments.push({ type: "L", to: [x, cy] });
        cx = x;
        lastControl = lastQuadControl = null;
        break;
      }
      case "V": {
        const y = relative ? cy + args[0]! : args[0]!;
        segments.push({ type: "L", to: [cx, y] });
        cy = y;
        lastControl = lastQuadControl = null;
        break;
      }
      case "C": {
        const c1: Point = [
          relative ? cx + args[0]! : args[0]!,
          relative ? cy + args[1]! : args[1]!,
        ];
        const c2: Point = [
          relative ? cx + args[2]! : args[2]!,
          relative ? cy + args[3]! : args[3]!,
        ];
        const to: Point = [
          relative ? cx + args[4]! : args[4]!,
          relative ? cy + args[5]! : args[5]!,
        ];
        segments.push({ type: "C", c1, c2, to });
        cx = to[0];
        cy = to[1];
        lastControl = c2;
        lastQuadControl = null;
        break;
      }
      case "S": {
        const c1: Point = lastControl
          ? [2 * cx - lastControl[0], 2 * cy - lastControl[1]]
          : [cx, cy];
        const c2: Point = [
          relative ? cx + args[0]! : args[0]!,
          relative ? cy + args[1]! : args[1]!,
        ];
        const to: Point = [
          relative ? cx + args[2]! : args[2]!,
          relative ? cy + args[3]! : args[3]!,
        ];
        segments.push({ type: "C", c1, c2, to });
        cx = to[0];
        cy = to[1];
        lastControl = c2;
        lastQuadControl = null;
        break;
      }
      case "Q": {
        const c: Point = [
          relative ? cx + args[0]! : args[0]!,
          relative ? cy + args[1]! : args[1]!,
        ];
        const to: Point = [
          relative ? cx + args[2]! : args[2]!,
          relative ? cy + args[3]! : args[3]!,
        ];
        segments.push({ type: "Q", c, to });
        cx = to[0];
        cy = to[1];
        lastQuadControl = c;
        lastControl = null;
        break;
      }
      case "T": {
        const c: Point = lastQuadControl
          ? [2 * cx - lastQuadControl[0], 2 * cy - lastQuadControl[1]]
          : [cx, cy];
        const to: Point = [
          relative ? cx + args[0]! : args[0]!,
          relative ? cy + args[1]! : args[1]!,
        ];
        segments.push({ type: "Q", c, to });
        cx = to[0];
        cy = to[1];
        lastQuadControl = c;
        lastControl = null;
        break;
      }
      case "A": {
        hadArcs = true;
        const to: Point = [
          relative ? cx + args[5]! : args[5]!,
          relative ? cy + args[6]! : args[6]!,
        ];
        const cubics = arcToCubics(
          [cx, cy],
          args[0]!,
          args[1]!,
          args[2]!,
          args[3] !== 0,
          args[4] !== 0,
          to,
        );
        for (const cubic of cubics) {
          segments.push({ type: "C", c1: cubic.c1, c2: cubic.c2, to: cubic.to });
        }
        cx = to[0];
        cy = to[1];
        lastControl = lastQuadControl = null;
        break;
      }
      case "Z": {
        segments.push({ type: "Z" });
        cx = startX;
        cy = startY;
        lastControl = lastQuadControl = null;
        break;
      }
      default:
        throw new PathParseError("unknown-command");
    }
  }

  return { segments, commands, hadArcs };
}

function cubicExtrema(a: number, b: number, c: number, d: number): number[] {
  const values = [a, d];
  const i = -3 * a + 9 * b - 9 * c + 3 * d;
  const j = 6 * a - 12 * b + 6 * c;
  const k = -3 * a + 3 * b;

  const at = (t: number) => {
    if (t <= 0 || t >= 1) return;
    const mt = 1 - t;
    values.push(
      mt * mt * mt * a + 3 * mt * mt * t * b + 3 * mt * t * t * c + t * t * t * d,
    );
  };

  if (Math.abs(i) < 1e-12) {
    if (Math.abs(j) > 1e-12) at(-k / j);
  } else {
    const disc = j * j - 4 * i * k;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      at((-j + root) / (2 * i));
      at((-j - root) / (2 * i));
    }
  }
  return values;
}

function quadExtrema(a: number, b: number, c: number): number[] {
  const values = [a, c];
  const denominator = a - 2 * b + c;
  if (Math.abs(denominator) > 1e-12) {
    const t = (a - b) / denominator;
    if (t > 0 && t < 1) {
      const mt = 1 - t;
      values.push(mt * mt * a + 2 * mt * t * b + t * t * c);
    }
  }
  return values;
}

export function segmentsBBox(segments: Segment[]): BBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let cursor: Point = [0, 0];
  let seen = false;

  const include = (x: number, y: number) => {
    seen = true;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (const segment of segments) {
    switch (segment.type) {
      case "M":
      case "L":
        include(segment.to[0], segment.to[1]);
        cursor = segment.to;
        break;
      case "C": {
        for (const x of cubicExtrema(
          cursor[0],
          segment.c1[0],
          segment.c2[0],
          segment.to[0],
        )) {
          for (const y of cubicExtrema(
            cursor[1],
            segment.c1[1],
            segment.c2[1],
            segment.to[1],
          )) {
            include(x, y);
          }
        }
        cursor = segment.to;
        break;
      }
      case "Q": {
        for (const x of quadExtrema(cursor[0], segment.c[0], segment.to[0])) {
          for (const y of quadExtrema(cursor[1], segment.c[1], segment.to[1])) {
            include(x, y);
          }
        }
        cursor = segment.to;
        break;
      }
      case "Z":
        break;
    }
  }

  return seen ? { minX, minY, maxX, maxY } : null;
}
