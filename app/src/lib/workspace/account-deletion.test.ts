import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../db/client";
import {
  account,
  collection,
  collectionItem,
  invite,
  mcpKey,
  membership,
  session,
  workspace,
} from "../../db/schema";

vi.mock("../auth/workspace", () => ({
  getPersonalWorkspace: vi.fn(),
}));

import { getPersonalWorkspace } from "../auth/workspace";
import { deleteUserAccount } from "./account-deletion";

/**
 * A minimal drizzle-shaped mock, not a real D1 - `deleteUserAccount` has no
 * pure logic to extract (every branch is a DB call), so this stands in for
 * the query builder, table-aware: `deleteResults` queues one result batch per call to
 * `.delete(<that table>)`, consumed in call order, so a table deleted more
 * than once in one run (`collectionItem`, once per owned collection) can
 * return a different batch each time. `order` records every table passed to
 * `.delete()`, in call order, so tests can assert FK-safe sequencing without
 * a real foreign-key-enforcing database - the real ordering guarantee is
 * exercised end to end against a real local D1 separately.
 */
function fakeDatabase(options: {
  selectResults?: unknown[];
  deleteResults: Map<unknown, unknown[][]>;
  order: unknown[];
}) {
  const { selectResults = [], deleteResults, order } = options;
  return {
    select: () => ({
      from: () => ({
        where: async () => selectResults,
      }),
    }),
    delete: (table: unknown) => {
      order.push(table);
      return {
        where: () => ({
          returning: async () => {
            const queue = deleteResults.get(table);
            return queue && queue.length > 0 ? queue.shift()! : [];
          },
        }),
      };
    },
  };
}

describe("deleteUserAccount", () => {
  it("deletes a personal workspace's collections and items in FK-safe order and reports accurate counts", async () => {
    vi.mocked(getPersonalWorkspace).mockResolvedValue({ id: "ws1", name: "Owner's workspace" });

    const order: unknown[] = [];
    const deleteResults = new Map<unknown, unknown[][]>([
      [collectionItem, [[{ id: "i1" }, { id: "i2" }], [{ id: "i3" }]]],
      [collection, [[{ id: "c1" }, { id: "c2" }]]],
      [mcpKey, [[{ id: "k1" }]]],
      [invite, [[]]],
      [membership, [[{ id: "m1" }]]],
      [workspace, [[{ id: "ws1" }]]],
      [session, [[{ id: "s1" }, { id: "s2" }]]],
      [account, [[{ id: "a1" }]]],
    ]);

    const database = fakeDatabase({
      selectResults: [{ id: "c1" }, { id: "c2" }],
      deleteResults,
      order,
    }) as unknown as Database;

    const summary = await deleteUserAccount(database, "user-1");

    expect(summary).toEqual({
      collectionItems: 3,
      collections: 2,
      mcpKeys: 1,
      invites: 0,
      memberships: 1,
      personalWorkspaceDeleted: true,
      sessions: 2,
      accounts: 1,
    });

    const indexOf = (table: unknown) => order.indexOf(table);
    expect(indexOf(collectionItem)).toBeLessThan(indexOf(collection));
    expect(indexOf(collection)).toBeLessThan(indexOf(workspace));
    expect(indexOf(membership)).toBeLessThan(indexOf(workspace));
    expect(indexOf(workspace)).toBeLessThan(indexOf(session));
    expect(indexOf(session)).toBeLessThan(indexOf(account));

    /* The personal workspace row is deleted exactly once - deleteUserAccount
       never turns a team membership into a workspace deletion. */
    expect(order.filter((table) => table === workspace)).toHaveLength(1);
  });

  it("skips collection/workspace deletion when there is no personal workspace, but still deletes the account rows", async () => {
    vi.mocked(getPersonalWorkspace).mockResolvedValue(null);

    const order: unknown[] = [];
    const deleteResults = new Map<unknown, unknown[][]>([
      [mcpKey, [[]]],
      [invite, [[]]],
      [membership, [[]]],
      [session, [[{ id: "s1" }]]],
      [account, [[{ id: "a1" }]]],
    ]);

    const database = fakeDatabase({ deleteResults, order }) as unknown as Database;

    const summary = await deleteUserAccount(database, "user-2");

    expect(summary.collections).toBe(0);
    expect(summary.collectionItems).toBe(0);
    expect(summary.personalWorkspaceDeleted).toBe(false);
    expect(summary.sessions).toBe(1);
    expect(summary.accounts).toBe(1);

    expect(order).not.toContain(collection);
    expect(order).not.toContain(collectionItem);
    expect(order).not.toContain(workspace);
  });

  it("reports personalWorkspaceDeleted: false if the workspace row was already gone (defensive - no known caller triggers this)", async () => {
    vi.mocked(getPersonalWorkspace).mockResolvedValue({ id: "ws1", name: "Owner's workspace" });

    const order: unknown[] = [];
    const deleteResults = new Map<unknown, unknown[][]>([
      [collectionItem, [[]]],
      [collection, [[]]],
      [mcpKey, [[]]],
      [invite, [[]]],
      [membership, [[]]],
      [workspace, [[]]],
      [session, [[]]],
      [account, [[]]],
    ]);

    const database = fakeDatabase({ selectResults: [], deleteResults, order }) as unknown as Database;

    const summary = await deleteUserAccount(database, "user-3");
    expect(summary.personalWorkspaceDeleted).toBe(false);
  });
});
