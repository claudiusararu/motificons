/**
 * Object storage for the large pipeline artefacts.
 *
 * Two drivers behind one interface:
 *
 *   R2  production. Range reads over the byte-offset body store.
 *   dev development only. Fetches the same bytes from the dev server's
 *       /__data endpoint, which streams pipeline/dist with Range support.
 *       `astro dev` runs in workerd, so there is no filesystem to read and no
 *       reason to publish 421MB into miniflare before the site will start.
 *
 * The dev driver loads through a dynamic import guarded by
 * `import.meta.env.DEV`. Vite replaces that with `false` in the production
 * build and drops the branch, so the dev transport never reaches the Worker.
 *
 * Small metadata (sets, stats, categories, licenses) deliberately does NOT go
 * through here: it is imported directly so it is embedded at build time. That
 * keeps prerendering working identically in Node and in workerd, and saves a
 * round trip on every page that needs a set name.
 */

export interface Storage {
  /** Whole object as text. Null when it does not exist. */
  text(key: string): Promise<string | null>;
  /** Byte range, for seeking into the icon body store. */
  range(key: string, offset: number, length: number): Promise<string | null>;
}

/** The subset of the R2 binding we use, typed locally to avoid a dependency. */
interface R2Bucket {
  get(
    key: string,
    options?: { range?: { offset: number; length: number } },
  ): Promise<{ text(): Promise<string> } | null>;
}

export interface RuntimeEnv {
  ICONS?: R2Bucket;
  METER?: unknown;
}

function r2Storage(bucket: R2Bucket): Storage {
  return {
    async text(key) {
      const object = await bucket.get(key);
      return object ? await object.text() : null;
    },
    async range(key, offset, length) {
      const object = await bucket.get(key, { range: { offset, length } });
      return object ? await object.text() : null;
    },
  };
}

let cached: Promise<Storage> | null = null;

/**
 * Resolves the driver, once per isolate.
 *
 * The choice is made by build mode, not by whether a binding happens to exist.
 * In dev the R2 binding DOES exist - miniflare creates an empty local bucket
 * from wrangler.jsonc - so "binding present means use R2" would silently serve
 * an empty library. Build mode is unambiguous: dev reads pipeline/dist, and
 * everything else reads R2.
 */
export function storage(): Promise<Storage> {
  cached ??= (async () => {
    if (import.meta.env.DEV) {
      const { devStorage } = await import("./storage-dev");
      return devStorage();
    }

    /* Ambient bindings: Astro v6 removed Astro.locals.runtime.env, and this
       works outside a request too, which the sitemap builder needs. */
    const { env } = (await import("cloudflare:workers")) as unknown as {
      env: RuntimeEnv;
    };
    if (!env?.ICONS) {
      throw new Error(
        "No ICONS binding. Create the R2 bucket and check app/wrangler.jsonc.",
      );
    }
    return r2Storage(env.ICONS);
  })();
  return cached;
}
