import { describe, expect, it } from "vitest";
import {
  DEMO_EMAIL,
  DEMO_RATE_LIMIT_PREFIX,
  handleDemoAccess,
  secretsMatch,
  type DemoAccessInput,
} from "./demo-access";
import { IP_LIMIT, type KVNamespace } from "./magic-link-rate-limit";

/** Same in-memory KV stand-in the rate-limit and guard tests use, plus the
    key names so the prefix can be asserted. */
function fakeKV(): KVNamespace & { keys: () => string[] } {
  const store = new Map<string, string>();
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    keys: () => [...store.keys()],
  };
}

const SECRET = "judge-key-2f8a1c";
const IP = "203.0.113.7";

/** Stands in for the D1 lookup: returns the stored spelling, records asks. */
function storedEmail(stored: string | null = DEMO_EMAIL) {
  const asked: string[] = [];
  const fn = async (email: string) => {
    asked.push(email);
    return stored;
  };
  return { fn, asked };
}

/** Stands in for Better Auth's magic-link verify: records the email it was
    given and answers with the 302 the real one produces. */
function signIn() {
  const emails: string[] = [];
  const fn = async (email: string) => {
    emails.push(email);
    return new Response(null, {
      status: 302,
      headers: { Location: "/dashboard", "Set-Cookie": "session=real" },
    });
  };
  return { fn, emails };
}

function input(overrides: Partial<DemoAccessInput> = {}): DemoAccessInput {
  return {
    key: SECRET,
    secret: SECRET,
    ip: IP,
    storedEmail: storedEmail().fn,
    signIn: signIn().fn,
    ...overrides,
  };
}

describe("secretsMatch", () => {
  it("accepts an exact match", async () => {
    await expect(secretsMatch(SECRET, SECRET)).resolves.toBe(true);
  });

  it("rejects a near miss, a prefix and a case change", async () => {
    await expect(secretsMatch(`${SECRET}x`, SECRET)).resolves.toBe(false);
    await expect(secretsMatch(SECRET.slice(0, -1), SECRET)).resolves.toBe(false);
    await expect(secretsMatch(SECRET.toUpperCase(), SECRET)).resolves.toBe(
      false,
    );
  });

  it("rejects the empty string against a real secret", async () => {
    await expect(secretsMatch("", SECRET)).resolves.toBe(false);
  });
});

describe("handleDemoAccess", () => {
  it("signs the demo user in when the key matches", async () => {
    const minted = signIn();
    const lookup = storedEmail();

    const response = await handleDemoAccess(
      input({ storedEmail: lookup.fn, signIn: minted.fn }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/dashboard");
    expect(response.headers.get("Set-Cookie")).toBe("session=real");
    expect(lookup.asked).toEqual([DEMO_EMAIL]);
    expect(minted.emails).toEqual([DEMO_EMAIL]);
  });

  it("hands the sign-in the email exactly as stored, not as asked for", async () => {
    const minted = signIn();

    await handleDemoAccess(
      input({ storedEmail: storedEmail("Demo@Motificons.app").fn, signIn: minted.fn }),
    );

    expect(minted.emails).toEqual(["Demo@Motificons.app"]);
  });

  it("404s on a wrong key, without touching the account lookup", async () => {
    const minted = signIn();
    const lookup = storedEmail();

    const response = await handleDemoAccess(
      input({ key: "wrong", storedEmail: lookup.fn, signIn: minted.fn }),
    );

    expect(response.status).toBe(404);
    expect(lookup.asked).toEqual([]);
    expect(minted.emails).toEqual([]);
  });

  it("404s when no key is supplied at all", async () => {
    const response = await handleDemoAccess(input({ key: null }));
    expect(response.status).toBe(404);
  });

  it("404s when no secret is configured, whatever the key says", async () => {
    const minted = signIn();

    for (const secret of [undefined, ""]) {
      const response = await handleDemoAccess(
        input({ secret, key: SECRET, signIn: minted.fn }),
      );
      expect(response.status).toBe(404);
    }

    expect(minted.emails).toEqual([]);
  });

  it("writes no rate-limit key when the feature is off", async () => {
    const kv = fakeKV();

    await handleDemoAccess(input({ secret: undefined, kv }));

    expect(kv.keys()).toEqual([]);
  });

  it("404s when the demo account does not exist, and creates nothing", async () => {
    const minted = signIn();

    const response = await handleDemoAccess(
      input({ storedEmail: storedEmail(null).fn, signIn: minted.fn }),
    );

    expect(response.status).toBe(404);
    expect(minted.emails).toEqual([]);
  });

  it("404s when the database is unreachable (no lookup available)", async () => {
    const minted = signIn();

    const response = await handleDemoAccess(
      input({ storedEmail: undefined, signIn: minted.fn }),
    );

    expect(response.status).toBe(404);
    expect(minted.emails).toEqual([]);
  });

  it("rate limits to IP_LIMIT attempts a minute, under its own key prefix", async () => {
    const kv = fakeKV();
    const now = Date.now();

    for (let attempt = 0; attempt < IP_LIMIT; attempt += 1) {
      const response = await handleDemoAccess(
        input({ key: "wrong", kv, now }),
      );
      expect(response.status).toBe(404);
    }

    /* The right key, one attempt past the budget: still 404. */
    const minted = signIn();
    const response = await handleDemoAccess(
      input({ kv, now, signIn: minted.fn }),
    );

    expect(response.status).toBe(404);
    expect(minted.emails).toEqual([]);
    expect(kv.keys()).toHaveLength(1);
    expect(kv.keys()[0]).toContain(`${DEMO_RATE_LIMIT_PREFIX}:${IP}:`);
  });

  it("lets the next window through again", async () => {
    const kv = fakeKV();
    const now = Date.now();
    const minted = signIn();

    for (let attempt = 0; attempt < IP_LIMIT; attempt += 1) {
      await handleDemoAccess(input({ key: "wrong", kv, now }));
    }

    const response = await handleDemoAccess(
      input({ kv, now: now + 60 * 1000, signIn: minted.fn }),
    );

    expect(response.status).toBe(302);
    expect(minted.emails).toEqual([DEMO_EMAIL]);
  });

  it("counts each IP separately", async () => {
    const kv = fakeKV();
    const now = Date.now();
    const minted = signIn();

    for (let attempt = 0; attempt < IP_LIMIT; attempt += 1) {
      await handleDemoAccess(input({ key: "wrong", kv, now }));
    }

    const response = await handleDemoAccess(
      input({ kv, now, ip: "198.51.100.4", signIn: minted.fn }),
    );

    expect(response.status).toBe(302);
  });

  it("fails open on the rate limit when there is no KV binding", async () => {
    const minted = signIn();

    for (let attempt = 0; attempt < IP_LIMIT + 3; attempt += 1) {
      const response = await handleDemoAccess(input({ signIn: minted.fn }));
      expect(response.status).toBe(302);
    }
  });

  it("answers every refusal with the identical uncacheable 404", async () => {
    const responses = await Promise.all([
      handleDemoAccess(input({ secret: undefined })),
      handleDemoAccess(input({ key: null })),
      handleDemoAccess(input({ key: "wrong" })),
      handleDemoAccess(input({ storedEmail: storedEmail(null).fn })),
    ]);

    const bodies = await Promise.all(responses.map((r) => r.text()));

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(new Set(bodies).size).toBe(1);
  });
});
