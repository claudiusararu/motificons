/**
 * WebMCP bridge - the one place this site talks to the browser's
 * `document.modelContext` API.
 *
 * WebMCP (W3C Web Machine Learning CG, shipping behind a flag in Chrome 149+
 * and in ChatGPT's desktop browser) lets a page hand the agent that is driving
 * the browser a set of tools, instead of making it guess at the DOM. The page
 * declares what it can do; the agent calls it; the human watches it happen on
 * the screen they already had open.
 *
 * Three rules this module exists to enforce:
 *
 * 1. **No API, no trace.** Every consumer is optional. When the browser has no
 *    `document.modelContext` - which today is nearly every browser - this
 *    registers nothing, logs nothing, and changes no behaviour. The page has to
 *    work exactly the same for a human with a plain Chrome as it does for an
 *    agent with the flag on.
 * 2. **One AbortController per registration batch.** The spec unregisters
 *    tools by aborting the signal passed to `registerTool`, so a UI island can
 *    register on mount and drop everything on unmount with a single call.
 * 3. **A thrown error is a result, not a rejection.** An agent that gets an
 *    opaque rejection has nothing to say to the human. Every `execute` is
 *    wrapped so a throw comes back as `{ error: "..." }`, which the agent can
 *    read out loud.
 *
 * Deliberately dependency-free and framework-free: React islands use it
 * through a `useEffect`, and a plain `<script>` could use it unchanged.
 */

/** JSON Schema for a tool's input. Kept loose on purpose - the shape is the
    agent's contract, not ours, and the spec passes it through verbatim. */
export type JsonSchema = Record<string, unknown>;

/**
 * Hints the spec passes to the agent, all optional. `readOnlyHint` is the one
 * that matters most here: it tells the agent a tool only looks, so it can call
 * it freely without asking the human first.
 */
export interface WebMcpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/**
 * One tool, in the shape `document.modelContext.registerTool` takes.
 *
 * `execute` returns a plain string or a small JSON-serializable object - NOT
 * the MCP `{ content: [...] }` envelope. WebMCP is the page-side half of MCP;
 * the browser builds the envelope.
 */
export interface WebMcpTool {
  /** snake_case, unique on the page. This is what the agent calls. */
  name: string;
  /** Written for an agent that has never seen this site: what it does, when to
      reach for it, what the inputs mean. */
  description: string;
  /** Human-facing label, if the consumer surfaces one. */
  title?: string;
  inputSchema?: JsonSchema;
  annotations?: WebMcpToolAnnotations;
  execute: (
    input: Record<string, unknown>,
    context: { signal?: AbortSignal },
  ) => Promise<unknown> | unknown;
}

/** The slice of `document` this module touches - so the tests can hand it a
    fake one, and so nothing here depends on lib.dom having WebMCP typings
    (it does not yet: the API is behind a flag). */
export interface WebMcpHost {
  modelContext?: {
    registerTool?: (
      tool: WebMcpTool,
      options?: { signal?: AbortSignal },
    ) => unknown;
  };
}

/** What a wrapped `execute` returns when the underlying handler threw. */
export interface WebMcpToolError {
  error: string;
}

function describeError(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message;
  if (typeof cause === "string" && cause) return cause;
  return "The tool failed unexpectedly.";
}

/**
 * Wraps one handler so it always resolves. An agent can act on
 * `{ error: "Search is unavailable right now." }`; it can do nothing at all
 * with a rejected promise carrying a minified stack trace.
 */
function safeExecute(tool: WebMcpTool): WebMcpTool["execute"] {
  return async (input, context) => {
    try {
      return await tool.execute(input ?? {}, context ?? {});
    } catch (cause) {
      return { error: describeError(cause) } satisfies WebMcpToolError;
    }
  };
}

/** Resolves the host to feature-detect against. Explicit argument first (tests,
    and any future non-`document` host), then the real document. */
function resolveHost(host?: WebMcpHost): WebMcpHost | undefined {
  if (host) return host;
  return typeof document === "undefined"
    ? undefined
    : (document as unknown as WebMcpHost);
}

/**
 * Registers `tools` with the page's model context and returns the function
 * that removes them again.
 *
 * Safe to call anywhere, in any browser: when WebMCP is absent this is a no-op
 * that returns a no-op. Registration is additive, so several islands can each
 * call this for their own tools without knowing about each other.
 *
 * Typical use, from a React island:
 *
 * ```ts
 * useEffect(() => registerWebMcpTools(createSearchTools(handle)), [handle]);
 * ```
 */
export function registerWebMcpTools(
  tools: WebMcpTool[],
  host?: WebMcpHost,
): () => void {
  const noop = () => {};
  const context = resolveHost(host)?.modelContext;
  if (typeof context?.registerTool !== "function") return noop;

  const controller = new AbortController();
  let registered = 0;
  for (const tool of tools) {
    try {
      /* Called on the context, not through a detached reference: a real
         implementation is free to need its own `this`. */
      context.registerTool(
        { ...tool, execute: safeExecute(tool) },
        { signal: controller.signal },
      );
      registered += 1;
    } catch {
      /* A half-implemented or hostile model context must not be able to break
         the page it is attached to. Skip the tool, keep the island alive. */
    }
  }

  if (registered === 0) return noop;
  return () => controller.abort();
}
