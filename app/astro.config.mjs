// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { devDataPlugin } from './vite-plugin-dev-data.ts';
import { motificonsDark } from './src/lib/code-theme.ts';

// The dev data endpoint has to be reachable on the port the dev server
// actually bound, so read the same --port the CLI was given.
const portFlag = process.argv.indexOf('--port');
const DEV_PORT = Number(
  process.env.PORT ?? (portFlag > -1 ? process.argv[portFlag + 1] : 4321),
);
const DATA_DIR = fileURLToPath(new URL('../pipeline/dist', import.meta.url));

// https://astro.build/config
export default defineConfig({
  // Static by default so every SEO page (icon, set, category) is prerendered
  // and never touches the Worker. Only routes that opt out with
  // `export const prerender = false` render on demand: /search, the sitemaps
  // and the /api/* endpoints. This is what keeps the never-gate-the-crawlable-
  // pages rule (AGENTS.md) structural rather than something to remember.
  output: 'static',

  adapter: cloudflare({
    // v14 wires the Cloudflare Vite plugin itself, so `astro dev` already gets
    // real bindings (R2, KV) through miniflare - dev and production differ in
    // data, not in code paths. No platformProxy flag needed any more.
    //
    // Prerendering runs in workerd (the adapter default) rather than Node,
    // which is deliberate: it means a prerendered page reaching for node:fs
    // fails the build instead of failing after deploy.
    prerenderEnvironment: 'workerd',
    imageService: 'passthrough'
  }),

  integrations: [react()],

  // Fenced code blocks in markdown (currently: the blog, src/content/blog)
  // render through Shiki at build time same as everywhere else on the site,
  // using the same "motificons-dark" theme CodePanel.astro already uses for
  // the icon-detail export panel - one
  // brand of code block, not a second unrelated one from Astro's own
  // github-dark default. The theme's background is transparent (it assumes
  // a navy panel ancestor, same as CodePanel.astro's bg-ink wrapper); the
  // blog page supplies that navy background itself via `!important` in its
  // scoped <pre> rule, since Shiki's inline style would otherwise win.
  markdown: {
    shikiConfig: { theme: motificonsDark },
  },

  vite: {
    plugins: [tailwindcss(), devDataPlugin(DATA_DIR, DEV_PORT)],

    // Prebundle React and both JSX runtimes explicitly rather than letting
    // Vite discover them.
    //
    // Swapping the Node adapter for the Cloudflare one changed the Vite
    // environment setup, and a dependency cache written before that swap
    // survived it: the client prebundle kept a react/jsx-dev-runtime chunk
    // whose _jsxDEV export no longer resolved, so every React island threw
    // "_jsxDEV is not a function" at hydration and unmounted itself, leaving
    // the server-rendered markup on screen and then blanking it.
    //
    // Clearing node_modules/.vite is what fixed that instance. Listing the
    // runtimes here makes the prebundle deterministic from first boot instead
    // of dependent on discovery order, so the same mismatch has less room to
    // happen again. Note this is hardening, not a proven cure - the cure was
    // the cache clear.
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        'react/jsx-dev-runtime'
      ]
    }
  }
});
