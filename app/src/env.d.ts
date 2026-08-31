/**
 * Populated by src/middleware.ts on every SSR request from the Better Auth
 * session cookie. Null on prerendered/static routes (middleware never runs
 * there) and for signed-out visitors.
 */
declare namespace App {
  interface Locals {
    user: import("./lib/auth/auth").SessionInfer["user"] | null;
    session: import("./lib/auth/auth").SessionInfer["session"] | null;
  }
}

/**
 * `window.posthog` - the array.js loader stub Layout.astro ships in
 * production builds only (see its own comment). Every reader guards with
 * `?.` since the loader is absent in dev and can be blocked by the visitor;
 * this only documents the methods this app actually calls, not
 * posthog-js's full API (this project has no dependency on posthog-js's own
 * types, same reasoning as the R2Bucket/D1Database casts elsewhere).
 */
interface Window {
  posthog?: {
    identify: (distinctId: string, properties?: Record<string, unknown>) => void;
    capture: (event: string, properties?: Record<string, unknown>) => void;
    reset: () => void;
  };
}
