/**
 * Starts the dev server, and starts it again if the first attempt dies.
 *
 * Astro 7 + @astrojs/cloudflare 14 + Vite 8 have a cold-cache race: with no
 * node_modules/.vite present, Vite optimizes dependencies, discovers
 * astro/assets/services/noop late (Astro imports its image service
 * dynamically), re-optimizes, and reloads. A browser survives that reload.
 * The workerd SSR runner does not - it is still holding the pre-reload chunk
 * hash, that file no longer exists, and the process exits.
 *
 * What the user sees is "Dev server process exited before becoming ready" with
 * no cause, because the real error goes to .astro/dev.log.
 *
 * The failed attempt still writes the optimized dependencies, so the cache is
 * warm afterwards and a second start succeeds. optimizeDeps settings for the
 * ssr environment were tried and have no effect here - Astro and the adapter
 * own that environment's config - so this retries rather than pretending to
 * have fixed the race.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const PORT = process.env.PORT ?? "4321";
const READY_TIMEOUT_MS = 45_000;
const ASTRO = "node_modules/.bin/astro";

function start() {
  /* Bind explicitly to the IPv4 loopback: this script's own waitForReady()
     and storage-dev.ts's /__data transport both target 127.0.0.1, but
     "localhost" started resolving IPv6-only on some machines, so the server
     came up on [::1] while both of those kept dialing 127.0.0.1 and got
     connection-refused - every dev search 503s while pages still loaded
     (browsers fall back to ::1 via Happy Eyeballs, which hid the bind
     mismatch). http://localhost:4321 keeps working for browsers either way. */
  spawnSync(ASTRO, ["dev", "--port", PORT, "--host", "127.0.0.1"], {
    stdio: "inherit",
  });
}

async function waitForReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

function coldCacheRace() {
  if (!existsSync(".astro/dev.log")) return false;
  const log = readFileSync(".astro/dev.log", "utf8");
  return log.includes("which is in the optimize deps directory");
}

function stop() {
  try {
    execFileSync(ASTRO, ["dev", "stop"], { stdio: "ignore" });
  } catch {
    /* nothing running */
  }
  try {
    execFileSync("pkill", ["-f", "workerd"], { stdio: "ignore" });
  } catch {
    /* none left */
  }
}

start();
if (await waitForReady()) {
  console.log(`\n  Dev server ready on http://localhost:${PORT}\n`);
  process.exit(0);
}

if (coldCacheRace()) {
  console.log(
    "\n  First start hit the cold-cache dependency race; the cache is warm now. Retrying...\n",
  );
} else {
  console.log("\n  Dev server did not come up. Retrying once...\n");
}

stop();
await new Promise((resolve) => setTimeout(resolve, 2000));
start();

if (await waitForReady()) {
  console.log(`\n  Dev server ready on http://localhost:${PORT}\n`);
  process.exit(0);
}

console.error(
  "\n  Dev server failed to start twice. The real error is in app/.astro/dev.log\n",
);
process.exit(1);
