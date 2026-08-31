# Motificons MCP server

Hosted Streamable HTTP MCP server - a separate Cloudflare Worker from
`app/`, sharing its R2 icon data and D1 database.

Every `/mcp` call requires an `mk_...` API key (`Authorization: Bearer
mk_...`). Accounts and keys are free - see "Getting a test key" below.
Tools:

Library (open to the whole 300k+-icon catalog, no ownership involved):

- `search_icons(query, style?, set?, license?, limit?)` - candidates (id,
  name, set, style, license, attributionRequired, tier), no bodies.
- `get_icon(id, format?, color?, size?, stroke?)` - one icon as ready-to-use
  code or an asset. `format` defaults to `svg`; also `jsx`, `tsx`, `vue`,
  `svelte`, `swiftui`, `png`.
- `suggest_icons(description, count?)` - v1 baseline: `description` used
  as-is as a `search_icons` query over names/tags/aliases. Not semantic
  matching yet - each tool's own description says so, so a calling agent
  calibrates expectations.

Collections (collection-scoped access - the human verbs on the
collection page, mirrored one-to-one for an agent; every tool below is scoped
to the calling key's own workspace via `src/auth.ts`'s `MotificonsAuthExtra`,
and two-way sync with the web dashboard is automatic - same D1 rows, no
separate sync step):

- `list_collections()` - the caller's own collections: id, name, saved icon
  count, one-line style summary.
- `get_collection(collection, limit?)` - one collection's saved icons (id,
  name, set), each rendered in the collection's remembered export format with
  its saved style settings applied. Capped at `MAX_COLLECTION_ICONS` (100)
  icons per call.
- `add_to_collection(collection, icon_id)` / `remove_from_collection(collection,
  icon_id)` - idempotent both directions, same as the web's
  POST/DELETE `/api/collections/[id]/icons`. Returns the new saved-icon count.
- `set_collection_style(collection, {color?, stroke?, size?})` - same
  validation as the web PUT `/api/collections/[id]/style`. `null` clears a
  field, omitting one leaves it unchanged (the web PUT always sends every
  field; this tool only exposes color/stroke/size, so it merges with the
  collection's current anchor/export-format under the hood to preserve that
  "whole blob" contract).
- `audit_repo_icons({findings, collection?})` - the calling agent scans its
  own repo and submits what it found; the audit runs server side against the
  caller's own collection, classifying each finding to a known icon set,
  flagging mixed sets, and marking each one covered, replaceable (with a
  suggestion rendered from the collection) or orphaned. Read-only.

Every collection tool's `collection` param accepts a name (case-insensitive
exact match) or an id; a missing or ambiguous name returns one plain-language
tool error listing the caller's own collection names (`src/tools/
collection-shared.ts`).

## Local dev

The Worker reads the SAME local D1 and R2 state `app/`'s dev server uses, so
nothing here needs seeding twice:

```sh
# once, if you have not already (creates the local D1 schema app/'s dev uses):
pnpm --filter app run db:migrate

# once, to put icon data + the search index into local R2 (miniflare):
pnpm publish-data --local --only=meta,shards
pnpm publish-data --local --sets=tabler --only=bodies   # add more --sets as needed

# start the MCP worker:
pnpm --filter mcp run dev
```

`wrangler dev` defaults to persisting local state at `.wrangler/state`
relative to its own config file (`mcp/.wrangler/state`), which would NOT be
the directory `app/`'s dev server and `publish-data --local` use
(`app/.wrangler/state`) - `mcp/package.json`'s `dev` script passes
`--persist-to ../app/.wrangler/state` for exactly this reason. Two separate
state directories would mean two separate empty-looking databases and a
confusing "no icon found" / "sign in first" experience even after doing the
steps above correctly.

Runs on **port 8788** (chosen to not collide with `app/`'s 4321) - set in
`package.json`'s `dev` script, not `wrangler.jsonc`, so `wrangler deploy`
never inherits a dev-only port.

`worker-configuration.d.ts` (the ambient `Env` type) is generated, not
committed - run `pnpm run types` (or `pnpm run check`, which runs it first)
after any `wrangler.jsonc` binding change.

### Getting a test key

Keys are minted from the app's dashboard, not from anything in this package.
With `app/`'s dev server running (`pnpm --filter app run dev`) and Better
Auth's DEV-ONLY instant sign-in:

```sh
curl -s "http://localhost:4321/api/auth/dev-instant-sign-in?email=you@example.com" \
  -c cookies.txt -o /dev/null -w "%{http_code}\n"
curl -s -b cookies.txt -X POST http://localhost:4321/api/keys | jq
```

The POST response's `plaintext` field is the `mk_...` key - shown once, same
as the real dashboard flow. Key creation needs nothing but a session.

### Calling it

```sh
curl -s http://localhost:8788/mcp \
  -H "Authorization: Bearer mk_..." \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0.0.0"}}}'
```

A missing, malformed, unknown or revoked key all get the same one JSON-RPC
error - see `src/auth.ts`'s doc comment for why that is one message rather
than a different one per failure mode.

## Auth

`src/auth.ts` verifies the bearer token itself (SHA-256 hash, looked up
against `app/src/db/schema.ts`'s `mcpKey` table by hash - the same hash
`app/src/lib/workspace/api-keys.ts`'s `hashApiKey` produces when the
dashboard creates a key), reused rather than copied - see "Engine reuse"
below. A live, non-revoked key is the entire gate: the product is free, so
there is no entitlement lookup behind it and no dev-unlock var to flip.

## Rate limiting

`MCP_RATE` is a KV namespace, separate from `app/`'s anonymous search
`METER` (different identity shape, different reset rule - see
`src/rate-limit.ts`'s doc comment). `wrangler.jsonc`'s `id`/`preview_id` are
placeholders until the real namespace is created (`wrangler kv namespace
create MCP_RATE` / `--preview`), same as `app/wrangler.jsonc`'s `METER`
placeholders.

## Engine reuse (not a copy)

`src/auth.ts`, `src/tools/*` import `app/src/lib/{data,storage,
search/*,transforms/*}` and `app/src/db/{client,schema}` directly by relative
path - the same engine and export code `/api/search` and `/api/export` use,
not a fork. `app/src/lib/workspace/api-keys.ts`'s `hashApiKey` is reused the
same way, so a key minted on the dashboard verifies here with no format
drift. `app/src/` is never modified by this package (see the doc comments in
`src/auth.ts`, `wrangler.jsonc` and `src/ambient.d.ts` for the handful of
places that needed a bridge - a `define` swap for Vite-only
`import.meta.env.DEV`, and two ambient type declarations - rather than a
change to the reused files themselves).

`get_icon`'s format list (svg, jsx, tsx, vue, svelte, swiftui, png) is
narrower than the web's nine-format export menu on purpose: `catalog` (a zip) and `datauri` (a `data:` string)
are not useful shapes for a tool call to hand back to an agent.

`get_collection` renders in the collection's remembered export format, which
can be any of the web's nine - it reuses `get_icon`'s same dispatch plus
`datauri` (a short string, cheap to inline per icon, unlike `catalog`'s
per-icon ZIP). A collection remembered as `catalog` downgrades to `svg` with
an honest `formatNote` in the response rather than silently substituting.
