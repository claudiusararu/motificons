/**
 * Rate limits POST /api/auth/sign-in/magic-link: every accepted call sends
 * a real email through Resend - with no limit, a bot can
 * burn send quota or bomb one victim's inbox with sign-in emails they never
 * requested. Two independent, KV-backed windows, same `METER` namespace and
 * fail-open posture as ../search/meter-kv.ts (a rate limiter must never be
 * the reason sign-in itself breaks):
 *
 *   1. Per IP: `IP_LIMIT` requests per `IP_WINDOW_MS` - one source hammering
 *      the endpoint.
 *   2. Per target email: `EMAIL_LIMIT` sends per `EMAIL_WINDOW_MS`,
 *      independent of IP - a botnet spreading requests across many IPs to
 *      bomb one victim's inbox, which the IP bound alone cannot catch.
 *
 * Both are plain fixed-window counters keyed by `{prefix}:{id}:{window
 * bucket}` - simpler than meter-kv.ts's sliding dedupe logic, which exists
 * there to keep legitimate repeat searches free. There is no legitimate
 * "repeat this exact request" case for a sign-in email, so a count-with-TTL
 * is the whole decision; a request right at a window boundary can start a
 * fresh burst a little early, which is an acceptable trade for staying this
 * simple - 5 per minute and 3 per 15 minutes, not a precise sliding
 * algorithm.
 *
 * Where this sits: magic-link-guard.ts runs Turnstile FIRST,
 * this limiter second, the account lookup third. The numbers and the
 * fail-open posture below are unchanged by that - the limiter simply no
 * longer faces raw internet traffic, since a caller that cannot pass the
 * human check never reaches it and so never eats a shared IP's budget.
 */

export interface KVNamespace {
  get(key: string, type: "text"): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}

/** The limits themselves. */
export const IP_LIMIT = 5;
const IP_WINDOW_MS = 60 * 1000;

export const EMAIL_LIMIT = 3;
const EMAIL_WINDOW_MS = 15 * 60 * 1000;

/** KV's floor; anything smaller is rejected. */
const MIN_TTL_SECONDS = 60;

export interface RateLimitDecision {
  limited: boolean;
  /** Which bound tripped - only meaningful when `limited` is true. The
      response to the caller is one plain message regardless of which bound
      fired (no point telling a bot which knob to turn), so this is for
      logging/tests only. */
  reason?: "ip" | "email";
}

/** Same digest-then-hex pattern as api-keys.ts's `hashApiKey` and
    meter-kv.ts's `identityHash` - the raw email never becomes part of a KV
    key name. */
async function hash(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Bucketed by window start (`floor(now / windowMs)`), so every request
    inside the same window shares one key/TTL - matches meter-kv.ts's
    day-bucketed key shape at a different resolution. */
function windowBucket(now: number, windowMs: number): number {
  return Math.floor(now / windowMs);
}

/**
 * One fixed window: reports whether `key`'s counter is already at `limit`
 * and, if not, increments it. Fails open on any KV error (read or write) -
 * same reasoning as meter-kv.ts: losing a count is far cheaper than a
 * sign-in flow that 500s because a KV read failed.
 */
async function checkWindow(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  let count = 0;
  try {
    const stored = await kv.get(key, "text");
    const parsed = stored ? Number(stored) : 0;
    count = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return false;
  }

  if (count >= limit) return true;

  try {
    await kv.put(key, String(count + 1), {
      expirationTtl: Math.max(MIN_TTL_SECONDS, Math.ceil(windowMs / 1000)),
    });
  } catch {
    /* Write failed - allow the request rather than block sign-in over a
       counter that could not be persisted. */
  }

  return false;
}

/**
 * The full decision: checks the IP bound first (cheaper - no hashing), then
 * the email bound only if the IP bound passed. Both are counted
 * independently of whether the OTHER bound ends up tripping this same call,
 * matching how meter-kv.ts counts a request as soon as it decides to charge
 * it rather than only after every other check clears.
 */
export async function checkMagicLinkRateLimit(
  kv: KVNamespace,
  ip: string,
  email: string,
  now = Date.now(),
): Promise<RateLimitDecision> {
  const ipKey = `auth-ip:${ip}:${windowBucket(now, IP_WINDOW_MS)}`;
  if (await checkWindow(kv, ipKey, IP_LIMIT, IP_WINDOW_MS)) {
    return { limited: true, reason: "ip" };
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail) {
    const emailKey = `auth-email:${await hash(normalizedEmail)}:${windowBucket(now, EMAIL_WINDOW_MS)}`;
    if (await checkWindow(kv, emailKey, EMAIL_LIMIT, EMAIL_WINDOW_MS)) {
      return { limited: true, reason: "email" };
    }
  }

  return { limited: false };
}

/** Plain-language, matches Better Auth's own error shape (`{ message, code
    }` - verified against a live 400 from this same endpoint) so the
    existing AuthCard error state renders it with zero client changes:
    @better-fetch/fetch spreads the parsed JSON body straight into the
    `error` object it hands back from `authClient.signIn.magicLink()`, and
    AuthCard already renders `error.message`. */
export const RATE_LIMIT_MESSAGE = "Too many attempts - wait a minute and try again.";
