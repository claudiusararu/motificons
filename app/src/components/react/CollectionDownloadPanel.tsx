import { useEffect, useRef, useState } from "react";
import { strToU8, zipSync } from "fflate";
import type { IconEdits } from "../../lib/transforms/svg-doc";
import { buildExportUrl } from "../../lib/transforms/export-url";
import { saveCollectionStyles } from "../../lib/collection-style-save";
import { EXPORT_FORMATS, type ExportFormat } from "../../lib/transforms/formats";
import {
  buildLicensesText,
  dedupeFilename,
  fallbackFilename,
  parseContentDispositionFilename,
  resolveExportSize,
  slugifyFilename,
  summarizeCollectionStyles,
} from "../../lib/collection-download";
import type { CollectionIconItem } from "./CollectionIconGrid";
import type { CollectionStyleSettings } from "./CollectionStylePanel";
import { Choice, Group, SIZES } from "./editor/Controls";
import { CheckIcon, ErrorLine, SpinnerIcon } from "./save/icons";

/** Icons fetched at once - the edge cache makes repeats cheap, but a
    collection is still someone else's browser and someone else's
    connection; small batches keep memory/concurrent-request pressure sane
    on a large collection without making a small one feel throttled. */
const BATCH_SIZE = 4;

/** api/export/[prefix]/[name].ts's own PNG default when no `size` param is
    sent - mirrored here so the panel's shown default and the server's
    actual behavior can never quietly disagree (also documented on
    resolveExportSize, which is what actually applies this). */
const DEFAULT_PNG_SIZE = 512;

type DownloadStatus = "idle" | "running" | "error" | "done";

/** What an auto-started run reports back to whoever asked for it - today
    only CollectionWorkspace.tsx's WebMCP `download_collection` tool. */
export interface AutoDownloadResult {
  ok: boolean;
  count: number;
  format: ExportFormat;
  /** The panel's own error sentence, when the run failed. */
  error?: string;
}

type FetchResult =
  | { ok: true; filename: string; bytes: Uint8Array }
  | { ok: false; error: string };

/**
 * "Download collection": one zip of every icon in the
 * collection, assembled IN THE BROWSER - no new server endpoint. Each icon
 * is fetched from the exact same /api/export/[prefix]/[name] route a
 * single-icon download already uses (buildExportUrl is the shared param-
 * builder FormatPreviewPanel.tsx also calls, so this can never send a
 * subtly different query than a visitor downloading one icon by hand would
 * have gotten), zipped client-side with fflate, plus a LICENSES.txt built
 * from what pages/collections/[id].astro already resolved server-side.
 *
 * Export format lives here now, not in CollectionStylePanel.tsx (moved in
 * the same commit, as one coherent move) - it is genuinely a download-
 * time choice, not a look the icons wear on the page. The collection's
 * stored `exportFormat` is still the remembered default (preselected on
 * open) and is still updated on download, via the same full-replace PUT
 * CollectionStylePanel.tsx uses - `onFormatSaved` mirrors that panel's
 * `onSaved` so CollectionWorkspace.tsx's one `styleSettings` value stays the
 * single source of truth for both panels.
 */
