import { useCallback, useEffect, useRef, useState } from "react";

export interface QuickSaveToastState {
  message: string;
  onChange: () => void;
}

/**
 * The quick-save star's confirmation: "Saved to
 * <name>" / "Removed from <name>" plus a "Change" escape hatch back to the
 * full picker. Extracted from SearchIsland.tsx so every place that mounts
 * a quick-save star - the search grid,
 * the category/set page stars (TileStars.tsx), and the icon detail page's
 * own Save button - shows the exact same toast instead of a near-duplicate.
 * One instance per grid/page, not per tile - only one save happens at a
 * time from a single pointer, so only one toast is ever meaningful on
 * screen.
 */
export function useQuickSaveToast() {
  const [toast, setToast] = useState<QuickSaveToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, onChange: () => void) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ message, onChange });
    timerRef.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const dismiss = useCallback(() => setToast(null), []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { toast, showToast, dismiss };
}

export default function QuickSaveToast({
  toast,
  onDismiss,
}: {
  toast: QuickSaveToastState | null;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center px-4"
    >
      {toast && (
        <div className="pointer-events-auto flex items-center gap-3 rounded-control border-2 border-ink bg-ink px-4 py-3 text-body text-canvas shadow-hard">
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={() => {
              toast.onChange();
              onDismiss();
            }}
            className="text-body font-semibold text-primary underline underline-offset-2"
          >
            Change
          </button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="touch-target-inset -m-1 shrink-0 rounded-control p-1 text-on-dark-muted transition-colors duration-120 ease-in hover:text-on-dark"
          >
            <svg
              width={16}
              height={16}
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
      )}
    </div>
  );
}
