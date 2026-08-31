import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* Vitest runs in node here (no jsdom in this project), so the two browser
   globals this module touches are stood up by hand. Both are the real
   contract it codes against: a Storage-shaped object that can throw, and an
   optional window.posthog. */
const store = new Map<string, string>();

const localStorageStub = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
};

const identify = vi.fn();
const reset = vi.fn();

beforeEach(() => {
  store.clear();
  identify.mockReset();
  reset.mockReset();
  vi.stubGlobal("localStorage", localStorageStub);
  vi.stubGlobal("window", { posthog: { identify, reset } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const { clearCached, readCached, writeCached } = await import("./entitlements-cache");

describe("writeCached / readCached", () => {
  it("round-trips a signed-in answer", () => {
    writeCached({ signedIn: true, email: "visitor@example.com" });
    expect(readCached()).toMatchObject({ signedIn: true, email: "visitor@example.com" });
  });

  it("round-trips a signed-out answer", () => {
    writeCached({ signedIn: false, email: null });
    expect(readCached()).toMatchObject({ signedIn: false, email: null });
  });

  it("returns null when nothing was ever written", () => {
    expect(readCached()).toBeNull();
  });

  /* The paid tier is gone, so an entry written by an older build still
     carries a `pro` field. It must still read back rather than being
     rejected - a returning visitor would otherwise lose the anti-flash
     guess for a day. */
  it("accepts an entry left behind by an older build", () => {
    store.set(
      "mfc-ent",
      JSON.stringify({ signedIn: true, pro: true, email: "old@example.com", t: Date.now() }),
    );
    expect(readCached()).toMatchObject({ signedIn: true, email: "old@example.com" });
  });

  it("rejects an entry past its 24h TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    writeCached({ signedIn: true, email: "visitor@example.com" });

    vi.setSystemTime(new Date("2026-01-01T23:59:00Z"));
    expect(readCached()).not.toBeNull();

    vi.setSystemTime(new Date("2026-01-02T00:01:00Z"));
    expect(readCached()).toBeNull();
  });

  it("rejects unparsable or malformed entries", () => {
    store.set("mfc-ent", "not json");
    expect(readCached()).toBeNull();

    store.set("mfc-ent", JSON.stringify({ email: "visitor@example.com", t: Date.now() }));
    expect(readCached()).toBeNull();

    store.set("mfc-ent", JSON.stringify({ signedIn: true, email: 42, t: Date.now() }));
    expect(readCached()).toBeNull();
  });

  it("never throws when storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: () => {
        throw new Error("storage disabled");
      },
      removeItem: () => {
        throw new Error("storage disabled");
      },
    });

    expect(() => writeCached({ signedIn: true, email: "visitor@example.com" })).not.toThrow();
    expect(readCached()).toBeNull();
    expect(() => clearCached()).not.toThrow();
  });

  it("clearCached drops the entry", () => {
    writeCached({ signedIn: true, email: "visitor@example.com" });
    clearCached();
    expect(readCached()).toBeNull();
  });
});

describe("writeCached - PostHog identity boundary", () => {
  it("identifies by email, with no plan properties", () => {
    writeCached({ signedIn: true, email: "visitor@example.com" });
    expect(identify).toHaveBeenCalledWith("visitor@example.com");
    expect(reset).not.toHaveBeenCalled();
  });

  it("resets once a previously signed-in visitor reads back signed out", () => {
    writeCached({ signedIn: true, email: "visitor@example.com" });
    identify.mockReset();

    writeCached({ signedIn: false, email: null });
    expect(reset).toHaveBeenCalledTimes(1);
    expect(identify).not.toHaveBeenCalled();
  });

  /* An anonymous visitor who was never signed in has no identity to reset -
     calling reset() would pointlessly churn their distinct id. */
  it("does not reset a visitor who was never signed in", () => {
    writeCached({ signedIn: false, email: null });
    expect(reset).not.toHaveBeenCalled();
  });

  it("tolerates a blocked or missing posthog loader", () => {
    vi.stubGlobal("window", {});
    expect(() => writeCached({ signedIn: true, email: "visitor@example.com" })).not.toThrow();
  });
});
