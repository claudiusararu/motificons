import type { Storage } from "./storage";

declare const __DEV_DATA_ORIGIN__: string;

/**
 * Development-only storage driver.
 *
 * Talks to the dev server's /__data endpoint (see vite-plugin-dev-data.ts)
 * with the same range semantics R2 provides, so `pnpm dev` works the moment
 * `pnpm sync-icons` has run - no publish step, no local copy of the library.
 *
 * Only ever imported from inside an `import.meta.env.DEV` branch, so it is
 * dropped from the production bundle.
 */
export function devStorage(): Storage {
  const origin =
    typeof __DEV_DATA_ORIGIN__ === "string"
      ? __DEV_DATA_ORIGIN__
      : "http://127.0.0.1:4321";

  return {
    async text(key) {
      const response = await fetch(`${origin}/__data/${key}`);
      return response.ok ? await response.text() : null;
    },

    async range(key, offset, length) {
      const response = await fetch(`${origin}/__data/${key}`, {
        headers: { Range: `bytes=${offset}-${offset + length - 1}` },
      });
      return response.ok ? await response.text() : null;
    },
  };
}
