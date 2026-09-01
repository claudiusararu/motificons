import type { APIRoute } from "astro";
import { db } from "../../../../../db/client";
import { resolveExportSize } from "../../../../../lib/collection-download";
import { verifyCollectionDownloadToken } from "../../../../../lib/download-token";
import { buildCollectionZip, type CollectionZipIcon } from "../../../../../lib/collection-zip";
import { DEFAULT_PNG_SIZE } from "../../../../../lib/export-file";
import { EXPORT_FORMATS, type ExportFormat } from "../../../../../lib/transforms/formats";
import { getCollection } from "../../../../../lib/workspace/collections";
import { loadCollectionIcons } from "../../../../../lib/workspace/collection-icons";
import { getCollectionStyleSettings } from "../../../../../lib/workspace/collection-style";
import { requireSessionWorkspace } from "../../../../../lib/workspace/session-workspace";
import type { Database } from "../../../../../db/client";

export const prerender = false;

/**
 * "Download collection" - every icon in one collection, exported in one
 * format, wearing the collection's shared look, in a single zip with a
 * LICENSES.txt.
 *
 * A PLAIN URL, deliberately. The zip used to be assembled in the visitor's
 * own browser and handed over as a blob, which an embedded browser cannot
 * download at all: the ChatGPT desktop app's download manager fetches the
 * URL after the click, has no access to the page's blob store, and marks
 * every one of those downloads "Stopped". A normal `GET` that answers with
 * `Content-Disposition: attachment` is something every download manager on
 * the web already knows how to track, so that is what this is.
 *
 * The URL ends in the collection's own slug (`/download/my-icons.zip`)
 * rather than a fixed path segment, because a download manager that names
 * files from the URL instead of the header should still write
 * `my-icons.zip`. The segment is cosmetic - the name this route actually
 * promises is the one it computes itself, below.
 *
 * Errors answer in plain text rather than JSON: this URL is navigated to,
 * not fetched, so whatever comes back is read by a person.
 *
 * TWO WAYS IN, one of which is not a cookie. A normal browser navigates here
 * with its session and is recognised the way every other collections route
 * recognises a visitor. An embedded browser does not: the ChatGPT desktop
 * app hands the click to an external download manager, which fetches this
 * URL as a separate program with no cookie jar at all, so answering that
 * request with 401 turned the fixed download straight back into "Stopped".
 * The URL therefore also accepts `?token=`, a short-lived signature the
 * collection page minted for its own owner - see lib/download-token.ts for
 * what it claims and what it deliberately does not.
 */

/** Collections live on an account, so every route here needs a signed-in
    visitor, or a token they minted while signed in. Accounts are free - this
    is the only thing standing between a caller and collections. */
const SIGN_IN_REQUIRED_ERROR = "Sign in with your free account to use collections.";

/**
 * How many icons one zip will build. There is no cap on the number of icons
 * in a collection (only on the number of collections), so without this a
 * single request could ask a Worker to rasterize thousands of PNGs against
 * its CPU limit and answer with nothing.
 *
 * Measured end to end on a 50-icon collection: 52ms and 17KB as SVG, 579ms
 * and 265KB as 512px PNG - the heaviest format by far, since every icon is
 * rasterized. Six times that is a few seconds and under 2MB, which leaves
 * the whole request well inside a Worker's CPU and memory limits with room
 * to spare, and keeps the zip small enough to buffer rather than stream.
 */
const MAX_ZIP_ICONS = 300;

const FORMAT_IDS: readonly string[] = EXPORT_FORMATS.map((format) => format.id);

/** Everything past the gate needs exactly these two, whichever door the
    request came through. */
interface ZipContext {
  database: Database;
  workspaceId: string;
}

