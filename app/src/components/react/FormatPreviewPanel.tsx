import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { IconSource, Tier } from "../../lib/data";
/* Leaf imports throughout, not the barrel: ./index re-exports ./png, which
   pulls the resvg native binary into the client bundle (same reasoning as
   IconEditor.tsx). PNG itself is never generated here - the PNG tab is an
   <img> against /api/export, which runs resvg on the server. */
import { buildSvg, type IconEdits } from "../../lib/transforms/svg-doc";
import { toJsxComponent } from "../../lib/transforms/jsx";
import { toSvelteComponent, toVueComponent } from "../../lib/transforms/components";
import { toBase64DataUri } from "../../lib/transforms/data-uri";
import { toSwiftUi, type SwiftUiKind } from "../../lib/transforms/swiftui";
import { assetName, contentsJson } from "../../lib/transforms/asset-catalog";
import { EXPORT_FORMATS, type ExportFormat } from "../../lib/transforms/formats";
import { buildExportUrl } from "../../lib/transforms/export-url";
import { highlightCode, type HighlightLang } from "../../lib/code-highlight";

const NOTE: Partial<Record<ExportFormat, string>> = {
  svg: "A standalone SVG document at the size selected on the left.",
  jsx: "A React component. Size defaults to 1em, so it inherits from font-size like an icon font would.",
  tsx: "The same component, typed for React + TypeScript.",
  vue: "A Vue 3 single-file component with size and color props, color defaulting to currentColor.",
  svelte: "A Svelte 5 component with size and color props, color defaulting to currentColor.",
  datauri:
    "Base64-encoded, at the cost of being larger than the plain SVG - drop it into an img src, a CSS background-image or a mask-image.",
};

/* Exported for IconEditor.tsx's WebMCP handle, which reports a format as
   unsupported to an agent with the same sentence the tab prints to the human -
   one wording, one source. */
export const SWIFTUI_NOTE: Record<SwiftUiKind, string> = {
  shape:
    "Exports as a SwiftUI Shape: fill it, stroke it or animate it like any built-in shape.",
  view: "This artwork is multicolor, so it exports as a layered SwiftUI View - one Shape per color in a ZStack, because a single Shape can only hold one fill.",
  unsupported:
    "This artwork uses masks or gradients, which have no honest Path equivalent - generating one anyway would silently misrepresent the icon. The asset catalog tab reproduces it exactly instead.",
};

type PanelContent =
  | { kind: "code"; code: string; html: string; swiftUiKind?: SwiftUiKind }
  | { kind: "image" }
  | { kind: "catalog"; asset: string; svgName: string; json: string; html: string };

/**
 * The one place a format turns into code. Exported so IconEditor.tsx's
 * `get_icon_code` WebMCP tool answers an agent with the very string this panel
 * puts on the screen, rather than a second rendering path that could drift
 * from it.
 */
export function codeFor(
  id: ExportFormat,
  icon: IconSource,
  edits: IconEdits,
  size: number,
  tier: Tier,
): { code: string; lang: HighlightLang; swiftUiKind?: SwiftUiKind } {
  switch (id) {
    case "svg":
      return { code: buildSvg(icon, { ...edits, size }, tier), lang: "markup" };
    case "jsx":
      return {
        code: toJsxComponent(icon, edits, tier, { typescript: false }),
        lang: "jsx",
      };
    case "tsx":
      return {
        code: toJsxComponent(icon, edits, tier, { typescript: true }),
        lang: "jsx",
      };
    case "vue":
      return { code: toVueComponent(icon, edits, tier), lang: "jsx" };
    case "svelte":
      return { code: toSvelteComponent(icon, edits, tier), lang: "jsx" };
    case "swiftui": {
      const result = toSwiftUi(icon, edits, tier);
      return { code: result.code, lang: "swift", swiftUiKind: result.kind };
    }
    case "datauri":
      return {
        code: toBase64DataUri(buildSvg(icon, { ...edits, size }, tier)),
        lang: "text",
      };
    default:
      return { code: "", lang: "text" };
  }
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* Clipboard API needs a secure context; fall back to a scratch node,
       same approach as CodePanel.astro's vanilla-JS copy button. */
    const legacy = document as unknown as {
      execCommand?: (command: string) => boolean;
    };
    if (!legacy.execCommand) return false;

    const scratch = document.createElement("textarea");
    scratch.value = text;
    scratch.setAttribute("readonly", "");
    scratch.style.position = "fixed";
    scratch.style.opacity = "0";
    document.body.appendChild(scratch);
    scratch.select();
    const copied = legacy.execCommand("copy");
    document.body.removeChild(scratch);
    return copied;
  }
}

