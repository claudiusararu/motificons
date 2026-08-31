import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react";
import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";
import { magicLinkErrorMessage } from "../../lib/auth/magic-link-errors";
import { useTurnstile, type Turnstile } from "./useTurnstile";

/* Same-origin, so no baseURL - the browser already knows where it is. */
const authClient = createAuthClient({ plugins: [magicLinkClient()] });

type Provider = "google" | "github" | "apple";

/** Which door this card is. Same engine underneath (one magic link creates
    the account on first click and signs in on every later one), but the two
    doors promise different things, so they say different things - and only
    "signin" gets the "no account here yet" answer from the server. */
export type AuthMode = "register" | "signin";

interface Props {
  providers: Record<Provider, boolean>;
  /** Where Better Auth lands the visitor after a successful sign-in. */
  callbackURL?: string;
  mode?: AuthMode;
  /** Cloudflare Turnstile site key, read server-side. Absent = widget off
      (the server is the one that decides whether a token is required). */
  turnstileSiteKey?: string;
  /** Prefill, used by the "create one?" hand-off from /sign-in. */
  initialEmail?: string;
}

/** "verifying" is the Turnstile check; "loading" is the request that follows
    it. Two states because they fail differently and the button says
    different things, not because the visitor has to care. */
type FormStatus =
  | "idle"
  | "verifying"
  | "loading"
  | "error"
  | "success"
  | "no-account";

/** Fallback only - the server sends this same sentence as `error.message`. */
const NO_ACCOUNT_FALLBACK = "No account for this email yet - create one?";

/* Verified against this repo's own icon data (pipeline/dist / @iconify/json)
   rather than typed from memory: a real brand mark has to be exactly right,
   not approximately right.
     google -> logos:google-icon (the four-color mark; Google's own sign-in
       branding guidelines require the full-color version, not the
       single-color "G")
     github, apple -> simple-icons, rendered in currentColor since both are
       single-color marks in official use. */

function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 256 262" aria-hidden="true">
      <path
        fill="#4285f4"
        d="M255.878 133.451c0-10.734-.871-18.567-2.756-26.69H130.55v48.448h71.947c-1.45 12.04-9.283 30.172-26.69 42.356l-.244 1.622l38.755 30.023l2.685.268c24.659-22.774 38.875-56.282 38.875-96.027"
      />
      <path
        fill="#34a853"
        d="M130.55 261.1c35.248 0 64.839-11.605 86.453-31.622l-41.196-31.913c-11.024 7.688-25.82 13.055-45.257 13.055c-34.523 0-63.824-22.773-74.269-54.25l-1.531.13l-40.298 31.187l-.527 1.465C35.393 231.798 79.49 261.1 130.55 261.1"
      />
      <path
        fill="#fbbc05"
        d="M56.281 156.37c-2.756-8.123-4.351-16.827-4.351-25.82c0-8.994 1.595-17.697 4.206-25.82l-.073-1.73L15.26 71.312l-1.335.635C5.077 89.644 0 109.517 0 130.55s5.077 40.905 13.925 58.602z"
      />
      <path
        fill="#eb4335"
        d="M130.55 50.479c24.514 0 41.05 10.589 50.479 19.438l36.844-35.974C195.245 12.91 165.798 0 130.55 0C79.49 0 35.393 29.301 13.925 71.947l42.211 32.783c10.59-31.477 39.891-54.251 74.414-54.251"
      />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12c0 5.303 3.438 9.8 8.205 11.385c.6.113.82-.258.82-.577c0-.285-.01-1.04-.015-2.04c-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729c1.205.084 1.838 1.236 1.838 1.236c1.07 1.835 2.809 1.305 3.495.998c.108-.776.417-1.305.76-1.605c-2.665-.3-5.466-1.332-5.466-5.93c0-1.31.465-2.38 1.235-3.22c-.135-.303-.54-1.523.105-3.176c0 0 1.005-.322 3.3 1.23c.96-.267 1.98-.399 3-.405c1.02.006 2.04.138 3 .405c2.28-1.552 3.285-1.23 3.285-1.23c.645 1.653.24 2.873.12 3.176c.765.84 1.23 1.91 1.23 3.22c0 4.61-2.805 5.625-5.475 5.92c.42.36.81 1.096.81 2.22c0 1.606-.015 2.896-.015 3.286c0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04c-2.04.027-3.91 1.183-4.961 3.014c-2.117 3.675-.546 9.103 1.519 12.09c1.013 1.454 2.208 3.09 3.792 3.039c1.52-.065 2.09-.987 3.935-.987c1.831 0 2.35.987 3.96.948c1.637-.026 2.676-1.48 3.676-2.948c1.156-1.688 1.636-3.325 1.662-3.415c-.039-.013-3.182-1.221-3.22-4.857c-.026-3.04 2.48-4.494 2.597-4.559c-1.429-2.09-3.623-2.324-4.39-2.376c-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83c-1.207.052-2.662.805-3.532 1.818c-.78.896-1.454 2.338-1.273 3.714c1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  );
}

