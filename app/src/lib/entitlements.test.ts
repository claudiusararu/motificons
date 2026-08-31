import { beforeEach, describe, expect, it, vi } from "vitest";

/* `auth()` builds a real Better Auth instance over D1 - mocked so the
   session-resolution branch is testable without a Worker runtime or a
   database. The `locals` branch never reaches it, which is itself one of the
   assertions below. */
const getSessionMock = vi.fn();
vi.mock("./auth/auth", () => ({
  auth: vi.fn(async () => ({ api: { getSession: getSessionMock } })),
}));

const { resolveAccount } = await import("./entitlements");

const request = new Request("https://motificons.app/api/entitlements");

beforeEach(() => {
  getSessionMock.mockReset();
});

describe("resolveAccount - middleware locals", () => {
  it("trusts a populated locals.user without a session lookup", async () => {
    await expect(
      resolveAccount({ request, locals: { user: { email: "visitor@example.com" } } }),
    ).resolves.toEqual({ signedIn: true, email: "visitor@example.com" });
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  /* `locals.user === null` is middleware's answer, not a missing one - it
     must not trigger a second lookup for every anonymous request. */
  it("treats locals.user === null as a settled signed-out answer", async () => {
    await expect(resolveAccount({ request, locals: { user: null } })).resolves.toEqual({
      signedIn: false,
    });
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("reports a signed-in visitor with no email as signed in, without an email", async () => {
    await expect(
      resolveAccount({ request, locals: { user: { email: null } } }),
    ).resolves.toEqual({ signedIn: true });
  });
});

describe("resolveAccount - session fallback", () => {
  it("reads the Better Auth session when there are no locals", async () => {
    getSessionMock.mockResolvedValue({ user: { email: "visitor@example.com" } });
    await expect(resolveAccount({ request })).resolves.toEqual({
      signedIn: true,
      email: "visitor@example.com",
    });
    expect(getSessionMock).toHaveBeenCalledOnce();
  });

  it("resolves signed out when there is no session", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(resolveAccount({ request })).resolves.toEqual({ signedIn: false });
  });

  /* Nothing is gated behind this answer any more, so a broken lookup must
     degrade to "signed out", never to a thrown 500. */
  it("resolves signed out when the session lookup throws", async () => {
    getSessionMock.mockRejectedValue(new Error("D1 is down"));
    await expect(resolveAccount({ request })).resolves.toEqual({ signedIn: false });
  });
});
