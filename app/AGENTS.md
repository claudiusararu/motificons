Notes specific to the website package. Project-wide conventions live in the
repo root's [AGENTS.md](../AGENTS.md).

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

If you start `astro dev` directly instead of through `pnpm dev` (`scripts/dev.mjs`), pass `--host 127.0.0.1` explicitly: the dev data transport (`vite-plugin-dev-data.ts`) dials `127.0.0.1` directly, and on some machines `localhost` resolves IPv6-only, so the server binds to `[::1]` and every dev-only fetch to the data transport 503s while pages still load normally - a confusing partial failure `scripts/dev.mjs` already works around.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
