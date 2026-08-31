/**
 * "Does an account already exist for this email?" - the one question the
 * sign-in door asks before it sends anything.
 *
 * Split from the route so the SQL lives next to the schema knowledge and the
 * guard (magic-link-guard.ts) can take a plain function instead of a
 * database.
 */

import { sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { user } from "../../db/schema";

/**
 * The comparison form.
 *
 * Better Auth writes the email as the caller supplied it (its magic-link
 * plugin does not lowercase), so a person who registered as `Sam@x.com` and
 * later types `sam@x.com` is the same account. Trim + lowercase here, and
 * `lower()` on the column in the query below, so the match is
 * case-insensitive from both sides regardless of what got stored.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** A user-exists check, injectable - the guard never sees a database. */
export type UserExistsLookup = (email: string) => Promise<boolean>;

/** One indexed-ish lookup on `user.email`; returns false for empty input. */
export async function userExistsByEmail(
  database: Database,
  email: string,
): Promise<boolean> {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;

  const rows = await database
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = ${normalized}`)
    .limit(1);

  return rows.length > 0;
}

/** Returns the email exactly as stored, or null when no account matches -
    injectable, same reasoning as `UserExistsLookup`. */
export type StoredEmailLookup = (email: string) => Promise<string | null>;

/**
 * Same case-insensitive match as `userExistsByEmail`, but hands back the
 * stored spelling instead of a boolean.
 *
 * Why the spelling matters: Better Auth's own `findUserByEmail` is fed
 * whatever string a caller puts in a magic-link verification value, and this
 * app's magic-link plugin creates a user when that lookup misses. Any server
 * flow that mints a session for an account it has already confirmed exists
 * must therefore hand Better Auth the exact stored address - a case-folded
 * copy risks silently creating a second account instead of signing into the
 * first. See demo-access.ts, the one such flow.
 */
export async function findStoredEmail(
  database: Database,
  email: string,
): Promise<string | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const rows = await database
    .select({ email: user.email })
    .from(user)
    .where(sql`lower(${user.email}) = ${normalized}`)
    .limit(1);

  return rows[0]?.email ?? null;
}
