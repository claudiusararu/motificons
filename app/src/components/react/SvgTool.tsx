import { useState, type ChangeEvent } from "react";
import type { IconSource } from "../../lib/data";
import { validateSvg } from "../../lib/svg-sanitize";
import { parseSvgDocument, sanitizeSvg } from "../../lib/transforms/untrusted-svg";
import { toJsxComponent } from "../../lib/transforms/jsx";
import { toSvelteComponent, toVueComponent } from "../../lib/transforms/components";
import { toBase64DataUri } from "../../lib/transforms/data-uri";
import { buildSvg } from "../../lib/transforms/svg-doc";
import type { ToolKind } from "../../lib/transforms/formats";

export type { ToolKind };

/** Kinds converted entirely client-side: plain string/template work, no
    rasterizer or path translator involved, so shipping the markup to a
    server would be slower and more invasive for no gain. swiftui and png
    still POST - SwiftUI needs the path translator and png needs resvg,
    neither of which belongs in a browser bundle. */
const CLIENT_KINDS = new Set<ToolKind>(["jsx", "tsx", "vue", "svelte", "datauri"]);

/** Builds a small, already-sanitized standalone document from parsed pasted
    markup - used for the live preview image, so what gets shown is never the
    raw pasted string. */
function safeDocument(parsed: { body: string; width: number; height: number }): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${parsed.width} ${parsed.height}">${sanitizeSvg(parsed.body)}</svg>`;
}

function pastedIcon(svg: string): IconSource | null {
  const parsed = parseSvgDocument(svg);
  if (!parsed) return null;
  return {
    prefix: "icon",
    name: "pasted",
    body: sanitizeSvg(parsed.body),
    width: parsed.width,
    height: parsed.height,
  };
}

const NOT_SVG_ERROR = "That does not look like an SVG. It should contain an <svg> tag.";

/**
 * The free-tool surface. Paste SVG markup,
 * get the converted output back - one page per export format the library
 * produces (see ../../pages/tools/_tool-data.ts).
 *
 * Paste-only, no file upload: a pasted string never touches the filesystem
 * or triggers a File read, so there is exactly one input path to validate.
 * Validation runs twice with the same pure function
 * (lib/svg-sanitize.ts#validateSvg) - once in onChangeInput, which fires the
 * moment pasted content lands in the textarea (and on every keystroke,
 * harmless since the checks are cheap regexes), and again in convert(),
 * immediately before anything is produced from the input, so nothing can
 * slip through if the state was ever set some other way. A rejection is
 * always a plain-language reason naming the actual problem - never a silent
 * strip-and-continue.
 *
 * The only preview this component ever renders of the pasted artwork is an
 * <img> against a data: URI built from sanitized markup - never
 * dangerouslySetInnerHTML, never the raw pasted string in the DOM.
 *
 * Every kind converts for everyone, SwiftUI included - no account, no
 * signup, no watermark, which is exactly what these landing pages promise.
 */
