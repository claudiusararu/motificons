/**
 * The anonymous search meter, on KV.
 *
 * A direct port of search-meter.ts - the rules are unchanged, only the storage
 * moved from an in-process Map to a durable one. The counting rule, restated
 * so it lives next to the code that enforces it:
 *
 *   A request consumes one search only when it is a genuinely new query for
 *   this identity. It is free when any of these hold:
 *
 *     1. the normalized query is empty - browsing by facet alone is never
 *        metered, same reason SEO pages are not;
 *     2. the normalized query was already counted within the last 10 minutes -
 *        paging, changing facets, or returning to the same search cost nothing;
 *     3. the normalized query and one counted in the last 60 seconds are
 *        prefixes of one another, in either direction - so typing "a", "ar",
 *        "arrow" costs one search, not three, and deleting back costs nothing.
 *
 *   A free request is always served, including at the limit: having spent a
 *   search and then being locked out of its own results would be worse than
 *   the limit itself.
 *
 * Rule 3 is enforced here rather than trusted to the client. The client
 * debounces, but it is a fetch anyone can replay, and a buggy or hostile page
 * must not be able to burn a visitor's five searches on one word.
 *
 * KEY DESIGN
 *
 *   m:{identity}:{YYYY-MM-DD}
 *
 * The date is in the key rather than the value, so the daily reset needs no
 * reset job: tomorrow is simply a different key. `identity` is a hash of the
 * cookie and IP together, so the key names carry no address or session id -
 * neither alone is right, since a cookie is cleared by a private window and an
 * IP alone punishes a whole office behind one NAT.
 *
 * TTL
 *
 * Every write sets expirationTtl to the seconds remaining in the UTC day plus
 * an hour of slack, floored at KV's 60-second minimum. Entries therefore
 * delete themselves shortly after they stop being meaningful, and nothing ever
 * needs sweeping.
 *
 * CONSISTENCY
 *
 * KV is eventually consistent - a write can take up to a minute to reach every
 * location. A visitor whose requests land in two regions inside that window
 * could get a couple of extra searches. That is the right trade for a
 * daily anonymous allowance: the alternative is a Durable Object per
 * visitor, which is real money and real latency to stop someone getting one
 * extra free search. Signed-in visitors skip the meter entirely.
 */

export const ANON_DAILY_LIMIT = 25;
export const METER_COOKIE = "mi_sid";

const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const PREFIX_WINDOW_MS = 60 * 1000;
/** Bound the stored history so one visitor cannot grow a value without limit. */
const MAX_REMEMBERED = 40;
/** KV's floor; anything smaller is rejected. */
const MIN_TTL_SECONDS = 60;

export interface KVNamespace {
  get(key: string, type: "text"): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}

interface CountedQuery {
  q: string;
  at: number;
}

interface MeterRecord {
  c: number;
  q: CountedQuery[];
}

export interface MeterDecision {
  limited: boolean;
  counted: boolean;
  used: number;
  remaining: number;
  limit: number;
}

export function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Short, stable, and reveals neither the cookie nor the address. */
export async function identityHash(sid: string, ip: string): Promise<string> {
  const data = new TextEncoder().encode(`${sid}|${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function secondsLeftToday(now: number): number {
  const end = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate() + 1,
  );
  return Math.max(MIN_TTL_SECONDS, Math.ceil((end - now) / 1000) + 3600);
}

export async function checkMeterKV(
  kv: KVNamespace,
  identity: string,
  rawQuery: string,
  now = Date.now(),
): Promise<MeterDecision> {
  const key = `m:${identity}:${dayKey(now)}`;

  let record: MeterRecord = { c: 0, q: [] };
  try {
    const stored = await kv.get(key, "text");
    if (stored) record = JSON.parse(stored) as MeterRecord;
  } catch {
    /* A meter that cannot be read must not take search down with it: fail
       open. Losing a count is cheaper than a broken search box. */
  }

  const query = normalizeQuery(rawQuery);

  const free =
    query === "" ||
    record.q.some((previous) => {
      const age = now - previous.at;
      if (age > DEDUPE_WINDOW_MS) return false;
      if (previous.q === query) return true;
      if (age > PREFIX_WINDOW_MS) return false;
      return previous.q.startsWith(query) || query.startsWith(previous.q);
    });

  if (free) {
    return {
      limited: false,
      counted: false,
      used: record.c,
      remaining: Math.max(0, ANON_DAILY_LIMIT - record.c),
      limit: ANON_DAILY_LIMIT,
    };
  }

  if (record.c >= ANON_DAILY_LIMIT) {
    return {
      limited: true,
      counted: false,
      used: record.c,
      remaining: 0,
      limit: ANON_DAILY_LIMIT,
    };
  }

  record.c += 1;
  record.q = [...record.q, { q: query, at: now }]
    .filter((previous) => now - previous.at <= DEDUPE_WINDOW_MS)
    .slice(-MAX_REMEMBERED);

  try {
    await kv.put(key, JSON.stringify(record), {
      expirationTtl: secondsLeftToday(now),
    });
  } catch {
    /* Same reasoning: a failed write costs one uncounted search. */
  }

  return {
    limited: false,
    counted: true,
    used: record.c,
    remaining: ANON_DAILY_LIMIT - record.c,
    limit: ANON_DAILY_LIMIT,
  };
}
