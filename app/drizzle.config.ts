import { defineConfig } from "drizzle-kit";

/**
 * `generate` only - this config never connects to a live database.
 *
 * Migrations are applied by wrangler instead of drizzle-kit push/migrate:
 * `pnpm db:migrate` runs `wrangler d1 migrations apply DB --local`, which
 * reads the same `migrations/` directory drizzle-kit writes to (wrangler's
 * default lookup path, matching the `NNNN_name.sql` naming drizzle-kit
 * already produces - no renaming step needed).
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./migrations",
});
