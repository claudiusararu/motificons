import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
import type { SearchResponse } from "../search-config";

/**
 * /api/search, at the meter boundary.
 *
 * It lives here rather than beside the route because everything under
 * src/pages is a route: a `search.test.ts` next to `search.ts` is built and
 * prerendered as /api/search.test, and the build fails on it.
 *
 * The subject is who pays for a search, not what search returns: the engine
 * is stubbed to a fixed empty result so every assertion here is about the
 * meter - one KV namespace, one account answer, and what the route does with
 * them.
 *
 * The KV double records every get/put, because "a signed-in visitor is not
 * metered" is a claim about writes that never happen, not about a number in
 * the body. A response can be made to look unlimited while still burning a
 * KV write per keystroke; asserting on `put` is what makes that impossible.
 */

const searchMock = vi.fn(async () => ({ hits: [], total: 0, facets: {} }));
vi.mock("./shard-engine", () => ({
  shardEngine: { name: "shard", search: searchMock },
}));

const resolveAccountMock = vi.fn(async () => ({ signedIn: false }));
vi.mock("../entitlements", () => ({
  resolveAccount: resolveAccountMock,
}));

/* The route reaches its namespace through `cloudflare:workers`, which only
   exists inside workerd - the module is virtual here and `env` is swapped per
   test through this mutable holder. */
const workerEnv: { METER?: FakeKV } = {};
vi.mock("cloudflare:workers", () => ({
  get env() {
    return workerEnv;
  },
}));

const { GET } = await import("../../pages/api/search");
const { ANON_DAILY_LIMIT, METER_COOKIE } = await import("./meter-kv");

class FakeKV {
  store = new Map<string, string>();
  gets: string[] = [];
  puts: { key: string; value: string }[] = [];
  failGet = false;
  failPut = false;

  async get(key: string): Promise<string | null> {
    this.gets.push(key);
    if (this.failGet) throw new Error("kv down");
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.puts.push({ key, value });
    if (this.failPut) throw new Error("kv down");
    this.store.set(key, value);
  }
}

/** Just enough AstroCookies for the route: read one, write one, remember. */
function fakeCookies(initial?: string) {
  const jar = new Map<string, string>();
  if (initial) jar.set(METER_COOKIE, initial);
  return {
    written: [] as string[],
    get(name: string) {
      const value = jar.get(name);
      return value === undefined ? undefined : { value };
    },
    set(name: string, value: string) {
      jar.set(name, value);
      this.written.push(name);
    },
  };
}

async function call(
  query: string,
  cookies = fakeCookies("fixed-session-id"),
): Promise<{ payload: SearchResponse; response: Response; cookies: ReturnType<typeof fakeCookies> }> {
  const request = new Request(
    `https://motificons.app/api/search?q=${encodeURIComponent(query)}`,
    { headers: { "cf-connecting-ip": "203.0.113.7" } },
  );
  const context = {
    request,
    cookies,
    clientAddress: "203.0.113.7",
    locals: { user: null },
  } as unknown as APIContext;

  const response = (await GET(context)) as Response;
  return {
    response,
    payload: (await response.json()) as SearchResponse,
    cookies,
  };
}

/**
 * Spends the whole anonymous allowance through the route itself, rather than
 * seeding a record by hand: the exhaustion path is then reached the way a
 * visitor reaches it. Every word is distinct and none is a prefix of another,
 * so each one counts.
 */
async function spendTheAllowance(): Promise<void> {
  const words = [
    "alpha", "bravo", "cargo", "delta", "eagle", "flint", "gamma", "hotel",
    "india", "juliet", "kilo", "lemon", "mango", "nectar", "oscar", "papa",
    "quartz", "romeo", "sierra", "tango", "umbra", "violet", "wagon", "xenon",
    "yodel",
  ];
  if (words.length !== ANON_DAILY_LIMIT) {
    throw new Error(
      `This helper spends ${words.length} searches; the allowance is ${ANON_DAILY_LIMIT}.`,
    );
  }
  for (const word of words) await call(word);
}

let kv: FakeKV;

beforeEach(() => {
  kv = new FakeKV();
  workerEnv.METER = kv;
  resolveAccountMock.mockReset();
  resolveAccountMock.mockResolvedValue({ signedIn: false });
  searchMock.mockClear();
});

