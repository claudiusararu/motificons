import { describe, expect, it } from "vitest";
import {
  registerWebMcpTools,
  type WebMcpHost,
  type WebMcpTool,
} from "./bridge";

/**
 * The bridge has one job and three promises (see bridge.ts): silence when the
 * browser has no WebMCP, one abort to unregister everything, and errors that
 * come back as data instead of as rejections. These cover all three, plus the
 * "a broken model context must not break the page" guard.
 */

/** A stand-in for `document.modelContext` that records what it was given. */
function fakeHost(options: { throwOn?: string } = {}) {
  const registered: { tool: WebMcpTool; signal: AbortSignal | undefined }[] = [];
  const host: WebMcpHost = {
    modelContext: {
      registerTool(tool, registerOptions) {
        if (options.throwOn === tool.name) throw new Error("registration refused");
        registered.push({ tool, signal: registerOptions?.signal });
      },
    },
  };
  return { host, registered };
}

function tool(name: string, execute: WebMcpTool["execute"]): WebMcpTool {
  return { name, description: `does ${name}`, execute };
}

describe("registerWebMcpTools - feature detection", () => {
  it("is a silent no-op when the browser has no model context", () => {
    const cleanup = registerWebMcpTools([tool("noop", () => "ok")], {});
    expect(typeof cleanup).toBe("function");
    /* Calling the returned cleanup must be safe even though nothing was
       registered - an island unmounting cannot be asked to check first. */
    expect(() => cleanup()).not.toThrow();
  });

  it("is a no-op when registerTool is missing from the model context", () => {
    const cleanup = registerWebMcpTools([tool("noop", () => "ok")], {
      modelContext: {},
    });
    expect(() => cleanup()).not.toThrow();
  });

  it("is a no-op with no document and no host (server render, worker)", () => {
    expect(typeof document).toBe("undefined");
    expect(() => registerWebMcpTools([tool("noop", () => "ok")])()).not.toThrow();
  });
});

describe("registerWebMcpTools - registration and cleanup", () => {
  it("registers every tool against one shared, un-aborted signal", () => {
    const { host, registered } = fakeHost();

    registerWebMcpTools(
      [tool("first", () => "a"), tool("second", () => "b")],
      host,
    );

    expect(registered.map((entry) => entry.tool.name)).toEqual([
      "first",
      "second",
    ]);
    expect(registered[0]!.signal).toBeInstanceOf(AbortSignal);
    expect(registered[0]!.signal).toBe(registered[1]!.signal);
    expect(registered[0]!.signal!.aborted).toBe(false);
  });

  it("passes the agent-facing metadata through untouched", () => {
    const { host, registered } = fakeHost();
    const schema = { type: "object", properties: { q: { type: "string" } } };

    registerWebMcpTools(
      [
        {
          name: "read_state",
          title: "Read state",
          description: "Reads the page state.",
          inputSchema: schema,
          annotations: { readOnlyHint: true },
          execute: () => "state",
        },
      ],
      host,
    );

    const entry = registered[0]!.tool;
    expect(entry.title).toBe("Read state");
    expect(entry.description).toBe("Reads the page state.");
    expect(entry.inputSchema).toBe(schema);
    expect(entry.annotations).toEqual({ readOnlyHint: true });
  });

  it("aborts the shared signal on cleanup, which is how WebMCP unregisters", () => {
    const { host, registered } = fakeHost();

    const cleanup = registerWebMcpTools([tool("first", () => "a")], host);
    expect(registered[0]!.signal!.aborted).toBe(false);

    cleanup();
    expect(registered[0]!.signal!.aborted).toBe(true);
  });

  it("keeps the remaining tools when one registration throws", () => {
    const { host, registered } = fakeHost({ throwOn: "first" });

    expect(() =>
      registerWebMcpTools(
        [tool("first", () => "a"), tool("second", () => "b")],
        host,
      ),
    ).not.toThrow();
    expect(registered.map((entry) => entry.tool.name)).toEqual(["second"]);
  });
});

describe("registerWebMcpTools - one name, one tool", () => {
  it("skips a name another island on the page is already offering", () => {
    const { host, registered } = fakeHost();

    registerWebMcpTools([tool("search_icons", () => "first island")], host);
    registerWebMcpTools(
      [tool("search_icons", () => "second island"), tool("only_here", () => "b")],
      host,
    );

    expect(registered.map((entry) => entry.tool.name)).toEqual([
      "search_icons",
      "only_here",
    ]);
  });

  it("hands the name back on cleanup, so the same island can remount", () => {
    const { host, registered } = fakeHost();

    const cleanup = registerWebMcpTools([tool("search_icons", () => "a")], host);
    cleanup();
    registerWebMcpTools([tool("search_icons", () => "b")], host);

    expect(registered.map((entry) => entry.tool.name)).toEqual([
      "search_icons",
      "search_icons",
    ]);
    expect(registered[1]!.signal!.aborted).toBe(false);
  });

  it("keeps names per model context, not global", () => {
    const first = fakeHost();
    const second = fakeHost();

    registerWebMcpTools([tool("search_icons", () => "a")], first.host);
    registerWebMcpTools([tool("search_icons", () => "b")], second.host);

    expect(first.registered).toHaveLength(1);
    expect(second.registered).toHaveLength(1);
  });
});

describe("registerWebMcpTools - execute wrapping", () => {
  it("passes input and context through to the handler", async () => {
    const { host, registered } = fakeHost();
    const seen: unknown[] = [];

    registerWebMcpTools(
      [
        tool("echo", (input, context) => {
          seen.push(input, context);
          return { ok: true };
        }),
      ],
      host,
    );

    const controller = new AbortController();
    await registered[0]!.tool.execute(
      { query: "arrow" },
      { signal: controller.signal },
    );
    expect(seen[0]).toEqual({ query: "arrow" });
    expect(seen[1]).toEqual({ signal: controller.signal });
  });

  it("substitutes an empty input when the agent sends none", async () => {
    const { host, registered } = fakeHost();
    let seen: unknown = "unset";

    registerWebMcpTools([tool("echo", (input) => ((seen = input), "ok"))], host);

    await registered[0]!.tool.execute(
      undefined as unknown as Record<string, unknown>,
      undefined as unknown as { signal: AbortSignal },
    );
    expect(seen).toEqual({});
  });

  it("turns a thrown Error into a readable result, not a rejection", async () => {
    const { host, registered } = fakeHost();

    registerWebMcpTools(
      [
        tool("boom", () => {
          throw new Error("Search is unavailable right now.");
        }),
      ],
      host,
    );

    await expect(registered[0]!.tool.execute({}, {})).resolves.toEqual({
      error: "Search is unavailable right now.",
    });
  });

  it("turns a rejected promise into a readable result too", async () => {
    const { host, registered } = fakeHost();

    registerWebMcpTools(
      [tool("boom", () => Promise.reject(new Error("network down")))],
      host,
    );

    await expect(registered[0]!.tool.execute({}, {})).resolves.toEqual({
      error: "network down",
    });
  });

  it("describes a non-Error throw rather than leaking undefined", async () => {
    const { host, registered } = fakeHost();

    registerWebMcpTools(
      [
        tool("boom", () => {
          throw { unhelpful: true };
        }),
      ],
      host,
    );

    await expect(registered[0]!.tool.execute({}, {})).resolves.toEqual({
      error: "The tool failed unexpectedly.",
    });
  });
});