export default function SvgTool({ kind }: { kind: ToolKind }) {
  const [input, setInput] = useState("");
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [output, setOutput] = useState("");
  const [pngUrl, setPngUrl] = useState<string | null>(null);
  const [size, setSize] = useState(512);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const onChangeInput = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setInput(value);
    setOutput("");
    setPngUrl(null);

    const trimmed = value.trim();
    if (!trimmed) {
      setError(null);
      setPreviewUri(null);
      return;
    }

    /* Checkpoint 1: "on paste". onChange fires immediately after a paste (and
       after every keystroke), so a rejection shows before Convert is ever
       clicked. */
    const validation = validateSvg(trimmed);
    if (!validation.ok) {
      setError(validation.reason ?? "That SVG could not be validated.");
      setPreviewUri(null);
      return;
    }

    setError(null);
    const parsed = parseSvgDocument(trimmed);
    setPreviewUri(parsed ? toBase64DataUri(safeDocument(parsed)) : null);
  };

  const convert = async () => {
    setError(null);
    setOutput("");
    setPngUrl(null);

    const svg = input.trim();
    if (!svg) {
      setError("Paste some SVG markup first.");
      return;
    }

    /* Checkpoint 2: "on submit" - re-validates the exact string about to be
       converted, right before anything is produced from it. */
    const validation = validateSvg(svg);
    if (!validation.ok) {
      setError(validation.reason ?? "That SVG could not be validated.");
      return;
    }

    if (CLIENT_KINDS.has(kind)) {
      const icon = pastedIcon(svg);
      if (!icon) {
        setError(NOT_SVG_ERROR);
        return;
      }
      /* Tier "T1" so nothing is gated by capability tier: this is the
         visitor's own artwork, not one of ours, so there is no restyle
         tier to restrict it to. */
      if (kind === "jsx") {
        setOutput(toJsxComponent(icon, {}, "T1", { typescript: false }));
      } else if (kind === "tsx") {
        setOutput(toJsxComponent(icon, {}, "T1", { typescript: true }));
      } else if (kind === "vue") {
        setOutput(toVueComponent(icon, {}, "T1"));
      } else if (kind === "svelte") {
        setOutput(toSvelteComponent(icon, {}, "T1"));
      } else if (kind === "datauri") {
        setOutput(toBase64DataUri(buildSvg(icon, {}, "T1")));
      }
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/tools/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ svg, size }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(payload?.error ?? "Conversion failed. Check the markup.");
        return;
      }
      if (kind === "png") {
        const blob = await response.blob();
        setPngUrl(URL.createObjectURL(blob));
      } else {
        const payload = (await response.json()) as {
          code: string;
          kind: string;
        };
        setOutput(payload.code);
        if (payload.kind === "unsupported") {
          setError(
            "This artwork uses masks or gradients, so there is no honest SwiftUI Path for it. The explanation is in the output - use an Xcode asset catalog instead.",
          );
        }
      }
    } catch {
      setError("Conversion failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const onConvertClick = () => {
    void convert();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Could not reach the clipboard.");
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <label
          htmlFor="svg-input"
          className="mb-3 block text-pill font-bold text-ink-muted uppercase"
        >
          Your SVG
        </label>
        <textarea
          id="svg-input"
          value={input}
          spellCheck={false}
          onChange={onChangeInput}
          placeholder={'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">...'}
          rows={10}
          className="w-full rounded-card border-2 border-ink bg-surface px-5 py-4 font-mono text-meta text-ink placeholder:text-ink-muted focus:shadow-card"
        />

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {kind === "png" && (
            <label className="flex items-center gap-2 text-meta">
              Size
              <input
                type="number"
                min={8}
                max={2048}
                value={size}
                onChange={(event) => setSize(Number(event.target.value))}
                className="w-24 rounded-control border-2 border-ink bg-surface px-3 py-2 text-meta"
              />
              px
            </label>
          )}

          <button
            type="button"
            onClick={onConvertClick}
            aria-busy={busy ? "true" : undefined}
            className="press press-sm inline-flex items-center gap-2 rounded-control border-2 border-ink bg-primary px-4 py-[10px] text-body font-semibold text-ink"
          >
            {busy && (
              <svg
                className="inline-spinner"
                width={16}
                height={16}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={3}
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" opacity="0.3" />
                <path d="M21 12a9 9 0 0 0-9-9" />
              </svg>
            )}
            Convert
          </button>
        </div>

        {error && (
          <p className="mt-4 flex items-start gap-2 text-meta text-danger">
            <svg
              width={16}
              height={16}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="mt-[3px] shrink-0"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7.5v5.5M12 16.5h.01" strokeLinecap="round" />
            </svg>
            {error}
          </p>
        )}
      </div>

      {/* Free preview: an <img> against a data: URI, built from sanitized
          markup - never the raw pasted string, never injected into the DOM.
          Shown for every kind except png, whose own output pane already is
          the rendered image. */}
      {previewUri && kind !== "png" && (
        <div>
          <h2 className="mb-3 text-pill font-bold text-ink-muted uppercase">
            Preview
          </h2>
          <div className="grid-paper flex items-center justify-center rounded-card p-6">
            <img
              src={previewUri}
              alt="Preview of your pasted SVG"
              className="max-h-24 max-w-24"
            />
          </div>
        </div>
      )}

      {(output || pngUrl) && (
        <div>
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 className="text-pill font-bold text-ink-muted uppercase">
              Output
            </h2>
            {output && (
              <button
                type="button"
                onClick={copy}
                className="press press-sm inline-flex items-center rounded-control border-2 border-ink bg-surface px-4 py-[10px] text-body font-semibold text-ink"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            )}
          </div>

          {output && (
            <pre className="scroll-dark overflow-x-auto rounded-card bg-ink px-6 py-5 font-mono text-code text-on-dark">
              <code>{output}</code>
            </pre>
          )}

          {pngUrl && (
            <div className="grid-paper flex flex-col items-center gap-5 rounded-card p-10 shadow-card">
              <img
                src={pngUrl}
                alt="Converted PNG preview"
                className="max-h-[256px] max-w-full"
              />
              <a
                href={pngUrl}
                download={`icon-${size}.png`}
                className="press press-sm inline-flex items-center rounded-control border-2 border-ink bg-primary px-4 py-[10px] text-body font-semibold text-ink no-underline"
              >
                Download PNG
              </a>
            </div>
          )}
        </div>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {copied ? "Copied to clipboard" : output ? "Conversion ready" : ""}
      </p>
    </div>
  );
}
