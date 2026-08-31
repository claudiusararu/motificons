/**
 * Ambient shims needed only because this package type-checks reused
 * app/src/lib files (see mcp/README.md's "engine reuse" note) alongside its
 * own - `tsc` type-checks the whole program, including files a compiled
 * import pulls in from outside `include`, so these two Vite/Astro-only
 * pieces of surface need a declaration somewhere in the program or `tsc
 * --noEmit` fails on files this package never touches. Neither changes
 * app's own compile: astro/Vite provide both natively there.
 */

/** `import.meta.env.DEV` (Vite's convention) - `app/src/lib/storage.ts`
    branches on it. Wrangler's bundler statically replaces
    the expression with `false` via wrangler.jsonc's `[define]`, so the
    runtime value never matters here; this only satisfies the type checker. */
interface ImportMeta {
  env: { DEV: boolean };
}

/** `@resvg/resvg-wasm/index_bg.wasm` (imported by
    `app/src/lib/transforms/png.ts`) - Workers/esbuild's native `.wasm`
    module-import support compiles this to a `WebAssembly.Module`, matching
    what `@resvg/resvg-wasm`'s own `initWasm` expects. */
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
