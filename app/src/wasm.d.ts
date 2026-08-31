/**
 * Wasm modules are emitted as assets by the bundler and instantiated directly
 * by the Worker; TypeScript needs to be told they resolve to a Module.
 */
declare module "*.wasm" {
  const wasmModule: WebAssembly.Module;
  export default wasmModule;
}

/**
 * Ambient Worker bindings. Astro v6 removed Astro.locals.runtime.env, and the
 * generated worker types are not in this project's include path, so the shape
 * we actually use is declared here.
 */
declare module "cloudflare:workers" {
  export const env: {
    ICONS?: {
      get(
        key: string,
        options?: { range?: { offset: number; length: number } },
      ): Promise<{ text(): Promise<string> } | null>;
    };
    METER?: unknown;
  };
}
