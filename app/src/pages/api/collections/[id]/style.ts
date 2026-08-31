import type { APIRoute } from "astro";
import {
  getCollectionStyleSettings,
  saveCollectionStyleSettings,
  validateAnchorIconId,
  validateColor,
  validateExportFormat,
  validateSize,
  validateStrokeWidth,
} from "../../../../lib/workspace/collection-style";
import { requireSessionWorkspace } from "../../../../lib/workspace/session-workspace";

export const prerender = false;

/** Collections live on an account, so every route here needs a signed-in
    visitor. Accounts are free - this is the only thing standing between a
    caller and collections. */
const SIGN_IN_REQUIRED_ERROR = "Sign in with your free account to use collections.";

/** The caller's own collection's style settings - "Set collection styles"
    on the collection page. Same not-found-reads-the-same-
    whether-missing-or-not-yours convention as every other route under
    lib/workspace/. */
export const GET: APIRoute = async ({ locals, params }) => {
  const ctx = await requireSessionWorkspace(locals.user);
  if (!ctx) return json({ error: SIGN_IN_REQUIRED_ERROR }, 401);

  const collectionId = params.id ?? "";
  const settings = await getCollectionStyleSettings(ctx.database, ctx.workspaceId, collectionId);
  if (!settings) return json({ error: "That collection could not be found." }, 404);

  return json({ settings });
};

interface StyleSettingsPayload {
  anchorIconId?: unknown;
  color?: unknown;
  strokeWidth?: unknown;
  size?: unknown;
  exportFormat?: unknown;
}

/** Sets the whole settings blob in one call - the panel always sends every
    field, since its form holds them all at once. Not a PATCH-style partial
    update. */
export const PUT: APIRoute = async ({ request, locals, params }) => {
  const ctx = await requireSessionWorkspace(locals.user);
  if (!ctx) return json({ error: SIGN_IN_REQUIRED_ERROR }, 401);

  const collectionId = params.id ?? "";

  let payload: StyleSettingsPayload;
  try {
    payload = (await request.json()) as StyleSettingsPayload;
  } catch {
    return json({ error: "Send a JSON body." }, 400);
  }

  const anchorIconId = validateAnchorIconId(payload.anchorIconId);
  if (!anchorIconId.ok) return json({ error: anchorIconId.error }, 400);

  const color = validateColor(payload.color);
  if (!color.ok) return json({ error: color.error }, 400);

  const strokeWidth = validateStrokeWidth(payload.strokeWidth);
  if (!strokeWidth.ok) return json({ error: strokeWidth.error }, 400);

  const size = validateSize(payload.size);
  if (!size.ok) return json({ error: size.error }, 400);

  const format = validateExportFormat(payload.exportFormat);
  if (!format.ok) return json({ error: format.error }, 400);

  const result = await saveCollectionStyleSettings(ctx.database, ctx.workspaceId, collectionId, {
    anchorIconId: anchorIconId.value,
    color: color.value,
    strokeWidth: strokeWidth.value,
    size: size.value,
    exportFormat: format.value,
  });

  if (!result.ok && result.reason === "not-found") {
    return json({ error: "That collection could not be found." }, 404);
  }
  if (!result.ok && result.reason === "invalid-anchor") {
    return json(
      { error: "Pick the anchor icon from this collection's own icons - tap one of its tiles below." },
      400,
    );
  }

  return json({ settings: result.settings });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}
