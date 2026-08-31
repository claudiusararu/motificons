/**
 * The judge door: one secret URL that signs a visitor into a single shared
 * demo account so a hackathon judge can try the signed-in half of the product
 * (collections, the dashboard, exports) without registering.
 *
 * Everything about it is deliberately narrow:
 *
 *   - OFF unless `DEMO_ACCESS_KEY` is set as a Worker secret. No secret, no
 *     endpoint - a plain 404, including in dev unless `.dev.vars` sets one.
 *     A feature that hands out a session must not be on by default anywhere.
 *   - ONE account, `DEMO_EMAIL`, which must already exist. This never creates
 *     an account, so a leaked key cannot be turned into a user factory, and
 *     the owner can revoke the whole thing by deleting that one row.
 *   - Every refusal is the SAME 404 - wrong key, no key, unconfigured, demo
 *     account missing, rate limited. The URL therefore says nothing about
 *     whether the feature exists on this deployment, so it cannot be used to
 *     probe the configuration; a key-shaped guess gets the identical answer
 *     to a bare GET.
 *   - 5 attempts per minute per IP (magic-link-rate-limit.ts's `checkIpWindow`,
 *     its own key prefix so the two budgets do not share), which is what keeps
 *     the key from being brute-forced fast.
 *   - The key comparison hashes both sides first and compares the digests
 *     byte by byte, so the loop runs the same length regardless of how much
 *     of the guess was right.
 *
 * The session itself is minted by Better Auth's own magic-link verify
 * endpoint (see src/pages/demo-access.ts) - no hand-rolled cookie.
 *
 * Nothing links here: no nav entry, no sitemap entry, and robots.txt
 * disallows /demo-access for every crawler.
 */

import { checkIpWindow, type KVNamespace } from "./magic-link-rate-limit";
import type { StoredEmailLookup } from "./account-lookup";

/** The one account this door opens. Created by hand, like any other account
    (magic link to an inbox the owner controls) - see docs/DEPLOY.md. */
export const DEMO_EMAIL = "demo@motificons.app";

/** Where a successful sign-in lands. */
export const DEMO_CALLBACK_URL = "/dashboard";

/** Key prefix for this endpoint's per-IP counters in the METER namespace,
    kept distinct from the magic-link door's `auth-ip:`. */
export const DEMO_RATE_LIMIT_PREFIX = "demo-ip";

/** Every refusal, identical. No body text worth reading, no cache. */
export function demoAccessNotFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}

async function digest(value: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

/**
 * Compares two secrets without leaking how far a guess got.
 *
 * Hash both sides first, then XOR-accumulate over the digests: SHA-256 output
 * is always 32 bytes, so the comparison loop's length no longer depends on
 * the input at all, and an early-exit `===` on the raw strings (which stops
 * at the first differing byte) is never reached. Same digest primitive the
 * rest of this folder already uses.
 */
export async function secretsMatch(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([digest(a), digest(b)]);
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) {
    difference |= left[i]! ^ right[i]!;
  }
  return difference === 0;
}

export interface DemoAccessInput {
  /** The `key` query parameter, as supplied (null when absent). */
  key: string | null;
  /** `DEMO_ACCESS_KEY`. Absent/empty = the feature is off. */
  secret?: string;
  /** Client IP, already resolved from the proxy headers by the caller. */
  ip: string;
  /** Absent = no METER binding; the rate limit is skipped, same fail-open
      posture as the magic-link door. */
  kv?: KVNamespace;
  /** Absent = no database reachable. That is a refusal here, not a pass:
      this endpoint exists to sign somebody in, and it may only do that for
      an account it has actually seen. */
  storedEmail?: StoredEmailLookup;
  /** Mints the session. Receives the email exactly as stored, so Better Auth
      matches the existing account instead of creating a second one. */
  signIn: (email: string) => Promise<Response>;
  now?: number;
}

/**
 * The whole decision, in order: configured -> under budget -> key matches ->
 * account exists -> sign in. Every step but the last answers with the same
 * 404.
 *
 * The rate limit runs BEFORE the key check so that guesses are what gets
 * counted; it runs AFTER the "is this configured at all" check so a
 * deployment without the secret never writes a KV key for a feature it does
 * not have.
 */
export async function handleDemoAccess(
  input: DemoAccessInput,
): Promise<Response> {
  if (!input.secret) return demoAccessNotFound();

  if (input.kv) {
    const limited = await checkIpWindow(
      input.kv,
      DEMO_RATE_LIMIT_PREFIX,
      input.ip,
      input.now,
    );
    if (limited) return demoAccessNotFound();
  }

  if (!input.key) return demoAccessNotFound();
  if (!(await secretsMatch(input.key, input.secret))) {
    return demoAccessNotFound();
  }

  if (!input.storedEmail) return demoAccessNotFound();
  const email = await input.storedEmail(DEMO_EMAIL);
  if (!email) return demoAccessNotFound();

  return input.signIn(email);
}

interface DemoAccessEnv {
  DEMO_ACCESS_KEY?: string;
}

/**
 * Reads the secret out of the Worker env - same lazy `cloudflare:workers`
 * import as turnstile.ts's `turnstileConfig()`, and the same reason: bindings
 * only exist inside a request-ish context, and `.dev.vars` feeds the same env
 * under `astro dev`. No env at all (a plain node context, a test) reads as
 * unconfigured, which is the off state.
 */
export async function demoAccessSecret(): Promise<string | undefined> {
  try {
    const { env } = (await import("cloudflare:workers")) as unknown as {
      env?: DemoAccessEnv;
    };
    return env?.DEMO_ACCESS_KEY || undefined;
  } catch {
    return undefined;
  }
}
