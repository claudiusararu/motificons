import { useEffect, useMemo, useRef, useState } from "react";
import type { Tier } from "../../lib/data";
import { buildInlineSvg, capabilitiesFor, type IconEdits } from "../../lib/transforms/svg-doc";
import { combineQuickViewEdits } from "../../lib/quick-view";
import { StyledIconGlyph } from "./StyledIconGlyph";
import FormatPreviewPanel from "./FormatPreviewPanel";
import AddToCollectionStar from "./save/AddToCollectionStar";
import { SpinnerIcon } from "./save/icons";
import { Choice, ColorField, Group } from "./editor/Controls";

const DEFAULT_COLOR = "#183153";
/** FormatPreviewPanel needs SOME size; there is no Size control in this
    "limited controls" view (transform, output and color only),
    so this is the same fallback IconEditor.tsx uses when nothing else says
    otherwise, applied whenever the collection has no saved size either. */
const DEFAULT_SIZE = 128;

export interface QuickViewIcon {
  prefix: string;
  name: string;
  /** Null for ENTRY 2 ALWAYS (every SearchHit does, by design - see
      search-config.ts's own doc comment), not "rare" - which is exactly why
      this component fetches the real body itself (below) rather than
      staying stuck in a degraded view for every search-opened icon. Also
      null for the genuinely rare icon whose set left the pipeline (paired
      with a null `tier`, ENTRY 1's own edge case) - there the fetch cannot
      help either, since there is no tier to style against. */
  body: string | null;
  width: number;
  height: number;
}

/**
 * The icon quick-view: a simplified detail view
 * living in the SlideOver primitive family, shared by BOTH entry points -
 * one component, so the two can never drift
 * into showing different controls for the same icon:
 *
 *   ENTRY 1  CollectionIconGrid.tsx - a tile click opens this inside its
 *            OWN SlideOver (CollectionWorkspace.tsx). Closing it (the
 *            SlideOver's own X/Escape) is "back" - there is no separate
 *            listing state inside this view to return to, so `onBack` is
 *            omitted and no Back control renders. `collectionStar` IS
 *            still passed - the grid tile
 *            behind this panel already has its own remove control, but a
 *            labeled full-size row here is clearer than a small icon in a
 *            tile corner the visitor would have to close this panel to
 *            reach.
 *   ENTRY 2  SearchIsland.tsx - a result tile click SWAPS this in as the
 *            content of the already-open "Add icons" SlideOver, in place
 *            of the search listing. `onBack` is provided there, and
 *            `collectionStar` besides - the action row gets this
 *            collection's own add/remove star, since (unlike entry 1) the
 *            icon may not be saved here yet. Every SearchHit carries
 *            `body: null` by design (search-config.ts's own doc comment),
 *            so this entry is also the one that always needs the
 *            fetch-on-open below.
 *
 * The preview and every export tab start from `savedEdits` - the
 * collection's OWN saved color/stroke, exactly like the grid behind either
 * entry point already renders this icon - then layer the view's own
 * ephemeral, session-only adjustments on top (combineQuickViewEdits,
 * lib/quick-view.ts): transforms (same pattern/copy as IconEditor.tsx's own
 * Transform group), the CSS-styleable output toggle,
 * and a color OVERRIDE that never reads from or writes back to the
 * collection's saved style settings - CollectionStylePanel.tsx is the only
 * place that can change those.
 */
