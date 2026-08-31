import { useEffect, useState } from "react";
import { readCached, writeCached } from "../../lib/entitlements-cache";

/**
 * Who is looking at this page - the only session question the client asks.
 *
 * The product is free: every icon, every export format and every tool works
 * signed out, so nothing here decides what a visitor may DO. It only says
 * whose collections and API key a surface should show, so the handful of
 * account-shaped controls (the save star, the account menu) can prompt for
 * a free account instead of failing.
 *
 * One fetch per island tree: whichever component owns a grid or a page does
 * the call and threads the answer down, rather than every tile firing its
 * own request.
 */
export interface Account {
  /** Whether a real session is present. */
  signedIn: boolean;
  /** The signed-in visitor's account email, or null when signed out. */
  email: string | null;
  /** False until the first /api/entitlements response lands. Account
      controls stay in their signed-out shape while pending - the safe
      direction, since a control that offers to save and then cannot is
      worse than one that briefly offers to sign up. */
  ready: boolean;
}

/** The safe, neutral default - signed out, not ready. This is what BOTH the
    server render and the client's FIRST render must produce for every
    consumer of this hook that renders into SSR markup (the edge-cached
    icon/set/category/tools/home pages - one shared HTML response for every
    visitor, so nothing per-visitor can be baked into it at all): identical
    first paints mean nothing to reconcile, so no hydration mismatch is
    possible by construction. */
function defaultAccount(): Account {
  return { signedIn: false, email: null, ready: false };
}

export function useAccount(): Account {
  const [state, setState] = useState<Account>(defaultAccount);

  /* Anti-flash cache guess (entitlements-cache.ts's shared `mfc-ent` key),
     applied in an effect AFTER mount - never in the initial state, so the
     guess can never itself become a hydration mismatch. `ready` stays false
     throughout this seed - its contract
     ("the real fetch hasn't landed yet") is unchanged, so nothing
     downstream that gates on it needs to know the cache exists. */
  useEffect(() => {
    const cached = readCached();
    if (!cached) return;
    setState((current) =>
      current.ready ? current : { signedIn: cached.signedIn, email: cached.email, ready: false },
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/entitlements")
      .then((response) => (response.ok ? response.json() : { signedIn: false, email: null }))
      .then((data: { signedIn?: boolean; email?: string | null }) => {
        if (cancelled) return;
        const next = { signedIn: Boolean(data.signedIn), email: data.email ?? null };
        setState({ ...next, ready: true });
        writeCached(next);
      })
      .catch(() => {
        if (!cancelled) setState({ signedIn: false, email: null, ready: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
