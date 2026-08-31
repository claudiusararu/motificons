---
title: "Give Your Coding Agent an Icon Library with MCP"
description: "Coding agents guess icon package names and mix icon sets at random because they have no real source of truth. MCP gives them one - here is how to connect Claude Code, Cursor and Codex."
pubDate: 2026-08-13
tags: ["mcp", "coding-agents", "icons"]
---

Ask a coding agent for a "trash icon" and watch what happens. It might import `Trash2` from `lucide-react` even though your project uses Feather. It might write `import { FaTrash } from 'react-icons/fa'` and get the export name slightly wrong, because it is pattern-matching on what trash icons usually look like in training data, not checking what actually exists in the package you have installed. It might mix three icon sets across one page without noticing, because from the agent's side there is no difference between "an icon that exists" and "an icon that sounds like it should exist."

None of this is the agent being careless. It has no way to check. Without a real source it can query, an icon request is just a guess dressed up as an import statement, and guesses about package internals fail silently - the build breaks, or worse, it doesn't and you ship a page with two different icon styles because nothing caught it.

## What MCP actually is

MCP (Model Context Protocol) is a standard way for an AI coding agent to call an external tool directly, instead of guessing from memory. Rather than hallucinating what a `Trash2` import looks like, the agent can call a real `search_icons` tool, get back actual results with real ids, and call `get_icon` on the one it picked to get real, current code - the same way it might call a linter or a test runner instead of guessing whether your code compiles.

Motificons runs an MCP server that exposes exactly that: a live icon library your agent can search, filter and pull from, instead of pattern-matching on package names it half-remembers.

## Setup

MCP access is free with a Motificons [account](/register) - no payment details, just a magic link. Once you are signed in, create an API key from your dashboard and wire it into whichever agent you use.

**Claude Code** - the fastest path is one command in your terminal, which writes its own config:

```
claude mcp add --transport http motificons https://mcp.motificons.app/mcp --header "Authorization: Bearer mk_YOUR_API_KEY"
```

If you would rather commit a config your whole team shares, save this as `.mcp.json` in your project folder instead:

```json
{
  "mcpServers": {
    "motificons": {
      "type": "http",
      "url": "https://mcp.motificons.app/mcp",
      "headers": { "Authorization": "Bearer mk_YOUR_API_KEY" }
    }
  }
}
```

**Cursor** - save this as `.cursor/mcp.json` inside your project folder, or paste it into Cursor's Settings under MCP:

```json
{
  "mcpServers": {
    "motificons": {
      "url": "https://mcp.motificons.app/mcp",
      "headers": { "Authorization": "Bearer mk_YOUR_API_KEY" }
    }
  }
}
```

**Codex** - add this to `~/.codex/config.toml` in your home folder (create the file if it does not exist yet):

```toml
[mcp_servers.motificons]
url = "https://mcp.motificons.app/mcp"
bearer_token_env_var = "MOTIFICONS_MCP_TOKEN"
```

Codex reads the key from an environment variable rather than the file itself, so also run `export MOTIFICONS_MCP_TOKEN=mk_YOUR_API_KEY` before starting it.

Replace `mk_YOUR_API_KEY` with your real key in all three - it is shown once, right when you create it, from your dashboard's MCP section. After that, ask your agent to "search for a bell icon" and see if it comes back with real results instead of an import statement it made up.

## Collections are what keep the agent consistent

A raw search over a library of hundreds of thousands of icons solves the "does this icon exist" problem, but not the "does it match everything else in my project" problem. That is what collections are for. You curate a collection visually here - the icons you actually use, normalized to one style - and the agent consumes that same collection through MCP. `get_icon` returns the collection-normalized variant by default, so an agent working inside your project cannot introduce an off-style icon even if it wanted to: it is picking from a set you already curated, not from the entire library.

There is also an audit tool, `audit_repo_icons`, built for the case where the mismatch already happened - point it at your codebase and it reports icons that are off-collection, mixed sets, or orphaned SVGs nobody imports anymore, checked against your curated collection rather than generic heuristics.

This flips the usual order of operations. Normally you curate a style guide as documentation and hope everyone (human or agent) reads it before adding an icon. Here the collection is not documentation about the style, it is the style - the agent cannot drift from it because it is not working from a description, it is working from the same data your search and export pages use. If you rename or swap the anchor icon, the next `get_icon` call for anything in that collection reflects the change immediately, no separate sync step, no stale style guide sitting in a wiki nobody opens.

## The honest limits

MCP access costs nothing, but it does need an account - the API key has to belong to someone, and the collections it reads are yours. What you get is not "more icons than a free package" - `react-icons` and similar libraries already bundle a huge number of icons - it is a searchable, curated source your agent can query in real time, scoped to a style you actually chose, instead of an agent guessing at package internals or pulling whatever happens to rank first in its training data.

If your project only ever uses one icon set and your agent already imports from it correctly, you may not need this. The problem MCP solves is specifically the guessing - multiple sets in play, icons that half-exist under a slightly different name, no shared source of truth between what you curated and what the agent picks. If that describes your last few PRs, it is worth trying.
