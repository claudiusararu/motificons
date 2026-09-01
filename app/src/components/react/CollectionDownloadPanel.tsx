import { useEffect, useRef, useState } from "react";
import type { IconEdits } from "../../lib/transforms/svg-doc";
import { saveCollectionStyles } from "../../lib/collection-style-save";
import { EXPORT_FORMATS, type ExportFormat } from "../../lib/transforms/formats";
import {
  buildCollectionDownloadUrl,
  resolveExportSize,
  slugifyFilename,
  summarizeCollectionStyles,
} from "../../lib/collection-download";
import type { CollectionIconItem } from "./CollectionIconGrid";
import type { CollectionStyleSettings } from "./CollectionStylePanel";
import { Choice, Group, SIZES } from "./editor/Controls";
import { CheckIcon, SpinnerIcon } from "./save/icons";

/** api/collections/[id]/download/[name].zip's own PNG default when no `size`
    param is sent - mirrored here so the panel's shown default and the
    server's actual behavior can never quietly disagree (also documented on
    resolveExportSize, which is what actually applies this). */
const DEFAULT_PNG_SIZE = 512;

/** How long the panel says "Building your zip" before it switches to the
    handed-off line. The server is genuinely working for about that long on
    a normal collection, and after the click there is nothing left for this
    page to observe: a navigation to an attachment never unloads it and
    never reports back. So the panel stops claiming to know, and says what
    is actually true - the browser has it now. */
const BUILDING_MS = 1_500;

type DownloadStatus = "idle" | "building" | "handed-off";

/** What an auto-started run reports back to whoever asked for it - today
    only CollectionWorkspace.tsx's WebMCP `download_collection` tool. */
export interface AutoDownloadResult {
  ok: boolean;
  count: number;
  format: ExportFormat;
  /** The name the browser saves the zip under. */
  filename: string;
  /** The panel's own error sentence, when the run could not be started. */
  error?: string;
}

/**
 * "Download collection": one zip of every icon in the collection.
 *
 * The zip is built ON THE SERVER and this panel only points the browser at
 * it - a plain, same-origin GET that answers with `Content-Disposition:
 * attachment`. The Download control is a real `<a href>`, so it is
 * right-clickable, copyable, and above all trackable by whatever is actually
 * doing the downloading.
 *
 * It used to zip in the page with fflate and hand over a blob URL. That is
 * undownloadable in an embedded browser: the ChatGPT desktop app passes
 * downloads to an external manager which fetches the URL after the click and
 * has no access to the page's blob store, so every such download registered
 * and then stopped. Keeping the blob alive longer did not help, because the
 * manager was never able to read it at all. A URL on the origin is something
 * it already knows how to fetch - as long as the URL does not need a cookie
 * that manager has never had, which is why the href carries a signed
 * `token` as well (lib/download-token.ts).
 *
 * Export format lives here, not in CollectionStylePanel.tsx - it is
 * genuinely a download-time choice, not a look the icons wear on the page.
 * The collection's stored `exportFormat` is still the remembered default
 * (preselected on open) and is still updated on download, via the same
 * full-replace PUT CollectionStylePanel.tsx uses - `onFormatSaved` mirrors
 * that panel's `onSaved` so CollectionWorkspace.tsx's one `styleSettings`
 * value stays the single source of truth for both panels.
 */
