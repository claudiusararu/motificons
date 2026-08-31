import { useCallback, useEffect, useRef } from "react";

/**
 * Cloudflare Turnstile, client half.
 *
 * THIRD-PARTY SCRIPT, ON PURPOSE. The convention (AGENTS.md) is to
 * self-host assets and load nothing from a third-party CDN at runtime. This
 * is the one approved exception: Turnstile's widget cannot be self-hosted - the
 * challenge is served and scored by Cloudflare - and Cloudflare is already
 * this site's host, so no new party learns anything it did not already see.
 * The script is loaded ONLY from this hook, which only ever mounts inside
 * AuthCard on /register and /sign-in, and only when a site key exists. No
 * other page pays for it.
 *
 * Widget mode: rendered explicitly with `execution: "execute"` and
 * `appearance: "interaction-only"`, so nothing is visible and no work is
 * done until the visitor actually submits the form - and a visible challenge
 * appears only for the rare submission Cloudflare wants to look at.
 *
 * THE RULE THIS HOOK EXISTS TO ENFORCE (bug found in PM verification,
 * 2026-08-31): when a site key is configured, the form must NEVER post
 * token-less. Loading challenges.cloudflare.com and rendering the widget
 * takes a moment; a visitor who types fast and hits submit inside that
 * moment used to get a "we could not verify you are human" refusal on a
 * perfectly legitimate first click. So `getToken()` now WAITS - for the
 * widget to exist, then for the challenge to answer - inside one deadline,
 * and only gives up (null) if the widget really fails or the deadline
 * passes. `null` from a configured widget therefore means a real failure,
 * which is exactly when that error message is the true one.
 */

/**
 * Cloudflare's own handshake for explicit rendering: api.js calls this global
 * once it is fully initialized, and that callback is the ONLY moment
 * `turnstile.render()` is safe to call.
 *
 * `turnstile.ready()` is deliberately never used. Calling it right after
 * inserting the script tag - which is the only time this hook could - makes
 * api.js log "turnstile.ready() would break if called *before* the Turnstile
 * api.js script is loaded by visitors" and never run the callback, so the
 * widget never rendered, every submission fell through token-less, and the
 * server refused a real visitor's first click. The global is defined BEFORE
 * the tag is inserted so the callback cannot be missed.
 */
const ONLOAD_CALLBACK = "__motificonsTurnstileOnload";

const SCRIPT_SRC = `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=${ONLOAD_CALLBACK}`;

/** One budget for the whole acquisition - script load, widget render, and
    the challenge itself. Long enough that a slow network or a visible
    interactive challenge still completes, short enough that a wedged widget
    ends in a real error state instead of a spinner nobody can escape. */
export const TURNSTILE_TIMEOUT_MS = 15_000;

/** Note the absence of `ready` - see ONLOAD_CALLBACK. Leaving it off the type
    is what keeps it from being reached for again. */
interface TurnstileApi {
  render(
    container: HTMLElement,
    params: {
      sitekey: string;
      execution?: "render" | "execute";
      appearance?: "always" | "execute" | "interaction-only";
      callback?: (token: string) => void;
      "error-callback"?: (code?: string) => void;
      "timeout-callback"?: () => void;
      "expired-callback"?: () => void;
    },
  ): string;
  execute(widget: string | HTMLElement): void;
  reset(widget: string | HTMLElement): void;
  remove(widget: string | HTMLElement): void;
}

function turnstileApi(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile;
}

/** Set only from the onload callback, so "the API exists" can never be
    confused with "the API is ready" - api.js defines `window.turnstile`
    before it has finished initializing. */
let loadedApi: TurnstileApi | null = null;

/** One loader per document, shared by both islands if they ever coexist. */
let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    if (loadedApi) {
      resolve(loadedApi);
      return;
    }

    /* Defined first, tag inserted second - never the other way round. */
    (window as unknown as Record<string, unknown>)[ONLOAD_CALLBACK] = () => {
      loadedApi = turnstileApi() ?? null;
      if (loadedApi) resolve(loadedApi);
      else reject(new Error("turnstile-missing"));
    };

    /* A tag can already be here after a hot reload re-evaluated this module
       and reset `scriptPromise`. Inserting a second one makes api.js
       complain, so reuse the first: either it has finished (the API is
       there) or the callback above will catch it when it does. */
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src^="https://challenges.cloudflare.com/turnstile/"]',
    );
    if (existing) {
      const api = turnstileApi();
      if (api) {
        loadedApi = api;
        resolve(api);
      }
      return;
    }

    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("error", () =>
      reject(new Error("turnstile-script")),
    );
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/**
 * The submit-time sequence, pure and injectable so the ordering can be
 * tested without a browser: wait for the widget, THEN run the challenge,
 * both inside one shared deadline.
 *
 * Returns `null` in exactly three cases - no site key configured, the widget
 * never became usable, or the deadline passed. It never returns `null`
 * merely because the widget was still starting up, which is the bug this
 * function exists to make impossible.
 */
