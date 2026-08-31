import { useMemo, useState } from "react";
import type { IconSource, Tier } from "../../lib/data";
/* Leaf imports, not the barrel: the barrel re-exports the PNG module, which
   pulls the resvg native binary into the client bundle. */
import { extractPalette } from "../../lib/transforms/color";
import {
  buildInlineSvg,
  capabilitiesFor,
  type IconEdits,
} from "../../lib/transforms/svg-doc";
import { TIER_COPY } from "../../lib/tier-copy";
import { Choice, ColorField, Group, SIZES, STROKE_WIDTHS } from "./editor/Controls";
import { useAccount } from "./useAccount";
import FormatPreviewPanel from "./FormatPreviewPanel";
import SaveButton from "./SaveButton";

const DEFAULT_SIZE = 128;
const DEFAULT_COLOR = "#183153";

/**
 * The icon workbench: preview left, editing controls right, a capability
 * card explaining what this tier can do, and the format preview panel - one
 * tab per export format, live with whatever is set here - below both.
 *
 * Preview and the code tabs run the same transform functions the server
 * uses, so what you copy is exactly what you saw. PNG, SwiftUI and the asset
 * catalog's zip go through /api/export because they need a rasterizer, a
 * path translator or a zip - work that does not belong in a page bundle.
 *
 * Controls follow the icon's tier, not a plan: a control that cannot work
 * for this icon is not rendered, and the reason is stated in words. That is
 * the capability-honesty rule. Everything the editor can do, it does for
 * everyone - the only thing an account changes is where Save puts the
 * icon.
 */
export default function IconEditor({
  icon,
  tier,
}: {
  icon: IconSource;
  tier: Tier;
}) {
  const can = capabilitiesFor(tier);
  const copyFor = TIER_COPY[tier];
  const palette = useMemo(() => extractPalette(icon.body), [icon.body]);
  const { signedIn, ready } = useAccount();

  const [size, setSize] = useState(DEFAULT_SIZE);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [strokeWidth, setStrokeWidth] = useState<number | null>(null);
  const [cssStyleable, setCssStyleable] = useState(false);
  const [rotate, setRotate] = useState<0 | 90 | 180 | 270>(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [padding, setPadding] = useState(0);

  const edits: IconEdits = {
    color: can.recolor && !cssStyleable ? color : undefined,
    strokeWidth: can.strokeRetarget && strokeWidth !== null ? strokeWidth : undefined,
    cssStyleable,
    rotate: rotate === 0 ? undefined : rotate,
    flipH,
    flipV,
    padding: padding || undefined,
  };

  const preview = useMemo(
    () =>
      buildInlineSvg(icon, edits, tier, 'width="100%" height="100%"'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [icon, tier, color, strokeWidth, cssStyleable, rotate, flipH, flipV, padding],
  );

  return (
    <div className="flex flex-col gap-12">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div
          className="grid-paper relative flex aspect-square w-full items-center justify-center rounded-panel p-12 shadow-card"
          style={{ color: cssStyleable ? color : undefined }}
        >
          <SaveButton
            iconId={`${icon.prefix}:${icon.name}`}
            signedIn={signedIn}
            accountLoading={!ready}
          />
          <div
            className="h-full w-full"
            dangerouslySetInnerHTML={{ __html: preview }}
          />
        </div>

        <div className="flex flex-col gap-8">
          <Group label="Size">
            <div className="flex flex-wrap gap-2">
              {SIZES.map((value) => (
                <Choice
                  key={value}
                  active={size === value}
                  onClick={() => setSize(value)}
                >
                  {value}
                </Choice>
              ))}
            </div>
          </Group>

          {can.recolor ? (
            <Group label="Color">
              <ColorField value={color} onChange={setColor} />
              {can.perPathRecolor && palette.length > 1 && (
                <p className="mt-3 text-meta text-ink-muted">
                  This icon uses {palette.length} colors. Picking one flattens it;
                  per-path recoloring arrives with the style engine.
                </p>
              )}
            </Group>
          ) : (
            <Group label="Color">
              <p className="text-meta text-ink-muted">
                This set uses masks or gradients, so recoloring would change the
                artwork rather than restyle it. Size and export still work.
              </p>
            </Group>
          )}

          {can.strokeRetarget ? (
            <Group label="Stroke width">
              <div className="flex flex-wrap gap-2">
                <Choice active={strokeWidth === null} onClick={() => setStrokeWidth(null)}>
                  Original
                </Choice>
                {STROKE_WIDTHS.map((value) => (
                  <Choice
                    key={value}
                    active={strokeWidth === value}
                    onClick={() => setStrokeWidth(value)}
                  >
                    {value}
                  </Choice>
                ))}
              </div>
            </Group>
          ) : (
            <Group label="Stroke width">
              <p className="text-meta text-ink-muted">
                {copyFor.strokeAbsentReason}{" "}
                <a href="/search?tier=T1" className="prose-link">
                  Browse icons with a stroke to retarget
                </a>
                .
              </p>
            </Group>
          )}

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
        </div>
      </div>

      <div className="rounded-card bg-surface px-8 py-7 text-ink shadow-card">
        <h2 className="text-h3 font-semibold">{copyFor.label}</h2>
        <p className="mt-2 text-ink-muted">{copyFor.summary}</p>
      </div>

      <div>
        <h2 className="mb-4 text-h3 font-semibold">Every format, live</h2>
        <p className="mb-6 text-ink-muted">
          Every tab below reflects the color, size, stroke and transform set
          above - change something up there and every export updates with it.
        </p>
        <FormatPreviewPanel
          icon={icon}
          tier={tier}
          edits={edits}
          size={size}
        />
      </div>
    </div>
  );
}
