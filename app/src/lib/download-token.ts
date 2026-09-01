/**
 * Short-lived signed download tokens: how a collection's zip URL proves it
 * belongs to its owner WITHOUT a cookie.
 *
 * WHY THIS EXISTS. Moving the zip to a plain URL fixed the embedded-browser
 * download (see api/collections/[id]/download/[name].zip.ts's own note), but
 * only halfway. The ChatGPT desktop app hands the click to an external
 * download manager, and that manager fetches the URL as a fresh, cookieless
 * request - it is not the browser that has the session, it is a separate
 * program that was handed a string. Our route answered that cookieless GET
 * with 401, the manager gave up, and the download showed "Stopped" all over
 * again. So the URL itself has to carry the proof.
 *
 * WHAT A TOKEN SAYS. "The owner of workspace W asked for collection C's zip,
 * and did so less than 15 minutes ago." Nothing else. It is minted only
 * where a real session was already checked (the collection page's SSR pass,
 * which is signed-in and owner-scoped before it renders a single tile), and
 * it is verified against the same secret on the way back in.
 *
 * WHAT IT DELIBERATELY DOES NOT BIND: the export format and the size. Those
 * are picked in the download panel AFTER the page rendered, so binding them
 * would mean a round trip per pick - a second authed endpoint, a second
 * failure mode, and a race between "the pick changed" and "the anchor was
 * clicked". It would also buy nothing: every format and every size of that
 * collection is the SAME owner's own data, equally theirs to ask for, and
 * the PNG size a request can name is already clamped server-side
 * (transforms/png.ts's `clampPngSize`, 8-2048) on the session path too. So
 * the honest scope of a token is the collection, not the rendering options.
 *
 * WHY BETTER_AUTH_SECRET. It is already required in production, already the
 * thing that signs this app's sessions, and rotating it already invalidates
 * every session - which is exactly the behavior a download token should
 * inherit. A second secret would be one more thing to set, one more thing to
 * forget, and would give a strictly weaker guarantee than the one already
 * protecting the account these zips belong to. `authSecret()` in
 * lib/auth/auth.ts exists for precisely this: one resolution of that value,
 * with its dev fallback and its production throw, not re-derived by hand.
 *
 * Format: `<base64url(payload JSON)>.<base64url(HMAC-SHA-256)>`. Readable,
 * URL-safe, and small enough to sit in a query string next to `?format=`.
 * The payload is signed, not encrypted - it is not a secret, it is a claim,
 * and its contents (a collection id and a workspace id the owner is already
 * looking at) are worth nothing without the signature.
 */

import { secretsMatch } from "./auth/demo-access";

/**
 * How long a minted token stays good. Long enough to cover reading the
 * panel, changing the format and clicking; short enough that a URL copied
 * out of a downloads list, a proxy log or a screen share is a dead string
 * by the time anyone gets to it.
 */
export const DOWNLOAD_TOKEN_TTL_MS = 15 * 60 * 1000;

/** What the signature covers. `workspaceId` rides along so the route can run
    the SAME owner-scoped lookup the session path runs
    (`getCollection(db, workspaceId, collectionId)`) instead of growing a
    second, unscoped way to fetch a collection - the token is the proof of
    ownership, and the query stays identical either way. */
export interface DownloadTokenClaims {
  collectionId: string;
  workspaceId: string;
  /** Epoch milliseconds. Absolute, not a duration: the verifier must not
      have to trust the holder about when the clock started. */
  expiresAt: number;
}

function base64urlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlFromString(value: string): string {
  return base64urlFromBytes(new TextEncoder().encode(value));
}

/** `null` on anything that is not valid base64url of valid UTF-8 - a
    tampered or truncated token must fail as a refusal, never as a throw. */
function stringFromBase64url(value: string): string | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64urlFromBytes(new Uint8Array(signature));
}

/**
 * The pure minting half - secret in, token out, no env and no clock of its
 * own beyond `now`. `mintCollectionDownloadToken()` below is what callers
 * normally want.
 */
export async function mintDownloadToken(
  claims: Omit<DownloadTokenClaims, "expiresAt">,
  secret: string,
  now: number = Date.now(),
): Promise<string> {
  const payload: DownloadTokenClaims = {
    collectionId: claims.collectionId,
    workspaceId: claims.workspaceId,
    expiresAt: now + DOWNLOAD_TOKEN_TTL_MS,
  };
  const encoded = base64urlFromString(JSON.stringify(payload));
  return `${encoded}.${await sign(encoded, secret)}`;
}

/**
 * The pure verifying half. Returns the claims only when ALL of these hold,
 * and `null` - never a reason - for every other case:
 *
 *   - the token is two base64url parts
 *   - the signature matches the payload under this secret
 *   - the payload is the shape above, with real string ids
 *   - it has not expired
 *   - its `collectionId` is the collection this URL actually names
 *
 * That last check is what stops a token minted for one of your collections
 * from being pasted onto another collection's URL. The comparison of the two
 * signatures digests both sides first (lib/auth/demo-access.ts's
 * `secretsMatch`, reused rather than re-implemented) so the loop's length
 * does not depend on how much of a forged signature was right.
 */
export async function verifyDownloadToken(
  token: string | null,
  secret: string,
  expected: { collectionId: string },
  now: number = Date.now(),
): Promise<DownloadTokenClaims | null> {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts as [string, string];
  if (!encoded || !signature) return null;

  if (!(await secretsMatch(signature, await sign(encoded, secret)))) return null;

  const json = stringFromBase64url(encoded);
  if (json === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  const claims = parsed as Partial<DownloadTokenClaims> | null;
  if (!claims || typeof claims !== "object") return null;
  if (typeof claims.collectionId !== "string" || !claims.collectionId) return null;
  if (typeof claims.workspaceId !== "string" || !claims.workspaceId) return null;
  if (typeof claims.expiresAt !== "number" || !Number.isFinite(claims.expiresAt)) return null;

  if (claims.expiresAt <= now) return null;
  if (claims.collectionId !== expected.collectionId) return null;

  return {
    collectionId: claims.collectionId,
    workspaceId: claims.workspaceId,
    expiresAt: claims.expiresAt,
  };
}

/**
 * Mint a token for a collection the caller has ALREADY established belongs
 * to this workspace. Resolves the app's signing secret itself, so a caller
 * is one line.
 *
 * The `authSecret()` import is dynamic for the same reason the rest of this
 * codebase defers env reads (lib/auth/demo-access.ts's `demoAccessSecret`,
 * lib/auth/turnstile.ts): the auth module builds against Worker bindings,
 * and nothing that only wants a string should drag that in at module load.
 */
export async function mintCollectionDownloadToken(
  collectionId: string,
  workspaceId: string,
): Promise<string> {
  const { authSecret } = await import("./auth/auth");
  return mintDownloadToken({ collectionId, workspaceId }, await authSecret());
}

/** Verify a token from a URL against the collection that URL names. `null`
    means "no valid token here", which every caller treats the same as "no
    token at all". */
export async function verifyCollectionDownloadToken(
  token: string | null,
  collectionId: string,
): Promise<DownloadTokenClaims | null> {
  if (!token) return null;
  const { authSecret } = await import("./auth/auth");
  return verifyDownloadToken(token, await authSecret(), { collectionId });
}