export async function acquireTurnstileToken({
  configured,
  waitForWidget,
  execute,
  budgetMs = TURNSTILE_TIMEOUT_MS,
  now = Date.now,
}: {
  /** False = no site key, so there is nothing to wait for. */
  configured: boolean;
  waitForWidget: (timeoutMs: number) => Promise<boolean>;
  execute: (timeoutMs: number) => Promise<string | null>;
  budgetMs?: number;
  now?: () => number;
}): Promise<string | null> {
  if (!configured) return null;

  const deadline = now() + budgetMs;

  const ready = await waitForWidget(budgetMs);
  if (!ready) return null;

  const left = deadline - now();
  if (left <= 0) return null;

  return execute(left);
}

export interface Turnstile {
  /** Attach to the (empty, zero-height) element the widget renders into. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /**
   * Runs the challenge and resolves with a token. Resolves `null` only when
   * Turnstile is not configured, or the widget failed/timed out - see
   * `acquireTurnstileToken`. The server still has the final say: it refuses
   * a missing token whenever its secret is set, so there is one source of
   * truth and the client never pretends to make the decision.
   */
  getToken: () => Promise<string | null>;
}

type Phase = "starting" | "ready" | "failed";

export function useTurnstile(siteKey?: string): Turnstile {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const phaseRef = useRef<Phase>("starting");
  /** Submissions parked until the widget exists (or gives up). */
  const waitersRef = useRef<((ready: boolean) => void)[]>([]);
  /** Resolver for the challenge currently in flight, if any. */
  const pendingRef = useRef<((token: string | null) => void) | null>(null);
  /** A widget rendered with execution:"execute" must not be reset before its
      first run - only between runs, since a token is single-use. */
  const executedRef = useRef(false);

  /** Moves the widget out of "starting" exactly once and releases everyone
      waiting on it. */
  const settlePhase = useCallback((phase: "ready" | "failed") => {
    if (phaseRef.current !== "starting") return;
    phaseRef.current = phase;
    const waiters = waitersRef.current;
    waitersRef.current = [];
    for (const waiter of waiters) waiter(phase === "ready");
  }, []);

  const waitForWidget = useCallback(
    (timeoutMs: number): Promise<boolean> => {
      if (phaseRef.current === "ready") return Promise.resolve(true);
      if (phaseRef.current === "failed") return Promise.resolve(false);

      return new Promise<boolean>((resolve) => {
        let done = false;
        const finish = (ready: boolean) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(ready);
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        waitersRef.current.push(finish);
      });
    },
    [],
  );

  const execute = useCallback((timeoutMs: number): Promise<string | null> => {
    const api = turnstileApi();
    const id = widgetIdRef.current;
    if (!api || !id) return Promise.resolve(null);

    return new Promise<string | null>((resolve) => {
      let done = false;
      const finish = (token: string | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        pendingRef.current = null;
        resolve(token);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      pendingRef.current = finish;

      try {
        /* Every submission needs its own token, so runs after the first
           start from a reset widget. */
        if (executedRef.current) api.reset(id);
        executedRef.current = true;
        api.execute(id);
      } catch {
        finish(null);
      }
    });
  }, []);

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;

    loadTurnstile()
      .then((api) => {
        if (cancelled || widgetIdRef.current) return;
        const container = containerRef.current;
        if (!container) {
          settlePhase("failed");
          return;
        }
        try {
          widgetIdRef.current = api.render(container, {
            sitekey: siteKey,
            execution: "execute",
            appearance: "interaction-only",
            callback: (token) => pendingRef.current?.(token),
            "error-callback": () => pendingRef.current?.(null),
            "timeout-callback": () => pendingRef.current?.(null),
            "expired-callback": () => pendingRef.current?.(null),
          });
          settlePhase("ready");
        } catch {
          settlePhase("failed");
        }
      })
      .catch(() => {
        /* Blocked, offline, or the script 404'd. Release the waiters with a
           real failure rather than leaving a submission hanging until the
           deadline. */
        if (!cancelled) settlePhase("failed");
      });

    return () => {
      cancelled = true;
      const api = turnstileApi();
      const id = widgetIdRef.current;
      const container = containerRef.current;
      widgetIdRef.current = null;
      executedRef.current = false;
      /* Only when the container is still in the document: if React has
         already detached it, Cloudflare's own widget node went with it and
         remove() just logs "Cannot find Widget ...". */
      if (api && id && container?.isConnected) {
        try {
          api.remove(id);
        } catch {
          /* Already gone. */
        }
      }
    };
  }, [siteKey, settlePhase]);

  const getToken = useCallback(
    () =>
      acquireTurnstileToken({
        configured: Boolean(siteKey),
        waitForWidget,
        execute,
      }),
    [siteKey, waitForWidget, execute],
  );

  return { containerRef, getToken };
}
