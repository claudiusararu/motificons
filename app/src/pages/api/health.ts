import type { APIRoute } from "astro";
import { loadStats } from "../../lib/data";
import { storage } from "../../lib/storage";

export const prerender = false;

/**
 * Deploy-time health check.
 *
 * Reports each dependency separately rather than collapsing to one boolean: at
 * deploy time the useful question is not "is it broken" but "which part", and
 * the app can serve every SEO page with search down. Overall status is
 * degraded rather than unhealthy in that case, so a load balancer does not
 * pull a node that is still serving most of the site correctly.
 */
export const GET: APIRoute = async () => {
  const started = performance.now();

  const data = await loadStats()
    .then((stats) => ({
      ok: true,
      icons: stats.totals.icons,
      sets: stats.totals.sets,
      syncedAt: stats.generatedAt,
    }))
    .catch(() => ({ ok: false as const, error: "pipeline data unreadable" }));

  const search = await (async () => {
    try {
      const raw = await (await storage()).text("shards/index.json");
      if (!raw) return { ok: false, error: "shards missing - run publish-data" };
      const index = JSON.parse(raw) as { buckets: number; terms: number };
      return { ok: true, buckets: index.buckets, terms: index.terms };
    } catch {
      return { ok: false, error: "shards unreadable" };
    }
  })();

  const status = !data.ok ? "unhealthy" : search.ok ? "healthy" : "degraded";

  return new Response(
    JSON.stringify(
      {
        status,
        uptimeSeconds: Math.round(process.uptime()),
        tookMs: Math.round((performance.now() - started) * 100) / 100,
        checks: { data, search },
      },
      null,
      2,
    ),
    {
      status: status === "unhealthy" ? 503 : 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
};
