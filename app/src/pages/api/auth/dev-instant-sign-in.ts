import type { APIRoute } from "astro";
import { auth } from "../../../lib/auth/auth";

export const prerender = false;

/**
 * DEV-ONLY instant sign-in - internal QA tooling, not part of the product
 * flow.
 *
 * TOOLING-ONLY: AuthCard.tsx used to auto-navigate here right after submitting
 * the sign-in form, under `import.meta.env.DEV`. It no longer does - the
 * form flow is the real magic-link flow everywhere now (submit -> "Check
 * your email" -> click the emailed link), with no shortcut past it. This
 * endpoint stays only as a way for headless QA scripts to sign in without
 * reading an inbox: a normal
 * `authClient.signIn.magicLink()` call mints a real verification token and,
 * via auth.ts's `sendMagicLink` callback, captures it into
 * dev-magic-link.ts; this handler takes it back and hands it to Better
 * Auth's own `magicLinkVerify` endpoint with `asResponse: true` - the exact
 * same code path a visitor clicking the emailed link would hit, so the
 * resulting user (created if new - which fires the personal-workspace
 * databaseHooks.user.create.after hook exactly like a real sign-in) and
 * session are real D1 rows, and the Response carries a real Set-Cookie plus
 * a 302 to /dashboard, not a hand-rolled session or mock data.
 *
 * Guarded twice: this file 404s outright when `import.meta.env.DEV` is
 * false (Vite hard-codes that to `false` in a production build, so this
 * check compiles away to dead code there), and dev-magic-link.ts's map is
 * only ever populated from the same DEV-guarded branch in auth.ts.
 */
export const GET: APIRoute = async ({ request, url }) => {
  if (!import.meta.env.DEV) {
    return new Response("Not found", { status: 404 });
  }

  const email = url.searchParams.get("email")?.trim();
  if (!email) {
    return new Response("Missing email", { status: 400 });
  }

  const { take } = await import("../../../lib/auth/dev-magic-link");
  const token = take(email);
  if (!token) {
    return new Response(
      "No pending magic link for that email - submit the sign-in/register form first.",
      { status: 409 },
    );
  }

  const instance = await auth();
  return instance.api.magicLinkVerify({
    query: { token, callbackURL: "/dashboard" },
    headers: request.headers,
    asResponse: true,
  });
};
