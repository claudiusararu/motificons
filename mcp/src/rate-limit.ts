/**
 * Per-key call-rate abuse guard - unlimited use behind a fair-use cap.
 * Deliberately not the same mechanism as the app's
 * anonymous search meter (app/src/lib/search/meter-kv.ts): that meter
 * dedupes near-identical queries and resets at UTC midnight because it is
 * rationing a small daily allowance for anonymous visitors. This is a
 * generous per-minute abuse guard for an already-authenticated key, so a
 * plain fixed window is enough - the goal is catching a runaway loop, not
 * metering usage.
 *
 * Fixed window, not sliding: a caller could burst up to 2x the limit across
 * a window boundary. Accepted trade for a counter this generous - the
 * failure mode of a sliding window (one KV read+write per call carrying
 * timestamp history, same shape as meter-kv.ts) costs more than it buys
 * here.
 *
 * Fails open on any KV error, same reasoning as meter-kv.ts: a rate limiter
 * that cannot be read must not take the MCP server down with it.
 */

export const CALLS_PER_MINUTE = 300;

const MIN_TTL_SECONDS = 60;
/** A little longer than the window so a slow write from the previous minute
    cannot resurrect a stale key after rollover. */
const KEY_TTL_SECONDS = 120;

export interface KVNamespace {
  get(key: string, type: "text"): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}

export interface RateLimitDecision {
  limited: boolean;
  count: number;
  limit: number;
}

function windowKey(keyId: string, now: number): string {
  const minuteBucket = Math.floor(now / 60_000);
  return `rl:${keyId}:${minuteBucket}`;
}

export async function checkRateLimit(
  kv: KVNamespace,
  keyId: string,
  now = Date.now(),
): Promise<RateLimitDecision> {
  const key = windowKey(keyId, now);

  let count = 0;
  try {
    const stored = await kv.get(key, "text");
    count = stored ? Number(stored) || 0 : 0;
  } catch {
    return { limited: false, count: 0, limit: CALLS_PER_MINUTE };
  }

  if (count >= CALLS_PER_MINUTE) {
    return { limited: true, count, limit: CALLS_PER_MINUTE };
  }

  try {
    await kv.put(key, String(count + 1), {
      expirationTtl: Math.max(MIN_TTL_SECONDS, KEY_TTL_SECONDS),
    });
  } catch {
    /* A failed write costs one uncounted call - fail open, same as the miss
       above. */
  }

  return { limited: false, count: count + 1, limit: CALLS_PER_MINUTE };
}
