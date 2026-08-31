/**
 * The MCP server factory. `createMcpHandler` (src/index.ts) calls this once
 * per request (stateless: none of this package's tools carry state between
 * calls), so every tool closure below is fresh per call - safe to close over
 * per-request context (the authenticated key's identity) with no
 * shared-state bug to worry about.
 *
 * `ctx.authInfo.extra` (see src/auth.ts's `MotificonsAuthExtra`) carries the
 * calling key's userId/workspaceId/keyId - unused by the three library tools
 * (they operate on the whole public library, not a caller's data), but it is
 * what every collection tool (collection-scoped access) scopes
 * its reads/writes to. `authInfo` is always set in production: src/index.ts's
 * auth gate runs before `createMcpHandler` ever calls this factory, and it is
 * the one thing that populates it (`{ authInfo: auth.auth }`). The `? :
 * missingAuthExtraResult()` fallback on each collection tool below only
 * guards a hypothetical future transport that does not thread it through -
 * never expected to fire over HTTP.
 */

import { McpServer, type McpRequestContext } from "@modelcontextprotocol/server";
import type { MotificonsAuthExtra } from "./auth";
import { getIconInputSchema, runGetIcon } from "./tools/get-icon";
import { searchIconsInputSchema, runSearchIcons } from "./tools/search-icons";
import { suggestIconsInputSchema, runSuggestIcons } from "./tools/suggest-icons";
import { listCollectionsInputSchema, runListCollections } from "./tools/list-collections";
import { getCollectionInputSchema, runGetCollection, MAX_COLLECTION_ICONS } from "./tools/get-collection";
import { addToCollectionInputSchema, runAddToCollection } from "./tools/add-to-collection";
import {
  removeFromCollectionInputSchema,
  runRemoveFromCollection,
} from "./tools/remove-from-collection";
import { setCollectionStyleInputSchema, runSetCollectionStyle } from "./tools/set-collection-style";
import { auditRepoIconsInputSchema, runAuditRepoIcons } from "./tools/audit-repo-icons";
import { missingAuthExtraResult } from "./tools/collection-shared";

const SERVER_INFO = { name: "motificons", version: "0.1.0" };

export function buildServer(ctx: McpRequestContext): McpServer {
  const server = new McpServer(SERVER_INFO);
  const authExtra = ctx.authInfo?.extra as MotificonsAuthExtra | undefined;

  server.registerTool(
    "search_icons",
    {
      title: "Search icons",
      description:
        "Search the Motificons library (300k+ icons across 200+ sets) by name, alias and tag, with optional style/set/license filters. Returns compact candidates - id, name, set, style, license, whether attribution is required, and tier - for you to pick from. No icon bodies: call get_icon with a chosen id to fetch actual code or an asset.",
      inputSchema: searchIconsInputSchema,
    },
    async (input) => runSearchIcons(input),
  );

  server.registerTool(
    "get_icon",
    {
      title: "Get icon",
      description:
        'Fetch one icon (an id from search_icons or suggest_icons) as ready-to-use code or an asset, in the requested format (svg default; also jsx, tsx, vue, svelte, swiftui, png). Honest about capability: "swiftui" refuses with a plain-English reason instead of emitting Swift that would misrender when the artwork has no Path equivalent (masks, clips, gradients).',
      inputSchema: getIconInputSchema,
    },
    async (input) => runGetIcon(input),
  );

  server.registerTool(
    "suggest_icons",
    {
      title: "Suggest icons",
      description:
        "Suggest icons for a described need, e.g. \"delete trash can\" or \"user profile\". v1 is a keyword search over icon names/tags/aliases, NOT semantic matching - a multi-concept description (\"a settings screen with profile, notifications, privacy\") is searched as one literal phrase, not decomposed into separate results per concept. For that, call search_icons once per concept instead. Semantic multi-icon suggestion is a later phase.",
      inputSchema: suggestIconsInputSchema,
    },
    async (input) => runSuggestIcons(input),
  );

  server.registerTool(
    "list_collections",
    {
      title: "List collections",
      description:
        "List the signed-in account's own collections - each one's id, name, saved icon count, and a one-line summary of its style settings (color/stroke, if any are set). Two-way sync: this reads the exact same data the collection's web dashboard page shows, live - nothing here is cached separately, and it never lists another account's collections.",
      inputSchema: listCollectionsInputSchema,
    },
    async () => (authExtra ? runListCollections(authExtra) : missingAuthExtraResult()),
  );

  server.registerTool(
    "get_collection",
    {
      title: "Get collection",
      description:
        `Fetch one of the caller's own collections by name or id: every saved icon (id, name, set), each already rendered in the collection's remembered export format with its saved style settings (color, stroke width, size) applied - the same output the web dashboard's Download would produce. Capped at ${MAX_COLLECTION_ICONS} icons per call (pass "limit" for fewer); a bigger collection is truncated, oldest-saved icons first, and the response says so ("truncated": true).`,
      inputSchema: getCollectionInputSchema,
    },
    async (input) => (authExtra ? runGetCollection(input, authExtra) : missingAuthExtraResult()),
  );

  server.registerTool(
    "add_to_collection",
    {
      title: "Add icon to collection",
      description:
        "Save an icon into one of the caller's own collections, by collection name or id. Idempotent - adding an icon that is already saved there is still a success, not an error. Two-way sync: the icon appears on the collection's web dashboard page immediately, no separate step needed.",
      inputSchema: addToCollectionInputSchema,
    },
    async (input) => (authExtra ? runAddToCollection(input, authExtra) : missingAuthExtraResult()),
  );

  server.registerTool(
    "remove_from_collection",
    {
      title: "Remove icon from collection",
      description:
        "Remove an icon from one of the caller's own collections, by collection name or id. Idempotent - removing an icon that is not (or no longer) saved there is still a success. Two-way sync: the change is reflected on the collection's web dashboard page immediately.",
      inputSchema: removeFromCollectionInputSchema,
    },
    async (input) => (authExtra ? runRemoveFromCollection(input, authExtra) : missingAuthExtraResult()),
  );

  server.registerTool(
    "set_collection_style",
    {
      title: "Set collection style",
      description:
        'Change one of the caller\'s own collections\' style settings - color, stroke width and/or pixel size - the same settings the web dashboard\'s "Set collection styles" panel edits. Every icon in the collection, and every future get_collection call, renders with these settings applied. Pass null for a field to clear/unset it; omit a field to leave it as it is. Two-way sync: the change is reflected on the collection\'s web dashboard page immediately.',
      inputSchema: setCollectionStyleInputSchema,
    },
    async (input) => (authExtra ? runSetCollectionStyle(input, authExtra) : missingAuthExtraResult()),
  );

  server.registerTool(
    "audit_repo_icons",
    {
      title: "Audit repo icons",
      description:
        'Audit icon usage across your repo against your own curated collection - the source of truth, not generic heuristics. Scan your repo yourself first (grep icon-library import statements, list loose .svg files outside node_modules, grep icon-font CSS classes like "fa fa-" or "bi bi-"), then submit everything found as "findings" in one call. The report classifies each finding to a known icon set when recognized, flags mixed icon sets (a sign of visual inconsistency), and checks every finding against your collection: a match is "covered", a miss gets a suggested replacement rendered from your collection in its own export format and style, and a loose SVG file with no match is an "orphan". Read-only - never changes your collection or your repo.',
      inputSchema: auditRepoIconsInputSchema,
    },
    async (input) => (authExtra ? runAuditRepoIcons(input, authExtra) : missingAuthExtraResult()),
  );

  return server;
}
