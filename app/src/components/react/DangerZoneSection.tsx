import { useState } from "react";
import { createAuthClient } from "better-auth/react";
import DeleteAccountModal from "./DeleteAccountModal";
import { clearCached } from "../../lib/entitlements-cache";

const authClient = createAuthClient();

const BUTTON_BASE =
  "press press-sm relative inline-flex items-center justify-center gap-2 rounded-control border-2 border-ink text-body font-semibold leading-[1.25] disabled:cursor-not-allowed disabled:opacity-[0.55]";
/* Same quiet danger-text trigger ApiKeySection.tsx's "Revoke" button uses -
   the visual weight for something this serious comes from the modal's
   plain-language copy and its filled red confirm button, not from a loud
   trigger - content stays plain (ConfirmDeleteModal.tsx's own docstring). py-[10px] + text-body's 20px line-height + 2px border x2 =
   44px, the touch-target floor (AGENTS.md). */
const BUTTON_DANGER_TEXT_SM = `${BUTTON_BASE} bg-surface px-4 py-[10px] text-danger`;

type DeleteStatus = "idle" | "confirming" | "loading" | "error";

/**
 * Dashboard's Danger zone (GDPR right to erasure) - the very bottom of the
 * page, below the API key section. One plain
 * sentence stating what deletion does, one destructive trigger, confirmed
 * via DeleteAccountModal.tsx's typed "delete" flow (not the shared
 * ConfirmDeleteModal every OTHER destructive action on this page uses - see
 * that modal's own docstring for why this one is a sibling component
 * instead of a shared prop: deleting an entire account needs an input field
 * and a disabled-until-typed button state ConfirmDeleteModal has no shape
 * for).
 *
 * On success: the server has already deleted every `session` row as part of
 * its FK-safe cascade (api/account.ts -> lib/workspace/account-deletion.ts),
 * so the cookie the browser still holds is already worthless server-side.
 * This still calls `authClient.signOut()` - same mechanism AuthMenu.tsx's
 * sign-out uses - to clear it client-side too before redirecting, rather
 * than leaving a stale cookie for the next `getSession()` call to fail on.
 */
export default function DangerZoneSection() {
  const [status, setStatus] = useState<DeleteStatus>("idle");
  const [error, setError] = useState("");

  function openConfirm() {
    setStatus("confirming");
    setError("");
  }

  function cancel() {
    setStatus("idle");
    setError("");
  }

  async function confirmDelete() {
    setStatus("loading");
    setError("");
    try {
      const response = await fetch("/api/account", { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Could not delete your account. Try again.");
        setStatus("error");
        return;
      }
      clearCached();
      window.posthog?.reset();
      await authClient.signOut();
      window.location.href = "/";
    } catch {
      setError("Could not delete your account. Try again.");
      setStatus("error");
    }
  }

  return (
    <div className="rounded-card border-2 border-ink bg-surface px-5 py-5 sm:px-6 sm:py-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <p className="text-body text-ink-muted">
          Deleting your account permanently removes your account, your collections, your saved icons, and your
          API key - this cannot be undone.
        </p>
        <button type="button" onClick={openConfirm} className={`${BUTTON_DANGER_TEXT_SM} shrink-0`}>
          Delete account
        </button>
      </div>

      {status !== "idle" && (
        <DeleteAccountModal busy={status === "loading"} error={error} onConfirm={confirmDelete} onCancel={cancel} />
      )}
    </div>
  );
}
