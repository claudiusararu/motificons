/**
 * Client-side, localStorage-backed cache of the last known
 * /api/entitlements answer. DISPLAY ONLY: it exists so a returning
 * visitor's UI can guess correctly for one frame instead of always starting
 * from "signed out" while the real fetch is in flight. It grants nothing by
 * itself - every account-owned resource is still resolved server-side, and
 * every reader of this cache still reconciles against a real fetch
 * response.
 *
 * Shared by the base layout's inline anti-flash script (Layout.astro),
 * useAccount.ts, and AuthMenu.tsx - all three read/write the exact same
 * key, so they can never disagree about what "the cache" says.
 */

const KEY = "mfc-ent";
const TTL_MS = 24 * 60 * 60 * 1000;

export interface CachedEntitlements {
  signedIn: boolean;
  email: string | null;
  /** `Date.now()` when this entry was written - entries older than
      `TTL_MS` are treated as absent. */
  t: number;
}

/** The cached entry, or `null` when absent, unparsable, missing an expected
    field, or past its 24h TTL. Never throws - storage can be disabled
    (private browsing, quota) or simply empty. */
export function readCached(): CachedEntitlements | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedEntitlements>;
    if (
      typeof parsed.signedIn !== "boolean" ||
      typeof parsed.t !== "number" ||
      (parsed.email !== null && typeof parsed.email !== "string")
    ) {
      return null;
    }
    if (Date.now() - parsed.t > TTL_MS) return null;
    return { signedIn: parsed.signedIn, email: parsed.email ?? null, t: parsed.t };
  } catch {
    return null;
  }
}

/** Stamps `entry` with the current time and writes it - call this with a
    fresh /api/entitlements response, never with a guess. Best-effort: a
    storage failure just means the next page load starts from the safe
    default again, same as before this cache existed.

    Also the one shared spot every page that calls this passes through right
    after a fresh /api/entitlements answer, so it doubles as the PostHog
    identity boundary: identifies by email when signed in, so a person
    merges across an anonymous browsing session and their eventual
    account - and resets (starts a fresh anonymous identity) when the
    response says signed out AND a previous identify happened this session.
    "This session" is read off `previous` (the entry this call is about to
    overwrite) rather than a separate flag, so a plain anonymous visitor who
    was never signed in never triggers a pointless reset(). Every posthog
    call is optional-chained - the loader is production-only (Layout.astro)
    and can be blocked by the visitor, so `window.posthog` is routinely
    absent. */
export function writeCached(entry: Omit<CachedEntitlements, "t">): void {
  const previous = readCached();

  try {
    localStorage.setItem(KEY, JSON.stringify({ ...entry, t: Date.now() } satisfies CachedEntitlements));
  } catch {
    /* Storage disabled/unavailable/full - best-effort, see above. */
  }

  if (entry.signedIn && entry.email) {
    window.posthog?.identify(entry.email);
  } else if (previous?.signedIn) {
    window.posthog?.reset();
  }
}

/** Drops the cached entry - call this at the moment of sign-out so a stale
    "signed in" guess never survives past the session it described. */
export function clearCached(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* Storage disabled/unavailable - nothing to clear either way. */
  }
}
