/**
 * Cloudflare Turnstile - the human check in front of every magic-link send.
 *
 * Why it exists: the magic-link endpoint spends real money (a Resend send)
 * and real inbox goodwill (somebody else's inbox) on every accepted call.
 * The rate limiter in magic-link-rate-limit.ts caps how fast one source can
 * burn either; Turnstile is what stops a script from being a "source" at
 * all. The two stack - Turnstile runs first, the limiter second.
 *
 * Posture: ON by default. Fail-OPEN happens in
 * exactly one case - `TURNSTILE_SECRET` is unset, which means the feature
 * was never configured (a contributor's local checkout, a deploy that has
 * not had the secret set yet). Once the secret exists, a missing token, an
 * invalid token, or a siteverify call that does not come back is a refusal.
 * A verifier that fails open when its own backend is unreachable is not a
 * verifier.
 *
 * Everything here is dependency-injected (`fetchImpl`) so the branches are
 * testable without a network.
 */

/** Cloudflare's server-side verification endpoint. */
export const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** One plain sentence for every failure mode - a visitor cannot act on
    "invalid-input-response" and a bot does not deserve the hint. */
export const TURNSTILE_FAILED_MESSAGE =
  "We could not verify you are human. Reload the page and try again.";

export interface TurnstileConfig {
  /** Public site key, safe to ship to the browser. Absent = widget off. */
  siteKey?: string;
  /** Secret, server-only. Absent = verification off (fail open). */
  secret?: string;
}

interface TurnstileEnv {
  PUBLIC_TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
}

/**
 * Reads both halves out of the Worker env.
 *
 * Same lazy `cloudflare:workers` import as auth.ts's `authEnv()`: bindings
 * and vars only exist inside a request-ish context, and Astro v6 dropped
 * `Astro.locals.runtime.env`. `.dev.vars` feeds the same env in `astro dev`
 * through the adapter's miniflare, so dev and production read one place.
 */
export async function turnstileConfig(): Promise<TurnstileConfig> {
  try {
    const { env } = (await import("cloudflare:workers")) as unknown as {
      env?: TurnstileEnv;
    };
    return {
      siteKey: env?.PUBLIC_TURNSTILE_SITE_KEY || undefined,
      secret: env?.TURNSTILE_SECRET || undefined,
    };
  } catch {
    /* No Worker env here (a plain node context, a test) - treat as
       unconfigured, which is the fail-open case. */
    return {};
  }
}

export interface TurnstileOutcome {
  /** True = let the request continue. */
  ok: boolean;
  /** True only when the check was skipped because no secret is configured -
      for logging and tests, never shown to a visitor. */
  skipped?: boolean;
  /** Cloudflare's own error codes, when it returned any. Diagnostics only. */
  codes?: string[];
}

/** Cloudflare's documented siteverify response - only the fields read here. */
interface SiteverifyBody {
  success?: boolean;
  "error-codes"?: string[];
}

/**
 * Verifies one token.
 *
 * @param secret       `TURNSTILE_SECRET`; undefined/empty turns the check off.
 * @param token        The widget's `cf-turnstile-response`, from the client.
 * @param remoteIp     Client IP, optional - Cloudflare uses it as a hint.
 * @param fetchImpl    Injected for tests.
 */
export async function verifyTurnstile({
  secret,
  token,
  remoteIp,
  fetchImpl = fetch,
}: {
  secret?: string;
  token?: string | null;
  remoteIp?: string;
  fetchImpl?: typeof fetch;
}): Promise<TurnstileOutcome> {
  if (!secret) return { ok: true, skipped: true };
  if (!token) return { ok: false, codes: ["missing-input-response"] };

  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", token);
  if (remoteIp && remoteIp !== "unknown") form.set("remoteip", remoteIp);

  try {
    const response = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!response.ok) return { ok: false, codes: ["siteverify-http-error"] };

    const body = (await response.json()) as SiteverifyBody;
    if (body.success === true) return { ok: true };
    return { ok: false, codes: body["error-codes"] ?? ["verification-failed"] };
  } catch {
    /* Network/parse failure. Deliberately a refusal, not a pass: the secret
       is configured, so the check is meant to be running. */
    return { ok: false, codes: ["siteverify-unreachable"] };
  }
}
