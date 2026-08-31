import { useRef, useState, type SyntheticEvent } from "react";
import { MAX_NAME_LENGTH } from "../../lib/workspace/limits";
import CollectionDuplicateModal from "./CollectionDuplicateModal";
import ConfirmDeleteModal from "./ConfirmDeleteModal";

type Status = "idle" | "loading" | "error";

const BUTTON_BASE =
  "press press-sm relative inline-flex items-center justify-center gap-2 rounded-control border-2 border-ink px-4 py-[10px] text-body font-semibold leading-[1.25] disabled:cursor-not-allowed disabled:opacity-[0.55]";
const BUTTON_PRIMARY_SM = `${BUTTON_BASE} bg-primary text-ink`;
const BUTTON_SECONDARY_SM = `${BUTTON_BASE} bg-surface text-ink`;
const BUTTON_DANGER_TEXT_SM = `${BUTTON_BASE} bg-surface text-danger`;

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
 * Rename + duplicate + delete for the collection detail page header
 * (this URL later becomes the public share URL - see the page's own
 * comment). Delete uses the shared ConfirmDeleteModal popup (the old inline
 * bar read
 * as a page section, not a "stop and confirm" moment) - the same component
 * ResourceManager.tsx's dashboard rows use, sized for a page header (h1)
 * rather than a list item. Duplicate is a separate island rather than
 * folded into CollectionWorkspace.tsx - it does not need to share state
 * with the icon grid, since a successful duplicate navigates away entirely.
 */
export default function CollectionHeaderControls({ id, name }: { id: string; name: string }) {
  const [displayName, setDisplayName] = useState(name);

  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  const [duplicating, setDuplicating] = useState(false);

  const [confirming, setConfirming] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  /* Focus returns to the trigger - captured on open, refocused when
     the popup closes without deleting anything (cancel/Escape/backdrop). */
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);

  function startEdit() {
    setConfirming(false);
    setEditing(true);
    setValue(displayName);
    setStatus("idle");
    setError("");
  }

  function cancelEdit() {
    setEditing(false);
    setStatus("idle");
    setError("");
  }

  async function submitRename(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      setStatus("error");
      setError("Give your collection a name.");
      return;
    }

    setStatus("loading");
    setError("");

    try {
      const response = await fetch(`/api/collections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; collection?: { name: string } }
        | null;

      if (!response.ok) {
        setStatus("error");
        setError(payload?.error ?? "Could not rename. Try again.");
        return;
      }

      setDisplayName(payload?.collection?.name ?? trimmed);
      setEditing(false);
      setStatus("idle");
      document.title = document.title.replace(name, payload?.collection?.name ?? trimmed);
    } catch {
      setStatus("error");
      setError("Could not rename. Try again.");
    }
  }

  async function confirmDelete() {
    setDeleteBusy(true);
    setDeleteError("");
    try {
      const response = await fetch(`/api/collections/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setDeleteError(payload?.error ?? "Could not delete. Try again.");
        setDeleteBusy(false);
        return;
      }
      window.location.href = "/dashboard";
    } catch {
      setDeleteError("Could not delete. Try again.");
      setDeleteBusy(false);
    }
  }

  function cancelDelete() {
    setConfirming(false);
    setDeleteError("");
    deleteTriggerRef.current?.focus();
  }

  if (editing) {
    return (
      <form onSubmit={submitRename} aria-label="Rename collection" className="mt-4 flex flex-col gap-3 max-w-md">
        <input
          type="text"
          autoFocus
          maxLength={MAX_NAME_LENGTH}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (status === "error") setStatus("idle");
          }}
          aria-invalid={status === "error" ? "true" : undefined}
          aria-describedby={status === "error" ? "collection-rename-error" : undefined}
          className={`w-full rounded-control border-2 bg-surface px-4 py-3 text-h3 font-bold text-ink focus:shadow-card ${
            status === "error" ? "border-danger" : "border-ink"
          }`}
        />
        {status === "error" && (
          <p id="collection-rename-error" role="alert" className="flex items-start gap-2 text-meta text-danger">
            <AlertIcon />
            {error}
          </p>
        )}
        <div className="flex gap-3">
          <button type="submit" disabled={status === "loading"} aria-busy={status === "loading"} className={BUTTON_PRIMARY_SM}>
            {status === "loading" && <SpinnerIcon />}
            Save
          </button>
          <button type="button" onClick={cancelEdit} disabled={status === "loading"} className={BUTTON_SECONDARY_SM}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-h2 font-bold">{displayName}</h1>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={startEdit} className={BUTTON_SECONDARY_SM}>
            Rename
          </button>
          <button type="button" onClick={() => setDuplicating(true)} className={BUTTON_SECONDARY_SM}>
            Duplicate
          </button>
          <button
            ref={deleteTriggerRef}
            type="button"
            onClick={() => setConfirming(true)}
            className={BUTTON_DANGER_TEXT_SM}
          >
            Delete
          </button>
        </div>
      </div>

      {duplicating && (
        <CollectionDuplicateModal
          sourceId={id}
          sourceName={displayName}
          onClose={() => setDuplicating(false)}
        />
      )}

      {confirming && (
        <ConfirmDeleteModal
          name={displayName}
          busy={deleteBusy}
          error={deleteError}
          onConfirm={confirmDelete}
          onCancel={cancelDelete}
        />
      )}
    </div>
  );
}
