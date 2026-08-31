/**
 * Two things every rate-limited endpoint needs and neither of which belongs
 * to any one route: who the caller is, and where the counters live.
 *
 * Both used to be copy-pasted per route (api/auth/[...all].ts and
 * api/search.ts each grew their own). api/search.ts still resolves the IP
 * inline because its copy is welded to the meter-cookie block right above it;
 * everything since imports from here instead of adding a third copy.
 */

/** The METER namespace's surface, as narrow as the callers use it. Same
    shape the rate limiter declares - re-stated rather than imported so this
    module stays independent of the auth folder. */
export interface KVNamespace {
  get(key: string, type: "text"): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}

/**
 * The caller's IP. `cf-connecting-ip` is Cloudflare's real client IP,
 * `x-forwarded-for` a fallback for local proxies, and Astro's
 * `clientAddress` last because the Cloudflare adapter can throw on it in
 * some dev configurations. Falls back to the literal "unknown", which then
 * shares one rate-limit bucket - deliberate: an unidentifiable caller gets
 * the strictest treatment, not a free pass.
 */
export function clientIp(request: Request, clientAddress?: string): string {
  const forwarded =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0];
  return (forwarded ?? clientAddress ?? "unknown").trim();
}

/**
 * The METER KV binding, or undefined when there is none.
 *
 * Imported lazily: a static "cloudflare:workers" import is not resolvable
 * everywhere the dev module graph is built. A missing binding is a
 * misconfiguration, not a reason to fail a request - each caller decides what
 * "no counters" means for it.
 */
export async function meterKV(): Promise<KVNamespace | undefined> {
  try {
    const mod = (await import("cloudflare:workers")) as unknown as {
      env?: { METER?: KVNamespace };
    };
    return mod.env?.METER;
  } catch {
    return undefined;
  }
}
