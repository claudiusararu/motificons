import type { APIRoute } from "astro";
import { auth } from "../../../lib/auth/auth";
import {
  guardMagicLinkRequest,
  parseMagicLinkMode,
  refusalResponse,
} from "../../../lib/auth/magic-link-guard";
import type { KVNamespace } from "../../../lib/auth/magic-link-rate-limit";
import { turnstileConfig } from "../../../lib/auth/turnstile";
import { userExistsByEmail } from "../../../lib/auth/account-lookup";
import { db } from "../../../db/client";

export const prerender = false;

/** The one path this file guards before Better Auth ever sees the request -
    see magic-link-guard.ts's module docstring for the check order and why. */
const MAGIC_LINK_SIGN_IN_PATH = "/api/auth/sign-in/magic-link";

/** Which door the visitor came through, and the Turnstile token, travel as
    headers rather than body fields: Better Auth validates the magic-link
    body against its own schema, so the request can be forwarded to it
    completely untouched this way. */
const MODE_HEADER = "x-auth-mode";
const TURNSTILE_HEADER = "x-turnstile-token";

/** Same header precedence as api/search.ts's meter - cf-connecting-ip is
    Cloudflare's real client IP, x-forwarded-for a fallback for local
    proxies, clientAddress last since the CF adapter can throw on it in some
    dev configurations. */
function clientIp(request: Request, clientAddress: string): string {
  const forwarded =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0];
  return (forwarded ?? clientAddress ?? "unknown").trim();
}

/** Reads the target email out of the request body without consuming it
    (`.clone()` - `instance.handler(request)` below still needs the original,
    unread body). */
async function readEmail(request: Request): Promise<string> {
  try {
    const body = (await request.clone().json()) as { email?: unknown };
    return typeof body.email === "string" ? body.email : "";
  } catch {
    /* Malformed JSON - not this file's job to reject it; Better Auth's own
       validation does that (see the endpoint's real 400 shape this matches:
       {"message": "...", "code": "VALIDATION_ERROR"}). */
    return "";
  }
}

/** Imported lazily, same reasoning as api/search.ts: a static
    "cloudflare:workers" import is not resolvable everywhere the dev module
    graph is built. No METER binding is a misconfiguration, not a reason to
    block sign-in - fail open, same as a missing binding does for search. */
async function meterKV(): Promise<KVNamespace | undefined> {
  try {
    const mod = (await import("cloudflare:workers")) as unknown as {
      env?: { METER?: KVNamespace };
    };
    return mod.env?.METER;
  } catch {
    return undefined;
  }
}

/**
 * Turnstile -> rate limit -> account lookup, all before Better Auth. `null`
 * means "not refused, proceed"; a `Response` means "send this instead of
 * reaching Better Auth" - the caller returns it as-is, so no mailer call and
 * no verification token ever get minted for a blocked request.
 */
async function guardMagicLink(
  request: Request,
  clientAddress: string,
): Promise<Response | null> {
  const email = await readEmail(request);
  const ip = clientIp(request, clientAddress);
  const mode = parseMagicLinkMode(request.headers.get(MODE_HEADER));
  const { secret } = await turnstileConfig();

  /* Only the sign-in door needs the database, and a database that is not
     reachable must not 500 a sign-in - it just means the account check is
     skipped for this request (send anyway, the honest fallback). */
  const userExists =
    mode === "signin"
      ? await (async () => {
          try {
            const database = await db();
            return (candidate: string) =>
              userExistsByEmail(database, candidate);
          } catch {
            return undefined;
          }
        })()
      : undefined;

  const refusal = await guardMagicLinkRequest({
    mode,
    email,
    ip,
    turnstileToken: request.headers.get(TURNSTILE_HEADER),
    turnstileSecret: secret,
    kv: await meterKV(),
    userExists,
  });

  return refusal ? refusalResponse(refusal) : null;
}

/** Mounts every Better Auth endpoint (sign-in, magic-link verify, OAuth
    callbacks, sign-out, get-session, ...) at /api/auth/*. Better Auth's
    handler is a plain Request -> Response function, so no per-route glue is
    needed beyond awaiting the lazily-built instance - except the magic-link
    guard above, which must run BEFORE the handler so a blocked request never
    sends an email or mints a verification token. OAuth sign-in sends no mail
    and so needs no guard. */
const handle: APIRoute = async ({ request, clientAddress }) => {
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === MAGIC_LINK_SIGN_IN_PATH) {
    const blocked = await guardMagicLink(request, clientAddress);
    if (blocked) return blocked;
  }

  const instance = await auth();
  const response = await instance.handler(request);

  return response;
};

export const GET = handle;
export const POST = handle;
