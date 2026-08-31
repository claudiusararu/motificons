import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount } from "./useAccount";
import SaveStar from "./save/SaveStar";
import QuickSaveToast, { useQuickSaveToast } from "./save/QuickSaveToast";

/**
 * The quick-save star on category and set pages. Those pages stay
 * server-rendered/edge-cached for SEO - the tile grid itself is plain Astro
 * markup, not a React island -
 * so this is the ONE small client enhancement that attaches a real,
 * interactive star to each tile rather than rebuilding the grid as an
 * island.
 *
 * Every tile the Astro page renders (the first SSR'd page AND every batch a
 * page's own "Load more" script appends afterward) carries an empty sibling
 * placeholder: `<span data-star-slot="prefix:name" data-star-name="name" />`
 * next to the tile's own `<a>` - a SIBLING, not a child of it, because a
 * `<button>` nested inside an `<a>` is invalid HTML (SaveStar.tsx's own
 * doc comment). This component finds every placeholder under `gridSelector`
 * and portals a SaveStar into it - one account fetch and one shared toast
 * for the whole page, not one per tile (the same reasoning
 * SearchIsland.tsx's own grid already documents).
 *
 * Re-scans when the page dispatches a `motificons:tiles-appended` event on
 * `document` - both pages' own load-more scripts fire it right after
 * appending a batch of tiles+placeholders. Simpler and more explicit than a
 * MutationObserver watching the whole grid subtree.
 */
export default function TileStars({ gridSelector }: { gridSelector: string }) {
  const { signedIn, ready } = useAccount();
  const [slots, setSlots] = useState<HTMLElement[]>([]);
  const { toast, showToast, dismiss: dismissToast } = useQuickSaveToast();

  useEffect(() => {
    const container = document.querySelector<HTMLElement>(gridSelector);
    if (!container) return;

    function scan() {
      setSlots(Array.from(container!.querySelectorAll<HTMLElement>("[data-star-slot]")));
    }
    scan();

    document.addEventListener("motificons:tiles-appended", scan);
    return () => document.removeEventListener("motificons:tiles-appended", scan);
  }, [gridSelector]);

  return (
    <>
      {slots.map((slot) => {
        const iconId = slot.dataset["starSlot"];
        if (!iconId) return null;
        const name = slot.dataset["starName"] ?? iconId.split(":")[1] ?? iconId;
        return createPortal(
          <SaveStar
            key={iconId}
            iconId={iconId}
            name={name}
            signedIn={signedIn}
            accountLoading={!ready}
            tabIndex={0}
            onQuickSaved={showToast}
          />,
          slot,
        );
      })}
      <QuickSaveToast toast={toast} onDismiss={dismissToast} />
    </>
  );
}