export default function CollectionDownloadPanel({
  collectionId,
  collectionName,
  items,
  styleSettings,
  savedEdits,
  onFormatSaved,
  autoStart = false,
  onAutoStartSettled,
}: {
  collectionId: string;
  collectionName: string;
  items: CollectionIconItem[];
  styleSettings: CollectionStyleSettings;
  /** The collection's saved color/stroke - the same look the grid and the
      styles panel's picker render icons with, so what downloads matches
      what was just looked at. */
  savedEdits: IconEdits;
  onFormatSaved: (format: ExportFormat) => void;
  /** Start zipping the moment this panel mounts, instead of waiting for the
      button. Set only when a WebMCP agent called `download_collection` on
      the human's behalf: the panel still opens, still counts the icons off
      in front of them and still hands the file to their browser - the only
      thing skipped is the click they already delegated. */
  autoStart?: boolean;
  /** How an auto-started run reports back. Called exactly once per run. */
  onAutoStartSettled?: (result: AutoDownloadResult) => void;
}) {
  const [format, setFormat] = useState<ExportFormat>(styleSettings.exportFormat);
  const [pngSize, setPngSize] = useState<number>(styleSettings.size ?? DEFAULT_PNG_SIZE);

  const [status, setStatus] = useState<DownloadStatus>("idle");
  const [progress, setProgress] = useState({ done: 0, total: items.length });
  const [errorMessage, setErrorMessage] = useState("");

  const styleSummary = summarizeCollectionStyles({
    color: savedEdits.color ?? null,
    strokeWidth: savedEdits.strokeWidth ?? null,
  });

  async function persistFormat(nextFormat: ExportFormat) {
    /* Best-effort: the zip the visitor is about to get does not depend on
       this succeeding, so a failure here is silent rather than surfaced as
       a download error - the remembered default staying one save behind is
       a much smaller problem than "your download failed" for a settings
       write that was not what they clicked the button for. */
    const result = await saveCollectionStyles(collectionId, {
      anchorIconId: styleSettings.anchorIconId,
      color: styleSettings.color,
      strokeWidth: styleSettings.strokeWidth,
      size: styleSettings.size,
      exportFormat: nextFormat,
    });
    if (result.ok) onFormatSaved(result.settings.exportFormat);
  }

  async function fetchIconFile(item: CollectionIconItem): Promise<FetchResult> {
    const size = resolveExportSize(format, pngSize, styleSettings.size);
    const url = buildExportUrl(item.prefix, item.name, format, savedEdits, size);

    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      return { ok: false, error: `Could not reach the server for ${item.name}. Check your connection.` };
    }
    if (!response.ok) {
      return { ok: false, error: `Could not export ${item.name}. Try again.` };
    }

    const buffer = await response.arrayBuffer();
    const filename =
      parseContentDispositionFilename(response.headers.get("Content-Disposition")) ??
      fallbackFilename(item.prefix, item.name, format);
    return { ok: true, filename, bytes: new Uint8Array(buffer) };
  }

  /** Returns what happened, so an auto-started run can be reported back;
      the button ignores it, because for a person the panel's own status line
      IS the report. */
  async function handleDownload(): Promise<AutoDownloadResult> {
    if (items.length === 0 || status === "running") {
      return {
        ok: false,
        count: items.length,
        format,
        error:
          items.length === 0
            ? "There is nothing in this collection to download."
            : "A download is already running in this panel.",
      };
    }

    setStatus("running");
    setErrorMessage("");
    setProgress({ done: 0, total: items.length });

    if (format !== styleSettings.exportFormat) {
      void persistFormat(format);
    }

    try {
      const files: Record<string, Uint8Array> = {};
      const used = new Set<string>();
      let done = 0;

      const queue = [...items];
      while (queue.length > 0) {
        const batch = queue.splice(0, BATCH_SIZE);
        const results = await Promise.all(batch.map((item) => fetchIconFile(item)));

        for (const result of results) {
          if (!result.ok) throw new Error(result.error);
          const name = dedupeFilename(result.filename, used);
          used.add(name);
          files[name] = result.bytes;
        }

        done += batch.length;
        setProgress({ done, total: items.length });
      }

      files["LICENSES.txt"] = strToU8(buildLicensesText({ collectionName, items }));

      const zipped = zipSync(files);
      const blob = new Blob([zipped], { type: "application/zip" });
      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.download = `${slugifyFilename(collectionName)}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      /* Not revoked synchronously: Chrome resolves the blob at click time,
         but an external download manager (the ChatGPT desktop browser's, for
         one) fetches the URL after the click returns - revoking immediately
         made those downloads intermittently register then stop. A minute is
         enough for any pipeline to open the blob; the memory is reclaimed on
         navigation regardless. */
      setTimeout(() => URL.revokeObjectURL(url), 60_000);

      setStatus("done");
      return { ok: true, count: items.length, format };
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Could not download all icons. Try again.";
      setStatus("error");
      setErrorMessage(message);
      return { ok: false, count: items.length, format, error: message };
    }
  }

  /* The auto-start run, for a WebMCP `download_collection` call. Guarded by
     a ref rather than by `status`: this must fire exactly once per mounted
     panel, and the panel is mounted fresh each time the slide-over opens
     (SlideOver.tsx unmounts its children on close), so "once per mount" is
     exactly the right granularity. */
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStarted.current) return;
    autoStarted.current = true;
    void handleDownload().then((result) => onAutoStartSettled?.(result));
    /* Deliberately keyed on `autoStart` alone: handleDownload closes over
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
          <button
            type="button"
            onClick={handleDownload}
            disabled={status === "running"}
            aria-busy={status === "running"}
            className="press relative inline-flex items-center justify-center gap-2 rounded-btn border-2 border-ink bg-primary px-6 py-[15px] text-body font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-[0.55]"
          >
            {status === "running" && <SpinnerIcon />}
            {status === "running"
              ? `${progress.done} of ${progress.total}...`
              : `Download ${items.length} ${items.length === 1 ? "icon" : "icons"}`}
          </button>
          {status === "done" && (
            <span className="flex items-center gap-1.5 text-meta font-semibold text-ink">
              <span className="text-teal-deep">
                <CheckIcon />
              </span>
              Downloaded
            </span>
          )}
        </div>
        <p aria-live="polite" className="sr-only">
          {status === "running" ? `Exporting ${progress.done} of ${progress.total} icons` : ""}
          {status === "done" ? "Download ready" : ""}
        </p>
        {status === "error" && <ErrorLine id="collection-download-error" message={errorMessage} />}
      </div>
    </div>
  );
}
