/**
 * Small inline icons shared by the save-to-collection controls (SaveButton,
 * SaveStar, SaveCollectionPanel). Centralized here so the picker panel does
 * not get duplicated per call site (tile-classes.ts's rationale, applied to
 * icons instead of classes).
 */

/** Filled with the brand yellow when saved, outline-only otherwise - hex per
    AGENTS.md (SVG fill/stroke want real hex, not an OKLCH-backed CSS
    variable). Matches `--color-primary` in global.css. */
export const SAVED_FILL_HEX = "#ffd43b";

export function StarIcon({ filled, size = 18 }: { filled: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? SAVED_FILL_HEX : "none"}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z" />
    </svg>
  );
}

export function SpinnerIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
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

export function AlertIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
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

export function CheckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M5 12.5 9.5 17 19 7" />
    </svg>
  );
}

export function ErrorLine({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} role="alert" className="mt-2 flex items-start gap-2 text-meta text-danger">
      <AlertIcon />
      {message}
    </p>
  );
}
