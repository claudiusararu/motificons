/**
 * Plain-language copy for the `?error=` code Better Auth's magic-link plugin
 * appends to its redirect when `/magic-link/verify` cannot honor a token.
 *
 * Verified against this repo's actual dependency (not guessed): the plugin
 * source at `better-auth@1.6.26`'s `plugins/magic-link/index.mjs` calls
 * `redirectWithError("INVALID_TOKEN")` for every "no usable token" case - a
 * missing token, an already-consumed one, AND an expired one. There is no
 * separate `EXPIRED_TOKEN` code in this version: `internal-adapter.mjs`'s
 * `consumeVerificationValue` treats a row past its `expiresAt` as already
 * invalid, deletes it, and returns `null` exactly like a token that was
 * never valid, so the plugin's `if (!tokenValue) redirectWithError(...)`
 * branch cannot tell the two apart. The plugin's only other codes
 * (`failed_to_create_user`, `new_user_signup_disabled`,
 * `failed_to_create_session`) are unrelated to a bad token and fall through
 * to the generic message below, same as any future/unknown code.
 */
export function magicLinkErrorMessage(code: string): string {
  if (code === "INVALID_TOKEN") {
    return "That sign-in link is invalid or has expired. Enter your email below and we will send you a fresh one.";
  }
  return "That sign-in link did not work. Request a new one below.";
}
