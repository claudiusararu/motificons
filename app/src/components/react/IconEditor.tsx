import { useEffect, useMemo, useRef, useState } from "react";
import type { IconSource, Tier } from "../../lib/data";
/* Leaf imports, not the barrel: the barrel re-exports the PNG module, which
   pulls the resvg native binary into the client bundle. */
import { extractPalette } from "../../lib/transforms/color";
import {
  buildInlineSvg,
  capabilitiesFor,
  type IconEdits,
} from "../../lib/transforms/svg-doc";
import { assetName, contentsJson } from "../../lib/transforms/asset-catalog";
import { buildExportUrl } from "../../lib/transforms/export-url";
import { EXPORT_FORMATS, type ExportFormat } from "../../lib/transforms/formats";
import { TIER_COPY } from "../../lib/tier-copy";
import { registerWebMcpTools } from "../../lib/webmcp/bridge";
import {
  createIconTools,
  type IconEditState,
  type IconFormat,
  type IconToolHandle,
} from "../../lib/webmcp/icon-tools";
import { Choice, ColorField, Group, SIZES, STROKE_WIDTHS } from "./editor/Controls";
import { useAccount } from "./useAccount";
import FormatPreviewPanel, { codeFor, SWIFTUI_NOTE } from "./FormatPreviewPanel";
import SaveButton from "./SaveButton";

const DEFAULT_SIZE = 128;
const DEFAULT_COLOR = "#183153";

/** The 10% the padding button toggles on. */
const PADDING_STEP = 0.1;

/** Ceiling svg-doc.ts clamps padding to - the widest inset the transform
    pipeline will honour, so the widest a tool may ask for. */
const MAX_PADDING = 0.4;

/** Printed where the color control would be when the artwork cannot take a
    recolor, and handed verbatim to an agent that asks for one anyway. */
const RECOLOR_ABSENT_REASON =
  "This set uses masks or gradients, so recoloring would change the artwork " +
  "rather than restyle it. Size and export still work.";

/** What the page knows about the icon that the artwork itself does not carry:
    which set it came from, and what its license asks for. */
export interface IconEditorMeta {
  setName: string;
  /** The set's style when it declares exactly one, null when it mixes. */
  style: string | null;
  /** SPDX id where there is one, the license title otherwise. */
  license: string;
  attributionRequired: boolean;
}

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
 *
 * It is also the page's WebMCP surface: a browser agent gets tools to read
 * the icon, restyle it, read one format's code and download it, all of which
 * drive the controls below rather than a private copy - see the handle near
 * the end of this component.
 */