export const GET: APIRoute = async ({ locals, params, request }) => {
  const collectionId = params.id ?? "";
  const url = new URL(request.url);

  /* Session first, so a signed-in visitor in a normal browser is never
     affected by the state of the token in the URL - a stale one changes
     nothing for them. The token is the fallback, and it is the ONLY thing
     the cookieless download manager has. */
  const session = await requireSessionWorkspace(locals.user);
  const ctx: ZipContext | null = session ?? (await tokenContext(url, collectionId));
  if (!ctx) return text(SIGN_IN_REQUIRED_ERROR, 401);

  /* Same not-found-reads-the-same-whether-missing-or-not-yours convention as
     every other route under lib/workspace/. The token path runs the very
     same owner-scoped lookup - it carries the workspace id it was minted
     with, so there is no second, unscoped way to reach a collection. */
  const collection = await getCollection(ctx.database, ctx.workspaceId, collectionId);
  if (!collection) return text("That collection could not be found.", 404);

  const settings = await getCollectionStyleSettings(ctx.database, ctx.workspaceId, collectionId);
  if (!settings) return text("That collection could not be found.", 404);

  /* The collection remembers a format; `?format=` overrides it for this one
     download without changing what it remembers. The panel sends the
     override, and separately saves the pick through the styles route, so a
     visitor who tries PNG once does not silently rewrite their default. */
  const requested = url.searchParams.get("format");
  const format = (requested ?? settings.exportFormat) as ExportFormat;
  if (!FORMAT_IDS.includes(format)) {
    return text(`"${requested}" is not an export format here. Pick one of: ${FORMAT_IDS.join(", ")}.`, 400);
  }

  const saved = await loadCollectionIcons(ctx.database, collectionId);
  if (saved.length === 0) {
    return text("This collection has no icons in it yet, so there is nothing to download.", 409);
  }
  if (saved.length > MAX_ZIP_ICONS) {
    return text(
      `This collection holds ${saved.length} icons, and one zip carries at most ${MAX_ZIP_ICONS}. ` +
        `Split it across a few collections and download them separately.`,
      413,
    );
  }

  /* An icon whose set no longer resolves has no tier, and every transform
     needs one - those are dropped here exactly as the collection page drops
     them from its grid. */
  const icons: CollectionZipIcon[] = saved.flatMap((item) =>
    item.tier === null
      ? []
      : [
          {
            icon: {
              prefix: item.prefix,
              name: item.name,
              body: item.body,
              width: item.width,
              height: item.height,
            },
            tier: item.tier,
            license: item.license,
          },
        ],
  );

  const zip = await buildCollectionZip({
    collectionName: collection.name,
    icons,
    format,
    edits: {
      color: settings.color ?? undefined,
      strokeWidth: settings.strokeWidth ?? undefined,
      size: readSize(url.searchParams) ?? resolveExportSize(format, DEFAULT_PNG_SIZE, settings.size),
    },
  });

  if (zip.included === 0) {
    return text(
      `None of this collection's icons can be exported as ${format}. Try SVG or PNG instead.`,
      409,
    );
  }

  return new Response(zip.bytes, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zip.filename}"`,
      /* Someone else's icons, restyled to someone else's collection: never
         a shared cache, and never a stale one after a restyle. */
      "Cache-Control": "private, no-store",
      "Content-Length": String(zip.bytes.byteLength),
    },
  });
};

/**
 * The cookieless door: `?token=`, verified against this collection's id.
 *
 * An expired, forged, malformed or wrong-collection token is `null`, which
 * reads identically to no token at all - the caller answers all of them with
 * the same sign-in sentence, so the URL never reports which of those it was.
 */
async function tokenContext(url: URL, collectionId: string): Promise<ZipContext | null> {
  const claims = await verifyCollectionDownloadToken(url.searchParams.get("token"), collectionId);
  if (!claims) return null;
  return { database: await db(), workspaceId: claims.workspaceId };
}

/** `?size=` for the formats that take one. Ignored when it is not a real
    number, so a mangled URL falls back to the collection's own setting
    instead of erroring on a detail nobody typed by hand. */
function readSize(params: URLSearchParams): number | undefined {
  const raw = params.get("size");
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function text(body: string, status: number): Response {
  return new Response(`${body}\n`, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}
