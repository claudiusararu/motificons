import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import ConfirmDeleteModal from "./ConfirmDeleteModal";

export interface ApiKeySummary {
  id: string;
  keyPrefix: string;
  createdAt: string;
}

type CreateStatus = "idle" | "loading" | "error";
type CopyStatus = "idle" | "copied" | "error";
type ConfirmKind = "revoke" | "regenerate";

const BUTTON_BASE =
  "press relative inline-flex items-center justify-center gap-2 text-body font-semibold leading-[1.25] disabled:cursor-not-allowed disabled:opacity-[0.55]";
/* Blue, same construction as CollectionWorkspace.tsx's "Set collection
   styles": border-ink + hard shadow, blue-deep
   fill with white text, `on-navy` so the focus ring flips to yellow instead
   of disappearing against the dark fill (global.css's .on-navy). */
const BUTTON_BLUE = `${BUTTON_BASE} on-navy rounded-btn border-2 border-ink bg-blue-deep px-6 py-[15px] text-white`;
const BUTTON_SECONDARY_SM = `${BUTTON_BASE} press-sm rounded-control border-2 border-ink bg-surface px-4 py-[10px] text-ink`;
/* Green "copied" feedback, same construction as CollectionWorkspace.tsx's
   "Download collection": teal token fill with ink
   text - never teal-deep with white, which reads under 4.5:1. */
const BUTTON_TEAL_SM = `${BUTTON_BASE} press-sm rounded-control border-2 border-ink bg-teal px-4 py-[10px] text-ink`;
const BUTTON_DANGER_TEXT_SM = `${BUTTON_BASE} press-sm rounded-control border-2 border-ink bg-surface px-4 py-[10px] text-danger`;

function SpinnerIcon() {
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
      className="shrink-0 animate-spin"
    >
      <circle cx="12" cy="12" r="9" opacity="0.3" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}

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

/** Self-contained copy button - same idle/copied/error states and classes
    as the plaintext-key Copy button above, reused here for the two MCP
    config snippets so both surfaces read as one feedback pattern. */
function CopyButton({ text }: { text: string }) {
  const [status, setStatus] = useState<CopyStatus>("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
      window.setTimeout(() => setStatus((current) => (current === "copied" ? "idle" : current)), 2000);
    } catch {
      setStatus("error");
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={`${status === "copied" ? BUTTON_TEAL_SM : BUTTON_SECONDARY_SM} shrink-0`}
    >
      {status === "copied" ? "Copied" : status === "error" ? "Couldn't copy" : "Copy"}
    </button>
  );
}

/** The hosted MCP endpoint is `mcp.motificons.app` - in local development
    it is the mcp/ Worker's own dev port
    (mcp/README.md's "Local dev": `wrangler dev --port 8788`, chosen not to
    collide with app/'s 4321). `import.meta.env.DEV` is Vite's build-time
    flag, dead-code-eliminated in production - same pattern as every other
    DEV-ONLY branch in this codebase. */
const MCP_ENDPOINT = import.meta.env.DEV ? "http://localhost:8788/mcp" : "https://mcp.motificons.app/mcp";

/** Placeholder shown in the config snippets when there is no freshly-created
    plaintext key to embed (a returning visit - the real key is only ever
    shown once, see this file's own header comment) - a caller who pastes
    this literally gets a plain-language 401 from the MCP server itself, not
    a silent failure. */
const PLACEHOLDER_TOKEN = "mk_YOUR_API_KEY";

/** The `claude mcp add` one-liner - the no-file path for Claude Code users:
    one paste in any terminal, Claude Code writes its own config. Flag order
    follows `claude mcp add [options] <name> <url>`. */
function claudeCodeCommand(token: string): string {
  return `claude mcp add --transport http motificons ${MCP_ENDPOINT} --header "Authorization: Bearer ${token}"`;
}

