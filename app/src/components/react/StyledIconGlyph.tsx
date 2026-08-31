import { useMemo } from "react";
import type { Tier } from "../../lib/data";
import { applyEdits, type IconEdits } from "../../lib/transforms/svg-doc";
import { buildExportUrl } from "../../lib/transforms/export-url";

export interface StyleableIcon {
  prefix: string;
  name: string;
  body: string | null;
  width: number;
  height: number;
  /** Absent only for the rare icon whose body came back too large to inline
      (see the fallback below) - never faked, since capabilitiesFor(tier)
      is what keeps a T4 icon honest about not taking a stroke it cannot. */
  tier: Tier | null;
}

/**
 * Renders one icon glyph styled with the given edits - the SINGLE shared
 * "apply the collection's style settings to an icon" path - the style
 * engine is never forked - used by:
 *   - the saved-icon grid (CollectionIconGrid.tsx), with the collection's
 *     SAVED settings,
 *   - the style panel's anchor picker and its live preview strip
 *     (CollectionStylePanel.tsx), with the panel's CURRENT, unsaved,
 *     in-progress control values.
 * Centralizing this in one place (round-2 fix, replacing three near-copies
 * of the same body-resolve-and-style logic - the grid's old local
 * `IconGlyph`, the style panel's old `AnchorPreview` which did not resolve
 * bodies or apply edits at all) is what guarantees the three surfaces can
 * never drift apart again: there is only one function that decides what a
 * styled tile looks like.
 *
 * A render-time function of (body, edits, tier) - recomputed via useMemo on
 * every relevant prop change, never baked once at load - so a tile freshly
 * appended in the same session (an add-panel addition, before or after any
 * reload) styles exactly like one that was already there.
 *
 * Falls back to an `<img>` when there is no body to transform client-side -
 * every SearchHit carries `body: null` BY DESIGN (the shard engine's own
 * `toHit`/browse/category-browse paths, search/shard-engine.ts: the island
 * fetches each icon from the immutable, globally edge-cached /api/icon
 * instead of inlining it per query). CollectionWorkspace.tsx closes most of
 * this gap client-side (an icon added from the Add-icons panel gets its real
 * body fetched right after being added, so it stops rendering through this
 * fallback within one round trip) - but the fallback itself still has to be
 * styled honestly for whatever window remains (before that fetch resolves,
 * or if it fails): this used to point at
 * the plain, unstyled /api/icon/{prefix}/{name}.svg, which is why a tile
 * could render black/unstyled while its siblings (already carrying an
 * inlined body) rendered pink. `buildExportUrl` is the SAME param-building
 * function every other export surface uses,
 * so the server-rendered fallback image honors the exact same edits/tier
 * capabilities `applyEdits` above would have applied client-side. */
export function StyledIconGlyph({
  item,
  edits,
  size = 30,
  className,
}: {
  item: StyleableIcon;
  edits: IconEdits;
  size?: number;
  /** Extra classes on the rendered element. `size` still sets the intrinsic
      width/height attributes (so a fixed-size tile like a grid/picker tile
      gets exactly that box), but a caller that needs the glyph to SHRINK
      inside a container narrower than `size` (a responsive preview surface,
      say) can pass `max-w-full max-h-full h-auto w-auto` here - the classic
      "intrinsic size as a hint, CSS enforces the container" pattern, same
      as any responsive image. */
  className?: string;
}) {
  const styledBody = useMemo(() => {
    if (!item.body || !item.tier) return item.body;
    return applyEdits(
      { prefix: item.prefix, name: item.name, body: item.body, width: item.width, height: item.height },
      edits,
      item.tier,
    );
  }, [item.body, item.tier, item.prefix, item.name, item.width, item.height, edits]);

  if (styledBody) {
    return (
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${item.width} ${item.height}`}
        aria-hidden="true"
        focusable="false"
        className={className}
        dangerouslySetInnerHTML={{ __html: styledBody }}
      />
    );
  }
  return (
    <img
      src={buildExportUrl(item.prefix, item.name, "svg", edits, size)}
      width={size}
      height={size}
      alt=""
      loading="lazy"
      decoding="async"
      className={className}
    />
  );
}