function MailIcon({ className }: { className?: string }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 animate-spin ${className ?? ""}`}
    >
      <circle cx="12" cy="12" r="9" opacity="0.3" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}

/** Matches the AlertIcon used for form errors elsewhere (ApiKeySection.tsx,
    ResourceManager.tsx, etc.) - same circle-exclamation mark, same size, so
    a bad-magic-link notice reads as the same "error" visual language as the
    rest of the site instead of inventing a new one. */
function AlertIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mt-0.5 shrink-0"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5" />
      <path d="M12 16.5h.01" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 text-teal-deep"
    >
      <path d="m4 12.5 5.5 5.5L20 6.5" />
    </svg>
  );
}

const PROVIDER_LABEL: Record<Provider, string> = {
  google: "Continue with Google",
  github: "Continue with GitHub",
  apple: "Continue with Apple",
};

const PROVIDER_MARK: Record<Provider, () => React.JSX.Element> = {
  google: GoogleMark,
  github: GitHubMark,
  apple: AppleMark,
};

/** Matches Button.astro's secondary/default geometry - a plain .astro
    component cannot be used from a React island, so the classes are
    reproduced here (same convention as IconEditor.tsx/SvgTool.tsx). */
const OAUTH_BUTTON_CLASS =
  "press relative inline-flex w-full items-center justify-center gap-2.5 rounded-btn border-2 border-ink bg-surface px-6 py-[15px] text-body font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-[0.55]";

const SUBMIT_BUTTON_CLASS =
  "press relative inline-flex w-full items-center justify-center gap-2.5 rounded-btn border-2 border-ink bg-primary px-6 py-[15px] text-body font-semibold text-ink disabled:cursor-not-allowed";

/**
 * The Turnstile widget's host element.
 *
 * Rendered in EVERY state, never inside the form's branch: the widget is
 * bound to this DOM node, so unmounting it - which is what switching to the
 * success or "no account" card used to do - orphans the widget. The hook
 * would then hold an id whose node is gone, Cloudflare would log "Cannot
 * find Widget ...", and the next submission after "Try a different email"
 * could never get a token. Keeping one node alive for the island's whole
 * life keeps the widget reusable across retries.
 *
 * It occupies no space until Cloudflare decides a submission needs a visible
 * challenge, at which point the challenge appears at the top of the card
 * rather than covering anything.
 */
function TurnstileHost({ turnstile }: { turnstile: Turnstile }) {
  return <div ref={turnstile.containerRef} className="empty:hidden" />;
}

/**
 * The one card behind both doors, /sign-in and /register: OAuth buttons
 * (only for providers whose env vars are configured server-side -
 * `providers` comes from `configuredProviders()`) over a magic-link email
 * form. Full state set: loading, error, success, plus the sign-in-only
 * "no account" hand-off to /register.
 */
export default function AuthCard({
  providers,
  callbackURL = "/",
  mode = "signin",
  turnstileSiteKey,
  initialEmail = "",
}: Props) {
  const emailId = useId();
  const errorId = useId();

  const [oauthPending, setOauthPending] = useState<Provider | null>(null);
  const [oauthError, setOauthError] = useState("");

  const [email, setEmail] = useState(initialEmail);
  const [status, setStatus] = useState<FormStatus>("idle");
  const [formError, setFormError] = useState("");
  /* Guards the submit path against firing twice - see handleSubmit. */
  const submittingRef = useRef(false);

  /* Loads Cloudflare's widget script on mount, only on these two pages, and
     only when a site key was configured - see useTurnstile.ts for the
     third-party-script exception this is. OAuth stays out of it: those
     buttons send no email. */
  const turnstile = useTurnstile(turnstileSiteKey);

  /* Bad/expired magic-link notice - not a form-submit error (nothing was
     submitted on this pageview), so it gets its own state instead of
     reusing `formError`. Populated from ?error=... on mount, see the effect
     below; dismiss-free by design - it just goes away
     the moment the visitor types or submits again, same as `formError`
     already does. */
  const [linkNotice, setLinkNotice] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("error");
    if (!code) return;

    setLinkNotice(magicLinkErrorMessage(code));

    /* Clean the URL so a reload (or sharing the link) does not re-show a
       stale notice - dashboard.astro/sign-in.astro never read this param
       themselves, it exists only for this one-time read. */
    params.delete("error");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }, []);

  /* One flag for "a submission is in flight", so the human check and the
     request that follows it disable the button the same way. This drives the
     UI; `submittingRef` below is what actually enforces one request. */
  const busy = status === "verifying" || status === "loading";

  const enabledProviders = (
    Object.entries(providers) as [Provider, boolean][]
  )
    .filter(([, enabled]) => enabled)
    .map(([provider]) => provider);
  const hasOAuth = enabledProviders.length > 0;

  async function handleOAuth(provider: Provider) {
    setOauthError("");
    setOauthPending(provider);
    const { error } = await authClient.signIn.social({
      provider,
      callbackURL,
    });
    if (error) {
      setOauthPending(null);
      setOauthError(error.message ?? "Could not start sign-in. Try again.");
    }
    /* On success the browser is mid-navigation to the provider - nothing
       left to do here. */
  }

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;

    /* EXACTLY ONE request may leave this form per submission. A ref, not the
       `busy` state: state updates are asynchronous, so two submit events in
       the same tick (a click plus Enter, a double click, a duplicated
       handler) would both read `busy === false` and both post. A second
       request would also orphan the first challenge's token. */
    if (submittingRef.current) return;
    submittingRef.current = true;

    setFormError("");
    setLinkNotice("");

    /* The human check runs first and takes real time (script, widget, then
       the challenge), so it gets its own visible state instead of a button
       that looks idle while the click is being processed. With no site key
       configured there is nothing to wait for, so that state is skipped
       rather than flashed. */
    setStatus(turnstileSiteKey ? "verifying" : "loading");

    /* Waits for the widget and the challenge inside one deadline - see
       useTurnstile.ts. Null here means Turnstile is off, or it genuinely
       failed/timed out; it never means "not started yet", which is what used
       to refuse a legitimate fast first click. Not a client-side refusal
       either way: the server refuses a missing token whenever its secret is
       set, so the decision stays in one place. */
    try {
      const token = await turnstile.getToken();
      setStatus("loading");

      /* Both extras ride as headers so Better Auth's own body schema stays
         untouched - see the auth route's MODE_HEADER/TURNSTILE_HEADER note. */
      const headers: Record<string, string> = { "x-auth-mode": mode };
      if (token) headers["x-turnstile-token"] = token;

      const { error } = await authClient.signIn.magicLink(
        { email: trimmed, callbackURL },
        { headers },
      );

      if (error) {
        if (error.code === "NO_ACCOUNT") {
          setStatus("no-account");
          setFormError(error.message ?? NO_ACCOUNT_FALLBACK);
          return;
        }
        setStatus("error");
        setFormError(error.message ?? "Something went wrong. Try again.");
        return;
      }

      /* Real flow everywhere: the call above already sent the email, so this
         always lands on the "Check your email" state below and waits for the
         visitor to click the link. No DEV auto-navigation any more -
         /api/auth/dev-instant-sign-in still exists (still DEV-gated, still
         404s in prod) but as an internal QA tool headless scripts call
         directly; nothing in this UI references it. */
      setStatus("success");
    } finally {
      /* Released however the attempt ended, so a visitor who lands back on
         the form (error, or "try a different email") can submit again. */
      submittingRef.current = false;
    }
  }

  /* Same layout on both doors, different words: the register door promises
     an account at the end of the click, the sign-in door promises a way back
     in. Nothing else about the state changes. */
  if (status === "success") {
    return (
      <>
        <TurnstileHost turnstile={turnstile} />
      <div role="status" className="flex flex-col items-center gap-4 py-4 text-center">
        <span className="flex size-14 items-center justify-center rounded-full border-2 border-ink bg-teal">
          <CheckIcon />
        </span>
        <div>
          <h2 className="text-h3 font-bold">Check your email</h2>
          {mode === "register" ? (
            <p className="mt-2 text-body text-ink-muted">
              We sent a confirmation link to{" "}
              <strong className="text-ink">{email}</strong>. Click it and your
              account is ready. The link expires in 5 minutes.
            </p>
          ) : (
            <p className="mt-2 text-body text-ink-muted">
              We sent a sign-in link to{" "}
              <strong className="text-ink">{email}</strong>. It expires in 5
              minutes.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setStatus("idle");
            setFormError("");
          }}
          className="min-h-[44px] px-3 text-meta font-semibold text-blue-deep underline underline-offset-2"
        >
          Use a different email
        </button>
      </div>
      </>
    );
  }

  /* Sign-in door only: the email has no account here, so nothing was sent
     and there is no inbox to wait on. The next action is the whole point of
     the state, so it is a real button, not a sentence with a link in it. */
  if (status === "no-account") {
    return (
      <>
        <TurnstileHost turnstile={turnstile} />
      <div role="status" className="flex flex-col items-center gap-5 py-4 text-center">
        <span className="flex size-14 items-center justify-center rounded-full border-2 border-ink bg-surface text-ink">
          <MailIcon />
        </span>
        <div>
          <h2 className="text-h3 font-bold">{formError || NO_ACCOUNT_FALLBACK}</h2>
          <p className="mt-2 text-body text-ink-muted">
            We found no account for{" "}
            <strong className="text-ink">{email}</strong>. Accounts are free
            and take one click.
          </p>
        </div>
        <a
          href={`/register?email=${encodeURIComponent(email.trim())}`}
          className={SUBMIT_BUTTON_CLASS}
        >
          Create a free account
        </a>
        <button
          type="button"
          onClick={() => {
            setStatus("idle");
            setFormError("");
          }}
          className="min-h-[44px] px-3 text-meta font-semibold text-blue-deep underline underline-offset-2"
        >
          Try a different email
        </button>
      </div>
      </>
    );
  }

  return (
    <>
      <TurnstileHost turnstile={turnstile} />
    <div className="flex flex-col gap-6">
      {linkNotice && (
        <p
          role="alert"
          className="flex items-start gap-3 rounded-control border-2 border-danger bg-surface px-5 py-4 text-body text-danger"
        >
          <AlertIcon />
          {linkNotice}
        </p>
      )}

      {hasOAuth && (
        <div className="flex flex-col gap-3">
          {enabledProviders.map((provider) => {
            const Mark = PROVIDER_MARK[provider];
            const isPending = oauthPending === provider;
            return (
              <button
                key={provider}
                type="button"
                onClick={() => handleOAuth(provider)}
                disabled={oauthPending !== null}
                aria-busy={isPending}
                className={OAUTH_BUTTON_CLASS}
              >
                {isPending ? <SpinnerIcon /> : <Mark />}
                {PROVIDER_LABEL[provider]}
              </button>
            );
          })}
          {oauthError && (
            <p role="alert" className="flex items-center gap-2 text-meta text-danger">
              {oauthError}
            </p>
          )}
        </div>
      )}

      {hasOAuth && (
        <div className="flex items-center gap-4 text-meta text-ink-muted">
          <span className="h-px flex-1 bg-ink/15" />
          or
          <span className="h-px flex-1 bg-ink/15" />
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="sr-only" htmlFor={emailId}>
            Email address
          </label>
          <div className="relative">
            <MailIcon className="pointer-events-none absolute left-6 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              id={emailId}
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (status === "error") setStatus("idle");
                if (linkNotice) setLinkNotice("");
              }}
              aria-invalid={status === "error" ? "true" : undefined}
              aria-describedby={status === "error" ? errorId : undefined}
              className={`w-full appearance-none rounded-pill border-2 bg-surface py-[18px] pr-6 pl-[55px] text-body text-ink transition-shadow duration-[120ms] ease-in placeholder:text-ink-muted focus:shadow-card ${
                status === "error" ? "border-danger" : "border-ink"
              }`}
            />
          </div>
          {status === "error" && (
            <p
              id={errorId}
              role="alert"
              className="mt-3 flex items-center gap-2 pl-6 text-meta text-danger"
            >
              {formError}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={busy}
          aria-disabled={busy}
          aria-busy={busy}
          className={SUBMIT_BUTTON_CLASS}
        >
          {busy && <SpinnerIcon />}
          {status === "verifying"
            ? "Checking..."
            : mode === "register"
              ? "Create my free account"
              : "Send magic link"}
        </button>
      </form>
    </div>
    </>
  );
}
