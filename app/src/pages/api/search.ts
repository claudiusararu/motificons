import type { APIContext, APIRoute } from "astro";
import type { SearchResponse } from "../../lib/search-config";
import type { EngineQuery, SearchEngine } from "../../lib/search/engine";
import { resolveAccount } from "../../lib/entitlements";
import { shardEngine } from "../../lib/search/shard-engine";
import {
  ANON_DAILY_LIMIT,
  METER_COOKIE,
  checkMeterKV,
  identityHash,
  type KVNamespace,
  type MeterDecision,
} from "../../lib/search/meter-kv";

export const prerender = false;

const MAX_LIMIT = 100;

function parseQuery(params: URLSearchParams): EngineQuery {
  const list = (key: string) =>
    params
      .getAll(key)
      .flatMap((value) => value.split(","))
      .filter(Boolean);

  return {
    query: params.get("q") ?? "",
    prefixes: [...list("prefix"), ...list("sets")],
    styles: list("style"),
    licenses: list("license"),
    tiers: list("tier"),
    noAttribution: params.get("noAttribution") === "1",
    noBrand: params.get("noBrand") === "1",
    category: params.get("category") || undefined,
    limit: Math.min(Number(params.get("limit")) || 60, MAX_LIMIT),
    offset: Math.max(0, Number(params.get("offset")) || 0),
  };
}

/**
 * The anonymous allowance, for one request. Everything meter-shaped lives in
 * here so the signed-in path can skip the lot with a single branch and the
 * anonymous path stays exactly the code it was: same cookie, same identity
 * hash, same KV read/write, same fail-open when the binding is missing.
 */
async function anonymousMeter(
  ctx: Pick<APIContext, "request" | "cookies" | "clientAddress">,
  url: URL,
  rawQuery: string,
): Promise<MeterDecision> {
  let sid = ctx.cookies.get(METER_COOKIE)?.value;
  if (!sid) {
    sid = crypto.randomUUID().replace(/-/g, "");
    ctx.cookies.set(METER_COOKIE, sid, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      secure: url.protocol === "https:",
    });
  }

  const forwarded = ctx.request.headers.get("cf-connecting-ip") ??
    ctx.request.headers.get("x-forwarded-for")?.split(",")[0];
  const ip = (forwarded ?? ctx.clientAddress ?? "unknown").trim();
  const identity = await identityHash(sid, ip);

  /* Imported lazily: a static "cloudflare:workers" import is not resolvable
     everywhere the dev module graph is built. */
  const kv = await (async () => {
    try {
      const mod = (await import("cloudflare:workers")) as unknown as {
        env?: { METER?: KVNamespace };
      };
      return mod.env?.METER;
    } catch {
      return undefined;
    }
  })();

  if (!kv) {
    /* No binding is a misconfiguration, not a reason to charge the visitor:
       serve the search and let /api/health report the missing namespace. */
    return {
      limited: false,
      counted: false,
      used: 0,
      remaining: ANON_DAILY_LIMIT,
      limit: ANON_DAILY_LIMIT,
    };
  }

  return checkMeterKV(kv, identity, rawQuery);
}

export const GET: APIRoute = async (context) => {
  const started = Date.now();
  const url = new URL(context.request.url);
  const params = url.searchParams;
  const rawQuery = params.get("q") ?? "";

  /* Signed in means unlimited search, so the account question is asked first
     and a signed-in visitor never reaches the meter at all: no meter cookie,
     no KV read, no KV write, no limited branch. This costs nothing extra -
     middleware has already resolved the session onto `locals` for every
     on-demand route, and resolveAccount reads that rather than looking it up
     again. Anonymous visitors take exactly the path they took before. */
  const { signedIn } = await resolveAccount(context);
  const meter = signedIn ? null : await anonymousMeter(context, url, rawQuery);

  if (meter?.limited) {
    /* HTTP 200, not 429: this is a designed product state the island renders,
       not a transport error, and a 4xx would be cached and retried by
       intermediaries in ways that make the state flicker. */
    return json({
      limited: true,
      meter: { used: meter.used, remaining: 0, limit: meter.limit },
      upsell: {
        headline: `That is ${ANON_DAILY_LIMIT} searches today`,
        body: "You have used today's free searches. Create a free account for unlimited search. Browsing stays open either way - every set, category and icon page is free and always will be.",
        browse: [
          { label: "Browse all icons", href: "/search" },
          { label: "Browse categories", href: "/categories" },
          { label: "Create a free account", href: "/register" },
        ],
      },
    } satisfies SearchResponse);
  }

  const engine: SearchEngine = shardEngine;

  try {
    const result = await engine.search(parseQuery(params));
    return json(
      {
        limited: false,
        hits: result.hits,
        total: result.total,
        offset: parseQuery(params).offset,
        limit: parseQuery(params).limit,
        facets: result.facets,
        /* null for a signed-in visitor: there is no allowance to report, so
           the island renders no counter at all rather than a zeroed one. */
        meter: meter
          ? { used: meter.used, remaining: meter.remaining, limit: meter.limit }
          : null,
        tookMs: Math.round((Date.now() - started) * 100) / 100,
      } satisfies SearchResponse,
      200,
      engine.name,
    );
  } catch {
    return json({ error: "search-unavailable" }, 503);
  }
};

function json(body: unknown, status = 200, engine?: string): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    /* Per-visitor metered state must never be shared by a cache. */
    "Cache-Control": "private, no-store",
  };
  if (engine) headers["X-Motificons-Engine"] = engine;
  return new Response(JSON.stringify(body), { status, headers });
}
