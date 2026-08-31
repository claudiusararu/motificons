import type { ReactNode } from "react";
import { SWATCHES } from "../../../lib/transforms/swatches";

/**
 * The style-engine's control primitives, factored out of IconEditor.tsx so
 * the collection style settings panel (the style engine's manual-override
 * half, which lives on the collection) can reuse the exact same controls
 * instead of a second, drifting copy: the style engine is never forked.
 */

/** Export sizes offered wherever a size control appears. */
export const SIZES = [24, 48, 64, 128, 256, 512, 1024] as const;

/** Stroke width targets offered wherever a stroke control appears. */
export const STROKE_WIDTHS = [1, 1.5, 2, 2.5, 3] as const;

export function Group({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div>
      <h2 className="mb-3 flex items-center gap-2 text-pill font-bold text-ink-muted uppercase">
        {label}
      </h2>
      {children}
    </div>
  );
}

export function Choice({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center justify-center rounded-control border-2 border-ink px-3 py-2 text-meta font-semibold text-ink transition-colors duration-120 ease-in ${
        active ? "bg-segment-active" : "bg-surface"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Color picker + hex input + the standard swatch row. `value` may be null
 * (unset) for contexts where a color is optional, like a collection's style
 * settings - the swatch/picker still needs SOME hex to show, so a
 * fallback is required whenever the value is null.
 */
export function ColorField({
  value,
  fallback = "#183153",
  onChange,
}: {
  value: string | null;
  fallback?: string;
  onChange: (value: string) => void;
}) {
  const shown = value ?? fallback;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="color"
          value={shown}
          aria-label="Pick a color"
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-12 cursor-pointer rounded-control border-2 border-ink bg-surface"
        />
        <input
          type="text"
          value={shown}
          aria-label="Hex color"
          onChange={(event) => onChange(event.target.value)}
          className="w-28 rounded-control border-2 border-ink bg-surface px-3 py-2 font-mono text-meta"
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {SWATCHES.map((swatch) => (
          <button
            key={swatch}
            type="button"
            aria-label={swatch}
            title={swatch}
            onClick={() => onChange(swatch)}
            className="touch-target-inset size-7 rounded-control border-2 border-ink/15"
            style={{ backgroundColor: swatch }}
          />
        ))}
      </div>
    </>
  );
}
