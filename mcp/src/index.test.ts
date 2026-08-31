import { describe, expect, it } from "vitest";
import worker from "./index";

/** /health and the auth-rejection path never touch D1/R2/KV, so a real
    binding is unnecessary - the fields exist only so TS accepts the call. */
function fakeEnv(): Env {
  return {
    ICONS: {} as Env["ICONS"],
    DB: {} as Env["DB"],
    MCP_RATE: {} as Env["MCP_RATE"],
    PUBLIC_SITE_ORIGIN: "https://motificons.app",
  };
}

describe("Worker routing", () => {
  it("answers /health without touching the MCP transport", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/health"),
      fakeEnv(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", server: "motificons-mcp" });
  });

  it("404s anything outside /mcp and /health", async () => {
    const response = await worker.fetch(new Request("https://example.com/nope"), fakeEnv());
    expect(response.status).toBe(404);
  });

  it("rejects /mcp with no Authorization header before touching the MCP transport", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/mcp", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      }),
      fakeEnv(),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Bearer");
    const body = (await response.json()) as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32001);
    expect(body.error.message).toContain("motificons.app");
  });
});
