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
