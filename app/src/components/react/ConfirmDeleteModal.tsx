import { useEffect, useId, useRef, type ReactNode } from "react";

const BUTTON_BASE =
  "press press-sm relative inline-flex items-center justify-center gap-2 rounded-control border-2 border-ink text-body font-semibold leading-[1.25] disabled:cursor-not-allowed disabled:opacity-[0.55]";
const BUTTON_DANGER_FILL_SM = `${BUTTON_BASE} bg-red px-4 py-[10px] text-ink`;
const BUTTON_SECONDARY_SM = `${BUTTON_BASE} bg-surface px-4 py-[10px] text-ink`;

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
 * ONE shared delete-confirm popup (the previous
 * inline full-width bar under the collection title read as a page section,
 * not a "stop and confirm" moment). Same centered-modal primitive as
 * CollectionDuplicateModal.tsx - overlay, `role=
 * "dialog"`, focus trap, Escape closes, buttons sized off the same `py-
 * [10px]` convention those modals already use (24px line-height + 20px
 * padding = 44px, the touch-target floor (AGENTS.md), not the dense-row
 * exception - this modal just happens to reuse the same class values).
 *
 * Deliberately plain - no title icon, no
 * close (X) button, just the question and the two actions. Used from BOTH
 * the collection detail page header (CollectionHeaderControls.tsx) and the
 * dashboard's collection list rows (ResourceManager.tsx) - one component,
 * so the two surfaces cannot drift into two different confirm patterns
 * again.
 *
 * Focus returns to the trigger: this
 * component focuses its own Cancel button on mount (the safe default for a
 * destructive action - an accidental Enter/Space should not delete
 * anything) and leaves returning focus to whichever button opened it to the
 * caller's `onCancel`, since only the caller still holds a reference to
 * that trigger element.
 *
 * `message`/`confirmLabel` (added for the dashboard's API key Revoke/
 * Regenerate confirms) let a caller replace the default "Delete X?" phrasing
 * entirely - neither action is a delete, so forcing that word into the
 * question would be dishonest. Both are optional and default to the
 * original collection-delete copy, so the two existing callers
 * (CollectionHeaderControls.tsx, ResourceManager.tsx) need no changes.
 */
export default function ConfirmDeleteModal({
  name,
  message,
  confirmLabel = "Yes, delete",
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  /** The collection's display name, dropped straight into the default
      question. Unused when `message` is provided. */
  name?: string;
  /** Overrides the default "Delete <name>? This can't be undone." sentence. */
  message?: ReactNode;
  confirmLabel?: string;
  busy: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
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
        className="w-full max-w-[420px] rounded-panel border-2 border-ink bg-surface p-8 shadow-hard"
      >
        <p id={titleId} className="text-body text-ink">
          {message ?? (
            <>
              Delete <strong>{name}</strong>? This can&apos;t be undone.
            </>
          )}
        </p>

        {error && (
          <p role="alert" className="mt-3 flex items-start gap-2 text-meta text-danger">
            <AlertIcon />
            {error}
          </p>
        )}

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy}
            className={`${BUTTON_DANGER_FILL_SM} flex-1`}
          >
            {busy && <SpinnerIcon />}
            {confirmLabel}
          </button>
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={`${BUTTON_SECONDARY_SM} flex-1`}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
