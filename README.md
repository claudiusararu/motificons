# Motificons

**[motificons.app](https://motificons.app)** - every open-source icon in one place: 337,000+ icons from 239 sets, searchable, restyleable, and exportable for web AND native. Built for humans and for coding agents. Free, and open source itself.

## Why this exists

Icon aggregators solve finding an icon. They do not solve the two problems that come after:

1. **Icons from different sets do not match.** Mix Tabler with Lucide with Phosphor and you get three stroke widths, three visual weights, three grid sizes. Motificons has a style engine: pick one icon as the anchor and the collection normalizes stroke, size and color to match it - then exports as one consistent system.
2. **Coding agents pick icons terribly.** An agent asked for "an archive icon" will invent an SVG, paste a stale snippet, or grab the first of fifty near-duplicates. Motificons gives agents the same library humans browse - searched by intent, filtered to your collection's style, delivered as production-ready code.

## What is inside

- **Search 337,000+ icons** across 239 open-source sets, with facets for set, category, style, license and restyling capability.
- **Style engine**: recolor, resize, restroke, rotate, flip and pad any icon that supports it - live on the icon page, with every export format updating as you edit.
- **9 export formats**: SVG, React JSX/TSX, Vue, Svelte, SwiftUI `Shape` code, Xcode asset catalogs, PNG at any size, and data URIs. The native half (SwiftUI, asset catalogs) is the part other aggregators do not offer.
- **Collections**: save icons, set collection-level styles (anchor icon, color, stroke, size, format), duplicate to make style variants, and download the whole set as a zip with per-set license attribution included.
- **Free accounts**: email magic link, no password. An account adds 5 collections, unlimited search and an MCP key. Everything else works without one - anonymous visitors get every export format and 25 searches a day.
- **A macOS app**: Spotlight-style hotkey search, offline, copies code straight to the clipboard.

## For coding agents

The MCP server at `mcp.motificons.app` is free with an account. Nine tools: search and fetch icons, manage collections, get styled exports, and `audit_repo_icons` - point it at a codebase and it reports mixed sets, orphan SVGs and off-collection icons, checked against your curated collection rather than generic heuristics.

Setup snippets for Claude Code, Cursor and Codex are generated with your key in the dashboard at [motificons.app/dashboard](https://motificons.app/dashboard). More on the approach: [motificons.app/agents](https://motificons.app/agents).

## Repository layout

| Package | What it is |
| --- | --- |
| `app/` | The web app - Astro SSR + React islands on Cloudflare Workers, D1, R2, KV |
| `mcp/` | The MCP server - a separate Cloudflare Worker sharing the app's data |
| `pipeline/` | Builds the icon data - ingests sets, computes search shards, stats and categories |
| `desktop/` | The macOS app - native Swift, XcodeGen project |

## Development

```sh
pnpm install

# one-time: create your own Cloudflare resources and config
cp app/wrangler.jsonc.example app/wrangler.jsonc     # fill in your ids
cp app/.dev.vars.example app/.dev.vars               # optional secrets
cp mcp/wrangler.jsonc.example mcp/wrangler.jsonc

# run the web app
cd app && pnpm dev                                   # http://127.0.0.1:4321
```

Gates before any change ships:

```sh
pnpm -C app exec astro check    # 0 errors
pnpm -C app exec vitest run
pnpm -C mcp exec tsc --noEmit
pnpm -C mcp exec vitest run
pnpm -C app run build
```

Conventions live in [AGENTS.md](AGENTS.md) - read it first.

## Icon licenses

Every set keeps its upstream license (MIT, Apache 2.0, CC BY, OFL and friends). The app shows the license on every icon page, filters by attribution requirement, and collection downloads include a `LICENSES.txt` with per-set attribution. Details: [motificons.app/licenses](https://motificons.app/licenses).

## License

The Motificons code is [MIT licensed](LICENSE). The icons belong to their authors, under their own licenses.
