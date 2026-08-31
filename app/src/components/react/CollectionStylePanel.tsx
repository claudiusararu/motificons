import { useMemo, useState, type SyntheticEvent } from "react";
import type { IconEdits } from "../../lib/transforms/svg-doc";
import { computeStyleTargets, targetsSummary, type ComputedStyleTargets } from "../../lib/style-targets";
import type { ExportFormat } from "../../lib/transforms/formats";
import type { CollectionIconItem } from "./CollectionIconGrid";
import { StyledIconGlyph } from "./StyledIconGlyph";
import { Choice, ColorField, Group, SIZES, STROKE_WIDTHS } from "./editor/Controls";
import { CheckIcon, ErrorLine, SpinnerIcon } from "./save/icons";

export interface CollectionStyleSettings {
  anchorIconId: string | null;
  computedTargets: ComputedStyleTargets | null;
  color: string | null;
  strokeWidth: number | null;
  size: number | null;
  exportFormat: ExportFormat;
}

type SaveStatus = "idle" | "loading" | "error" | "success";

interface StyleSettingsResponseDTO {
  anchorIconId: string | null;
  computedTargets: CollectionStyleSettings["computedTargets"];
  color: string | null;
  strokeWidth: number | null;
  size: number | null;
  exportFormat: ExportFormat;
}

/**
 * "Set collection styles": a visual
 * anchor pick from the collection's OWN icons (tile click, never a paste-an-
 * id field) plus manual size/color/stroke-width/export-format controls,
 * reusing editor/Controls.tsx's primitives rather than a second style-engine
 * UI - the style engine is never forked.
 *
 * Preview: ONE
 * icon - the currently picked style-guide (anchor) icon - on the same
 * grid-paper surface the icon detail page's editor uses (IconEditor.tsx),
 * sized to a third of the panel's width (these are icons, not HD images).
 * Live with
 * `liveEdits` - the panel's CURRENT,
 * UNSAVED color/stroke-width state - via the shared StyledIconGlyph (also
 * what the grid behind this panel uses, with the collection's SAVED
 * settings instead: one function, two different edit sources, never two
 * implementations that could drift). `size` is deliberately not one of the
 * dimensions this preview visually reacts to - same as the icon detail
 * page's own preview, which stays a fixed box regardless of the size
 * selector: `size` is an export parameter, not a body transform, so there
 * is nothing for a live preview to show beyond what color/stroke already
 * change (StyledIconGlyph/applyEdits do not consume it at all).
 *
 * The anchor picker's tiles and the collection grid behind this panel are
 * NOT live: both render with `savedEdits` - the collection's
 * currently SAVED settings, passed down from CollectionWorkspace, the exact
 * same value the grid uses - so neither one flickers through every unsaved
 * keystroke, and both only change once "Save styles" actually persists.
 *
 * One combined save: the anchor pick and the manual fields are independent
 * inputs that persist together in a single PUT, matching the form's own
 * single "Save styles" action - simpler than the deleted project-scoped
 * style profile's two-form flow, and there is no paste field left for a
 * separate "use this icon" submit to attach to.
 *
 * Export format lives in CollectionDownloadPanel.tsx now - it is a
 * download-time choice, not a look the icons wear on the page. `/api/collections/[id]/style` is a full-replace PUT, not a
 * PATCH ("the panel always sends every field" - that route's own comment),
 * so this form still has to send SOME `exportFormat` on every save or it
 * would silently reset the remembered default to whatever the server
 * defaults an omitted field to - it just carries `initialSettings`'s value
 * straight through, unread and unchanged by anything in this form, since
 * there is no longer a control here that touches it.
 */
