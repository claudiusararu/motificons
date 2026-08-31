import type { APIRoute } from "astro";
import { getIcon, getSet } from "../../../../lib/data";
import type { IconEdits } from "../../../../lib/transforms";
import {
  buildSvg,
  capabilitiesFor,
  toAssetCatalog,
  toBase64DataUri,
  toJsxComponent,
  toPng,
  toSvelteComponent,
  toVueComponent,
  toSwiftUi,
} from "../../../../lib/transforms";

export const prerender = false;

import { EXPORT_FORMATS, type ExportFormat } from "../../../../lib/transforms";

const FORMATS = EXPORT_FORMATS.map((format) => format.id);
type Format = ExportFormat;

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
  const format = (url.searchParams.get("format") ?? "svg") as Format;

  if (!(FORMATS as readonly string[]).includes(format)) {
    return new Response("Unknown format", { status: 400 });
  }

  /* No entitlement check of any kind: every export format - SwiftUI and the
     Xcode asset catalog included - is free for everyone, signed in or not.
     That also keeps this route free of per-visitor work, which matters
     because the icon og:image and the image sitemap point at `?format=png`:
     a D1 outage can never 500 the whole library's image SEO. */

  const [icon, set] = await Promise.all([getIcon(prefix, name), getSet(prefix)]);
  if (!icon || !set) return new Response("Not found", { status: 404 });

  const edits = parseEdits(url.searchParams);
  const tier = set.tier;
  const stem = `${prefix}-${name}`;

  /* Exports are a pure function of the URL, so they cache hard. Nothing here
     is metered: export is browse, and only the search box is limited. Every
     format uses the same immutable policy. */
  const cache = "public, max-age=31536000, immutable";

  /* Every branch below assigns `response` instead of returning directly, so
     there is a single return at the bottom for every format. */
  let response: Response;

  switch (format) {
    case "svg":
      response = file(buildSvg(icon, edits, tier), "image/svg+xml", `${stem}.svg`, cache);
      break;

    case "png": {
      const png = await toPng(icon, edits, tier, edits.size ?? 512);
      response = new Response(png, {
        headers: {
          "Content-Type": "image/png",
          "Content-Disposition": `attachment; filename="${stem}-${edits.size ?? 512}.png"`,
          "Cache-Control": cache,
        },
      });
      break;
    }

    case "jsx":
    case "tsx":
      response = file(
        toJsxComponent(icon, edits, tier, { typescript: format === "tsx" }),
        "text/plain; charset=utf-8",
        `${stem}.${format}`,
        cache,
      );
      break;

    case "vue":
      response = file(
        toVueComponent(icon, edits, tier, {
          typescript: url.searchParams.get("ts") === "1",
        }),
        "text/plain; charset=utf-8",
        `${stem}.vue`,
        cache,
      );
      break;

    case "svelte":
      response = file(
        toSvelteComponent(icon, edits, tier, {
          typescript: url.searchParams.get("ts") === "1",
        }),
        "text/plain; charset=utf-8",
        `${stem}.svelte`,
        cache,
      );
      break;

    case "swiftui": {
      const result = toSwiftUi(icon, edits, tier);
      response = new Response(result.code, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${result.typeName}.swift"`,
          "Cache-Control": cache,
          /* The island reads this to show the honest state instead of
             pretending the download succeeded. */
          "X-Motificons-Swiftui": result.kind,
        },
      });
      break;
    }

    case "catalog": {
      if (!capabilitiesFor(tier).assetCatalog) {
        response = new Response("Not available", { status: 409 });
        break;
      }
      const catalog = toAssetCatalog(icon, edits, tier);
      response = new Response(new Uint8Array(catalog.zip), {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${catalog.filename}"`,
          "Cache-Control": cache,
        },
      });
      break;
    }

    case "datauri":
      response = file(
        toBase64DataUri(buildSvg(icon, edits, tier)),
        "text/plain; charset=utf-8",
        `${stem}.txt`,
        cache,
      );
      break;
  }

  return response;
};

function file(
  body: string,
  type: string,
  filename: string,
  cache: string,
): Response {
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": cache,
    },
  });
}