function claudeCodeConfig(token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        motificons: {
          type: "http",
          url: MCP_ENDPOINT,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}

function cursorConfig(token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        motificons: {
          url: MCP_ENDPOINT,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}

/** Codex CLI (`~/.codex/config.toml`) reads a remote HTTP MCP server's
    bearer token from an environment variable, not a literal value inside
    the file itself (`bearer_token_env_var`, stable since Codex's streamable
    HTTP support landed) - unlike Claude Code/Cursor's JSON, there is no
    field here to embed the key in directly. The guide's caption under this
    block carries the one extra step (`export ...`) that follows from that. */
const CODEX_TOKEN_ENV_VAR = "MOTIFICONS_MCP_TOKEN";

function codexConfig(): string {
  return [
    "[mcp_servers.motificons]",
    `url = "${MCP_ENDPOINT}"`,
    `bearer_token_env_var = "${CODEX_TOKEN_ENV_VAR}"`,
  ].join("\n");
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * The API key section on /dashboard (right column of the Collections/API key
 * grid). One key per account for v1 (api/keys/index.ts enforces it
 * server-side; this component just reflects that shape) - create,
 * copy-once reveal, revoke, regenerate.
 *
 * The MCP setup guide (the hosted endpoint callout, copyable Claude
 * Code/Cursor/Codex config snippets) is layout-wise a SEPARATE, full-width
 * "Coding agents (MCP)" section below the grid - but it still needs `plaintext` below the moment a key is
 * created/regenerated, and that value is never persisted server-side or
 * re-fetchable (shown exactly once, see the field's own note below), so a
 * second independent island for it would only ever see the placeholder
 * token. Portalling into `mcpMountSelector` (dashboard.astro's
 * `#mcp-section-mount`, an empty div below the grid) keeps this ONE React
 * tree/one state owner while still rendering in two different places in the
 * page - the same technique TileStars.tsx uses to attach stars to
 * server-rendered tiles it does not otherwise own the position of.
 *
 * `initialKey` comes from the server (dashboard.astro already queries D1 for
 * everything else on this page - lib/workspace/api-keys.ts's
 * `getActiveApiKey`), so there is no loading flicker on first paint. The
 * plaintext, by contrast, can only ever come from a client-side create/
 * regenerate response - it is never fetched, never stored, shown exactly
 * once per the task's key model.
 */
export default function ApiKeySection({
  initialKey,
  mcpMountSelector,
}: {
  initialKey: ApiKeySummary | null;
  /** CSS selector for the empty div dashboard.astro renders below the grid,
      under the server-rendered "Coding agents (MCP)" heading - see the
      portal note above. */
  mcpMountSelector: string;
}) {
  const [key, setKey] = useState<ApiKeySummary | null>(initialKey);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  /* Client-only lookup (SSR has no `document`) - the target div is plain,
     already-server-rendered markup, always present by the time this effect
     runs, so a single lookup on mount is enough; no MutationObserver/rescan
     needed the way TileStars.tsx's dynamically-appended slots require. */
  const [mcpMount, setMcpMount] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setMcpMount(document.querySelector<HTMLElement>(mcpMountSelector));
  }, [mcpMountSelector]);

  const [createStatus, setCreateStatus] = useState<CreateStatus>("idle");
  const [createError, setCreateError] = useState("");

  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");

  const [confirming, setConfirming] = useState<ConfirmKind | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  async function createKey() {
    setCreateStatus("loading");
    setCreateError("");
    try {
      const response = await fetch("/api/keys", { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; key?: ApiKeySummary; plaintext?: string }
        | null;

      if (!response.ok || !payload?.key || !payload.plaintext) {
        setCreateStatus("error");
        setCreateError(payload?.error ?? "Could not create a key. Try again.");
        return;
      }

      setKey(payload.key);
      setPlaintext(payload.plaintext);
      setCopyStatus("idle");
      setCreateStatus("idle");
    } catch {
      setCreateStatus("error");
      setCreateError("Could not create a key. Try again.");
    }
  }

  async function copyPlaintext() {
    if (!plaintext) return;
    try {
      await navigator.clipboard.writeText(plaintext);
      setCopyStatus("copied");
      window.setTimeout(() => setCopyStatus((current) => (current === "copied" ? "idle" : current)), 2000);
    } catch {
      setCopyStatus("error");
    }
  }

  function openConfirm(kind: ConfirmKind) {
    setConfirming(kind);
    setActionError("");
  }

  function cancelConfirm() {
    setConfirming(null);
    setActionBusy(false);
    setActionError("");
  }

  async function confirmRevoke() {
    setActionBusy(true);
    setActionError("");
    try {
      const response = await fetch("/api/keys", { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setActionError(payload?.error ?? "Could not revoke. Try again.");
        setActionBusy(false);
        return;
      }
      setKey(null);
      setPlaintext(null);
      setConfirming(null);
      setActionBusy(false);
    } catch {
      setActionError("Could not revoke. Try again.");
      setActionBusy(false);
    }
  }

  async function confirmRegenerate() {
    setActionBusy(true);
    setActionError("");
    try {
      const response = await fetch("/api/keys/regenerate", { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; key?: ApiKeySummary; plaintext?: string }
        | null;

      if (!response.ok || !payload?.key || !payload.plaintext) {
        setActionError(payload?.error ?? "Could not regenerate. Try again.");
        setActionBusy(false);
        return;
      }

      setKey(payload.key);
      setPlaintext(payload.plaintext);
      setCopyStatus("idle");
      setConfirming(null);
      setActionBusy(false);
    } catch {
      setActionError("Could not regenerate. Try again.");
      setActionBusy(false);
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <p className="text-body text-ink-muted">
        This is the key your coding agent uses to reach your collections through Motificons&apos; MCP server.
      </p>

      {!key && (
        <div className="rounded-card border-2 border-ink bg-surface px-8 py-7 shadow-card">
          <p className="text-body font-semibold text-ink">No API key yet</p>
          <p className="mt-2 text-meta text-ink-muted">
            Create one when you&apos;re ready to connect an agent - you can revoke or replace it any time.
          </p>
          <button
            type="button"
            onClick={createKey}
            disabled={createStatus === "loading"}
            aria-busy={createStatus === "loading"}
            className={`${BUTTON_BLUE} mt-4`}
          >
            {createStatus === "loading" && <SpinnerIcon />}
            Create API key
          </button>
          {createStatus === "error" && (
            <p role="alert" className="mt-3 flex items-start gap-2 text-meta text-danger">
              <AlertIcon />
              {createError}
            </p>
          )}
        </div>
      )}

      {plaintext && (
        <div className="rounded-card border-2 border-ink bg-surface p-5">
          <p className="text-body font-semibold text-ink">Your API key</p>
          <p className="mt-1 text-meta text-danger">Copy it now - we only show it once.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-control border-2 border-ink bg-canvas px-4 py-3 text-meta text-ink whitespace-nowrap">
              {plaintext}
            </code>
            <button
              type="button"
              onClick={copyPlaintext}
              className={`${copyStatus === "copied" ? BUTTON_TEAL_SM : BUTTON_SECONDARY_SM} shrink-0`}
            >
              {copyStatus === "copied" ? "Copied" : copyStatus === "error" ? "Couldn't copy" : "Copy"}
            </button>
          </div>
          {copyStatus === "error" && (
            <p role="alert" className="mt-2 flex items-start gap-2 text-meta text-danger">
              <AlertIcon />
              Select the key above and copy it manually.
            </p>
          )}
          <p className="mt-3 text-meta text-ink-muted">
            Store it somewhere safe, like a password manager or your agent&apos;s config.
          </p>
        </div>
      )}

      {key && (
        <div className="flex items-center justify-between gap-4 rounded-card border-2 border-ink bg-surface px-5 py-4">
          <div className="flex flex-col gap-0.5">
            <code className="text-body font-semibold text-ink">{key.keyPrefix}...</code>
            <span className="text-pill text-ink-muted">Created {formatDate(key.createdAt)}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={() => openConfirm("regenerate")} className={BUTTON_SECONDARY_SM}>
              Regenerate
            </button>
            <button type="button" onClick={() => openConfirm("revoke")} className={BUTTON_DANGER_TEXT_SM}>
              Revoke
            </button>
          </div>
        </div>
      )}

      {confirming === "revoke" && (
        <ConfirmDeleteModal
          message="Revoke your API key? Your coding agent will lose access until you create a new one."
          confirmLabel="Yes, revoke"
          busy={actionBusy}
          error={actionError}
          onConfirm={confirmRevoke}
          onCancel={cancelConfirm}
        />
      )}

      {confirming === "regenerate" && (
        <ConfirmDeleteModal
          message="Regenerate your API key? The old key stops working right away and can't be recovered."
          confirmLabel="Yes, regenerate"
          busy={actionBusy}
          error={actionError}
          onConfirm={confirmRegenerate}
          onCancel={cancelConfirm}
        />
      )}

      {mcpMount &&
        createPortal(
          <div className="rounded-card border-2 border-ink bg-surface px-5 py-5 sm:px-6 sm:py-6">
            {/* The yellow featured-card treatment
                (bg-primary/shadow-card-primary) reads as the loudest emphasis
                the system has, which this card is not - so it takes the
                design system's other colored-card pair, blue (Card.astro's
                own "blue" surface variant: bg-blue text-ink +
                shadow-card-blue). Both are Tailwind theme tokens
                (global.css's `@theme` block:
                --color-blue/--shadow-card-blue), not raw hex in markup. */}
            <div className="rounded-card border-2 border-ink bg-blue px-5 py-4 shadow-card-blue">
              <p className="text-pill font-bold text-ink uppercase">MCP endpoint</p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <code className="min-w-0 flex-1 overflow-x-auto rounded-control border-2 border-ink bg-surface px-4 py-3 text-meta text-ink whitespace-nowrap">
                  {MCP_ENDPOINT}
                </code>
                <CopyButton text={MCP_ENDPOINT} />
              </div>
              {import.meta.env.DEV && (
                <p className="mt-2 text-pill text-ink">
                  In production this is https://mcp.motificons.app/mcp, live at launch.
                </p>
              )}
            </div>

            {/* Collapsed by default (the steps + three
                config blocks read as clutter under the endpoint). Native
                <details>/<summary> - same construction FaqAccordion.astro
                uses (.faq-item/.faq-chevron in global.css: marker removed,
                chevron rotates+presses on [open]/hover, focus-visible via
                the site-wide rule), reused verbatim rather than a
                hand-rolled button+state toggle - keyboard operable and
                screen-reader announced with zero extra JS. No persistence:
                collapsed again on every page load. */}
            <details className="faq-item mt-5 border-t-2 border-ink/15">
              <summary className="flex min-h-11 w-full cursor-pointer list-none items-center justify-between gap-4 py-4 text-left text-body font-semibold text-ink">
                How to connect your agent
                <span
                  className="faq-chevron inline-flex size-9 shrink-0 items-center justify-center rounded-control border-2 border-ink bg-surface text-ink"
                  aria-hidden="true"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </span>
              </summary>

              <div className="pb-1">
                <p className="text-body font-semibold text-ink">Connect a coding agent</p>
                <p className="mt-1 text-meta text-ink-muted">
                  Give Claude Code, Cursor, Codex, or any other MCP-capable agent access to the whole icon library and
                  your own collections, right from your editor.
                </p>

                <ol className="mt-4 flex list-decimal flex-col gap-1 pl-5 text-meta text-ink-muted">
                  <li>Create an API key above.</li>
                  <li>Find your agent below and follow its one setup step.</li>
                  <li>
                    Then try it: ask your agent to{" "}
                    <span className="text-ink">&quot;search Motificons for a bell icon&quot;</span>. If it answers with
                    icons, you&apos;re connected.
                  </li>
                </ol>

                <div className="mt-5 flex flex-col gap-5">
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-meta font-semibold text-ink">Claude Code</p>
                      <CopyButton text={claudeCodeCommand(plaintext ?? PLACEHOLDER_TOKEN)} />
                    </div>
                    <p className="mt-1 text-pill text-ink-muted">
                      Easiest path: paste this one command in your terminal - Claude Code sets itself up.
                    </p>
                    <pre
                      tabIndex={0}
                      className="scroll-light mt-2 overflow-x-auto rounded-control border-2 border-ink bg-canvas px-4 py-3 font-mono text-code text-ink"
                    >
                      <code>{claudeCodeCommand(plaintext ?? PLACEHOLDER_TOKEN)}</code>
                    </pre>
                    <p className="mt-2 text-pill text-ink-muted">
                      Prefer a file your whole team shares? Save this as{" "}
                      <code className="text-ink">.mcp.json</code> in your project folder instead:
                    </p>
                    <div className="mt-2 flex items-center justify-end">
                      <CopyButton text={claudeCodeConfig(plaintext ?? PLACEHOLDER_TOKEN)} />
                    </div>
                    <pre
                      tabIndex={0}
                      className="scroll-light mt-2 overflow-x-auto rounded-control border-2 border-ink bg-canvas px-4 py-3 font-mono text-code text-ink"
                    >
                      <code>{claudeCodeConfig(plaintext ?? PLACEHOLDER_TOKEN)}</code>
                    </pre>
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-meta font-semibold text-ink">Cursor</p>
                      <CopyButton text={cursorConfig(plaintext ?? PLACEHOLDER_TOKEN)} />
                    </div>
                    <p className="mt-1 text-pill text-ink-muted">
                      Save this as <code className="text-ink">.cursor/mcp.json</code> inside your project folder - or
                      paste it in Cursor&apos;s Settings, under MCP.
                    </p>
                    <pre
                      tabIndex={0}
                      className="scroll-light mt-2 overflow-x-auto rounded-control border-2 border-ink bg-canvas px-4 py-3 font-mono text-code text-ink"
                    >
                      <code>{cursorConfig(plaintext ?? PLACEHOLDER_TOKEN)}</code>
                    </pre>
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-meta font-semibold text-ink">Codex</p>
                      <CopyButton text={codexConfig()} />
                    </div>
                    <p className="mt-1 text-pill text-ink-muted">
                      Add this to the file <code className="text-ink">~/.codex/config.toml</code> in your home folder
                      (create the file if it doesn&apos;t exist yet).
                    </p>
                    <pre
                      tabIndex={0}
                      className="scroll-light mt-2 overflow-x-auto rounded-control border-2 border-ink bg-canvas px-4 py-3 font-mono text-code text-ink"
                    >
                      <code>{codexConfig()}</code>
                    </pre>
                    <p className="mt-2 text-pill text-ink-muted">
                      Codex reads the key from an environment variable, not the config file - also run{" "}
                      <code className="text-ink">
                        export {CODEX_TOKEN_ENV_VAR}={plaintext ?? PLACEHOLDER_TOKEN}
                      </code>{" "}
                      before starting Codex.
                    </p>
                  </div>
                </div>

                {!plaintext && (
                  <p className="mt-3 text-pill text-ink-muted">
                    Replace <code className="text-ink">{PLACEHOLDER_TOKEN}</code> with the key you created above - it
                    only shows in full once, right after you create or regenerate it.
                  </p>
                )}
              </div>
            </details>
          </div>,
          mcpMount,
        )}
    </div>
  );
}
