/**
 * A collection's style settings, the "Set collection styles" panel behind
 * the collection page: a visual anchor icon -
 * one of the collection's OWN icons, picked by tile click, never a paste-an-
 * id field (explicitly banned) - plus manual size/color/stroke-width/export-
 * format controls. Stored on `collection.styleSettings` (migration 0002,
 * additive), one JSON blob per collection - the collection-scoped successor
 * to the deleted project-scoped `styleProfile` table.
 *
 * The collection grid (CollectionIconGrid.tsx) applies these settings
 * client-side to every tile's glyph via the same transforms/svg-doc.ts
 * `applyEdits` the icon editor uses - "reuse the existing client-side style
 * engine," not a second implementation.
 */

import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/client";
import { collection } from "../../db/schema";
import { getIcon } from "../data";
import { computeStyleTargets, type ComputedStyleTargets } from "../style-targets";
import { EXPORT_FORMATS, type ExportFormat } from "../transforms/formats";
import { isValidIconId, listCollectionItems } from "./collection-items";

export type { ComputedStyleTargets };

export interface CollectionStyleSettingsDTO {
  collectionId: string;
  /** "prefix:name" of the style-guide icon, or null if none is set. Always
      one of the collection's own icons - enforced server-side on save. */
  anchorIconId: string | null;
  computedTargets: ComputedStyleTargets | null;
  color: string | null;
  strokeWidth: number | null;
  size: number | null;
  exportFormat: ExportFormat;
  updatedAt: string | null;
}

/* ---------------------------------------------------------------------- *
 * Pure validation/computation - unit-tested directly (no DB, no network)
 * ---------------------------------------------------------------------- */

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isValidHexColor(value: string): boolean {
  return HEX_COLOR.test(value.trim());
}

export type FieldValidation<T> = { ok: true; value: T } | { ok: false; error: string };

/** Null clears the manual stroke override. Otherwise a positive, finite
    number under a sane upper bound (nothing in the editor goes past 3 on a
    24 grid; collection targets can reasonably run higher since collections
    render icons at arbitrary sizes). */
export function validateStrokeWidth(raw: unknown): FieldValidation<number | null> {
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: null };
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 64) {
    return { ok: false, error: "Stroke width must be a number between 0 and 64." };
  }
  return { ok: true, value };
}

export function validateColor(raw: unknown): FieldValidation<string | null> {
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string" || !isValidHexColor(raw)) {
    return { ok: false, error: "Color must be a hex value like #183153." };
  }
  return { ok: true, value: raw.trim().toLowerCase() };
}

export function validateSize(raw: unknown): FieldValidation<number | null> {
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: null };
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 4096) {
    return { ok: false, error: "Size must be a whole number of pixels between 1 and 4096." };
  }
  return { ok: true, value };
}

export function validateExportFormat(raw: unknown): FieldValidation<ExportFormat> {
  const found = EXPORT_FORMATS.find((format) => format.id === raw);
  if (!found) return { ok: false, error: "Pick a valid export format." };
  return { ok: true, value: found.id };
}

/** Null/empty clears the anchor. Otherwise must be a well-formed icon id -
    membership in the collection is checked separately (it needs a DB read,
    which this pure function deliberately does not do). */
export function validateAnchorIconId(raw: unknown): FieldValidation<string | null> {
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: null };
  if (!isValidIconId(raw)) return { ok: false, error: "That icon id is not valid." };
  return { ok: true, value: raw };
}

/* ---------------------------------------------------------------------- *
 * DB access
 * ---------------------------------------------------------------------- */

interface StoredSettings {
  anchorIconId?: unknown;
  computedTargets?: unknown;
  color?: unknown;
  strokeWidth?: unknown;
  size?: unknown;
  exportFormat?: unknown;
}

function toDTO(collectionId: string, raw: StoredSettings, updatedAt: string | null): CollectionStyleSettingsDTO {
  const format = EXPORT_FORMATS.some((f) => f.id === raw.exportFormat)
    ? (raw.exportFormat as ExportFormat)
    : "svg";

  return {
    collectionId,
    anchorIconId: typeof raw.anchorIconId === "string" ? raw.anchorIconId : null,
    computedTargets: (raw.computedTargets as ComputedStyleTargets | undefined) ?? null,
    color: typeof raw.color === "string" ? raw.color : null,
    strokeWidth: typeof raw.strokeWidth === "number" ? raw.strokeWidth : null,
    size: typeof raw.size === "number" ? raw.size : null,
    exportFormat: format,
    updatedAt,
  };
}

