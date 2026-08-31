/**
 * Worker entry point. One route that matters - `POST/GET/DELETE /mcp`, the
 * Streamable HTTP transport `@modelcontextprotocol/server`'s
 * `createMcpHandler` implements - gated by two checks that run BEFORE the
 * request ever reaches the MCP transport:
 *
 *   1. Bearer auth (src/auth.ts) - a live API key from call one. Accounts
 *      and keys are free; a missing/invalid/revoked key never reaches
 *      `createMcpHandler` at all, it gets one plain-language JSON-RPC error
 *      instead.
 *   2. Per-key rate limit (src/rate-limit.ts) - the fair-use cap, generous
 *      and fail-open.
 *
 * `legacy: "stateless"` (the default) is deliberate, not an oversight: this
 * server's tools carry no state between calls, so there is nothing a
 * session would buy that a fresh `McpServer` per request (src/server.ts's
 * factory) does not already give for free - no Durable Object, no session
 * storage, one Worker.
 */

import { createMcpHandler } from "@modelcontextprotocol/server";
import { authenticate, type MotificonsAuthExtra } from "./auth";
import { handleRest, REST_PREFIX } from "./rest";
import {
  jsonRpcErrorResponse,
  peekRequestId,
  RATE_LIMITED_CODE,
  UNAUTHORIZED_CODE,
} from "./json-rpc";
import { checkRateLimit, type KVNamespace as RateLimitKV } from "./rate-limit";
import { buildServer } from "./server";

const MCP_ROUTE = "/mcp";

const mcpHandler = createMcpHandler(buildServer, {
  onerror: (error) => console.error("[motificons-mcp]", error),
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "ok", server: "motificons-mcp" });
    }

    // Same bearer gate for both consumers of the one mk_ key: /mcp (agents,
    // JSON-RPC errors) and /v1/* (the desktop app, plain JSON errors).
    const isRest = url.pathname.startsWith(REST_PREFIX);
    if (url.pathname !== MCP_ROUTE && !isRest) {
      return new Response("Not found", { status: 404 });
    }

    const auth = await authenticate(request.headers.get("Authorization"));
    if (!auth.ok) {
      if (isRest) {
        // Same single failure message policy as auth.ts, reworded for the
        // desktop surface (rule 13: no "MCP server" on a general surface).
        return Response.json(
          {
            error:
              "This key was not accepted. Check it in your dashboard at motificons.app/dashboard, or create a free account there and generate one.",
          },
          { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="motificons-mcp"' } },
        );
      }
      const id = await peekRequestId(request);
      return jsonRpcErrorResponse(id, UNAUTHORIZED_CODE, auth.message, 401, {
        "WWW-Authenticate": 'Bearer realm="motificons-mcp"',
      });
    }

    const extra = auth.auth.extra as { keyId?: string } | undefined;
    const keyId = extra?.keyId ?? auth.auth.clientId;
    const limit = await checkRateLimit(env.MCP_RATE as unknown as RateLimitKV, keyId);
    if (limit.limited) {
      const message = `This key has hit its rate limit (${limit.limit} calls/minute). Wait a moment and retry.`;
      if (isRest) {
        return Response.json({ error: message }, { status: 429 });
      }
      const id = await peekRequestId(request);
      return jsonRpcErrorResponse(id, RATE_LIMITED_CODE, message, 429);
    }

    if (isRest) {
      return handleRest(request, url, auth.auth.extra as unknown as MotificonsAuthExtra);
    }

    return mcpHandler.fetch(request, { authInfo: auth.auth });
  },
};
