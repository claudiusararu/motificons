import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

/**
 * D1 access, lazily bound to the Worker's `DB` binding.
 *
 * Same shape as `storage()` in lib/storage.ts: one cached promise per
 * isolate, resolved through a dynamic `import("cloudflare:workers")` because
 * Astro v6 dropped `Astro.locals.runtime.env` and this needs to work outside
 * a request too (database hooks run from inside Better Auth, not from an
 * Astro endpoint that would hand us `Astro.locals`).
 *
 * The binding is cast through `unknown` rather than typed against the real
 * `D1Database` global: this project deliberately does not depend on
 * `@cloudflare/workers-types` (see the R2Bucket note in lib/storage.ts), and
 * drizzle-orm's own `D1Database` constraint degrades to `any` without it
 * (skipLibCheck keeps that degradation from surfacing as an error) - so the
 * cast documents the same choice instead of leaving it to accident.
 */

export { schema };
export type Database = ReturnType<typeof drizzle<typeof schema>>;

let cached: Promise<Database> | null = null;

export function db(): Promise<Database> {
  cached ??= (async () => {
    const { env } = (await import("cloudflare:workers")) as unknown as {
      env: { DB?: unknown };
    };
    if (!env?.DB) {
      throw new Error(
        "No DB binding. Create the D1 database and uncomment it in app/wrangler.jsonc.",
      );
    }
    return drizzle(env.DB as any, { schema });
  })();
  return cached;
}
