import { describe, expect, it, vi } from "vitest";
import {
  guardMagicLinkRequest,
  parseMagicLinkMode,
  refusalResponse,
  NO_ACCOUNT_MESSAGE,
} from "./magic-link-guard";
import { IP_LIMIT, type KVNamespace } from "./magic-link-rate-limit";
import { TURNSTILE_FAILED_MESSAGE } from "./turnstile";

/** Same in-memory KV stand-in the rate-limit tests use. */
function fakeKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

/** A siteverify stand-in that answers `success` and counts its calls. */
function siteverify(success: boolean) {
  const calls: string[] = [];
  const impl = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return {
      ok: true,
      async json() {
        return { success };
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const KNOWN = "known@example.com";

function lookup(known: string[] = [KNOWN]) {
  const seen: string[] = [];
  const fn = async (email: string) => {
    seen.push(email);
    return known.some((k) => k.toLowerCase() === email.trim().toLowerCase());
  };
  return { fn, seen };
}

describe("parseMagicLinkMode", () => {
  it('reads "signin" only from the exact value', () => {
    expect(parseMagicLinkMode("signin")).toBe("signin");
  });

  it("defaults anything else - including absent - to the register door", () => {
    expect(parseMagicLinkMode("register")).toBe("register");
    expect(parseMagicLinkMode(null)).toBe("register");
    expect(parseMagicLinkMode(undefined)).toBe("register");
    expect(parseMagicLinkMode("SIGNIN")).toBe("register");
  });
});

describe("guardMagicLinkRequest - account lookup", () => {
  it("lets a known email through on the sign-in door", async () => {
    const { fn } = lookup();
    const refusal = await guardMagicLinkRequest({
      mode: "signin",
      email: KNOWN,
      ip: "1.2.3.4",
      userExists: fn,
    });

    expect(refusal).toBeNull();
  });

  it("refuses an unknown email on the sign-in door with NO_ACCOUNT", async () => {
    const { fn } = lookup();
    const refusal = await guardMagicLinkRequest({
      mode: "signin",
      email: "stranger@example.com",
      ip: "1.2.3.4",
      userExists: fn,
    });

    expect(refusal).not.toBeNull();
    expect(refusal!.status).toBe(404);
    expect(refusal!.body.code).toBe("NO_ACCOUNT");
    expect(refusal!.body.message).toBe(NO_ACCOUNT_MESSAGE);
  });

  it("matches the account case-insensitively", async () => {
    const { fn } = lookup(["Sam@Example.com"]);
    const refusal = await guardMagicLinkRequest({
      mode: "signin",
      email: "  sam@example.com ",
      ip: "1.2.3.4",
      userExists: fn,
    });

    expect(refusal).toBeNull();
  });

  it("never looks the email up on the register door - it always sends", async () => {
    const { fn, seen } = lookup();
    const refusal = await guardMagicLinkRequest({
      mode: "register",
      email: "stranger@example.com",
      ip: "1.2.3.4",
      userExists: fn,
    });

    expect(refusal).toBeNull();
    expect(seen).toHaveLength(0);
  });

  it("sends anyway when no lookup is available (no database reachable)", async () => {
    const refusal = await guardMagicLinkRequest({
      mode: "signin",
      email: "stranger@example.com",
      ip: "1.2.3.4",
    });

    expect(refusal).toBeNull();
  });
});

describe("guardMagicLinkRequest - Turnstile", () => {
  it("skips the check entirely when no secret is configured", async () => {
    const { impl, calls } = siteverify(false);
    const refusal = await guardMagicLinkRequest({
      mode: "signin",
      email: KNOWN,
      ip: "1.2.3.4",
      turnstileToken: null,
      userExists: lookup().fn,
      fetchImpl: impl,
    });

    expect(refusal).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("passes a valid token through to the rest of the checks", async () => {
    const { impl, calls } = siteverify(true);
    const refusal = await guardMagicLinkRequest({
      mode: "signin",
      email: KNOWN,
      ip: "1.2.3.4",
      turnstileToken: "tok",
      turnstileSecret: "s3cret",
      userExists: lookup().fn,
      fetchImpl: impl,
    });

    expect(refusal).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("refuses an invalid token with the plain human-check message", async () => {
    const { impl } = siteverify(false);
    const refusal = await guardMagicLinkRequest({
      mode: "register",
      email: KNOWN,
      ip: "1.2.3.4",
      turnstileToken: "tok",
      turnstileSecret: "s3cret",
      fetchImpl: impl,
    });

    expect(refusal!.status).toBe(403);
    expect(refusal!.body.code).toBe("TURNSTILE_FAILED");
    expect(refusal!.body.message).toBe(TURNSTILE_FAILED_MESSAGE);
  });

  it("refuses a missing token once the secret is set", async () => {
    const { impl, calls } = siteverify(true);
    const refusal = await guardMagicLinkRequest({
      mode: "register",
      email: KNOWN,
      ip: "1.2.3.4",
      turnstileToken: null,
      turnstileSecret: "s3cret",
      fetchImpl: impl,
    });

    expect(refusal!.body.code).toBe("TURNSTILE_FAILED");
    expect(calls).toHaveLength(0);
  });
});

describe("guardMagicLinkRequest - rate limit", () => {
  it("keeps the existing per-IP bound", async () => {
    const kv = fakeKV();
    for (let i = 0; i < IP_LIMIT; i++) {
      const refusal = await guardMagicLinkRequest({
        mode: "register",
        email: `visitor-${i}@example.com`,
        ip: "9.9.9.9",
        kv,
      });
      expect(refusal).toBeNull();
    }

    const refusal = await guardMagicLinkRequest({
      mode: "register",
      email: "visitor-last@example.com",
      ip: "9.9.9.9",
      kv,
    });

    expect(refusal!.status).toBe(429);
    expect(refusal!.body.code).toBe("RATE_LIMITED");
  });
});

describe("guardMagicLinkRequest - order of checks", () => {
  it("runs Turnstile before the rate limit: a refused bot spends no budget", async () => {
    const kv = fakeKV();
    const { impl } = siteverify(false);

    for (let i = 0; i < IP_LIMIT + 3; i++) {
      const refusal = await guardMagicLinkRequest({
        mode: "register",
        email: "bot@example.com",
        ip: "8.8.8.8",
        turnstileToken: "tok",
        turnstileSecret: "s3cret",
        kv,
        fetchImpl: impl,
      });
      expect(refusal!.body.code).toBe("TURNSTILE_FAILED");
    }

    /* The real visitor behind the same IP still has their full budget. */
    const ok = siteverify(true);
    const refusal = await guardMagicLinkRequest({
      mode: "register",
      email: "person@example.com",
      ip: "8.8.8.8",
      turnstileToken: "tok",
      turnstileSecret: "s3cret",
      kv,
      fetchImpl: ok.impl,
    });

    expect(refusal).toBeNull();
  });

  it("runs the rate limit before the account lookup", async () => {
    const kv = fakeKV();
    const { fn, seen } = lookup();

    for (let i = 0; i < IP_LIMIT; i++) {
      await guardMagicLinkRequest({
        mode: "signin",
        email: KNOWN,
        ip: "7.7.7.7",
        kv,
        userExists: fn,
      });
    }
    const before = seen.length;

    const refusal = await guardMagicLinkRequest({
      mode: "signin",
      email: "stranger@example.com",
      ip: "7.7.7.7",
      kv,
      userExists: fn,
    });

    expect(refusal!.body.code).toBe("RATE_LIMITED");
    expect(seen.length).toBe(before);
  });

  it("verifies Turnstile before it ever asks whether the account exists", async () => {
    const { impl } = siteverify(false);
    const { fn, seen } = lookup();

    const refusal = await guardMagicLinkRequest({
      mode: "signin",
      email: "stranger@example.com",
      ip: "1.2.3.4",
      turnstileToken: "tok",
      turnstileSecret: "s3cret",
      userExists: fn,
      fetchImpl: impl,
    });

    expect(refusal!.body.code).toBe("TURNSTILE_FAILED");
    expect(seen).toHaveLength(0);
  });
});

describe("refusalResponse", () => {
  it("renders the Better Auth error shape, uncached", async () => {
    const response = refusalResponse({
      status: 404,
      body: { message: NO_ACCOUNT_MESSAGE, code: "NO_ACCOUNT" },
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      message: NO_ACCOUNT_MESSAGE,
      code: "NO_ACCOUNT",
    });
  });
});

describe("guardMagicLinkRequest - nothing is sent on a refusal", () => {
  it("returns before any send path for every refusal code", async () => {
    const send = vi.fn();
    const outcomes = [
      await guardMagicLinkRequest({
        mode: "register",
        email: KNOWN,
        ip: "1.1.1.1",
        turnstileToken: null,
        turnstileSecret: "s3cret",
      }),
      await guardMagicLinkRequest({
        mode: "signin",
        email: "nobody@example.com",
        ip: "1.1.1.1",
        userExists: lookup().fn,
      }),
    ];

    for (const refusal of outcomes) {
      if (refusal) continue;
      send();
    }
    expect(send).not.toHaveBeenCalled();
  });
});
