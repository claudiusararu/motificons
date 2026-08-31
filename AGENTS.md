# Contributing to Motificons

Conventions for anyone working in this repo, human or agent. Read this before
your first change.

## What this is

Motificons is a free, open-source icon library: hundreds of thousands of icons
from hundreds of open-source sets, searchable by people on the web and by
coding agents over MCP. On top of the raw icons it adds a style engine that
normalizes icons from different sets to one look, export to web and native
formats (React, Vue, Svelte, SwiftUI, Xcode asset catalogs, PNG, CSS), and
collections you curate and your agent can read. Everything is free. An account
adds collections, unlimited search and an MCP key; nothing costs money and
there is no paid tier.

## Layout

A pnpm workspace with four packages:

| Package     | What it is                                                     |
| ----------- | -------------------------------------------------------------- |
| `app/`      | The website. Astro SSR + React islands + Tailwind v4, TypeScript. |
| `mcp/`      | The MCP server coding agents connect to. Cloudflare Worker.      |
| `pipeline/` | Ingests upstream icon sets and produces the data the app serves. |
| `desktop/`  | The macOS app. Swift, built with Xcode.                          |

Install once at the root with `pnpm install`; the workspace links the packages
together.

## Commands

Run these from the repo root unless noted.

```
pnpm dev                  # the website on localhost
pnpm build                # production build of the website
pnpm sync-icons           # re-ingest upstream icon sets
```

Gates - all four must pass before a change is done:

```
pnpm -C app exec astro check     # 0 errors
pnpm -C app exec vitest run
pnpm -C mcp exec tsc --noEmit && pnpm -C mcp exec vitest run
pnpm -C app run build
```

`pnpm -C pipeline run check` type-checks the pipeline when you touch it.

## Conventions

### Writing

- Use "-" for punctuation dashes. Never em-dashes, anywhere: copy, comments,
  commit messages, docs.
- Visitor-facing copy is plain language. Say what a person gets, not what the
  system is called internally. Tier names, SPDX identifiers and engine terms
  never appear raw on a general-audience page - translate them into a sentence
  ("free, no account needed") or move them to a detail page that explains them.
- Icon and set counts come from the pipeline's own stats. Never hardcode a
  count in copy; when the upstream sets change, the number has to change with
  them.
- Detail pages may be technical. Browse and marketing pages may not.

### Pages

- Browse surfaces lead with icons. A page about icons that shows no icons is
  wrong by default.
- Programmatic pages - icon, set and category pages - are never gated and never
  metered. They are the open surface of the library. Only the search box is
  metered, and only for visitors without an account.
- One shared container on every page: 1200px maximum, 24px side padding,
  centered. The header row, every section, the banner and the footer all use
  it, so content width never varies between sections or between pages.
- No max-width narrower than that container, on any page, including long-form
  documents. No character caps (`max-w-[62ch]` and friends). If there is room
  to stretch, let it stretch.

### Frontend

- Self-host fonts and assets. Nothing loads from a third-party CDN at runtime.
- In SVG, `stop-color` takes a hex value. OKLCH is unreliable there.
- Accessibility is not optional: 44x44px minimum touch targets (36px height is
  allowed only in dense desktop rows with at least 8px spacing),
  `:focus-visible` on every interactive element, complete state sets
  (disabled, loading, error, success), `prefers-reduced-motion` respected,
  full keyboard patterns, and contrast verified rather than assumed.
- Every visible control works. A control that does nothing does not ship.

### Verifying

Screenshot the page in a real browser before calling visual work done. Tests
and type checks do not catch a broken layout or an unreadable contrast ratio.

## Commits

Plain conventional messages: `area: what changed`, lower case, no trailing
period. Explain why in the body when the why is not obvious from the diff. No
generated attribution trailers.
