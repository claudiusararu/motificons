import { defineMiddleware } from "astro:middleware";
import { auth } from "./lib/auth/auth";

/**
 * Populates `Astro.locals.user`/`.session` from the Better Auth session
 * cookie, for every SSR route (prerendered pages never reach this - see
 * env.d.ts). Real cost here is one D1 lookup per SSR request; that is every
 * route that currently opts out of prerendering (/search, /api/*, and now
 * /sign-in), which is already the small slice of the site that pays for
 * per-request work.
 *
 * The header's signed-in state does NOT read these locals - it is a client
 * island (AuthMenu.tsx) so it renders identically on prerendered pages (most
 * of the site) and SSR pages alike, rather than forking behavior by route
 * type. `locals.user` is for server-side logic that needs the identity
 * before it renders anything, e.g. redirecting a signed-in visitor away from
 * /sign-in below, and the account dashboard's auth gate.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  try {
    const instance = await auth();
    const result = await instance.api.getSession({
      headers: context.request.headers,
    });
    context.locals.user = result?.user ?? null;
    context.locals.session = result?.session ?? null;
  } catch {
    /* A broken session lookup must not take the whole route down - render
       signed-out rather than 500. */
    context.locals.user = null;
    context.locals.session = null;
  }

  return next();
});
