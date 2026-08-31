/**
 * Name validation + collection capacity. Every route that reaches these
 * functions has already required a session (see
 * lib/workspace/session-workspace.ts and every api/collections/* route);
 * accounts are free, so a session is the only thing standing in front of
 * them. COLLECTION_LIMIT is an anti-spam guard, not a monetized cap - there
 * is nothing to sell and nothing to unlock, so hitting it is a plain "you
 * are full, make room" and never an offer (collectionCapUpsell's own
 * message).
 *
 * Pure functions, deliberately DB-free, so the limit and validation rules
 * can be unit-tested directly - the API routes are the only place either
 * function is combined with a real count/session.
 */

/** A named constant, not a bare literal at the call site. */
export const MAX_NAME_LENGTH = 80;

/** Collection slots per workspace: 5, an anti-spam guard rather than a real
    ceiling - see the header comment. */
export const COLLECTION_LIMIT = 5;

export type ResourceNoun = "collection";

export type NameValidation =
  | { ok: true; name: string }
  | { ok: false; error: string };

/**
 * Trims, then checks non-empty and the length cap. The trimmed name is
 * returned so callers never have to re-trim before writing it - one place
 * decides what "the name" is.
 */
export function validateResourceName(
  raw: unknown,
  noun: ResourceNoun,
): NameValidation {
  if (typeof raw !== "string") {
    return { ok: false, error: `Give your ${noun} a name.` };
  }

  const name = raw.trim();
  if (!name) {
    return { ok: false, error: `Give your ${noun} a name.` };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      error: `Keep the name under ${MAX_NAME_LENGTH} characters.`,
    };
  }

  return { ok: true, name };
}

/**
 * Whether one more collection may be created (or duplicated - a duplicate
 * counts against the cap like a create) in a workspace already
 * holding `existingCount` of them: strictly under `limit`, so a workspace
 * already at the cap is blocked, never allowed to sneak one more in on a
 * race. Every caller has already required a session before counting.
 */
export function canCreateResource(existingCount: number, limit: number): boolean {
  return existingCount < limit;
}

/**
 * The over-cap response body, shared by every route that can hit the
 * collection cap (create in api/collections/index.ts, duplicate in
 * api/collections/[id]/duplicate.ts) - one place for the honest copy so the
 * two routes can never say it differently. No `href`: there is nothing to
 * buy and nothing to write in for, so a button here would be a dead click.
 * The name is historical - it is a capacity notice, not an offer. Split
 * across headline/body, which concatenate back to the exact copy: "You have
 * reached the limit of 5 collections. Delete or reuse one to make room."
 */
export function collectionCapUpsell(): {
  limited: true;
  upsell: { headline: string; body: string };
} {
  return {
    limited: true,
    upsell: {
      headline: `You have reached the limit of ${COLLECTION_LIMIT} collections.`,
      body: "Delete or reuse one to make room.",
    },
  };
}
