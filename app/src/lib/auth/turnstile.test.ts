import { describe, expect, it, vi } from "vitest";
import { TURNSTILE_VERIFY_URL, verifyTurnstile } from "./turnstile";

/** A siteverify stand-in: records what it was called with, answers with the
    JSON body it was given. */
function fakeFetch(body: unknown, init: { ok?: boolean } = {}) {
  const calls: { url: string; body: string }[] = [];
  const impl = (async (url: string | URL | Request, options?: RequestInit) => {
    calls.push({ url: String(url), body: String(options?.body ?? "") });
    return {
      ok: init.ok ?? true,
      async json() {
        return body;
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("verifyTurnstile - secret unset (feature off)", () => {
  it("passes without calling siteverify at all", async () => {
    const { impl, calls } = fakeFetch({ success: false });
    const outcome = await verifyTurnstile({
      secret: undefined,
      token: null,
      fetchImpl: impl,
    });

    expect(outcome).toEqual({ ok: true, skipped: true });
    expect(calls).toHaveLength(0);
  });

  it("treats an empty-string secret as unset", async () => {
    const { impl, calls } = fakeFetch({ success: false });
    const outcome = await verifyTurnstile({
      secret: "",
      token: "anything",
      fetchImpl: impl,
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.skipped).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("verifyTurnstile - secret set", () => {
  it("refuses a missing token without calling siteverify", async () => {
    const { impl, calls } = fakeFetch({ success: true });
    const outcome = await verifyTurnstile({
      secret: "s3cret",
      token: null,
      fetchImpl: impl,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.codes).toContain("missing-input-response");
    expect(calls).toHaveLength(0);
  });

  it("passes a token Cloudflare accepts, and posts secret + response", async () => {
    const { impl, calls } = fakeFetch({ success: true });
    const outcome = await verifyTurnstile({
      secret: "s3cret",
      token: "tok-123",
      remoteIp: "1.2.3.4",
      fetchImpl: impl,
    });

    expect(outcome.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(TURNSTILE_VERIFY_URL);

    const sent = new URLSearchParams(calls[0].body);
    expect(sent.get("secret")).toBe("s3cret");
    expect(sent.get("response")).toBe("tok-123");
    expect(sent.get("remoteip")).toBe("1.2.3.4");
  });

  it("omits an unknown remote IP rather than sending the literal string", async () => {
    const { impl, calls } = fakeFetch({ success: true });
    await verifyTurnstile({
      secret: "s3cret",
      token: "tok",
      remoteIp: "unknown",
      fetchImpl: impl,
    });

    expect(new URLSearchParams(calls[0].body).has("remoteip")).toBe(false);
  });

  it("refuses a token Cloudflare rejects, and keeps its error codes", async () => {
    const { impl } = fakeFetch({
      success: false,
      "error-codes": ["invalid-input-response"],
    });
    const outcome = await verifyTurnstile({
      secret: "s3cret",
      token: "tok",
      fetchImpl: impl,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.codes).toEqual(["invalid-input-response"]);
  });

  it("refuses on a non-2xx from siteverify", async () => {
    const { impl } = fakeFetch({ success: true }, { ok: false });
    const outcome = await verifyTurnstile({
      secret: "s3cret",
      token: "tok",
      fetchImpl: impl,
    });

    expect(outcome.ok).toBe(false);
  });

  it("refuses when siteverify is unreachable - fail closed, not open", async () => {
    const impl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const outcome = await verifyTurnstile({
      secret: "s3cret",
      token: "tok",
      fetchImpl: impl,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.codes).toContain("siteverify-unreachable");
  });
});
