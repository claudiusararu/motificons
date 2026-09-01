/**
 * One icon, exported in one format - the single code path behind every
 * download the product offers.
 *
 * Two routes call it:
 *
 *   /api/export/[prefix]/[name]                  one icon, one file
 *   /api/collections/[id]/download/[name].zip    a whole collection, one zip
 *
 * They must never disagree. A visitor who downloads `tabler:arrow-right` as
 * SVG by hand and a visitor who downloads a collection containing it should
 * get byte-identical artwork under a byte-identical filename - so the format
 * switch, the per-format filename and the per-format content type live here
 * once, and each route only wraps the result in the Response it needs
 * (cache headers and the SwiftUI hint on the single-icon route, a zip entry
 * on the collection route).
 *
 * Returns a result object rather than a Response: the collection zip has no
 * Response to hand back per icon, and one unsupported icon there is a skip,
 * not a failed download.
 */

import type { IconSource, Tier } from "./data";
import type { ExportFormat, IconEdits, SwiftUiKind } from "./transforms";
import {
  buildSvg,
  capabilitiesFor,
  toAssetCatalog,
  toBase64DataUri,
  toJsxComponent,
  toPng,
  toSvelteComponent,
  toSwiftUi,
  toVueComponent,
} from "./transforms";

/** The PNG size used when a request carries none. Mirrored client-side by
    CollectionDownloadPanel.tsx's own default, so the size the panel shows
    and the size the server actually renders can never quietly disagree. */
export const DEFAULT_PNG_SIZE = 512;

export interface ExportedFile {
  /** The name the file gets, both as `Content-Disposition: attachment;
      filename=` on a single-icon download and as the zip entry name in a
      collection download. */
  filename: string;
  contentType: string;
  body: string | Uint8Array;
  /** SwiftUI only: whether the icon became a `Shape` or a `View`. The
      single-icon route forwards it as a response header so the island can
      show the honest state instead of pretending. */
  swiftuiKind?: SwiftUiKind;
}

export type ExportResult =
  | { ok: true; file: ExportedFile }
  | { ok: false; reason: "unsupported"; message: string };

export interface ExportOptions {
  /** Vue and Svelte only: emit `lang="ts"` single-file components. React's
      TypeScript switch is the format itself (jsx vs tsx), not this. */
  typescript?: boolean;
}

export async function exportIconFile(
  icon: IconSource,
  tier: Tier,
  format: ExportFormat,
  edits: IconEdits,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const stem = `${icon.prefix}-${icon.name}`;
  const text = (body: string, filename: string, contentType = "text/plain; charset=utf-8") =>
    ({ ok: true, file: { filename, contentType, body } }) as const;

  switch (format) {
    case "svg":
      return text(buildSvg(icon, edits, tier), `${stem}.svg`, "image/svg+xml");

    case "png": {
      const size = edits.size ?? DEFAULT_PNG_SIZE;
      return {
        ok: true,
        file: {
          filename: `${stem}-${size}.png`,
          contentType: "image/png",
          body: await toPng(icon, edits, tier, size),
        },
      };
    }

    case "jsx":
    case "tsx":
      return text(
        toJsxComponent(icon, edits, tier, { typescript: format === "tsx" }),
        `${stem}.${format}`,
      );

    case "vue":
      return text(
        toVueComponent(icon, edits, tier, { typescript: options.typescript === true }),
        `${stem}.vue`,
      );

    case "svelte":
      return text(
        toSvelteComponent(icon, edits, tier, { typescript: options.typescript === true }),
        `${stem}.svelte`,
      );

    case "swiftui": {
      const result = toSwiftUi(icon, edits, tier);
      return {
        ok: true,
        file: {
          filename: `${result.typeName}.swift`,
          contentType: "text/plain; charset=utf-8",
          body: result.code,
          swiftuiKind: result.kind,
        },
      };
    }

    case "catalog": {
      /* The only format a set can be unable to produce: a T4 set's artwork
         carries colour an Xcode template asset cannot represent. Naming the
         icon matters here - the collection zip reports exactly which ones it
         had to leave out. */
      if (!capabilitiesFor(tier).assetCatalog) {
        return {
          ok: false,
          reason: "unsupported",
          message: `${icon.prefix}:${icon.name} cannot become an Xcode asset catalog - its set is full-colour artwork.`,
        };
      }
      const catalog = toAssetCatalog(icon, edits, tier);
      return {
        ok: true,
        file: {
          filename: catalog.filename,
          contentType: "application/zip",
          body: new Uint8Array(catalog.zip),
        },
      };
    }

    case "datauri":
      return text(toBase64DataUri(buildSvg(icon, edits, tier)), `${stem}.txt`);
  }
}
