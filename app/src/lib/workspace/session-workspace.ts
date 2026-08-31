import { db, type Database } from "../../db/client";
import { getPersonalWorkspace } from "../auth/workspace";

export interface SessionWorkspace {
  database: Database;
  userId: string;
  workspaceId: string;
}

/**
 * The one auth check every collections API route needs: a real
 * session (`locals.user`, populated by src/middleware.ts) resolved down to
 * that user's personal workspace. `null` covers both "not signed in" and
 * "session exists but the personal workspace is somehow missing" - both are
 * the same 401 to the caller, since neither is a state a route can act on.
 */
export async function requireSessionWorkspace(
  user: App.Locals["user"],
): Promise<SessionWorkspace | null> {
  if (!user) return null;

  const database = await db();
  const workspace = await getPersonalWorkspace(database, user.id);
  if (!workspace) return null;

  return { database, userId: user.id, workspaceId: workspace.id };
}
