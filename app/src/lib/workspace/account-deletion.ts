import { eq } from "drizzle-orm";
import type { Database } from "../../db/client";
import {
  account,
  collection,
  collectionItem,
  invite,
  mcpKey,
  membership,
  session,
  user,
  workspace,
} from "../../db/schema";
import { getPersonalWorkspace } from "../auth/workspace";

/**
 * Self-service account deletion (GDPR right to erasure): a person can
 * delete their account and all its data themselves, from the dashboard, at
 * any time. Deletes the user row and everything owned by them, in FK-safe
 * order.
 *
 * Explicit deletes rather than relying on the schema's declared `onDelete:
 * "cascade"`: D1's runtime enforcement of the `foreign_keys` pragma is not
 * confirmed anywhere in this codebase (the one place it is toggled,
 * migrations/0001_lean_dark_beast.sql, is drizzle-kit's own table-recreate
 * dance, not evidence D1 enforces it on every connection) - explicit deletes
 * are correct whether or not D1 happens to cascade, and let this function
 * return an honest count of what it actually removed.
 *
 * SCOPE: only the user's PERSONAL workspace is deleted outright. A team
 * workspace they merely belong to (`membership.role === "member"`) is left
 * fully intact for its other members - only this user's own membership row
 * in it is removed. Nothing in the product exercises team workspaces yet (no
 * UI, `invite` unused), so this is forward-looking, not reverse-engineered
 * from a real flow - but a personal-workspace-only delete would silently
 * strand a future team member's data if this function ever deleted every
 * workspace a user has a membership row in.
 *
 * Order (each step's own comment explains why it has to come before the
 * next):
 *   1. collectionItem  - references collection
 *   2. collection      - references workspace (the personal one only)
 *   3. mcpKey          - references user + workspace
 *   4. invite          - `invitedByUserId` references user, no cascade
 *                        declared in the schema at all (see db/schema.ts)
 *   5. membership      - references user + workspace (every membership this
 *                        user has, not just the personal one)
 *   6. workspace       - the personal workspace row itself, now that nothing
 *                        references it any more
 *   7. session         - references user (Better Auth)
 *   8. account         - references user (Better Auth OAuth/magic-link rows)
 *   9. user            - the row itself, now that nothing references it
 */
export interface AccountDeletionSummary {
  collectionItems: number;
  collections: number;
  mcpKeys: number;
  invites: number;
  memberships: number;
  personalWorkspaceDeleted: boolean;
  sessions: number;
  accounts: number;
}

export async function deleteUserAccount(
  database: Database,
  userId: string,
): Promise<AccountDeletionSummary> {
  const personalWorkspace = await getPersonalWorkspace(database, userId);

  let collectionItemsDeleted = 0;
  let collectionsDeleted = 0;
  let personalWorkspaceDeleted = false;

  if (personalWorkspace) {
    const ownedCollections = await database
      .select({ id: collection.id })
      .from(collection)
      .where(eq(collection.workspaceId, personalWorkspace.id));

    for (const { id } of ownedCollections) {
      const deletedItems = await database
        .delete(collectionItem)
        .where(eq(collectionItem.collectionId, id))
        .returning({ id: collectionItem.id });
      collectionItemsDeleted += deletedItems.length;
    }

    const deletedCollections = await database
      .delete(collection)
      .where(eq(collection.workspaceId, personalWorkspace.id))
      .returning({ id: collection.id });
    collectionsDeleted = deletedCollections.length;
  }

  const deletedKeys = await database
    .delete(mcpKey)
    .where(eq(mcpKey.userId, userId))
    .returning({ id: mcpKey.id });

  const deletedInvites = await database
    .delete(invite)
    .where(eq(invite.invitedByUserId, userId))
    .returning({ id: invite.id });

  const deletedMemberships = await database
    .delete(membership)
    .where(eq(membership.userId, userId))
    .returning({ id: membership.id });

  if (personalWorkspace) {
    const deletedWorkspace = await database
      .delete(workspace)
      .where(eq(workspace.id, personalWorkspace.id))
      .returning({ id: workspace.id });
    personalWorkspaceDeleted = deletedWorkspace.length > 0;
  }

  const deletedSessions = await database
    .delete(session)
    .where(eq(session.userId, userId))
    .returning({ id: session.id });

  const deletedAccounts = await database
    .delete(account)
    .where(eq(account.userId, userId))
    .returning({ id: account.id });

  await database.delete(user).where(eq(user.id, userId));

  return {
    collectionItems: collectionItemsDeleted,
    collections: collectionsDeleted,
    mcpKeys: deletedKeys.length,
    invites: deletedInvites.length,
    memberships: deletedMemberships.length,
    personalWorkspaceDeleted,
    sessions: deletedSessions.length,
    accounts: deletedAccounts.length,
  };
}
