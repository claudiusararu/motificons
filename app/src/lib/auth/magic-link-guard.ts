/**
 * Everything that has to be true before POST /api/auth/sign-in/magic-link is
 * allowed to send an email, in one ordered place.
 *
 * Order matters and is fixed:
 *
 *   1. Turnstile - cheapest way to drop a script before it costs anything,
 *      and the only check that can tell a bot from a person at all.
 *   2. Rate limit - the per-IP / per-target-email budget. Behind Turnstile
 *      on purpose: a bot that cannot pass step 1 never gets to consume a
 *      real visitor's shared IP budget.
 *   3. Account lookup - sign-in path only (see the trade-off note below).
 *
 * A refusal at any step returns before Better Auth is called, so no token is
 * minted and no mail is sent.
 *
 * The two doors:
 *
 *   - "register" always sends. An email that already has an account simply
 *     gets signed in by the link, which is the honest outcome - there is
 *     nothing to error about, and a "you already have an account" screen
 *     would leak exactly what step 3 leaks, to everybody, for free.
 *   - "signin" refuses unknown emails with NO_ACCOUNT so the visitor is sent
 *     to /register instead of staring at an inbox that will never get a
 *     link.
 *
 * ENUMERATION TRADE-OFF (deliberate): the sign-in
 * door's NO_ACCOUNT answer tells the asker whether an email has an account
 * here. That is a real disclosure and it is accepted on purpose - the cost
 * of the alternative (every mistyped or never-registered address ending in a
 * silent dead end) is worse for a free, no-password product whose accounts
 * hold icon collections. Turnstile plus the rate limiter is what keeps the
 * disclosure from being enumerable at scale.
 */

import {
  checkMagicLinkRateLimit,
  RATE_LIMIT_MESSAGE,
  type KVNamespace,
} from "./magic-link-rate-limit";
import { TURNSTILE_FAILED_MESSAGE, verifyTurnstile } from "./turnstile";
import type { UserExistsLookup } from "./account-lookup";

/** Which door the request came through. Anything unrecognized (and a
    request with no mode at all, e.g. a direct API caller) is treated as
    "register", the door that discloses nothing. */
export type MagicLinkMode = "register" | "signin";

export function parseMagicLinkMode(value: string | null | undefined): MagicLinkMode {
  return value === "signin" ? "signin" : "register";
}

/** Shown next to a link to /register. */
export const NO_ACCOUNT_MESSAGE = "No account for this email yet - create one?";

export interface GuardRefusal {
  status: number;
  /** Better Auth's own error shape (`{ message, code }`), so
      @better-fetch/fetch spreads it into the client's `error` object and
      AuthCard can branch on `error.code` with no extra plumbing. */
  body: { message: string; code: string };
}

export interface GuardInput {
  mode: MagicLinkMode;
  email: string;
  /** Client IP, already resolved from the proxy headers by the caller. */
  ip: string;
  turnstileToken?: string | null;
  /** Absent = Turnstile not configured; the check is skipped (fail open). */
  turnstileSecret?: string;
  /** Absent = no METER binding; the rate limit is skipped (fail open). */
  kv?: KVNamespace;
  /** Absent = no database reachable; the account check is skipped, and the
      register-style "always send" behavior applies. */
  userExists?: UserExistsLookup;
  fetchImpl?: typeof fetch;
  now?: number;
}

/**
 * Runs the three checks in order. `null` means "proceed to Better Auth";
 * a `GuardRefusal` means "answer with this and send nothing".
 */
export async function guardMagicLinkRequest(
  input: GuardInput,
): Promise<GuardRefusal | null> {
  const turnstile = await verifyTurnstile({
    secret: input.turnstileSecret,
    token: input.turnstileToken,
    remoteIp: input.ip,
    fetchImpl: input.fetchImpl,
  });
  if (!turnstile.ok) {
    return {
      status: 403,
      body: { message: TURNSTILE_FAILED_MESSAGE, code: "TURNSTILE_FAILED" },
    };
  }

  if (input.kv) {
    const decision = await checkMagicLinkRateLimit(
      input.kv,
      input.ip,
      input.email,
      input.now,
    );
    if (decision.limited) {
      return {
        status: 429,
        body: { message: RATE_LIMIT_MESSAGE, code: "RATE_LIMITED" },
      };
    }
  }

  if (input.mode === "signin" && input.userExists) {
    const exists = await input.userExists(input.email);
    if (!exists) {
      return {
        status: 404,
        body: { message: NO_ACCOUNT_MESSAGE, code: "NO_ACCOUNT" },
      };
    }
  }

  return null;
}

/** The refusal as an HTTP response - one place, so every refusal gets the
    same no-store headers. */
export function refusalResponse(refusal: GuardRefusal): Response {
  return new Response(JSON.stringify(refusal.body), {
    status: refusal.status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}