export default function CollectionDownloadPanel({
  collectionId,
  collectionName,
  downloadToken,
  items,
  styleSettings,
  savedEdits,
  onFormatSaved,
  autoStart = false,
  onAutoStartSettled,
}: {
  collectionId: string;
  collectionName: string;
  /** The page's signed download token, put on the anchor's href so the URL
      can authenticate itself.

      It is minted once, at page render, and is good for 15 minutes. That is
      long enough for the ordinary open-panel-pick-click sequence, and a page
      left sitting open past it is a non-event for a normal browser: the
      anchor is same-origin, the session cookie rides along, and the server
      takes the session path without ever looking at the token. The only
      caller a stale token can actually strand is the cookieless one - an
      embedded browser's external download manager - and there a reload of
      the page mints a fresh one. Not worth a timer, a refresh endpoint or a
      countdown in the UI for that. */
  downloadToken: string;
  items: CollectionIconItem[];
  styleSettings: CollectionStyleSettings;
  /** The collection's saved color/stroke - the same look the grid and the
      styles panel's picker render icons with, so what downloads matches
      what was just looked at. The server applies it from its own copy of
      these settings; this is here for the readout below. */
  savedEdits: IconEdits;
  onFormatSaved: (format: ExportFormat) => void;
  /** Ask for the zip the moment this panel mounts, instead of waiting for
      the button. Set only when a WebMCP agent called `download_collection`
      on the human's behalf: the panel still opens and the file still lands
      in their own browser - the only thing skipped is the click they
      already delegated. */
  autoStart?: boolean;
  /** How an auto-started run reports back. Called exactly once per run. */
  onAutoStartSettled?: (result: AutoDownloadResult) => void;
}) {
  const [format, setFormat] = useState<ExportFormat>(styleSettings.exportFormat);
  const [pngSize, setPngSize] = useState<number>(styleSettings.size ?? DEFAULT_PNG_SIZE);
  const [status, setStatus] = useState<DownloadStatus>("idle");

  const filename = `${slugifyFilename(collectionName)}.zip`;
  const downloadUrl = buildCollectionDownloadUrl(
    collectionId,
    collectionName,
    format,
    resolveExportSize(format, pngSize, styleSettings.size),
    downloadToken,
  );

  const styleSummary = summarizeCollectionStyles({
    color: savedEdits.color ?? null,
    strokeWidth: savedEdits.strokeWidth ?? null,
  });

  async function persistFormat(nextFormat: ExportFormat) {
    /* Best-effort: the zip the visitor is about to get carries the format as
       a URL parameter and does not depend on this succeeding, so a failure
       here is silent rather than surfaced as a download error - the
       remembered default staying one save behind is a much smaller problem
       than "your download failed" for a settings write that was not what
       they clicked the button for. */
    const result = await saveCollectionStyles(collectionId, {
      anchorIconId: styleSettings.anchorIconId,
      color: styleSettings.color,
      strokeWidth: styleSettings.strokeWidth,
      size: styleSettings.size,
      exportFormat: nextFormat,
    });
    if (result.ok) onFormatSaved(result.settings.exportFormat);
  }

  /** Everything that happens around the navigation itself. The `<a>` does
      the navigating - this only remembers the pick and moves the status
      line along. */
  function startDownload(): AutoDownloadResult {
    if (format !== styleSettings.exportFormat) {
      void persistFormat(format);
    }

    setStatus("building");
    window.setTimeout(() => setStatus("handed-off"), BUILDING_MS);

    return { ok: true, count: items.length, format, filename };
  }

  /* The auto-start run, for a WebMCP `download_collection` call. It clicks
     the very same anchor the human would - there is no second, agent-only
     path to the file. Guarded by a ref rather than by `status`: this must
     fire exactly once per mounted panel, and the panel is mounted fresh each
     time the slide-over opens (SlideOver.tsx unmounts its children on
     close), so "once per mount" is exactly the right granularity. */
  const anchor = useRef<HTMLAnchorElement>(null);
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStarted.current) return;
    autoStarted.current = true;

    if (items.length === 0) {
      onAutoStartSettled?.({
        ok: false,
        count: 0,
        format,
        filename,
        error: "There is nothing in this collection to download.",
      });
      return;
    }

    onAutoStartSettled?.(startDownload());
    anchor.current?.click();
    /* Deliberately keyed on `autoStart` alone: startDownload closes over
       this render's items/format, which are the ones the human is looking
       at, and re-running on every render is exactly what must not happen. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  return (
    <div className="flex flex-col gap-8 px-6 py-6">
      <p className="text-meta text-ink-muted">
        Downloads every icon in this collection as one zip, in the format you
        pick below, with a LICENSES.txt listing what each icon set asks of
        you.
      </p>

      <Group label="Export format">
        <div className="flex flex-wrap gap-2">
          {EXPORT_FORMATS.map((option) => (
            <Choice key={option.id} active={format === option.id} onClick={() => setFormat(option.id)}>
              {option.label}
            </Choice>
          ))}
        </div>
      </Group>

      {format === "png" && (
        <Group label="PNG size">
          <div className="flex flex-wrap gap-2">
            {SIZES.map((value) => (
              <Choice key={value} active={pngSize === value} onClick={() => setPngSize(value)}>
                {value}
              </Choice>
            ))}
          </div>
        </Group>
      )}

      <div className="rounded-control border-2 border-ink bg-canvas px-4 py-3">
        <p className="text-meta text-ink">{styleSummary}</p>
      </div>

      <div className="flex flex-col gap-3 border-t-2 border-ink pt-6">
        <div className="flex items-center gap-4">
          {/* No link at all while there is nothing to zip - a control that
              can only answer "this collection is empty" is a dead click.
              The workspace already hides its Download button in that state,
              so this is the belt to that braces. */}
          {items.length === 0 ? (
            <p className="text-body text-ink">
              This collection is empty. Add some icons and the download
              appears here.
            </p>
          ) : (
            /* A real link, not a button with an onClick that fabricates a
               file. Same primary-button construction as everywhere else;
               `press` needs no type attribute here. */
            <a
              ref={anchor}
              href={downloadUrl}
              onClick={startDownload}
              className="press relative inline-flex items-center justify-center gap-2 rounded-btn border-2 border-ink bg-primary px-6 py-[15px] text-body font-semibold text-ink no-underline"
            >
              {status === "building" && <SpinnerIcon />}
              {status === "building"
                ? "Building your zip..."
                : `Download ${items.length} ${items.length === 1 ? "icon" : "icons"}`}
            </a>
          )}
          {status === "handed-off" && (
            <span className="flex items-center gap-1.5 text-meta font-semibold text-ink">
              <span className="text-teal-deep">
                <CheckIcon />
              </span>
              Saving {filename}
            </span>
          )}
        </div>
        <p aria-live="polite" className="sr-only">
          {status === "building" ? "Building your zip on the server" : ""}
          {status === "handed-off" ? `Your browser is saving ${filename}` : ""}
        </p>
        {status === "handed-off" && (
          <p className="text-meta text-ink-muted">
            Check your browser's downloads. Nothing there? Use the button
            again - the link works on its own, so you can also right-click it
            and pick Save link as.
          </p>
        )}
      </div>
    </div>
  );
}