export default function IconQuickView({
  icon,
  tier,
  savedEdits,
  savedSize,
  collectionStar,
  onBack,
}: {
  icon: QuickViewIcon;
  /** Null only for the rare icon whose set left the pipeline (same edge
      case CollectionIconItem.tier already documents) - paired with `body`,
      both being required for any live editing to be possible at all. */
  tier: Tier | null;
  /** The collection's saved color/stroke - the base state this view's
      preview and every export tab start from. Read here, never written. */
  savedEdits: IconEdits;
  savedSize: number | null;
  /** Both entries pass this (originally ENTRY 2 only, see the header
      comment): a full-size, labeled add/remove
      control for THIS collection, in the action row. */
  collectionStar?: {
    collectionId: string;
    iconId: string;
    name: string;
    added: boolean;
    onToggle: (added: boolean) => void;
  };
  /** ENTRY 2 only: renders the "Back to results" control and is called on
      click - and on Escape, which SearchIsland.tsx handles itself (a
      capture-phase listener that wins over the wrapping SlideOver's own
      Escape-closes handler while this view is showing; see that file's own
      comment for why a capture-phase listener, not a registration-order
      argument, is what makes that reliable). Omitted for ENTRY 1. */
  onBack?: () => void;
}) {
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    /* Entry 1 already gets its focus moved to the wrapping SlideOver's own
       close button (SlideOver.tsx's existing open behavior) - stealing it
       a second time here would fight that instead of helping, so this only
       runs when there is a Back control to focus (entry 2). */
    if (onBack) backRef.current?.focus({ preventScroll: true });
  }, [onBack]);

  /* Fetch-on-open: ENTRY 2 always hands this
     view an icon with `body: null` (every SearchHit does, by design - see
     search-config.ts's own doc comment), which used to mean it fell
     straight into the degraded view with a minuscule glyph and a false
     "too large" message for every single icon opened from search - never
     actually rare. Resolve the real body once, client-side, via the same
     JSON endpoint CollectionWorkspace.tsx's handlePanelToggle uses to close
     this same gap for the grid behind that panel. Never fetches for ENTRY 1
     (icon.body is already real there, so `bodyStatus` starts "ready" and
     the effect below no-ops) or for the genuinely rare `tier === null` case
     (a body alone would not let this view do anything with it). */
  const [fetchedBody, setFetchedBody] = useState<{
    body: string;
    width: number;
    height: number;
  } | null>(null);
  const [bodyStatus, setBodyStatus] = useState<"ready" | "loading" | "error">(
    icon.body ? "ready" : "loading",
  );

  useEffect(() => {
    if (icon.body) {
      setBodyStatus("ready");
      return;
    }
    let cancelled = false;
    setFetchedBody(null);
    setBodyStatus("loading");

    fetch(`/api/icon/${icon.prefix}/${icon.name}.json`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("not ok"))))
      .then((data: { body: string; width: number; height: number }) => {
        if (cancelled) return;
        setFetchedBody(data);
        setBodyStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setBodyStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [icon.body, icon.prefix, icon.name]);

  /* What this view actually renders/edits from: `icon` itself once its body
     is real, or the freshly-fetched body layered on top while `icon.body`
     stays null (ENTRY 2, before the fetch above resolves or if it fails).
     Memoized so its identity only changes when `icon`/`fetchedBody`
     actually do - otherwise it would be a fresh object every render,
     defeating the `preview` useMemo below (which depends on it). */
  const effectiveIcon: QuickViewIcon = useMemo(
    () =>
      fetchedBody
        ? { ...icon, body: fetchedBody.body, width: fetchedBody.width, height: fetchedBody.height }
        : icon,
    [icon, fetchedBody],
  );

  const can = tier ? capabilitiesFor(tier) : null;
  const canEdit = Boolean(effectiveIcon.body) && Boolean(tier);

  const [colorOverride, setColorOverride] = useState(savedEdits.color ?? DEFAULT_COLOR);
  const [cssStyleable, setCssStyleable] = useState(false);
  const [rotate, setRotate] = useState<0 | 90 | 180 | 270>(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [padding, setPadding] = useState(0);

  const edits: IconEdits = combineQuickViewEdits({
    savedStrokeWidth: savedEdits.strokeWidth,
    colorOverride,
    cssStyleable,
    canRecolor: can?.recolor ?? false,
    rotate,
    flipH,
    flipV,
    padding,
  });

  const preview = useMemo(() => {
    if (!effectiveIcon.body || !tier) return null;
    return buildInlineSvg(
      {
        prefix: effectiveIcon.prefix,
        name: effectiveIcon.name,
        body: effectiveIcon.body,
        width: effectiveIcon.width,
        height: effectiveIcon.height,
      },
      edits,
      tier,
      'width="100%" height="100%"',
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    effectiveIcon,
    tier,
    edits.color,
    edits.strokeWidth,
    edits.cssStyleable,
    edits.rotate,
    edits.flipH,
    edits.flipV,
    edits.padding,
  ]);

  const detailHref = `/${icon.prefix}/${icon.name}`;
  const colorChanged = colorOverride !== (savedEdits.color ?? DEFAULT_COLOR);

  return (
    <div className="flex flex-col gap-8 px-6 py-6">
      {onBack && (
        <button
          ref={backRef}
          type="button"
          onClick={onBack}
          className="self-start text-meta font-semibold text-blue-deep"
        >
          &larr; Back to results
        </button>
      )}

      <div
        className="grid-paper relative mx-auto flex aspect-square w-full max-w-[240px] items-center justify-center rounded-panel p-8 shadow-card"
        style={canEdit && cssStyleable ? { color: colorOverride } : undefined}
      >
        {canEdit && preview ? (
          <div className="h-full w-full" dangerouslySetInnerHTML={{ __html: preview }} />
        ) : bodyStatus === "loading" ? (
          /* The fetch above is still in flight (ENTRY 2's normal first
             paint) - an honest loading state, never the degraded message or
             a tiny placeholder glyph (the old
             fallback rendered here unconditionally, at 96px in a ~208px
             box, reading as "minuscule" even on the success path). */
          <span role="status" className="text-ink-muted">
            <span className="sr-only">Loading icon…</span>
            <SpinnerIcon size={40} />
          </span>
        ) : (
          <StyledIconGlyph
            item={{
              prefix: effectiveIcon.prefix,
              name: effectiveIcon.name,
              body: effectiveIcon.body,
              width: effectiveIcon.width,
              height: effectiveIcon.height,
              tier,
            }}
            edits={{}}
            /* h-full/w-full (not the shrink-only h-auto/w-auto pattern other
               StyledIconGlyph callers use) so this actually FILLS the
               surface - a viewBox'd inline SVG scales like object-fit:
               contain automatically via its default preserveAspectRatio,
               and object-contain covers the <img> fallback branch the same
               way, so neither ever distorts a non-square icon. */
            size={176}
            className="h-full w-full max-h-full max-w-full object-contain"
          />
        )}
      </div>

      {!canEdit && bodyStatus !== "loading" && (
        <p className="text-center text-pill text-ink-muted">
          Could not load this icon&apos;s artwork - open its full page to view
          and edit it.
        </p>
      )}

      {collectionStar && (
        <AddToCollectionStar
          iconId={collectionStar.iconId}
          name={collectionStar.name}
          collectionId={collectionStar.collectionId}
          added={collectionStar.added}
          onToggle={collectionStar.onToggle}
          variant="cta"
        />
      )}

      {canEdit && (
        <>
          <Group label="Transform">
            <div className="flex flex-wrap gap-2">
              <Choice
                active={rotate !== 0}
                onClick={() =>
                  setRotate((current) =>
                    current === 0 ? 90 : current === 90 ? 180 : current === 180 ? 270 : 0,
                  )
                }
              >
                Rotate {rotate}&deg;
              </Choice>
              <Choice active={flipH} onClick={() => setFlipH((value) => !value)}>
                Flip H
              </Choice>
              <Choice active={flipV} onClick={() => setFlipV((value) => !value)}>
                Flip V
              </Choice>
              <Choice active={padding > 0} onClick={() => setPadding(padding > 0 ? 0 : 0.1)}>
                Padding {padding > 0 ? "10%" : "none"}
              </Choice>
            </div>
          </Group>

          <Group label="Output">
            <label className="flex items-center gap-3 text-meta">
              <input
                type="checkbox"
                checked={cssStyleable}
                onChange={(event) => setCssStyleable(event.target.checked)}
                className="size-5 rounded-[4px] border-2 border-ink accent-ink"
              />
              CSS-styleable (no baked-in color - takes the text color around it)
            </label>
          </Group>

          {can?.recolor ? (
            <Group label="Color - just for this export">
              <ColorField value={colorOverride} onChange={setColorOverride} />
              <p className="mt-3 text-meta text-ink-muted">
                Only changes what you preview and export right here - the
                collection keeps its own saved color.
              </p>
              {colorChanged && (
                <button
                  type="button"
                  onClick={() => setColorOverride(savedEdits.color ?? DEFAULT_COLOR)}
                  className="mt-3 text-meta font-semibold text-blue-deep"
                >
                  Reset to the collection&apos;s color
                </button>
              )}
            </Group>
          ) : (
            <Group label="Color - just for this export">
              <p className="text-meta text-ink-muted">
                This set uses masks or gradients, so recoloring would change
                the artwork rather than restyle it.
              </p>
            </Group>
          )}
        </>
      )}

      <a href={detailHref} className="self-start text-meta font-semibold text-blue-deep">
        Open full page &rarr;
      </a>

      {effectiveIcon.body && tier && (
        <div>
          <h2 className="mb-4 text-h3 font-semibold">Every format, live</h2>
          <FormatPreviewPanel
            icon={{
              prefix: effectiveIcon.prefix,
              name: effectiveIcon.name,
              body: effectiveIcon.body,
              width: effectiveIcon.width,
              height: effectiveIcon.height,
            }}
            tier={tier}
            edits={edits}
            size={savedSize ?? DEFAULT_SIZE}
          />
        </div>
      )}
    </div>
  );
}
