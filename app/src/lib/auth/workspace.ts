import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/client";
import { workspace, membership } from "../../db/schema";

/**
 * The architecture rule: every user gets an auto-created
 * personal workspace at signup, with an owner membership - never a project
 * hanging directly off a user row. Called once, from the
 * `databaseHooks.user.create.after` hook in auth.ts, so it runs exactly on
 * first sign-in and never again for a returning user.
 */
export async function createPersonalWorkspace(
  database: Database,
  userId: string,
  displayName: string,
): Promise<void> {
  const now = new Date();
  const workspaceId = crypto.randomUUID();

  await database.insert(workspace).values({
    id: workspaceId,
    personal: true,
    name: `${displayName}'s workspace`,
    createdAt: now,
  });

  await database.insert(membership).values({
    id: crypto.randomUUID(),
    userId,
    workspaceId,
    role: "owner",
    createdAt: now,
  });
}

/**
 * The signed-in user's personal workspace - real D1 row, used by /dashboard
 * to show a real workspace name (never a placeholder). Every user has
 * exactly one (created alongside them, see above), so this is a lookup, not
 * a query over many; `null` only if that invariant was somehow broken.
 */
export async function getPersonalWorkspace(
  database: Database,
  userId: string,
): Promise<{ id: string; name: string } | null> {
  const rows = await database
    .select({ id: workspace.id, name: workspace.name })
    .from(membership)
    .innerJoin(workspace, eq(workspace.id, membership.workspaceId))
    .where(and(eq(membership.userId, userId), eq(workspace.personal, true)))
    .limit(1);

  return rows[0] ?? null;
}
