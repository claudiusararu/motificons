import { auth } from "./auth/auth";

/**
 * Who the current visitor is - the whole access model.
 *
 * Motificons is free, so the only question a server route ever has to ask is
 * "is somebody signed in": the library, every export format and every tool
 * are open to anonymous visitors, while collections and API keys hang off an
 * account because they need somewhere to live, not because they cost
 * anything.
 *
 * Most routes never need this function: `Astro.locals.user` (populated by
 * src/middleware.ts on every SSR request) already answers the same question
 * for free, and `lib/workspace/session-workspace.ts` wraps it for the
 * collections/keys routes. This exists for the one caller that has no
 * middleware-populated locals to lean on - `api/entitlements.ts`, fetched
 * client-side from edge-cached pages.
 */
export interface ResolvedAccount {
  signedIn: boolean;
  /** The signed-in visitor's account email. Absent when signed out. */
  email?: string;
}

/** The signed-out answer - also what a failed session lookup degrades to,
    since nothing about the library is gated and "we could not read your
    session" must never render as a 500. */
const ANONYMOUS: ResolvedAccount = { signedIn: false };

/**
 * Resolves `ctx` to an account.
 *
 * `ctx` is any object carrying the incoming `Request` - an Astro
 * `APIContext` satisfies it as-is. When it also carries `locals` (every SSR
 * route does, and middleware has already filled in `user` by the time a
 * route body runs) that answer is authoritative and this costs nothing;
 * `locals.user === null` means "middleware looked and there is no session",
 * not "unknown". Without `locals`, the Better Auth session is read from the
 * request headers instead - one D1 lookup.
 *
 * Never throws: a broken session lookup resolves to signed-out, because
 * nothing here decides whether a visitor may do something, only whose data
 * to show them.
 */
export async function resolveAccount(ctx: {
  request: Request;
  locals?: { user?: { email?: string | null } | null };
}): Promise<ResolvedAccount> {
  if (ctx.locals && "user" in ctx.locals) {
    return accountFor(ctx.locals.user);
  }

  try {
    const instance = await auth();
    const session = await instance.api.getSession({ headers: ctx.request.headers });
    return accountFor(session?.user);
  } catch {
    return ANONYMOUS;
  }
}

function accountFor(user: { email?: string | null } | null | undefined): ResolvedAccount {
  if (!user) return ANONYMOUS;
  return { signedIn: true, ...(user.email ? { email: user.email } : {}) };
}
