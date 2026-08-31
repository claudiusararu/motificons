import { useEffect, useRef, useState } from "react";
import { createAuthClient } from "better-auth/react";
import { clearCached, readCached } from "../../lib/entitlements-cache";

const authClient = createAuthClient();

/** Matches Button.astro's ghost/sm rendering exactly, so there is no visible
    difference between this island's initial paint and the plain "Sign in"
    link the rest of the header renders elsewhere pre-hydration. */
const SIGN_IN_LINK_CLASS =
  "relative inline-flex items-center justify-center gap-2.5 rounded-control px-4 py-[10px] text-body font-semibold text-ink-muted no-underline transition-colors duration-[120ms] ease-in hover:text-ink press-sm";

/** The signed-in avatar trigger's own classes, pulled out so the
    anti-flash placeholder below (a non-interactive guess at the same shape)
    can reuse them verbatim instead of duplicating the string. */
const AVATAR_BUTTON_CLASS =
  "touch-target press-sm inline-flex size-11 items-center justify-center rounded-full border-2 border-ink bg-primary text-body font-bold text-ink md:size-10";

function initialOf(name: string | null | undefined, email: string): string {
  const source = name?.trim() || email;
  return source.slice(0, 1).toUpperCase() || "?";
}

export interface AuthMenuInitialState {
  signedIn: boolean;
  name?: string | null;
  email?: string | null;
}

/**
 * The header's signed-in state.
 *
 * A client island rather than server-derived from `Astro.locals` on
 * purpose for MOST of the site: it is prerendered/edge-cached (the
 * crawlable pages are never gated) - one shared HTML response for every
 * visitor - so baking a
 * real per-visitor answer into that markup would leak one visitor's signed-
 * in state to everyone else served the same cached page. Those pages pass
 * no `initialState`; this renders the neutral default on both the server
 * and the client's first paint (nothing to flash away from), then applies
 * the `mfc-ent` cache guess - display only, still just a guess - in an
 * effect AFTER mount, never in the initial render, so that guess can never
 * itself become a hydration mismatch (it used to
 * seed the initial `useState`, which meant a returning visitor's first
 * CLIENT render could differ from the server's neutral one whenever the
 * cache said "signed in" - React logs that as a hydration error and never
 * patches it up).
 *
 * `initialState` is for the OTHER kind of page: per-user SSR routes that
 * are never cached (dashboard.astro, collections/[id].astro - both already
 * set `Cache-Control: private, no-store` and already resolve
 * `Astro.locals.user` server-side before rendering anything). Those pass
 * the real, already-known answer down as a prop, so the server HTML and the
 * client's first paint are identical BY CONSTRUCTION - no cache, no guess,
 * no post-mount correction needed at all on those two pages.
 */
export default function AuthMenu({ initialState }: { initialState?: AuthMenuInitialState } = {}) {
  const { data, isPending } = authClient.useSession();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  /* Anti-flash seed (entitlements-cache.ts's shared `mfc-ent` key) -
     applied here, in an effect, not in the initial state (see the doc
     comment above) - only meaningful when the caller did not already pass
     `initialState` (a page that can answer for real has no reason to
     guess). Picks the closer-looking placeholder while
     authClient.useSession() is still pending: a confidently signed-out
     cache skips straight to the real "Sign in" link below, a confidently
     signed-in cache shapes the placeholder like the avatar button instead
     of the blank pill. Real session data (name, email) still waits for
     useSession() to resolve - this never fabricates a working menu from
     cached data alone. */
  const [cached, setCached] = useState<ReturnType<typeof readCached>>(null);
  useEffect(() => {
    if (!initialState) setCached(readCached());
  }, [initialState]);

  useEffect(() => {
    if (!open) return;

    function handlePointer(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  /* Server-known state wins outright on the pages that pass it - the real
     `authClient.useSession()` result still takes over once it resolves
     (`data.user` below), which normally just reconfirms the same visitor,
     but nothing here waits on that to render the real menu. */
  if (!initialState?.signedIn) {
    if ((!isPending && !data?.user) || (isPending && !initialState && cached?.signedIn === false)) {
      return (
        <a href="/sign-in" className={SIGN_IN_LINK_CLASS}>
          Sign in
        </a>
      );
    }

    if (!data?.user) {
      /* Session check still in flight: reserve the same slot the signed-out
         link occupies rather than showing nothing (a visible control that
         does nothing briefly beats a layout jump) - shaped like the avatar
         button instead when the cache above guesses signed-in, so the slot
         doesn't visibly change shape once the real session lands. */
      return (
        <span
          aria-hidden="true"
          className={isPending && !initialState && cached?.signedIn ? AVATAR_BUTTON_CLASS : SIGN_IN_LINK_CLASS}
        />
      );
    }
  }

  const user = data?.user;
  const name = user?.name ?? initialState?.name ?? null;
  const email = user?.email ?? initialState?.email ?? "";

  async function handleSignOut() {
    setSigningOut(true);
    clearCached();
    window.posthog?.reset();
    await authClient.signOut();
    window.location.href = "/";
  }

  return (
    <div ref={menuRef} className="relative">
      {/* size-11 (44px) below md - this now also renders inside the mobile
          nav panel (a mobile control needs the full 44px,
          the 36px dense-row exception is desktop-only) - back to the
          original size-10 (40px) at md and up, where it has always rendered
          in the header's top bar. */}
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={AVATAR_BUTTON_CLASS}
      >
        {initialOf(name, email)}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-64 rounded-card border-2 border-ink bg-surface p-2 shadow-card"
        >
          <div className="px-3 py-2">
            <p className="truncate text-body font-semibold text-ink">
              {name || "Signed in"}
            </p>
            <p className="truncate text-meta text-ink-muted">{email}</p>
          </div>
          <hr className="my-1 border-t border-ink/15" />
          <a
            role="menuitem"
            href="/dashboard"
            className="block w-full rounded-control px-3 py-2 text-left text-body font-semibold text-ink no-underline transition-colors duration-[120ms] ease-in hover:bg-canvas"
          >
            Dashboard
          </a>
          <hr className="my-1 border-t border-ink/15" />
          <button
            role="menuitem"
            type="button"
            disabled={signingOut}
            aria-busy={signingOut}
            onClick={handleSignOut}
            className="w-full rounded-control px-3 py-2 text-left text-body font-semibold text-ink transition-colors duration-[120ms] ease-in hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-[0.55]"
          >
            {signingOut ? "Signing out..." : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
