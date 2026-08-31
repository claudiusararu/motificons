import type { APIRoute } from "astro";
import { toSwiftUi } from "../../../lib/transforms/swiftui";
import { validateSvg } from "../../../lib/svg-sanitize";
import { parseSvgDocument, sanitizeSvg } from "../../../lib/transforms/untrusted-svg";
import { clampPngSize, rasterize } from "../../../lib/transforms/png";

export const prerender = false;

/**
 * Free-tool conversions for pasted SVG.
 *
 * Nothing is stored: the markup is converted in memory and the response is
 * the only copy. This is the "on submit" validation checkpoint (the other is
 * SvgTool.tsx, client-side, before the request is even sent) - both call the
 * same lib/svg-sanitize.ts so a request that skips or bypasses the browser
 * still gets rejected with the same plain-language reason, never silently
 * repaired. sanitizeSvg below is a second, independent layer that runs after
 * validation passes: it protects the rasterizer even if a future rejection
 * rule has a gap.
 *
 * No entitlement check: every conversion here, SwiftUI included, is free for
 * everyone, signed in or not.
 */
export const POST: APIRoute = async ({ params, request }) => {
  const tool = params["tool"] ?? "";
  if (tool !== "swiftui" && tool !== "png") {
    return json({ error: "Unknown tool" }, 404);
  }

  let payload: { svg?: unknown; size?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ error: "Send JSON with an svg field." }, 400);
  }

  const markup = typeof payload.svg === "string" ? payload.svg : "";
  if (!markup.trim()) return json({ error: "Paste some SVG markup first." }, 400);

  const validation = validateSvg(markup);
  if (!validation.ok) {
    return json({ error: validation.reason ?? "That SVG could not be validated." }, 400);
  }

  const parsed = parseSvgDocument(markup);
  if (!parsed) {
    return json(
      { error: "That does not look like an SVG. It should contain an <svg> tag." },
      400,
    );
  }

  if (tool === "swiftui") {
    const result = toSwiftUi(
      { prefix: "icon", name: "pasted", ...parsed },
      {},
      /* T1 so nothing is gated: this is somebody's own artwork, not ours. */
      "T1",
    );
    return json({ code: result.code, kind: result.kind, reason: result.reason });
  }

  const size = clampPngSize(
    typeof payload.size === "number" ? payload.size : 512,
  );

  try {
    const safe = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${parsed.width} ${parsed.height}" width="${size}" height="${size}">${sanitizeSvg(parsed.body)}</svg>`;
    const png = await rasterize(safe, size);
    return new Response(png, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return json({ error: "Could not render that SVG. Check the markup." }, 422);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}