async function getOwnedCollectionRow(
  database: Database,
  workspaceId: string,
  collectionId: string,
): Promise<{ id: string; styleSettings: Record<string, unknown> | null } | null> {
  const rows = await database
    .select({ id: collection.id, styleSettings: collection.styleSettings })
    .from(collection)
    .where(and(eq(collection.id, collectionId), eq(collection.workspaceId, workspaceId)))
    .limit(1);
  return rows[0] ?? null;
}

/** `null` if the collection itself does not exist (or belongs to a
    different workspace) - a missing/empty settings JSON is not that: every
    collection has settings, they just start empty until first saved. */
export async function getCollectionStyleSettings(
  database: Database,
  workspaceId: string,
  collectionId: string,
): Promise<CollectionStyleSettingsDTO | null> {
  const row = await getOwnedCollectionRow(database, workspaceId, collectionId);
  if (!row) return null;
  return toDTO(collectionId, row.styleSettings ?? {}, null);
}

export interface StyleSettingsInput {
  anchorIconId: string | null;
  color: string | null;
  strokeWidth: number | null;
  size: number | null;
  exportFormat: ExportFormat;
}

export type SaveStyleSettingsResult =
  | { ok: true; settings: CollectionStyleSettingsDTO }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "invalid-anchor" };

/** Insert-or-update the whole settings blob in one call - the panel always
    sends every field, since its form holds them all at once (same "PUT, not
    PATCH" convention the deleted project style-profile route used). The
    anchor, if set, must already be one of the collection's own saved icons -
    the visual-pick-only rule (no paste-an-id field) enforced here, not just
    in the UI, since this is the one place that could be bypassed by a
    crafted request. */
export async function saveCollectionStyleSettings(
  database: Database,
  workspaceId: string,
  collectionId: string,
  input: StyleSettingsInput,
): Promise<SaveStyleSettingsResult> {
  const owned = await getOwnedCollectionRow(database, workspaceId, collectionId);
  if (!owned) return { ok: false, reason: "not-found" };

  let computedTargets: ComputedStyleTargets | null = null;

  if (input.anchorIconId) {
    const items = await listCollectionItems(database, collectionId);
    if (!items.some((item) => item.iconId === input.anchorIconId)) {
      return { ok: false, reason: "invalid-anchor" };
    }
    const [prefix, name] = input.anchorIconId.split(":");
    const icon = prefix && name ? await getIcon(prefix, name) : null;
    if (icon) computedTargets = computeStyleTargets(icon);
  }

  const now = new Date();
  const stored: StoredSettings = {
    anchorIconId: input.anchorIconId,
    computedTargets,
    color: input.color,
    strokeWidth: input.strokeWidth,
    size: input.size,
    exportFormat: input.exportFormat,
  };

  await database
    .update(collection)
    .set({ styleSettings: stored as Record<string, unknown> })
    .where(eq(collection.id, collectionId));

  return { ok: true, settings: toDTO(collectionId, stored, now.toISOString()) };
}

/** Copies the raw settings blob verbatim - the style half of DUPLICATE
    (a duplicate copies icons AND style settings). No
    re-validation needed: an anchor icon valid for the source collection is
    still valid for the copy, since duplicate always copies every icon too
    (copyCollectionItems) before this runs. A no-op when the source has never
    had settings saved - the copy simply starts empty, same as any other new
    collection. Callers are responsible for ownership checks on both ids,
    same convention as copyCollectionItems. */
export async function copyStyleSettings(
  database: Database,
  sourceCollectionId: string,
  destCollectionId: string,
): Promise<void> {
  const rows = await database
    .select({ styleSettings: collection.styleSettings })
    .from(collection)
    .where(eq(collection.id, sourceCollectionId))
    .limit(1);
  const settings = rows[0]?.styleSettings;
  if (!settings) return;

  await database.update(collection).set({ styleSettings: settings }).where(eq(collection.id, destCollectionId));
}
