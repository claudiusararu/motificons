/**
 * Dev-only origin for Better Auth's `baseURL` (magic-link URLs, OAuth
 * callback URLs, and the Origin-header check on every signed-in request).
 * Uses its own Vite `define` from vite-plugin-dev-data.ts - deliberately
 * NOT `__DEV_DATA_ORIGIN__` (that one is 127.0.0.1, for an internal
 * server-to-self fetch). This one has to equal whatever origin the
 * visitor's browser actually used, which is "localhost" by convention -
 * `127.0.0.1` and `localhost` are different origins as far as CORS/Origin
 * matching is concerned even though they reach the same box.
 *
 * Only ever imported from inside an `import.meta.env.DEV` branch, so it is
 * dropped from the production bundle - see storage-dev.ts for the same
 * pattern applied to R2.
 */
declare const __DEV_APP_ORIGIN__: string;

export function devOrigin(): string {
  return typeof __DEV_APP_ORIGIN__ === "string"
    ? __DEV_APP_ORIGIN__
    : "http://localhost:4321";
}
