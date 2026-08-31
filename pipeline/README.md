# pipeline

Turns `@iconify/json` into the local data the app, search index and MCP server read.

```sh
pnpm sync-icons    # from the repo root: rebuild pipeline/dist
pnpm spike:s1      # re-run the Spike S1 coverage matrix
pnpm check         # typecheck (tsc --noEmit)
```

Meilisearch is repo-contained, never installed system-wide: `
Writes `pipeline/dist/` (gitignored, ~500MB, rebuilt from scratch each run):

- `sets/<prefix>.json` + `sets.json` - set metadata: author, license policy, attribution and brand flags, counts, styles, samples, and the capability tier (T1-T4) with the sample shares it was derived from.
- `icons/<prefix>.jsonl` - one search doc per icon: id, name, aliases, categories, style, license, tier, flags.
- `bodies/<prefix>.jsonl` + `bodies/<prefix>.index.json` - icon bodies with a byte-offset index, so `/api/icon` seeks to one icon instead of parsing a set file that reaches 99MB.
- `licenses.json` - license policies with set counts, the attribution-required list and the brand/trademark list.
- `stats.json` - totals, per-set counts and the tier breakdown. The only source for icon numbers in copy.
