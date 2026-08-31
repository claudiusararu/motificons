/**
 * The one client-side way to persist a collection's style settings.
 *
 * `PUT /api/collections/[id]/style` is a full-replace route ("the panel
 * always sends every field" - that route's own comment), which is exactly
 * the kind of contract that rots when three callers each build the body by
 * hand. There are three: the styles panel's Save button, the download
 * panel's remembered-format write, and the WebMCP `set_collection_styles`
 * tool an agent calls. They all come through here, so an agent provably
 * saves through the same request the human's own Save button sends - no
 * second write path with its own idea of what a complete payload is.
 *
 * Never throws: a network failure and a refused save both come back as
 * `{ ok: false, error }` with a sentence a person (or an agent talking to
 * one) can read.
 */

import type { ComputedStyleTargets } from "./style-targets";
import type { ExportFormat } from "./transforms/formats";

/** A collection's saved look, exactly as the route hands it back. */
export interface CollectionStyleValues {
  anchorIconId: string | null;
  /** Measured off the anchor icon by the server - read-only here. */
  computedTargets: ComputedStyleTargets | null;
  color: string | null;
  strokeWidth: number | null;
  size: number | null;
  exportFormat: ExportFormat;
}

/** What a caller sends: everything except the server-computed targets. */
export type CollectionStyleInput = Omit<CollectionStyleValues, "computedTargets">;

export type CollectionStyleSaveResult =
  | { ok: true; settings: CollectionStyleValues }
  | { ok: false; error: string };

/** The copy every caller already used for "the request itself fell over". */
const GENERIC_ERROR = "Something went wrong. Try again.";

interface StyleSettingsResponseDTO {
  anchorIconId: string | null;
  computedTargets: ComputedStyleTargets | null;
  color: string | null;
  strokeWidth: number | null;
  size: number | null;
  exportFormat: ExportFormat;
}

export async function saveCollectionStyles(
  collectionId: string,
  input: CollectionStyleInput,
): Promise<CollectionStyleSaveResult> {
  let response: Response;
  try {
    response = await fetch(`/api/collections/${collectionId}/style`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        anchorIconId: input.anchorIconId,
        color: input.color,
        strokeWidth: input.strokeWidth,
        size: input.size,
        exportFormat: input.exportFormat,
      }),
    });
  } catch {
    return { ok: false, error: GENERIC_ERROR };
  }

  const data = (await response.json().catch(() => null)) as
    | { error?: string; settings?: StyleSettingsResponseDTO }
    | null;

  if (!response.ok || !data?.settings) {
    /* The route's own sentence wins when there is one - it is the only
       thing that can say WHICH field was refused (a bad hex, an anchor that
       is not in this collection). */
    return { ok: false, error: data?.error ?? GENERIC_ERROR };
  }

  const settings = data.settings;
  return {
    ok: true,
    settings: {
      anchorIconId: settings.anchorIconId,
      computedTargets: settings.computedTargets,
      color: settings.color,
      strokeWidth: settings.strokeWidth,
      size: settings.size,
      exportFormat: settings.exportFormat,
    },
  };
}
