import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { db, schema } from "../../db/client";
import { createPersonalWorkspace } from "./workspace";
import { resolveMailer } from "./mailer";
import { SITE_ORIGIN } from "../seo";

/**
 * The Better Auth instance, lazily built once per isolate.
 *
 * Same reasoning as `storage()`/`db()`: bindings and secrets only exist
 * inside a request-ish context in Workers, so construction is deferred
 * behind a cached promise rather than built at module load.
 *
 * Providers: magic link always on (the only flow this app can fully test
 * without third-party app registrations); Google/GitHub/Apple wire up only
 * when their env vars are present - buttons render only for providers whose
 * env vars exist, checked again in sign-in.astro to decide
 * what to render.
 */

interface AuthEnv {
  DB?: unknown;
  BETTER_AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  APPLE_CLIENT_ID?: string;
  APPLE_CLIENT_SECRET?: string;
  APPLE_APP_BUNDLE_IDENTIFIER?: string;
}

/** Insecure on purpose - dev only, never reachable in a production build
    because `authEnv().BETTER_AUTH_SECRET` missing throws there instead. */
const DEV_SECRET_FALLBACK =
  "dev-only-insecure-secret-do-not-use-in-production-000000";

async function authEnv(): Promise<AuthEnv> {
  const { env } = (await import("cloudflare:workers")) as unknown as {
    env: AuthEnv;
  };
  return env ?? {};
}

/** Which OAuth providers are configured, for the auth config AND for the
    sign-in page's conditional rendering - one source so they cannot drift. */
export async function configuredProviders(): Promise<{
  google: boolean;
  github: boolean;
  apple: boolean;
}> {
  const env = await authEnv();
  return {
    google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
    apple: Boolean(env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET),
  };
}

async function baseURL(): Promise<string> {
  if (import.meta.env.DEV) {
    const { devOrigin } = await import("./dev-origin");
    return devOrigin();
  }
  return SITE_ORIGIN;
}

/**
 * The Better Auth secret, resolved the same way `buildAuth()` resolves it
 * (env var, falling back to `DEV_SECRET_FALLBACK` in dev, throwing in
 * production when unset) - exported so other server code that needs to
 * sign/verify something with the same secret does not duplicate that
 * fallback/throw logic. No caller today - it exists so the next one does not
 * re-derive the secret by hand.
 */
export async function authSecret(): Promise<string> {
  const env = await authEnv();
  const secret = env.BETTER_AUTH_SECRET ?? (import.meta.env.DEV ? DEV_SECRET_FALLBACK : undefined);
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET is required in production. Set it with `wrangler secret put BETTER_AUTH_SECRET` (generate one with `openssl rand -base64 32`).",
    );
  }
  return secret;
}

export type Auth = Awaited<ReturnType<typeof buildAuth>>;
/** The exact session/user shape this instance's config produces (magic link
    + whichever OAuth providers are configured) - used by env.d.ts to type
    `Astro.locals.user`/`.session` without duplicating the derivation. */
export type SessionInfer = Auth["$Infer"]["Session"];

async function buildAuth() {
  const env = await authEnv();
  const database = await db();
  const secret = await authSecret();

  const providers = await configuredProviders();

  return betterAuth({
    baseURL: await baseURL(),
    secret,
    /* Cost/latency: cache
       the session in a signed cookie for 600s so `auth.api.getSession()` -
       called on every SSR request by middleware.ts, plus once more per call
       site below - skips its D1 lookup for that window instead of hitting
       the `session`/`user` tables on routine navigation. Shape verified
       against @better-auth/core's `init-options.d.mts` (`session.cookieCache
       .{enabled,maxAge}`), not guessed. */
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 600,
      },
    },
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
      /* D1 has no interactive multi-statement transaction support through
         drizzle; the adapter runs its operations sequentially instead. */
      transaction: false,
    }),
    socialProviders: {
      ...(providers.google && {
        google: {
          clientId: env.GOOGLE_CLIENT_ID!,
          clientSecret: env.GOOGLE_CLIENT_SECRET!,
        },
      }),
      ...(providers.github && {
        github: {
          clientId: env.GITHUB_CLIENT_ID!,
          clientSecret: env.GITHUB_CLIENT_SECRET!,
        },
      }),
      /* clientSecret here is a pre-generated ES256 JWT (team id + key id +
         .p8 key), not a static dashboard value - Apple has no long-lived
         secret to copy-paste. Better Auth does not synthesize it from raw
         key material, so it must be minted out-of-band (Apple's docs show
         the `jose` recipe) and rotated before its <=6-month expiry. That
         generation step is deliberately out of scope here: there is no real
         Apple Services ID to test against yet, and the button correctly
         stays hidden until APPLE_CLIENT_ID/APPLE_CLIENT_SECRET are set. */
      ...(providers.apple && {
        apple: {
          clientId: env.APPLE_CLIENT_ID!,
          clientSecret: env.APPLE_CLIENT_SECRET!,
          appBundleIdentifier: env.APPLE_APP_BUNDLE_IDENTIFIER,
        },
      }),
    },
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url, token }) => {
          /* DEV-ONLY QA tooling capture - the real flow (AuthCard.tsx) never
             reads this; only headless test scripts do, via
             api/auth/dev-instant-sign-in.ts. Capture the token the plugin
             just minted so that endpoint can consume it immediately instead
             of an inbox. import.meta.env.DEV is Vite/Astro's build-time flag
             (false in production, verified false in the built bundle), so
             this branch and its import are gone from the production
             bundle. */
          if (import.meta.env.DEV) {
            const { remember } = await import("./dev-magic-link");
            remember(email, token);
          }
          const mailer = await resolveMailer();
          await mailer.sendMagicLink(email, url);
        },
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          /* Auto-create the personal workspace + owner membership
             on first sign-in. This hook fires exactly once per user - when
             their row is first inserted - never on a returning sign-in. */
          after: async (user) => {
            await createPersonalWorkspace(
              database,
              user.id,
              user.name || user.email,
            );
          },
        },
      },
    },
  });
}

let cached: Promise<Auth> | null = null;

export function auth(): Promise<Auth> {
  cached ??= buildAuth();
  return cached;
}
