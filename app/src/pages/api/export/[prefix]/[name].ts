import type { APIRoute } from "astro";
import { getIcon, getSet } from "../../../../lib/data";
import { exportIconFile } from "../../../../lib/export-file";
import { EXPORT_FORMATS, type ExportFormat, type IconEdits } from "../../../../lib/transforms";

export const prerender = false;

const FORMATS: readonly string[] = EXPORT_FORMATS.map((format) => format.id);

function parseEdits(params: URLSearchParams): IconEdits {
  const number = (key: string) => {
    const raw = params.get(key);
    if (raw === null) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };

  const rotate = number("rotate");
  return {
    size: number("size"),
    color: params.get("color") ?? undefined,
    strokeWidth: number("stroke"),
    cssStyleable: params.get("css") === "1",
    rotate:
      rotate === 90 || rotate === 180 || rotate === 270 ? rotate : undefined,
    flipH: params.get("flipH") === "1",
    flipV: params.get("flipV") === "1",
    padding: number("padding"),
  };
}

export const GET: APIRoute = async ({ params, request }) => {
  const prefix = params["prefix"] ?? "";
  const name = params["name"] ?? "";
  const url = new URL(request.url);
  const format = (url.searchParams.get("format") ?? "svg") as ExportFormat;

  if (!FORMATS.includes(format)) {
    return new Response("Unknown format", { status: 400 });
  }

  /* No entitlement check of any kind: every export format - SwiftUI and the
     Xcode asset catalog included - is free for everyone, signed in or not.
     That also keeps this route free of per-visitor work, which matters
     because the icon og:image and the image sitemap point at `?format=png`:
     a D1 outage can never 500 the whole library's image SEO. */

  const [icon, set] = await Promise.all([getIcon(prefix, name), getSet(prefix)]);
  if (!icon || !set) return new Response("Not found", { status: 404 });

  /* The format switch itself lives in lib/export-file.ts, shared with the
     collection zip route, so one icon downloaded by hand and the same icon
     inside a collection zip are byte-identical under the same filename. */
  const result = await exportIconFile(icon, set.tier, format, parseEdits(url.searchParams), {
    typescript: url.searchParams.get("ts") === "1",
  });

  if (!result.ok) return new Response("Not available", { status: 409 });

  const headers = new Headers({
    "Content-Type": result.file.contentType,
    "Content-Disposition": `attachment; filename="${result.file.filename}"`,
    /* Exports are a pure function of the URL, so they cache hard. Nothing
       here is metered: export is browse, and only the search box is
       limited. Every format uses the same immutable policy. */
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  if (result.file.swiftuiKind) {
    /* The island reads this to show the honest state instead of pretending
       the download succeeded. */
    headers.set("X-Motificons-Swiftui", result.file.swiftuiKind);
  }

  return new Response(result.file.body, { headers });
};
