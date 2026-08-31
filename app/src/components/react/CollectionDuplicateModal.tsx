import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react";
import { MAX_NAME_LENGTH } from "../../lib/workspace/limits";

type Status = "idle" | "loading" | "error";

const BUTTON_BASE =
  "press press-sm relative inline-flex items-center justify-center gap-2 rounded-control border-2 border-ink text-body font-semibold leading-[1.25] disabled:cursor-not-allowed disabled:opacity-[0.55]";
const BUTTON_PRIMARY_SM = `${BUTTON_BASE} bg-primary px-4 py-[10px] text-ink`;
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
 * DUPLICATE: a popup asking the new collection's name, prefilled with a
 * placeholder along the lines of "<name> (duplicate)". Centered modal, not a slide-over - matches
 * ConfirmDeleteModal.tsx (same focus trap/Escape/44px pattern), since this
 * is a short confirm-and-go interaction rather than a
 * workspace to browse inside.
 *
 * Confirming copies the source collection's icons AND style settings
 * server-side (api/collections/[id]/duplicate.ts) and navigates to the copy
 * - there is nothing left to do on this page once that happens.
 */
export default function CollectionDuplicateModal({
  sourceId,
  sourceName,
  onClose,
}: {
  sourceId: string;
  sourceName: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const inputId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [value, setValue] = useState(`${sourceName} (duplicate)`);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [capped, setCapped] = useState<{ headline: string; body: string } | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled])',
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
  }, [onClose]);

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      setStatus("error");
      setError("Give the copy a name.");
      return;
    }

    setStatus("loading");
    setError("");
    setCapped(null);

    try {
      const response = await fetch(`/api/collections/${sourceId}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = (await response.json().catch(() => null)) as
        | { error?: string; limited?: true; upsell?: { headline: string; body: string }; collection?: { id: string } }
        | null;

      if (!response.ok) {
        setStatus("error");
        setError(data?.error ?? "Could not duplicate. Try again.");
        return;
      }

      if (data?.limited) {
        setStatus("idle");
        setCapped(data.upsell ?? { headline: "All collection slots are in use", body: "" });
        return;
      }

      if (!data?.collection) {
        setStatus("error");
        setError("Could not duplicate. Try again.");
        return;
      }

      window.location.href = `/collections/${data.collection.id}`;
    } catch {
      setStatus("error");
      setError("Could not duplicate. Try again.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-6" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[420px] rounded-panel border-2 border-ink bg-surface p-8 shadow-hard"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-h3 font-bold text-ink">
            Duplicate {sourceName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="touch-target-inset -m-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-control p-1 text-ink-muted transition-colors duration-[120ms] ease-in hover:text-ink"
          >
            <svg
              width={20}
              height={20}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6 18 18M18 6 6 18" />
            </svg>
          </button>
        </div>

        <p className="mt-3 text-body text-ink-muted">
          Copies every icon and this collection's style settings into a new
          collection.
        </p>

        {capped ? (
          <div className="mt-5 rounded-control border-2 border-ink bg-canvas p-4">
            <p className="text-meta font-semibold text-ink">{capped.headline}</p>
            {capped.body && <p className="mt-1.5 text-meta text-ink-muted">{capped.body}</p>}
            <button type="button" onClick={onClose} className={`${BUTTON_SECONDARY_SM} mt-4 w-full`}>
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3">
            <label htmlFor={inputId} className="text-pill font-bold text-ink-muted uppercase">
              New collection name
            </label>
            <input
              ref={inputRef}
              id={inputId}
              type="text"
              maxLength={MAX_NAME_LENGTH}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                if (status === "error") setStatus("idle");
              }}
              aria-invalid={status === "error" ? "true" : undefined}
              aria-describedby={status === "error" ? "duplicate-name-error" : undefined}
              className={`w-full rounded-control border-2 bg-surface px-4 py-3 text-body text-ink focus:shadow-card ${
                status === "error" ? "border-danger" : "border-ink"
              }`}
            />
            {status === "error" && (
              <p id="duplicate-name-error" role="alert" className="flex items-start gap-2 text-meta text-danger">
                <AlertIcon />
                {error}
              </p>
            )}
            <div className="mt-2 flex gap-3">
              <button
                type="submit"
                disabled={status === "loading"}
                aria-busy={status === "loading"}
                className={`${BUTTON_PRIMARY_SM} flex-1`}
              >
                {status === "loading" && <SpinnerIcon />}
                Duplicate
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={status === "loading"}
                className={`${BUTTON_SECONDARY_SM} flex-1`}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
