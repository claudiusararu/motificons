/**
 * Shared plumbing for the collection tools (list_collections,
 * get_collection, add_to_collection, remove_from_collection,
 * set_collection_style, audit_repo_icons) - the human-verb mirror of the
 * collection page. Every one of those
 * tools takes the same `collection` param (name or id) and needs the same
 * tool-level error shape, so both live here once rather than five times.
 *
 * "collection" resolution: an exact id match wins outright; otherwise a
 * case-insensitive exact name match. Collection names are NOT unique
 * (renameCollection enforces nothing beyond non-empty - see
 * lib/workspace/limits.ts's validateResourceName) - a caller with two
 * collections named "Icons" has to pass the id for either. Both "not found"
 * and "ambiguous" list the caller's own collection names so the next call
 * can disambiguate, same idea as auth.ts's one shared failure message but at
 * the tool-result level (`isError: true` inside a successful JSON-RPC
 * `tools/call` response, the same pattern get-icon.ts's own `errorResult`
 * uses) rather than the transport-level JSON-RPC error index.ts emits for
 * auth/rate-limit failures.
 *
 * Also home to the one-icon rendering path get_collection uses to turn a
 * saved icon into its remembered export format with style settings applied -
 * audit_repo_icons reuses it verbatim (not a copy) to render a suggested
 * replacement in the exact same shape, per the task brief's "reuse
 * get_collection's rendering path."
 */

import type { CallToolResult } from "@modelcontextprotocol/server";
import type { Database } from "../../../app/src/db/client";
import { getIcon, getSet } from "../../../app/src/lib/data";
import {
  buildSvg,
  toBase64DataUri,
  toJsxComponent,
  toPng,
  toSvelteComponent,
  toSwiftUi,
  toVueComponent,
  type IconEdits,
} from "../../../app/src/lib/transforms";
import { listCollections, type CollectionDTO } from "../../../app/src/lib/workspace/collections";

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Every collection tool needs the calling key's workspace identity
    (src/auth.ts's `MotificonsAuthExtra`, threaded through `McpRequestContext
    .authInfo.extra` in src/server.ts). It is always present by the time a
    tool call reaches here - src/index.ts's auth gate runs before the MCP
    transport ever sees the request - so this only guards against a future
    transport (e.g. stdio) that might not thread it through. */
export function missingAuthExtraResult(): CallToolResult {
  return errorResult(
    "Could not identify your account for this call - retry, or create a new API key from your dashboard if it keeps happening.",
  );
}

function collectionNamesList(collections: CollectionDTO[]): string {
  if (collections.length === 0) {
    return "You don't have any collections yet - create one at motificons.app/dashboard.";
  }
  return `Your collections: ${collections.map((c) => `"${c.name}"`).join(", ")}.`;
}

export type ResolveCollectionResult =
  | { ok: true; collection: CollectionDTO }
  | { ok: false; result: CallToolResult };

/** Resolves the `collection` param against the caller's own workspace -
    `listCollections` already scopes to `workspaceId`, so another account's
    collection can never match here regardless of what id/name is passed. */
export async function resolveCollection(
  database: Database,
  workspaceId: string,
  nameOrId: string,
): Promise<ResolveCollectionResult> {
  const collections = await listCollections(database, workspaceId);
  const trimmed = nameOrId.trim();

  if (!trimmed) {
    return {
      ok: false,
      result: errorResult(`Provide a collection name or id. ${collectionNamesList(collections)}`),
    };
  }

  const byId = collections.find((c) => c.id === trimmed);
  if (byId) return { ok: true, collection: byId };

  const byName = collections.filter((c) => c.name.toLowerCase() === trimmed.toLowerCase());
  if (byName.length > 1) {
    return {
      ok: false,
      result: errorResult(
        `More than one collection is named "${trimmed}" - use its id instead. ${collectionNamesList(collections)}`,
      ),
    };
  }
  const [onlyMatch] = byName;
  if (onlyMatch) return { ok: true, collection: onlyMatch };

  return {
    ok: false,
    result: errorResult(`No collection named "${trimmed}" was found. ${collectionNamesList(collections)}`),
  };
}

/* ---------------------------------------------------------------------- *
 * One-icon rendering, in a collection's remembered format/style
 * ---------------------------------------------------------------------- */

/** get_icon's own 7 formats plus "datauri" - a short `data:` string, cheap
    to inline per icon, unlike "catalog" (an Xcode asset-catalog ZIP per
    icon - not a useful shape for a JSON tool result). Callers downgrade a
    remembered "catalog" format to "svg" before calling `renderIconInFormat`
    and say so in an honest `formatNote`, the same capability-honesty
    pattern get_icon's swiftui refusal established. */
export const RENDERABLE_FORMATS = ["svg", "jsx", "tsx", "vue", "svelte", "swiftui", "png", "datauri"] as const;
export type RenderableFormat = (typeof RENDERABLE_FORMATS)[number];

export function isRenderable(format: string): format is RenderableFormat {
  return (RENDERABLE_FORMATS as readonly string[]).includes(format);
}

export interface RenderedIcon {
  id: string;
  name: string;
  set: string | null;
  code?: string;
  data?: string;
  mimeType?: string;
  error?: string;
}

/** Chunked to avoid `String.fromCharCode(...bytes)` blowing the call stack
    on a large rasterized PNG - same helper get-icon.ts defines locally. */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

/** Renders one icon ("prefix:name") in the given format with the given
    edits applied - byte-for-byte what get_collection returns per icon, and
    what the web dashboard's Download would produce. A saved icon whose set
    left the pipeline resolves to an honest per-icon error, never a crash. */
export async function renderIconInFormat(
  iconId: string,
  format: RenderableFormat,
  edits: IconEdits,
): Promise<RenderedIcon> {
  const separator = iconId.indexOf(":");
  const prefix = iconId.slice(0, separator);
  const name = iconId.slice(separator + 1);

  const [icon, set] = await Promise.all([getIcon(prefix, name), getSet(prefix)]);
  if (!icon || !set) {
    return { id: iconId, name, set: null, error: "This icon's set is no longer available." };
  }

  const tier = set.tier;
  const base = { id: iconId, name, set: set.name };

  switch (format) {
    case "svg":
      return { ...base, code: buildSvg(icon, edits, tier) };
    case "jsx":
      return { ...base, code: toJsxComponent(icon, edits, tier, { typescript: false }) };
    case "tsx":
      return { ...base, code: toJsxComponent(icon, edits, tier, { typescript: true }) };
    case "vue":
      return { ...base, code: toVueComponent(icon, edits, tier, { typescript: false }) };
    case "svelte":
      return { ...base, code: toSvelteComponent(icon, edits, tier, { typescript: false }) };
    case "swiftui":
      return { ...base, code: toSwiftUi(icon, edits, tier).code };
    case "datauri":
      return { ...base, code: toBase64DataUri(buildSvg(icon, edits, tier)) };
    case "png": {
      const png = await toPng(icon, edits, tier, edits.size ?? 512);
      return { ...base, data: toBase64(png), mimeType: "image/png" };
    }
  }
}
