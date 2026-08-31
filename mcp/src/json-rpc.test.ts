import { describe, expect, it } from "vitest";
import { jsonRpcErrorResponse, peekRequestId, UNAUTHORIZED_CODE } from "./json-rpc";

describe("peekRequestId", () => {
  it("reads a numeric id from a JSON-RPC body without consuming the caller's copy", async () => {
    const request = new Request("https://example.com/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "initialize" }),
    });
    const id = await peekRequestId(request);
    expect(id).toBe(7);
    /* The original request body must still be readable - callers that need
       the id also need the full body for the real handler. */
    const body = await request.json();
    expect((body as { id: number }).id).toBe(7);
  });

  it("reads a string id", async () => {
    const request = new Request("https://example.com/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: "abc", method: "tools/list" }),
    });
    expect(await peekRequestId(request)).toBe("abc");
  });

  it("falls back to null for a non-JSON body", async () => {
    const request = new Request("https://example.com/mcp", {
      method: "POST",
      body: "not json",
    });
    expect(await peekRequestId(request)).toBeNull();
  });

  it("falls back to null when the body has no id", async () => {
    const request = new Request("https://example.com/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(await peekRequestId(request)).toBeNull();
  });
});

describe("jsonRpcErrorResponse", () => {
  it("shapes a JSON-RPC 2.0 error body with the given status", async () => {
    const response = jsonRpcErrorResponse(3, UNAUTHORIZED_CODE, "no key", 401);
    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    const body = await response.json();
    expect(body).toEqual({
      jsonrpc: "2.0",
      id: 3,
      error: { code: UNAUTHORIZED_CODE, message: "no key" },
    });
  });

  it("merges extra headers", () => {
    const response = jsonRpcErrorResponse(null, UNAUTHORIZED_CODE, "no key", 401, {
      "WWW-Authenticate": 'Bearer realm="motificons-mcp"',
    });
    expect(response.headers.get("WWW-Authenticate")).toBe('Bearer realm="motificons-mcp"');
  });
});
