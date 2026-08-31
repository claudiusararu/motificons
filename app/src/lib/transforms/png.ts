/**
 * PNG rasterization via resvg-wasm.
 *
 * The wasm build rather than the native one, because this has to run in a
 * Worker. Initialisation is per isolate and happens at most once: the module
 * keeps the in-flight promise so concurrent first requests share a single
 * instantiation instead of racing to initialise twice, which resvg treats as
 * an error.
 *
 * The wasm binary is imported as a module so the bundler emits it as an asset
 * the Worker can instantiate directly, with no network fetch at runtime.
 */

import type { IconSource, Tier } from "../data";
import { buildSvg, type IconEdits } from "./svg-doc";

export const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512] as const;

export const MIN_PNG_SIZE = 8;
export const MAX_PNG_SIZE = 2048;

export function clampPngSize(size: number): number {
  if (!Number.isFinite(size)) return 512;
  return Math.min(MAX_PNG_SIZE, Math.max(MIN_PNG_SIZE, Math.round(size)));
}

type ResvgModule = typeof import("@resvg/resvg-wasm");

let ready: Promise<ResvgModule> | null = null;

async function resvg(): Promise<ResvgModule> {
  ready ??= (async () => {
    const module = await import("@resvg/resvg-wasm");
    const wasm = (await import("@resvg/resvg-wasm/index_bg.wasm")) as unknown as {
      default: WebAssembly.Module;
    };
    await module.initWasm(wasm.default);
    return module;
  })().catch((error: unknown) => {
    /* A failed init must not poison the isolate: clear it so the next request
       can try again rather than every later call rejecting on a stale promise. */
    ready = null;
    throw error;
  });
  return ready;
}

/** Rasterizes an arbitrary SVG document. Used by the free PNG tool. */
export async function rasterize(
  svg: string,
  size: number,
): Promise<Uint8Array> {
  const { Resvg } = await resvg();
  const pixels = clampPngSize(size);
  const renderer = new Resvg(svg, {
    fitTo: { mode: "width", value: pixels },
    background: "rgba(0,0,0,0)",
  });
  return renderer.render().asPng();
}

export async function toPng(
  icon: IconSource,
  edits: IconEdits,
  tier: Tier,
  size: number,
): Promise<Uint8Array> {
  const { Resvg } = await resvg();
  const pixels = clampPngSize(size);

  /* currentColor has no meaning outside a document, so it is resolved to ink
     before rasterizing - otherwise resvg drops the paint and renders nothing. */
  const svg = buildSvg(icon, { ...edits, size: pixels }, tier).replace(
    /currentColor/g,
    edits.color ?? "#183153",
  );

  const renderer = new Resvg(svg, {
    fitTo: { mode: "width", value: pixels },
    background: "rgba(0,0,0,0)",
  });
  return renderer.render().asPng();
}
