import { describe, expect, it } from "vitest";
import {
  EMAIL_LIMIT,
  IP_LIMIT,
  checkMagicLinkRateLimit,
  type KVNamespace,
} from "./magic-link-rate-limit";

/** An in-memory stand-in for the METER KV binding - real `get`/`put`
    semantics (string values, no TTL enforcement needed since these tests
    never cross a window boundary). */
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

function failingKV(): KVNamespace {
  return {
    async get() {
      throw new Error("KV unavailable");
    },
    async put() {
      throw new Error("KV unavailable");
    },
  };
}

describe("checkMagicLinkRateLimit - IP bound", () => {
  it(`allows up to ${IP_LIMIT} requests per IP per window`, async () => {
    const kv = fakeKV();
    for (let i = 0; i < IP_LIMIT; i++) {
      const decision = await checkMagicLinkRateLimit(kv, "1.2.3.4", `visitor-${i}@example.com`);
      expect(decision.limited).toBe(false);
    }
  });

  it(`blocks the request past ${IP_LIMIT}, with distinct emails so only the IP bound can be responsible`, async () => {
    const kv = fakeKV();
    for (let i = 0; i < IP_LIMIT; i++) {
      await checkMagicLinkRateLimit(kv, "1.2.3.4", `visitor-${i}@example.com`);
    }
    const decision = await checkMagicLinkRateLimit(kv, "1.2.3.4", "one-more@example.com");
    expect(decision).toEqual({ limited: true, reason: "ip" });
  });

  it("does not share counters across different IPs", async () => {
    const kv = fakeKV();
    for (let i = 0; i < IP_LIMIT; i++) {
      await checkMagicLinkRateLimit(kv, "1.2.3.4", `visitor-${i}@example.com`);
    }
    const decision = await checkMagicLinkRateLimit(kv, "5.6.7.8", "fresh@example.com");
    expect(decision.limited).toBe(false);
  });

  it("resets in a later window", async () => {
    const kv = fakeKV();
    const windowMs = 60 * 1000;
    const first = Date.now();
    for (let i = 0; i < IP_LIMIT; i++) {
      await checkMagicLinkRateLimit(kv, "1.2.3.4", `visitor-${i}@example.com`, first);
    }
    const stillLimited = await checkMagicLinkRateLimit(kv, "1.2.3.4", "another@example.com", first);
    expect(stillLimited.limited).toBe(true);

    const nextWindow = first + windowMs;
    const afterReset = await checkMagicLinkRateLimit(kv, "1.2.3.4", "another@example.com", nextWindow);
    expect(afterReset.limited).toBe(false);
  });
});

describe("checkMagicLinkRateLimit - email bound", () => {
  it(`allows up to ${EMAIL_LIMIT} sends to the same email, from the same IP`, async () => {
    const kv = fakeKV();
    for (let i = 0; i < EMAIL_LIMIT; i++) {
      const decision = await checkMagicLinkRateLimit(kv, "9.9.9.9", "victim@example.com");
      expect(decision.limited).toBe(false);
    }
  });

  it(`blocks the send past ${EMAIL_LIMIT}, tripping before the (higher) IP limit`, async () => {
    const kv = fakeKV();
    for (let i = 0; i < EMAIL_LIMIT; i++) {
      await checkMagicLinkRateLimit(kv, "9.9.9.9", "victim@example.com");
    }
    const decision = await checkMagicLinkRateLimit(kv, "9.9.9.9", "victim@example.com");
    expect(decision).toEqual({ limited: true, reason: "email" });
  });

  it("catches distributed bombing - same email, different IPs, still trips", async () => {
    const kv = fakeKV();
    for (let i = 0; i < EMAIL_LIMIT; i++) {
      const decision = await checkMagicLinkRateLimit(kv, `10.0.0.${i}`, "victim@example.com");
      expect(decision.limited).toBe(false);
    }
    const decision = await checkMagicLinkRateLimit(kv, "10.0.0.99", "victim@example.com");
    expect(decision).toEqual({ limited: true, reason: "email" });
  });

  it("is case-insensitive and trims whitespace, matching the same account either way", async () => {
    const kv = fakeKV();
    for (let i = 0; i < EMAIL_LIMIT; i++) {
      await checkMagicLinkRateLimit(kv, `10.0.1.${i}`, "Victim@Example.com");
    }
    const decision = await checkMagicLinkRateLimit(kv, "10.0.1.99", "  victim@example.com  ");
    expect(decision).toEqual({ limited: true, reason: "email" });
  });

  it("does not share counters across different emails", async () => {
    const kv = fakeKV();
    for (let i = 0; i < EMAIL_LIMIT; i++) {
      await checkMagicLinkRateLimit(kv, "9.9.9.9", "victim@example.com");
    }
    const decision = await checkMagicLinkRateLimit(kv, "9.9.9.9", "someone-else@example.com");
    expect(decision.limited).toBe(false);
  });
});

describe("checkMagicLinkRateLimit - fail-open", () => {
  it("allows the request when KV reads/writes throw", async () => {
    const decision = await checkMagicLinkRateLimit(failingKV(), "1.2.3.4", "anyone@example.com");
    expect(decision).toEqual({ limited: false });
  });

  it("allows the request when the email is empty (Better Auth's own validation rejects it next)", async () => {
    const kv = fakeKV();
    const decision = await checkMagicLinkRateLimit(kv, "1.2.3.4", "");
    expect(decision.limited).toBe(false);
  });
});
