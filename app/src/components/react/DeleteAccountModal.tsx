import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react";

const BUTTON_BASE =
  "press press-sm relative inline-flex items-center justify-center gap-2 rounded-control border-2 border-ink text-body font-semibold leading-[1.25] disabled:cursor-not-allowed disabled:opacity-[0.55]";
const BUTTON_DANGER_FILL_SM = `${BUTTON_BASE} bg-red px-4 py-[10px] text-ink`;
const BUTTON_SECONDARY_SM = `${BUTTON_BASE} bg-surface px-4 py-[10px] text-ink`;

/** The exact word the input must match (case-insensitive, trimmed) before
    the destructive button enables: typing beats a
    plain Yes/confirm click for something this irreversible. */
const CONFIRMATION_WORD = "delete";

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

/**
 * The delete-account confirm modal (dashboard Danger zone). Same centered-
 * modal primitive as ConfirmDeleteModal.tsx (overlay, `role="dialog"`,
 * border-ink + shadow-hard card, focus trap, Escape closes, same button
 * geometry) but NOT that shared component - this one needs a typed
 * confirmation input ConfirmDeleteModal has no prop shape for, so it is a
 * sibling rather than a prop bolted onto a component every OTHER caller
 * (collection delete, API key revoke/regenerate) still uses in its plain
 * two-button form.
 *
 * REPLACES the plain "Yes, delete" pattern for this one action specifically
 * - deleting an entire account is categorically bigger than deleting one
 * collection or one key:
 *   1. Copy states plainly what happens: all data gone, access lost, cannot
 *      be undone - no euphemism, no mechanism talk.
 *   2. The destructive button stays disabled until the visitor types
 *      "delete" (case-insensitive, whitespace-trimmed) into the input -
 *      typing beats a click for something this irreversible.
 *   3. Initial focus goes to the input (not Cancel, unlike
 *      ConfirmDeleteModal's default - the whole point here is making the
 *      visitor deliberately type the word, so the input is the natural
 *      first stop); Cancel stays equally sized/weighted next to the
 *      destructive button, never visually demoted.
 */
export default function DeleteAccountModal({
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  busy: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const inputId = useId();
  const errorId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");

  const matches = value.trim().toLowerCase() === CONFIRMATION_WORD;

  useEffect(() => {
    inputRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        "input:not([disabled]), button:not([disabled])",
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (matches && !busy) onConfirm();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-6"
      onClick={busy ? undefined : onCancel}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[440px] rounded-panel border-2 border-ink bg-surface p-8 shadow-hard"
      >
        <h2 id={titleId} className="text-h3 font-bold text-ink">
          Delete your account?
        </h2>
        <p className="mt-2 text-body text-ink-muted">
          This permanently deletes your account, your collections, your saved icons, and your API key. You will
          lose access to all of it right away, and it is removed from the database - this cannot be undone.
        </p>

        <form onSubmit={handleSubmit} className="mt-5">
          <label htmlFor={inputId} className="text-meta font-semibold text-ink">
            Type <strong className="text-danger">delete</strong> to confirm
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? errorId : undefined}
            className="mt-2 w-full appearance-none rounded-control border-2 border-ink bg-surface px-4 py-[10px] text-body text-ink transition-shadow duration-[120ms] ease-in focus:shadow-card disabled:cursor-not-allowed disabled:opacity-[0.55]"
          />

          {error && (
            <p id={errorId} role="alert" className="mt-3 flex items-start gap-2 text-meta text-danger">
              <AlertIcon />
              {error}
            </p>
          )}

          <div className="mt-5 flex gap-3">
            <button
              type="submit"
              disabled={!matches || busy}
              aria-busy={busy}
              className={`${BUTTON_DANGER_FILL_SM} flex-1`}
            >
              {busy && <SpinnerIcon />}
              Delete my account
            </button>
            <button type="button" onClick={onCancel} disabled={busy} className={`${BUTTON_SECONDARY_SM} flex-1`}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