export default function IconEditor({
  icon,
  tier,
  meta,
}: {
  icon: IconSource;
  tier: Tier;
  meta: IconEditorMeta;
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
  /* The format panel's open tab, lifted here so the WebMCP tools can open the
     tab they are talking about. The panel still owns the click handling and
     reports back through onFormatChange, so the human's own tab clicks keep
     this in step. */
  const [format, setFormat] = useState<ExportFormat>("svg");

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

  /* ---------------------------------------------------------------------
     WebMCP: the agent-facing half of the workbench.

     Every tool below goes through this component's own setters and this
     component's own export functions. An agent that recolors the icon moves
     the same state the human's color picker moves, so the preview they are
     watching changes; an agent that asks for the SwiftUI code gets the string
     out of the tab it just opened for them. There is no headless second copy
     of the icon anywhere in here.

     `latest` follows the DOM rather than a render pass, the same way
     SearchIsland.tsx does it: a tool call can arrive between renders, and it
     must read what is on the screen.
     --------------------------------------------------------------------- */
  const latest = useRef({ size, color, strokeWidth, cssStyleable, rotate, flipH, flipV, padding, edits, format });
  useEffect(() => {
    latest.current = { size, color, strokeWidth, cssStyleable, rotate, flipH, flipV, padding, edits, format };
  });

  const webmcpHandle = useMemo<IconToolHandle>(() => {
    const readEdits = (): IconEditState => {
      const state = latest.current;
      return {
        size: state.size,
        color: state.color,
        strokeWidth: state.strokeWidth,
        cssStyleable: state.cssStyleable,
        rotate: state.rotate,
        flipH: state.flipH,
        flipV: state.flipV,
        padding: state.padding,
      };
    };

    /* What the panel offers for THIS artwork, not what the format registry
       lists: SwiftUI codegen is decided by the geometry, so the answer comes
       from the same call the SwiftUI tab makes. */
    const readFormats = (): IconFormat[] =>
      EXPORT_FORMATS.map((entry) => {
        if (entry.id === "png") {
          return { id: entry.id, label: entry.label, kind: "image", supported: true };
        }
        if (entry.id === "catalog") {
          return { id: entry.id, label: entry.label, kind: "files", supported: true };
        }
        if (entry.id === "swiftui") {
          const state = latest.current;
          const kind =
            codeFor("swiftui", icon, state.edits, state.size, tier).swiftUiKind ??
            "unsupported";
          return {
            id: entry.id,
            label: entry.label,
            kind: "code",
            supported: kind !== "unsupported",
            note: SWIFTUI_NOTE[kind],
          };
        }
        return { id: entry.id, label: entry.label, kind: "code", supported: true };
      });

    return {
      identity: () => ({
        name: icon.name,
        set: meta.setName,
        prefix: icon.prefix,
        style: meta.style,
        license: meta.license,
        attributionRequired: meta.attributionRequired,
        capability: {
          tier,
          label: copyFor.label,
          summary: copyFor.summary,
          canRecolor: can.recolor,
          canRetargetStroke: can.strokeRetarget,
          recolorAbsentReason: RECOLOR_ABSENT_REASON,
          strokeAbsentReason: copyFor.strokeAbsentReason,
        },
      }),
      constraints: () => ({
        sizes: SIZES,
        strokeWidths: STROKE_WIDTHS,
        maxPadding: MAX_PADDING,
      }),
      edits: readEdits,
      formats: readFormats,
      activeFormat: () => latest.current.format,
      applyStyle: (patch) => {
        if (patch.size !== undefined) setSize(patch.size);
        if (patch.color !== undefined) setColor(patch.color);
        if (patch.strokeWidth !== undefined) setStrokeWidth(patch.strokeWidth);
        if (patch.rotate !== undefined) setRotate(patch.rotate);
        if (patch.flipH !== undefined) setFlipH(patch.flipH);
        if (patch.flipV !== undefined) setFlipV(patch.flipV);
        if (patch.padding !== undefined) setPadding(patch.padding);
        /* React has not re-rendered yet, so report the state these setters
           are about to land on rather than the one they replaced. */
        return { ...readEdits(), ...patch };
      },
      code: (id) => {
        const chosen = id as ExportFormat;
        setFormat(chosen);
        const state = latest.current;
        if (chosen === "catalog") {
          /* Same string the catalog tab's Copy button puts on the clipboard. */
          return {
            code: contentsJson(`${assetName(icon.prefix, icon.name)}.svg`),
            lang: "json",
          };
        }
        const result = codeFor(chosen, icon, state.edits, state.size, tier);
        return {
          code: result.code,
          lang: result.lang,
          ...(result.swiftUiKind ? { note: SWIFTUI_NOTE[result.swiftUiKind] } : {}),
        };
      },
      download: (id) => {
        const chosen = id as ExportFormat;
        setFormat(chosen);
        const state = latest.current;
        /* buildExportUrl is the panel's own Download href (export-url.ts is
           the single builder), so this is that link, clicked. */
        const url = buildExportUrl(icon.prefix, icon.name, chosen, state.edits, state.size);
        const link = document.createElement("a");
        link.href = url;
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();
        link.remove();
        return url;
      },
    };
  }, [icon, tier, meta, can.recolor, can.strokeRetarget, copyFor]);

  useEffect(() => registerWebMcpTools(createIconTools(webmcpHandle)), [webmcpHandle]);

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
              <p className="text-meta text-ink-muted">{RECOLOR_ABSENT_REASON}</p>
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
              {/* The button toggles the standard 10%, but the label reads the
                  real value: a WebMCP style_icon call may set any inset up to
                  MAX_PADDING, and a button that still said "10%" would be
                  lying about the preview next to it. */}
              <Choice
                active={padding > 0}
                onClick={() => setPadding(padding > 0 ? 0 : PADDING_STEP)}
              >
                Padding {padding > 0 ? `${Math.round(padding * 100)}%` : "none"}
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
          preferredFormat={format}
          onFormatChange={setFormat}
        />
      </div>
    </div>
  );
}
