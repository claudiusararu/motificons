import { describe, expect, it } from "vitest";
import { CALLS_PER_MINUTE, checkRateLimit, type KVNamespace } from "./rate-limit";

function fakeKV(initial: Record<string, string> = {}): KVNamespace {
  const store = new Map(Object.entries(initial));
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

/** A KV whose every call rejects, to exercise the fail-open path. */
function brokenKV(): KVNamespace {
  return {
    async get() {
      throw new Error("KV unavailable");
    },
    async put() {
      throw new Error("KV unavailable");
    },
  };
}

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

describe("checkRateLimit", () => {
  it("allows the first call in a window", async () => {
    const kv = fakeKV();
    const decision = await checkRateLimit(kv, "key1", NOW);
    expect(decision).toEqual({ limited: false, count: 1, limit: CALLS_PER_MINUTE });
  });

  it("counts consecutive calls within the same minute", async () => {
    const kv = fakeKV();
    await checkRateLimit(kv, "key1", NOW);
    await checkRateLimit(kv, "key1", NOW + 1000);
    const third = await checkRateLimit(kv, "key1", NOW + 2000);
    expect(third.count).toBe(3);
    expect(third.limited).toBe(false);
  });

  it("keeps counters independent per key", async () => {
    const kv = fakeKV();
    await checkRateLimit(kv, "key1", NOW);
    const other = await checkRateLimit(kv, "key2", NOW);
    expect(other.count).toBe(1);
  });

  it("resets in a new minute window", async () => {
    const kv = fakeKV();
    await checkRateLimit(kv, "key1", NOW);
    const nextMinute = await checkRateLimit(kv, "key1", NOW + 61_000);
    expect(nextMinute.count).toBe(1);
  });

  it("trips the limit at the cap and serves nothing free after it", async () => {
    const kv = fakeKV({ [`rl:key1:${Math.floor(NOW / 60_000)}`]: String(CALLS_PER_MINUTE) });
    const decision = await checkRateLimit(kv, "key1", NOW);
    expect(decision).toEqual({ limited: true, count: CALLS_PER_MINUTE, limit: CALLS_PER_MINUTE });
  });

  it("fails open when the KV read throws", async () => {
    const decision = await checkRateLimit(brokenKV(), "key1", NOW);
    expect(decision.limited).toBe(false);
  });
});