export default function CollectionStylePanel({
  collectionId,
  items,
  initialSettings,
  savedEdits,
  onSaved,
}: {
  collectionId: string;
  items: CollectionIconItem[];
  initialSettings: CollectionStyleSettings;
  /** The collection's currently SAVED color/stroke - what the picker tiles
      (and the grid behind this panel) render with. Never the panel's own
      unsaved, in-progress state. */
  savedEdits: IconEdits;
  onSaved: (settings: CollectionStyleSettings) => void;
}) {
  const [anchorIconId, setAnchorIconId] = useState(initialSettings.anchorIconId);
  const [size, setSize] = useState<number | null>(initialSettings.size);
  const [color, setColor] = useState<string | null>(initialSettings.color);
  const [strokeWidth, setStrokeWidth] = useState<number | null>(initialSettings.strokeWidth);
  /* No control in this form changes it any more (see this component's own
     doc comment) - carried through untouched so the full-replace PUT below
     does not reset the download panel's remembered format. */
  const format: ExportFormat = initialSettings.exportFormat;

  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");

  /* The live, unsaved preview - deliberately NOT `initialSettings` and NOT
     `savedEdits`. Recomputed every render from whatever the controls below
     are set to right now, drives ONLY the single-icon preview surface. */
  const liveEdits: IconEdits = {
    color: color ?? undefined,
    strokeWidth: strokeWidth ?? undefined,
  };

  async function handleSave(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    setError("");

    try {
      const response = await fetch(`/api/collections/${collectionId}/style`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anchorIconId, color, strokeWidth, size, exportFormat: format }),
      });
      const data = (await response.json().catch(() => null)) as
        | { error?: string; settings?: StyleSettingsResponseDTO }
        | null;

      if (!response.ok || !data?.settings) {
        setStatus("error");
        setError(data?.error ?? "Something went wrong. Try again.");
        return;
      }

      setStatus("success");
      onSaved({
        anchorIconId: data.settings.anchorIconId,
        computedTargets: data.settings.computedTargets,
        color: data.settings.color,
        strokeWidth: data.settings.strokeWidth,
        size: data.settings.size,
        exportFormat: data.settings.exportFormat,
      });
    } catch {
      setStatus("error");
      setError("Something went wrong. Try again.");
    }
  }

  const anchorItem = items.find((item) => item.iconId === anchorIconId) ?? null;

  /* Computed LIVE from whichever anchor is picked right now - never from
     `initialSettings`/the last save response, which was only ever accurate
     for whichever anchor was last actually saved (the bug this fixes:
     picking a fresh, unsaved anchor showed nothing, or a stale readout left
     over from the previous one). `anchorItem.body` is only absent for the
     rare icon whose body came back too large to inline (StyledIconGlyph's
     own fallback case) - there is nothing to read a fingerprint from then
     either, so the readout simply stays hidden, same as no anchor picked. */
  const computedTargets = useMemo(
    () => (anchorItem?.body ? computeStyleTargets({ body: anchorItem.body, width: anchorItem.width }) : null),
    [anchorItem],
  );

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-8 px-6 py-6">
      <p className="text-meta text-ink-muted">
        These settings apply to how this collection's icons look here and when you
        export them. Pick a style-guide icon from your own collection, then fine-tune
        manually below - the preview updates as you go, live, before you save.
      </p>

      <Group label="Preview">
        <div
          className="grid-paper flex aspect-square w-1/3 items-center justify-center rounded-panel p-4 shadow-card"
          aria-live="polite"
        >
          {anchorItem ? (
            <StyledIconGlyph
              item={anchorItem}
              edits={liveEdits}
              size={176}
              className="h-auto w-auto max-h-full max-w-full"
            />
          ) : (
            <p className="px-4 text-center text-pill text-ink-muted">
              Pick an icon below to preview your styles.
            </p>
          )}
        </div>
      </Group>

      <Group label="Style-guide icon">
        {items.length === 0 ? (
          <p className="text-meta text-ink-muted">
            Add icons to this collection first, then come back to pick one as the
            style guide.
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-2">
            {items.map((item) => {
              const active = item.iconId === anchorIconId;
              return (
                <button
                  key={item.iconId}
                  type="button"
                  onClick={() => setAnchorIconId(active ? null : item.iconId)}
                  aria-pressed={active}
                  aria-label={`Use ${item.name} as the style-guide icon`}
                  title={item.name}
                  className={`touch-target-inset flex h-11 w-11 items-center justify-center rounded-control border-2 text-ink transition-colors duration-120 ease-in ${
                    active ? "border-ink bg-primary" : "border-ink/20 bg-surface hover:border-ink"
                  }`}
                >
                  <StyledIconGlyph item={item} edits={savedEdits} size={20} />
                </button>
              );
            })}
          </div>
        )}

        {anchorItem && (
          <div className="mt-4 flex items-center gap-3 rounded-control border-2 border-ink bg-canvas px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control border-2 border-ink bg-surface text-ink">
              <StyledIconGlyph item={anchorItem} edits={savedEdits} size={20} />
            </span>
            <div>
              <p className="text-meta font-semibold text-ink">{anchorItem.name}</p>
              {computedTargets && (
                <p className="mt-0.5 text-pill text-ink-muted">{targetsSummary(computedTargets)}</p>
              )}
            </div>
          </div>
        )}
      </Group>

      <Group label="Size">
        <div className="flex flex-wrap gap-2">
          <Choice active={size === null} onClick={() => setSize(null)}>
            Unset
          </Choice>
          {SIZES.map((value) => (
            <Choice key={value} active={size === value} onClick={() => setSize(value)}>
              {value}
            </Choice>
          ))}
        </div>
      </Group>

      <Group label="Color">
        <ColorField value={color} onChange={setColor} />
        {color !== null && (
          <button
            type="button"
            onClick={() => setColor(null)}
            className="mt-3 text-meta font-semibold text-blue-deep"
          >
            Clear color
          </button>
        )}
      </Group>

      <Group label="Stroke width">
        <div className="flex flex-wrap gap-2">
          <Choice active={strokeWidth === null} onClick={() => setStrokeWidth(null)}>
            Unset
          </Choice>
          {STROKE_WIDTHS.map((value) => (
            <Choice key={value} active={strokeWidth === value} onClick={() => setStrokeWidth(value)}>
              {value}
            </Choice>
          ))}
        </div>
        <p className="mt-3 text-meta text-ink-muted">
          Icons without a stroke to retarget keep their own look - this only changes
          icons that have a stroke.
        </p>
      </Group>

      <div className="flex items-center gap-4 border-t-2 border-ink pt-6">
        <button
          type="submit"
          disabled={status === "loading"}
          aria-busy={status === "loading"}
          className="press relative inline-flex items-center justify-center gap-2 rounded-btn border-2 border-ink bg-primary px-6 py-[15px] text-body font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-[0.55]"
        >
          {status === "loading" && <SpinnerIcon />}
          Save styles
        </button>
        {status === "success" && (
          <span className="flex items-center gap-1.5 text-meta font-semibold text-ink">
            <span className="text-teal-deep">
              <CheckIcon />
            </span>
            Saved
          </span>
        )}
      </div>
      {status === "error" && <ErrorLine id="collection-style-error" message={error} />}
    </form>
  );
}
