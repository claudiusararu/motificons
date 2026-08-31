/**
 * DEV-ONLY instant sign-in - production sends the email.
 *
 * A tiny module-scope capture point: auth.ts's `sendMagicLink` callback
 * hands every plugin-generated token to `remember()` (guarded by
 * `import.meta.env.DEV` at the call site), and the dev-instant-sign-in
 * endpoint calls `take()` to consume it moments later in the same request
 * flow, in the same isolate. One dev process, so a plain `Map` is enough -
 * this is never imported outside a DEV-guarded path, so it drops out of the
 * production bundle along with everything that reaches it.
 */

const tokensByEmail = new Map<string, string>();

export function remember(email: string, token: string): void {
  tokensByEmail.set(email, token);
}

/** Single-use, matching the token's own semantics (Better Auth consumes a
    magic-link token atomically on first verification). */
export function take(email: string): string | null {
  const token = tokensByEmail.get(email);
  if (!token) return null;
  tokensByEmail.delete(email);
  return token;
}