describe("anonymous visitors are metered exactly as before", () => {
  it("counts a new query and reports the remaining allowance", async () => {
    const { payload } = await call("arrow");

    expect(payload.limited).toBe(false);
    expect(payload.meter).toEqual({
      used: 1,
      remaining: ANON_DAILY_LIMIT - 1,
      limit: ANON_DAILY_LIMIT,
    });
    expect(kv.puts).toHaveLength(1);
  });

  it("does not count browsing with no query", async () => {
    const { payload } = await call("");

    expect(payload.meter).toEqual({
      used: 0,
      remaining: ANON_DAILY_LIMIT,
      limit: ANON_DAILY_LIMIT,
    });
    expect(kv.puts).toHaveLength(0);
  });

  it("issues a meter cookie when the visitor has none", async () => {
    const cookies = fakeCookies();
    await call("arrow", cookies);
    expect(cookies.written).toContain(METER_COOKIE);
  });

  it("serves the limit state, uncounted, once the allowance is spent", async () => {
    await spendTheAllowance();

    const putsBefore = kv.puts.length;
    searchMock.mockClear();
    const { payload, response } = await call("zebra");

    expect(payload.limited).toBe(true);
    if (!payload.limited) throw new Error("unreachable");
    expect(payload.meter).toEqual({
      used: ANON_DAILY_LIMIT,
      remaining: 0,
      limit: ANON_DAILY_LIMIT,
    });
    expect(payload.upsell.body).toContain("Create a free account");
    /* A designed product state, not a transport error. */
    expect(response.status).toBe(200);
    /* Being over the limit must not cost another write. */
    expect(kv.puts).toHaveLength(putsBefore);
    /* And the engine is never asked for results it will not render. */
    expect(searchMock).not.toHaveBeenCalled();
  });
});

describe("signed-in visitors bypass the meter entirely", () => {
  beforeEach(() => {
    resolveAccountMock.mockResolvedValue({
      signedIn: true,
      email: "visitor@example.com",
    } as never);
  });

  it("reports no meter at all", async () => {
    const { payload } = await call("arrow");

    expect(payload.limited).toBe(false);
    if (payload.limited) throw new Error("unreachable");
    expect(payload.meter).toBeNull();
  });

  it("touches KV neither for reading nor for writing", async () => {
    await call("arrow");

    expect(kv.gets).toEqual([]);
    expect(kv.puts).toEqual([]);
  });

  it("issues no meter cookie", async () => {
    const cookies = fakeCookies();
    await call("arrow", cookies);
    expect(cookies.written).toEqual([]);
  });

  /* The strongest form of the claim: the very identity that was just locked
     out signs in and is served. Nothing about the request changes except the
     account, so the account is demonstrably what decides. */
  it("is never limited, on the identity that just exhausted the allowance", async () => {
    resolveAccountMock.mockResolvedValue({ signedIn: false });
    await spendTheAllowance();
    const locked = await call("zebra");
    expect(locked.payload.limited).toBe(true);

    resolveAccountMock.mockResolvedValue({ signedIn: true } as never);
    searchMock.mockClear();
    const { payload } = await call("zebra");

    expect(payload.limited).toBe(false);
    if (payload.limited) throw new Error("unreachable");
    expect(payload.meter).toBeNull();
    expect(searchMock).toHaveBeenCalledTimes(1);
  });
});

describe("the meter fails open", () => {
  it("serves search when the KV read throws", async () => {
    kv.failGet = true;
    const { payload, response } = await call("arrow");

    expect(response.status).toBe(200);
    expect(payload.limited).toBe(false);
    expect(searchMock).toHaveBeenCalledTimes(1);
  });

  it("serves search when the KV write throws", async () => {
    kv.failPut = true;
    const { payload, response } = await call("arrow");

    expect(response.status).toBe(200);
    expect(payload.limited).toBe(false);
  });

  it("serves search with a full allowance when the namespace is unbound", async () => {
    delete workerEnv.METER;
    const { payload } = await call("arrow");

    expect(payload.limited).toBe(false);
    if (payload.limited) throw new Error("unreachable");
    expect(payload.meter).toEqual({
      used: 0,
      remaining: ANON_DAILY_LIMIT,
      limit: ANON_DAILY_LIMIT,
    });
  });
});