/**
 * The format preview panel - one tab per export format, live with the
 * current editor state.
 *
 * IconBuddy does not have this: it shows one export at a time, after a click.
 * Here every format the library offers is one tab away, already rendered with
 * whatever color/size/stroke/transform the icon is currently wearing, so what
 * gets copied is exactly what got looked at.
 *
 * Code tabs are highlighted client-side (code-highlight.ts) rather than with
 * Shiki - Shiki only runs during Astro's render pass, and this panel
 * re-renders on every edit inside an already-hydrated island. PNG is a real
 * <img> against /api/export (resvg has to run somewhere, and that somewhere
 * is the server). The asset catalog tab shows the file listing and
 * Contents.json the zip actually contains, not the zip itself.
 */
export default function FormatPreviewPanel({
  icon,
  tier,
  edits,
  size,
  preferredFormat = null,
  onFormatChange,
}: {
  icon: IconSource;
  tier: Tier;
  edits: IconEdits;
  size: number;
  /** Preselect a tab - the same effect as clicking that tab by hand. `null`
      returns to the panel's own "svg" default. IconEditor.tsx drives this so
      an agent's `get_icon_code` / `download_icon` call opens the tab it is
      talking about; a future caller could use it for, say, a collection's
      preferred export format. */
  preferredFormat?: ExportFormat | null;
  /** Fires whenever the human switches tabs, so a parent driving
      `preferredFormat` does not go stale behind their clicks. */
  onFormatChange?: (format: ExportFormat) => void;
}) {
  const [activeTab, setActiveTab] = useState<ExportFormat>("svg");
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const copyResetRef = useRef<number | undefined>(undefined);
  const previousPreferredRef = useRef<ExportFormat | null>(null);

  useEffect(() => {
    if (preferredFormat !== previousPreferredRef.current) {
      setActiveTab(preferredFormat ?? "svg");
      previousPreferredRef.current = preferredFormat;
    }
  }, [preferredFormat]);

  const exportUrl = (format: string) => buildExportUrl(icon.prefix, icon.name, format, edits, size);

  /* Every panel, not just the active one: CodePanel.astro keeps every pane in
     the DOM and toggles `hidden`, which is friendlier to assistive tech than
     mounting only the active tab (aria-controls always points at something
     real) and avoids losing state on switch. Icon bodies are tiny, so
     computing all nine formats on every edit is cheap - the one moderately
     real cost, SwiftUI's path parsing, is still sub-millisecond at this
     scale. */
  const panels = useMemo(() => {
    const map = {} as Record<ExportFormat, PanelContent>;
    for (const format of EXPORT_FORMATS) {
      if (format.id === "png") {
        map[format.id] = { kind: "image" };
        continue;
      }
      if (format.id === "catalog") {
        const asset = assetName(icon.prefix, icon.name);
        const svgName = `${asset}.svg`;
        const json = contentsJson(svgName);
        map[format.id] = {
          kind: "catalog",
          asset,
          svgName,
          json,
          html: highlightCode(json, "json"),
        };
        continue;
      }
      const { code, lang, swiftUiKind } = codeFor(format.id, icon, edits, size, tier);
      map[format.id] = { kind: "code", code, html: highlightCode(code, lang), swiftUiKind };
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    icon,
    tier,
    size,
    edits.color,
    edits.strokeWidth,
    edits.cssStyleable,
    edits.rotate,
    edits.flipH,
    edits.flipV,
    edits.padding,
  ]);

  const copyActive = async () => {
    const panel = panels[activeTab];
    const text = panel.kind === "code" ? panel.code : panel.kind === "catalog" ? panel.json : "";
    if (!text) return;

    window.clearTimeout(copyResetRef.current);
    if (await writeClipboard(text)) {
      setCopied(true);
      setNotice(null);
      copyResetRef.current = window.setTimeout(() => setCopied(false), 1600);
    } else {
      setNotice("Could not reach the clipboard. Use the download link instead.");
    }
  };

  const selectTab = (id: ExportFormat) => {
    setActiveTab(id);
    setCopied(false);
    setNotice(null);
    onFormatChange?.(id);
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;

    let next = -1;
    if (step !== 0) {
      next = (index + step + EXPORT_FORMATS.length) % EXPORT_FORMATS.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = EXPORT_FORMATS.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const id = EXPORT_FORMATS[next]!.id;
    selectTab(id);
    tabRefs.current[id]?.focus();
  };

  const activePanel = panels[activeTab];
  const activeLabel = EXPORT_FORMATS.find((format) => format.id === activeTab)!.label;

  return (
    <div className="on-navy overflow-hidden rounded-card bg-ink text-on-dark">
      {/* Tab strip: underline tabs, matching the code-panel spec. This once
          used button-shaped chips instead, because an earlier attempt
          wrapped to a second row and looked broken; this version fixes the
          two things that actually caused that, rather than avoiding
          underline tabs altogether: (1) the row never wraps - `flex-nowrap`
          plus `shrink-0` per tab, with the CSS-background tab gone there is
          exactly enough width for the remaining nine at desktop, and below
          that width the strip scrolls horizontally in its own
          `overflow-x-auto` container (`scroll-dark`'s thin styled scrollbar,
          the non-negotiable stand-in for a bare native one) instead of
          wrapping or squeezing; (2) the baseline is one continuous rule
          (`border-b-2 border-ink-deep` on the shared track, `ink-deep`
          being the one darker navy the palette has), not a per-tab border
          that only rendered under whichever tab happened to be active - so
          it is always there under every tab, active or not. The active
          tab's own indicator is a `--primary` yellow bar absolutely
          positioned over that baseline (not part of layout flow, so it adds
          no height and can't be the thing that reserved dead space above
          the label last time). `w-max min-w-full` on the track makes the
          baseline span the wider of "all nine tabs" or "the full panel
          width", so it never stops short even when the tabs alone don't
          fill the row. */}
      <div className="px-8 pt-5">
        <div className="scroll-dark overflow-x-auto">
          <div
            role="tablist"
            aria-label="Export format"
            className="flex w-max min-w-full flex-nowrap gap-6 border-b-2 border-ink-deep"
          >
            {EXPORT_FORMATS.map((format, index) => {
              const isActive = format.id === activeTab;
              return (
                <button
                  key={format.id}
                  ref={(element) => {
                    tabRefs.current[format.id] = element;
                  }}
                  type="button"
                  role="tab"
                  id={`format-tab-${format.id}`}
                  aria-controls={`format-panel-${format.id}`}
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => selectTab(format.id)}
                  onKeyDown={(event) => onTabKeyDown(event, index)}
                  className={`relative shrink-0 whitespace-nowrap pt-2 pb-2.5 text-pill font-bold uppercase transition-colors duration-[120ms] ease-in ${
                    isActive ? "text-white" : "text-white/60 hover:text-white/85"
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5">{format.label}</span>
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-0 -bottom-[2px] h-[3px] rounded-full bg-primary"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-start gap-2 px-8">
        {activePanel.kind !== "image" && (
          <button
            type="button"
            onClick={copyActive}
            className="touch-target inline-flex items-center justify-center gap-2 rounded-control border-2 border-white/40 px-3 py-[9px] text-pill font-bold text-on-dark uppercase transition-colors duration-[120ms] ease-in hover:border-white/65"
          >
            {copied ? (
              <>
                <CheckGlyph /> Copied
              </>
            ) : (
              <>
                <CopyGlyph /> Copy
              </>
            )}
          </button>
        )}
        <a
          href={exportUrl(activeTab)}
          className="touch-target inline-flex items-center justify-center gap-2 rounded-control border-2 border-white/40 px-3 py-[9px] text-pill font-bold text-on-dark uppercase no-underline transition-colors duration-[120ms] ease-in hover:border-white/65"
        >
          <DownloadGlyph /> Download
        </a>
      </div>

      {/* Card-interior padding (cards pad 28px/32px) on every
          side, not just the sides that happened to touch a tab or a button -
          the content needs the same breathing room the rest of the design
          system gives a card. Top padding stays small because the actions
          row above already provided some. */}
      <div className="px-8 pt-2 pb-8">
        {EXPORT_FORMATS.map((format) => {
          const panel = panels[format.id];
          return (
            <div
              key={format.id}
              role="tabpanel"
              id={`format-panel-${format.id}`}
              aria-labelledby={`format-tab-${format.id}`}
              hidden={format.id !== activeTab}
            >
              {panel.kind === "image" ? (
                <PngPane icon={icon} size={size} exportUrl={exportUrl} />
              ) : panel.kind === "catalog" ? (
                <CatalogPane asset={panel.asset} svgName={panel.svgName} html={panel.html} />
              ) : (
                <>
                  <pre className="scroll-dark overflow-x-auto font-mono text-code" tabIndex={0}>
                    <code dangerouslySetInnerHTML={{ __html: panel.html }} />
                  </pre>
                  <p className="mt-4 text-meta text-on-dark-muted">
                    {panel.swiftUiKind ? SWIFTUI_NOTE[panel.swiftUiKind] : NOTE[format.id]}
                  </p>
                </>
              )}
            </div>
          );
        })}
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        {copied ? `${activeLabel} copied to clipboard` : ""}
      </span>

      {notice && (
        <div className="flex items-center gap-x-6 gap-y-2 bg-ink-deep px-8 py-4 text-meta text-on-dark-muted">
          {notice}
        </div>
      )}
    </div>
  );
}

function PngPane({
  icon,
  size,
  exportUrl,
}: {
  icon: IconSource;
  size: number;
  exportUrl: (format: string) => string;
}) {
  const displaySize = Math.min(size, 320);
  return (
    <div className="flex flex-col items-center gap-4 py-2">
      <div className="grid-paper flex aspect-square w-full max-w-[320px] items-center justify-center rounded-panel p-6">
        <img
          src={exportUrl("png")}
          alt={`${icon.name} icon, ${size}px PNG`}
          width={displaySize}
          height={displaySize}
          style={size < 64 ? { imageRendering: "pixelated" } : undefined}
        />
      </div>
      <p className="text-meta text-on-dark-muted">
        {size}&times;{size}px, rasterized on request and cached forever.
      </p>
    </div>
  );
}

function CatalogPane({
  asset,
  svgName,
  html,
}: {
  asset: string;
  svgName: string;
  html: string;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-pill font-bold text-on-dark-muted uppercase">Files in the zip</p>
        <pre className="scroll-dark mt-2 overflow-x-auto font-mono text-code" tabIndex={0}>
          <code>{`${asset}.imageset/\n  Contents.json\n  ${svgName}`}</code>
        </pre>
      </div>
      <div>
        <p className="text-pill font-bold text-on-dark-muted uppercase">Contents.json</p>
        <pre className="scroll-dark mt-2 overflow-x-auto font-mono text-code" tabIndex={0}>
          <code dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
      </div>
      <p className="text-meta text-on-dark-muted">
        An .imageset holding the SVG with preserve-vector-data, which renders
        crisp at any point size and reproduces the artwork exactly - the
        universal fallback, including for masks and gradients that defeat
        SwiftUI Path codegen.
      </p>
    </div>
  );
}

/* Inline copies of Icon.astro's copy/check/download glyphs - Icon.astro is an
   .astro component and cannot be used from inside a React island. */
function CopyGlyph() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M15 5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h1" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m4 12.5 5.5 5.5L20 6.5" />
    </svg>
  );
}

function DownloadGlyph() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="m7 10.5 5 5 5-5" />
      <path d="M4 20h16" />
    </svg>
  );
}
