/**
 * JSON-RPC error responses for rejections that happen BEFORE the request
 * reaches the MCP transport - a missing/revoked key or a rate-limit trip.
 * `@modelcontextprotocol/server`'s `createMcpHandler` only ever sees a
 * request once it is authenticated, so these are hand-built rather than
 * anything the SDK emits.
 *
 * Shaped as JSON-RPC (not a bare `{error}` object or an OAuth-style
 * `{error, error_description}` body - the bearer-auth helpers in
 * `@modelcontextprotocol/server` produce that) because the task calling this
 * server is an MCP client, and a JSON-RPC error is the one shape every MCP
 * client already knows how to surface to whoever is driving it.
 */

/** Reserved range for implementation-defined server errors per the JSON-RPC
    2.0 spec (-32000 to -32099); -32001 is ours, not a spec-assigned code. */
export const UNAUTHORIZED_CODE = -32001;
export const RATE_LIMITED_CODE = -32002;

/**
 * Best-effort JSON-RPC request id from a request body that was never
 * validated - an auth failure happens before any real parsing, so this
 * peeks only far enough to echo the id back, and gives up silently (`null`,
 * the JSON-RPC convention for "the server could not determine the id") on
 * anything that is not `{"id": ...}`-shaped JSON.
 */
export async function peekRequestId(request: Request): Promise<string | number | null> {
  try {
    const clone = request.clone();
    const body = (await clone.json()) as { id?: string | number | null };
    return typeof body.id === "string" || typeof body.id === "number" ? body.id : null;
  } catch {
    return null;
  }
}

export function jsonRpcErrorResponse(
  id: string | number | null,
  code: number,
  message: string,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "private, no-store",
        ...headers,
      },
    },
  );
}
