import { describe, expect, it, vi } from "vitest";
import {
  acquireTurnstileToken,
  TURNSTILE_TIMEOUT_MS,
} from "./useTurnstile";

/**
 * The regression these cover (PM verification, 2026-08-31): the form used to
 * post token-less whenever the widget had not finished rendering by the time
 * the visitor clicked, so a legitimate fast first click came back 403 with
 * "we could not verify you are human". Submitting must WAIT for the widget,
 * then for the challenge, and only give up on a real failure.
 */

/** A widget that becomes ready only after `resolveReady()` is called. */
function deferredWidget() {
  let release: ((ready: boolean) => void) | null = null;
  const waited: number[] = [];
  const executed: number[] = [];

  return {
    waited,
    executed,
    resolveReady(ready = true) {
      release?.(ready);
      release = null;
    },
    waitForWidget(timeoutMs: number) {
      waited.push(timeoutMs);
      return new Promise<boolean>((resolve) => {
        release = resolve;
      });
    },
    execute(timeoutMs: number) {
      executed.push(timeoutMs);
      return Promise.resolve("token-from-widget");
    },
  };
}

describe("acquireTurnstileToken - waits instead of posting token-less", () => {
  it("does not execute until the widget reports ready", async () => {
    const widget = deferredWidget();

    const pending = acquireTurnstileToken({
      configured: true,
      waitForWidget: widget.waitForWidget,
      execute: widget.execute,
    });

    /* Let every already-scheduled microtask run: a still-starting widget
       must not have produced a token, and must not have been executed. */
    await Promise.resolve();
    await Promise.resolve();
    expect(widget.executed).toHaveLength(0);

    widget.resolveReady(true);
    await expect(pending).resolves.toBe("token-from-widget");
    expect(widget.executed).toHaveLength(1);
  });

  it("gives the widget the full budget to appear", async () => {
    const widget = deferredWidget();
    const pending = acquireTurnstileToken({
      configured: true,
      waitForWidget: widget.waitForWidget,
      execute: widget.execute,
      budgetMs: 15_000,
    });

    widget.resolveReady(true);
    await pending;

    expect(widget.waited).toEqual([15_000]);
  });

  it("returns the token from a widget that was already ready", async () => {
    const execute = vi.fn(async () => "tok");
    const token = await acquireTurnstileToken({
      configured: true,
      waitForWidget: async () => true,
      execute,
    });

    expect(token).toBe("tok");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("acquireTurnstileToken - the cases that legitimately give up", () => {
  it("returns null with no site key, and never touches the widget", async () => {
    const waitForWidget = vi.fn(async () => true);
    const execute = vi.fn(async () => "tok");

    const token = await acquireTurnstileToken({
      configured: false,
      waitForWidget,
      execute,
    });

    expect(token).toBeNull();
    expect(waitForWidget).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns null when the widget never becomes usable - blocked or timed out", async () => {
    const execute = vi.fn(async () => "tok");
    const token = await acquireTurnstileToken({
      configured: true,
      waitForWidget: async () => false,
      execute,
    });

    expect(token).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns null when the challenge itself fails", async () => {
    const token = await acquireTurnstileToken({
      configured: true,
      waitForWidget: async () => true,
      execute: async () => null,
    });

    expect(token).toBeNull();
  });
});

describe("acquireTurnstileToken - one shared deadline", () => {
  it("passes only the time left to the challenge", async () => {
    let clock = 1_000;
    const executed: number[] = [];

    const token = await acquireTurnstileToken({
      configured: true,
      budgetMs: 10_000,
      now: () => clock,
      waitForWidget: async () => {
        clock += 4_000;
        return true;
      },
      execute: async (timeoutMs) => {
        executed.push(timeoutMs);
        return "tok";
      },
    });

    expect(token).toBe("tok");
    expect(executed).toEqual([6_000]);
  });

  it("does not start a challenge once the budget is gone", async () => {
    let clock = 0;
    const execute = vi.fn(async () => "tok");

    const token = await acquireTurnstileToken({
      configured: true,
      budgetMs: 5_000,
      now: () => clock,
      waitForWidget: async () => {
        clock += 5_000;
        return true;
      },
      execute,
    });

    expect(token).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it("defaults to a budget a slow network and a visible challenge both fit in", () => {
    expect(TURNSTILE_TIMEOUT_MS).toBe(15_000);
  });
});
