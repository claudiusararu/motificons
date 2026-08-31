import { beforeEach, describe, expect, it, vi } from "vitest";

/* The reused app module touches real I/O (D1) - mocked so the
   header-parsing/prefix-check branches are testable without a Worker
   runtime, and so the DB-dependent branches are testable without a real D1. */
const selectMock = vi.fn();
vi.mock("../../app/src/db/client", () => ({
  db: vi.fn(async () => ({ select: selectMock })),
}));

const { authenticate, AUTH_REQUIRED_MESSAGE } = await import("./auth");

/** Chains `.select().from().where().limit()` down to a fixed row set,
    mirroring the shape auth.ts's verifier() calls. */
function mockRows(rows: unknown[]): void {
  selectMock.mockReturnValue({
    from: () => ({
      where: () => ({
        limit: async () => rows,
      }),
    }),
  });
}

const TOKEN = "mk_" + "a".repeat(64);

beforeEach(() => {
  selectMock.mockReset();
});

describe("authenticate - header parsing (no DB call)", () => {
  it("rejects a missing Authorization header", async () => {
    const result = await authenticate(null);
    expect(result).toEqual({ ok: false, message: AUTH_REQUIRED_MESSAGE });
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("rejects a non-Bearer scheme", async () => {
    const result = await authenticate("Basic dXNlcjpwYXNz");
    expect(result.ok).toBe(false);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("rejects Bearer with no token", async () => {
    const result = await authenticate("Bearer");
    expect(result.ok).toBe(false);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("rejects a token that is not mk_-prefixed, without a DB round trip", async () => {
    const result = await authenticate("Bearer sk_not_a_motificons_key");
    expect(result).toEqual({ ok: false, message: AUTH_REQUIRED_MESSAGE });
    expect(selectMock).not.toHaveBeenCalled();
  });
});

describe("authenticate - key lookup", () => {
  it("rejects an mk_ token with no matching row", async () => {
    mockRows([]);
    const result = await authenticate(`Bearer ${TOKEN}`);
    expect(result).toEqual({ ok: false, message: AUTH_REQUIRED_MESSAGE });
  });

  it("rejects a revoked key", async () => {
    mockRows([
      { id: "key1", userId: "user1", workspaceId: "ws1", revokedAt: new Date() },
    ]);
    const result = await authenticate(`Bearer ${TOKEN}`);
    expect(result).toEqual({ ok: false, message: AUTH_REQUIRED_MESSAGE });
  });

  /* The product is free: a live key is the entire gate, with no entitlement
     lookup behind it. This is the test that would have failed before the
     paid tier was removed. */
  it("accepts a valid, non-revoked key, carrying userId/workspaceId/keyId", async () => {
    mockRows([
      { id: "key1", userId: "user1", workspaceId: "ws1", revokedAt: null },
    ]);
    const result = await authenticate(`Bearer ${TOKEN}`);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.auth.clientId).toBe("user1");
    expect(result.auth.scopes).toEqual(["mcp"]);
    expect(result.auth.extra).toEqual({
      userId: "user1",
      workspaceId: "ws1",
      keyId: "key1",
    });
  });

  it("names the free account in the one failure message", () => {
    expect(AUTH_REQUIRED_MESSAGE).toContain("free account");
    expect(AUTH_REQUIRED_MESSAGE).not.toContain("Pro");
    expect(AUTH_REQUIRED_MESSAGE).not.toContain("$");
  });
});
