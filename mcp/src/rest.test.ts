import { describe, expect, it } from "vitest";
import worker from "./index";

/** REST routing/auth surface only - the authenticated handlers hit real D1
    and are live-verified against wrangler dev, same split as index.test.ts. */
function fakeEnv(): Env {
  return {
    ICONS: {} as Env["ICONS"],
    DB: {} as Env["DB"],
    MCP_RATE: {} as Env["MCP_RATE"],
    PUBLIC_SITE_ORIGIN: "https://motificons.app",
  };
}

describe("REST surface (/v1)", () => {
  it("rejects a keyless /v1/validate with a plain JSON error, not JSON-RPC", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/v1/validate"),
      fakeEnv(),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Bearer");
    const body = (await response.json()) as { error?: string; jsonrpc?: string };
    expect(typeof body.error).toBe("string");
    expect(body.jsonrpc).toBeUndefined();
  });

  it("rejects a keyless POST /v1/collections/:id/icons with 401 JSON", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/v1/collections/some-id/icons", {
        method: "POST",
        body: JSON.stringify({ icon: "tabler:star" }),
      }),
      fakeEnv(),
    );
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error?: string };
    expect(typeof body.error).toBe("string");
  });

  it("keeps 404 for paths outside /mcp and /v1/", async () => {
    const response = await worker.fetch(new Request("https://example.com/v2/validate"), fakeEnv());
    expect(response.status).toBe(404);
  });
});
