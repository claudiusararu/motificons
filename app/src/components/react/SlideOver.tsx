import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** Matches `duration-200` on both the overlay's opacity transition and the
    panel's transform transition below - the exit-unmount timer has to agree
    with the CSS or it either cuts the animation short or leaves a dead
    wrapper mounted after the animation already finished. */
const TRANSITION_MS = 200;

/**
 * Shared slide-over panel: overlay + a panel sliding in from the right edge
 * (the collection page's "Add icons" panel; reused for "Set collection
 * styles"). Kept generic on purpose - the "do not fork" rule applies to UI
 * shells the same way it applies to the style engine's controls.
 *
 * Accessibility: role="dialog" + aria-modal, Escape closes,
 * a visible 44px close button, focus moves to that button on open and back
 * to the trigger on close (the caller's own `onClose` is expected to do the
 * latter, same convention as CollectionDuplicateModal.tsx), and a focus trap
 * cycles Tab/Shift+Tab within the panel.
 *
 * STRUCTURAL FIX: a previous version kept
 * the fixed `inset-0 z-50` wrapper permanently mounted and relied on
 * `inert`/`aria-hidden`/`pointer-events-none` all being computed correctly
 * from `open` to keep it click-through while closed. QA's automated click
 * script found the hydrated client in a state where the wrapper rendered as
 * if open (`aria-hidden="false"`, no `pointer-events-none`) on a completely
 * fresh load, before anything had been clicked - i.e. some state was wrong
 * post-hydration, even though the equivalent SSR markup and every code path
 * that could set `open`/`addOpen`/`styleOpen` to true was re-audited and
 * found to only ever fire from the trigger buttons' own onClick. The
 * precise hydration mechanism was not pinned down with certainty (no
 * browser devtools available to this agent) - so rather than patch the
 * class/attribute computation a second time and hope, the wrapper is now
 * CONDITIONALLY RENDERED: `mounted` starts equal to `open` (false in the
 * overwhelmingly common case), and the wrapper returns `null` - not merely
 * inert-and-invisible, ABSENT FROM THE DOM ENTIRELY - whenever it is false.
 * There is no longer any state computation that, if wrong, could leave a
 * hit-testable node over the page: the only way the wrapper exists at all
 * is for the mount effect below to have actually run with `open === true`,
 * which only happens from a real click on a trigger button. This makes the
 * closed state correct by construction, independent of whatever the
 * previous bug's exact mechanism was.
 *
 * Mount/visible choreography (unmount replaces the old always-mounted
 * `inert` toggle, the two-frame open defer from the animation-divergence
 * fix is unchanged and still necessary - see that reasoning below):
 *   open  false -> true : mount immediately (paints the CLOSED/off-screen
 *                         state at least once), then two rAFs later flip to
 *                         the OPEN classes - guarantees two distinct paints
 *                         so the transition-transform always visibly plays,
 *                         regardless of how expensive the subtree is to
 *                         hydrate/focus-enable (this was the fix for the
 *                         round-2 "one panel never animates" bug: a heavier
 *                         subtree's wake-up cost could otherwise still be in
 *                         flight when the same-frame transform change would
 *                         start, and the browser would coalesce the closed
 *                         and open paints into one, skipping the visible
 *                         transition).
 *   open  true -> false : flip to the CLOSED classes immediately (plays the
 *                         exit transition on an still-mounted node), then
 *                         unmount after TRANSITION_MS - long enough for the
 *                         200ms exit transition to finish (or, under
 *                         `prefers-reduced-motion`, global.css's blanket
 *                         rule collapses that transition to ~0.01ms and this
 *                         timeout just unmounts almost immediately, still
 *                         correct either way).
 *
 * Reduced motion: no bespoke motion-reduce class needed - global.css's
 * blanket `@media (prefers-reduced-motion: reduce)` rule already collapses
 * every transition-duration to 0.01ms, so the slide becomes an instant state
 * change automatically - reduced motion means no slide animation, with no
 * second code path.
 */
export default function SlideOver({
  open,
  onClose,
  title,
  widthClassName = "w-full sm:max-w-[480px]",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Panel width - the Add-icons panel (full search experience) wants more
      room than the Set-collection-styles panel (a form). */
  widthClassName?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  /* Whether the wrapper exists in the DOM AT ALL - see the header comment's
     "STRUCTURAL FIX". */
  const [mounted, setMounted] = useState(open);
  /* Whether a MOUNTED wrapper shows its open (slid-in) classes. Only
     meaningful while `mounted` is true; deferred by two frames on open only
     - see the header comment's "Mount/visible choreography". */
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      let secondFrame = 0;
      const firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => setVisible(true));
      });
      return () => {
        cancelAnimationFrame(firstFrame);
        cancelAnimationFrame(secondFrame);
      };
    }

    setVisible(false);
    const unmountTimer = window.setTimeout(() => setMounted(false), TRANSITION_MS);
    return () => window.clearTimeout(unmountTimer);
  }, [open]);

  /* Focus the close button once the wrapper actually exists in the DOM -
     deliberately keyed on `mounted`, not `open`: `open` flips to true one
     render BEFORE `mounted` does (the effect above is what sets `mounted`,
     and effects run after the render they were scheduled from commits), so
     `closeButtonRef.current` would still be null the first time an
     `[open]`-keyed effect ran. Keying on `mounted` guarantees the ref is
     live by the time this runs. */
  useEffect(() => {
    if (!mounted || !open) return;
    /* preventScroll: focusing a panel whose visual (translated) state may
       still be one rAF away from painting must never yank the page's own
       scroll position to "make the close button visible" - the panel is
       already positioned correctly via the overlay, this focus call is for
       keyboard/AT users, not viewport scrolling. */
    closeButtonRef.current?.focus({ preventScroll: true });
  }, [mounted, open]);

  /* Escape + focus trap + scroll lock - independent of mount timing: Escape
     should work the instant `open` is true even in the split-second before
     the wrapper has mounted (a no-op keydown until then is harmless), and
     none of this depends on `closeButtonRef` specifically. */
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div
      inert={!open}
      aria-hidden={!open}
      className={`fixed inset-0 z-50 overflow-hidden ${open ? "" : "pointer-events-none"}`}
    >
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`absolute inset-0 bg-ink/50 transition-opacity duration-200 ease-in ${
          visible ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`absolute inset-y-0 right-0 flex flex-col bg-canvas shadow-hard transition-transform duration-200 ease-in-out focus:outline-none ${widthClassName} ${
          visible ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b-2 border-ink bg-surface px-6 py-5">
          <h2 id={titleId} className="text-h3 font-bold text-ink">
            {title}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="touch-target-inset flex h-11 w-11 shrink-0 items-center justify-center rounded-control border-2 border-ink bg-surface text-ink-muted transition-colors duration-[120ms] ease-in hover:text-ink"
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
        {/* overflow-x-hidden is a backstop, not the fix for the horizontal-
            scrollbar bug (that was SetGrid.astro's viewport-relative
            breakpoints, now genuinely container-relative) - without an
            explicit overflow-x, a lone overflow-y:auto computes overflow-x
            to auto too (the two axes cannot mix visible/non-visible per the
            CSS Overflow spec), so any future stray pixel of horizontal
            overflow would silently grow a second scrollbar here instead of
            surfacing as a bug to fix at the source. */}
        <div className="scroll-light min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
