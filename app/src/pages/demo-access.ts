import type { APIRoute } from "astro";
import { auth } from "../lib/auth/auth";
import { db } from "../db/client";
import { findStoredEmail } from "../lib/auth/account-lookup";
import {
  DEMO_CALLBACK_URL,
  demoAccessNotFound,
  demoAccessSecret,
  handleDemoAccess,
} from "../lib/auth/demo-access";
import { clientIp, meterKV } from "../lib/request-env";

export const prerender = false;

/**
 * GET /demo-access?key=<DEMO_ACCESS_KEY> - the judge door.
 *
 * All the policy (off without the secret, one shared account that must
 * already exist, the same 404 for every refusal, 5 tries a minute per IP,
 * digest-then-compare on the key) lives in lib/auth/demo-access.ts, where it
 * is unit-tested. This file is the wiring: read the env, resolve the IP, hand
 * the decision the two things only a request can supply - a database lookup
 * and a way to mint the session.
 *
 * Nothing links here. robots.txt disallows it; the sitemap lists static
 * pages by hand and this is not one of them.
 */

/**
 * Mints a real session for `email` the same way a clicked magic link does.
 *
 * Better Auth has no "create a session for this user" server API in this
 * configuration (that lives in the admin plugin's impersonation endpoint,
 * which this app does not install - it would add columns to the user table).
 * What it does have is the magic-link plugin's own verify endpoint, so this
 * writes the one row that endpoint consumes and then calls it: a verification
 * value whose identifier is the token (the plugin's default `storeToken` is
 * "plain", so the identifier is the token itself) and whose value is the
 * target email, valid for a minute, then `magicLinkVerify(... asResponse:
 * true)`.
 *
 * The result is the exact response a visitor clicking an emailed link would
 * get: a real `session` row, Better Auth's own Set-Cookie (session token plus
 * the cached-session cookie auth.ts configures), and a 302 to the callback.
 * No cookie is hand-rolled here, and no email is sent.
 *
 * `email` is the address exactly as stored (see findStoredEmail): the verify
 * endpoint CREATES a user when its own lookup misses, and handing it a
 * case-folded copy of an address stored differently would make it do that
 * instead of signing into the demo account.
 */
async function signInDemoUser(
  request: Request,
  email: string,
): Promise<Response> {
  const instance = await auth();
  const context = await instance.$context;

  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(
    /-/g,
    "",
  );
  await context.internalAdapter.createVerificationValue({
    identifier: token,
    value: JSON.stringify({ email }),
    expiresAt: new Date(Date.now() + 60 * 1000),
  });

  return instance.api.magicLinkVerify({
    query: { token, callbackURL: DEMO_CALLBACK_URL },
    headers: request.headers,
    asResponse: true,
  });
}

export const GET: APIRoute = async ({ request, url, clientAddress }) => {
  const secret = await demoAccessSecret();
  /* Cheapest possible answer when the feature is off - no database, no KV,
     no auth instance built. */
  if (!secret) return demoAccessNotFound();

  /* A database this endpoint cannot reach means it cannot confirm the demo
     account exists, and it may not sign anybody in on faith. Undefined here
     makes handleDemoAccess refuse. */
  const storedEmail = await (async () => {
    try {
      const database = await db();
      return (candidate: string) => findStoredEmail(database, candidate);
    } catch {
      return undefined;
    }
  })();

  return handleDemoAccess({
    key: url.searchParams.get("key"),
    secret,
    ip: clientIp(request, clientAddress),
    kv: await meterKV(),
    storedEmail,
    signIn: (email) => signInDemoUser(request, email),
  });
};
