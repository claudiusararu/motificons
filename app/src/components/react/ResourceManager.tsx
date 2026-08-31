import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type SyntheticEvent } from "react";
import { MAX_NAME_LENGTH } from "../../lib/workspace/limits";
import { registerWebMcpTools } from "../../lib/webmcp/bridge";
import {
  createDashboardTools,
  type DashboardCollectionSummary,
  type DashboardToolHandle,
} from "../../lib/webmcp/dashboard-tools";
import ConfirmDeleteModal from "./ConfirmDeleteModal";

export interface ResourceItem {
  id: string;
  name: string;
  /** Links the row to its detail page ("/collections/{id}"). */
  href?: string;
  /** How many icons are saved in this collection. */
  count?: number;
}

export interface UpsellCopy {
  headline: string;
  body: string;
  /** Omitted for the honest over-cap state (raising the cap is a
      manual reply to an email, not a self-serve action) - present for the
      states that do have somewhere to send a visitor. */
  href?: string;
  /** Label for the `href` link, when present. Defaults to "Learn more". */
  ctaLabel?: string;
}

type ResourceKind = "collection";
type FormStatus = "idle" | "loading" | "error";

interface Props {
  kind: ResourceKind;
  /** "/api/collections". */
  apiBase: string;
  initialItems: ResourceItem[];
  createLabel: string;
  namePlaceholder: string;
  emptyIcon: "grid" | "star";
  emptyTitle: string;
  emptyBody: string;
  /** One sentence + link telling a visitor how to fill an empty collection -
      "Browse the library and press Save on any icon". */
  emptyLink?: { text: string; href: string };
  /** "/collections", used to build each new item's href. */
  detailHrefBase?: string;
}

/* Reproduces Button.astro's fills/geometry in TSX - a plain .astro component
   cannot be used from a React island (same convention as AuthCard.tsx /
   SvgTool.tsx). */
const BUTTON_BASE =
  "press relative inline-flex items-center justify-center gap-2 text-body font-semibold leading-[1.25] disabled:cursor-not-allowed disabled:opacity-[0.55]";
const BUTTON_PRIMARY = `${BUTTON_BASE} rounded-btn border-2 border-ink bg-primary px-6 py-[15px] text-ink`;
const BUTTON_SECONDARY_SM = `${BUTTON_BASE} press-sm rounded-control border-2 border-ink bg-surface px-4 py-[10px] text-ink`;
const BUTTON_PRIMARY_SM = `${BUTTON_BASE} press-sm rounded-control border-2 border-ink bg-primary px-4 py-[10px] text-ink`;
const BUTTON_DANGER_TEXT_SM = `${BUTTON_BASE} press-sm rounded-control border-2 border-ink bg-surface px-4 py-[10px] text-danger`;

function SpinnerIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 animate-spin"
    >
      <circle cx="12" cy="12" r="9" opacity="0.3" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mt-0.5 shrink-0"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5" />
      <path d="M12 16.5h.01" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 transition-transform duration-120 ease-in group-hover:translate-x-0.5"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function EmptyGlyph({ name }: { name: "grid" | "star" }) {
  const paths =
    name === "grid" ? (
      <>
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
      </>
    ) : (
      <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z" />
    );
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-ink-muted"
    >
      {paths}
    </svg>
  );
}

function ErrorLine({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} role="alert" className="mt-2 flex items-start gap-2 text-meta text-danger">
      <AlertIcon />
      {message}
    </p>
  );
}

/**
 * The Collections section on /dashboard: create button -> inline form, list
 * rows with rename/delete, over-cap notice (5 collection slots per
 * workspace). Full state sets (AGENTS.md) - default/hover/focus-visible
 * come from the reused .press/border-ink chrome, disabled/loading/error/
 * success are handled explicitly below.
 *
 * The `limited` branch below needs 5 real collections to reach, so it is
 * covered by lib/workspace/limits.test.ts rather than by clicking through
 * (see that file's header comment).
 */
export default function ResourceManager({
  kind,
  apiBase,
  initialItems,
  createLabel,
  namePlaceholder,
  emptyIcon,
  emptyTitle,
  emptyBody,
  emptyLink,
  detailHrefBase,
}: Props) {
  const noun = kind;

  const [items, setItems] = useState<ResourceItem[]>(initialItems);
  const [upsell, setUpsell] = useState<UpsellCopy | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [formValue, setFormValue] = useState("");
  const [formStatus, setFormStatus] = useState<FormStatus>("idle");
  const [formError, setFormError] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editStatus, setEditStatus] = useState<FormStatus>("idle");
  const [editError, setEditError] = useState("");

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [deleteErrorId, setDeleteErrorId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  /* Focus returns to the trigger - which row's Delete button opened
     the popup, captured on open (CollectionDuplicateModal.tsx uses the same
     event.currentTarget capture) since confirmingId alone does not carry a
     DOM node back. */
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);

  function openCreateForm() {
    setFormOpen(true);
    setFormValue("");
    setFormStatus("idle");
    setFormError("");
  }

  function closeCreateForm() {
    setFormOpen(false);
    setFormValue("");
    setFormStatus("idle");
    setFormError("");
  }

  /**
   * The one create path: the inline form below and the WebMCP
   * `create_collection` tool both come through here, so an agent creating a
   * collection sends the same POST, hits the same five-slot cap, and puts
   * the same row on screen as the person's own New collection button. When
   * the account is full it also raises the same capacity notice they would
   * have seen - the refusal is never something only the agent knows about.
   */
  async function createResource(
    name: string,
  ): Promise<{ ok: true; item: ResourceItem } | { ok: false; error: string; limited?: true }> {
    let response: Response;
    try {
      response = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
    } catch {
      return { ok: false, error: "Something went wrong. Try again." };
    }

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; limited?: true; upsell?: UpsellCopy }
      | Record<ResourceKind, ResourceItem>
      | null;

    if (!response.ok) {
      return {
        ok: false,
        error: (payload as { error?: string } | null)?.error ?? "Something went wrong. Try again.",
      };
    }

    if (payload && "limited" in payload && payload.limited) {
      const copy = payload.upsell ?? null;
      setUpsell(copy);
      return {
        ok: false,
        limited: true,
        /* The page's own two lines, concatenated exactly as limits.ts
           documents them - whoever asked hears what the person is reading. */
        error: copy ? `${copy.headline} ${copy.body}` : "This account is full.",
      };
    }

    const created = (payload as Record<ResourceKind, ResourceItem> | null)?.[kind];
    if (!created) return { ok: false, error: "Something went wrong. Try again." };

    const item: ResourceItem = {
      id: created.id,
      name: created.name,
      href: detailHrefBase ? `${detailHrefBase}/${created.id}` : undefined,
      /* A freshly created collection always starts empty - no need to
         ask the server for a count it already knows is zero. */
      count: kind === "collection" ? 0 : undefined,
    };
    setItems((prev) => [...prev, item]);
    return { ok: true, item };
  }

  async function submitCreate(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = formValue.trim();
    if (!trimmed) {
      setFormStatus("error");
      setFormError(`Give your ${noun} a name.`);
      return;
    }

    setFormStatus("loading");
    setFormError("");

    const result = await createResource(trimmed);
    if (result.ok || result.limited) {
      /* Over the cap, the capacity notice REPLACES this form (createResource
         has already set it), so closing it is the whole response - an error
         line under a form nobody can see would be the dead end. */
      closeCreateForm();
      return;
    }

    setFormStatus("error");
    setFormError(result.error);
  }

  /* --------------------------------------------------------------------
     WebMCP - reading and creating the person's own collections.

     Same shape as SearchIsland.tsx's registration: a ref holding what is on
     screen right now (a tool call can arrive between renders), a handle
     built once, and one effect that registers on mount and drops the tools
     on unmount. `list` and `create` are the only two: renaming and deleting
     stay the person's own, in the rows in front of them - there is nothing
     an agent could not do by asking, and a deletion is not something to hand
     to a caller who cannot see the icons inside.
     -------------------------------------------------------------------- */
  const latestItems = useRef(items);
  useEffect(() => {
    latestItems.current = items;
  });

  const toSummary = useCallback(
    (item: ResourceItem): DashboardCollectionSummary => ({
      id: item.id,
      name: item.name,
      count: item.count ?? 0,
      url: item.href ?? (detailHrefBase ? `${detailHrefBase}/${item.id}` : ""),
    }),
    [detailHrefBase],
  );

  const webmcpHandle = useMemo<DashboardToolHandle>(
    () => ({
      list: () => latestItems.current.map(toSummary),
      async create(name) {
        const result = await createResource(name);
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, collection: toSummary(result.item) };
      },
    }),
    /* createResource is redefined every render and closes only over stable
       values (apiBase, kind, detailHrefBase and the state setters); listing
       it would rebuild the handle and re-register the tools on every render.
       eslint-disable-next-line react-hooks/exhaustive-deps */
    [toSummary],
  );

  useEffect(() => {
    /* Collections are the only resource kind that exists, and the tool
       descriptions say "collection" in plain words - so a future kind gets
       its own tools rather than silently inheriting these. */
    if (kind !== "collection") return;
    return registerWebMcpTools(createDashboardTools(webmcpHandle));
  }, [kind, webmcpHandle]);

  function startEdit(item: ResourceItem) {
    setConfirmingId(null);
    setEditingId(item.id);
    setEditValue(item.name);
    setEditStatus("idle");
    setEditError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue("");
    setEditStatus("idle");
    setEditError("");
  }

  async function submitRename(id: string, event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = editValue.trim();
    if (!trimmed) {
      setEditStatus("error");
      setEditError(`Give your ${noun} a name.`);
      return;
    }

    setEditStatus("loading");
    setEditError("");

    try {
      const response = await fetch(`${apiBase}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | Record<ResourceKind, ResourceItem>
        | null;

      if (!response.ok) {
        setEditStatus("error");
        setEditError((payload as { error?: string } | null)?.error ?? "Could not rename. Try again.");
        return;
      }

      const updated = (payload as Record<ResourceKind, ResourceItem> | null)?.[kind];
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, name: updated?.name ?? trimmed } : item)),
      );
      cancelEdit();
    } catch {
      setEditStatus("error");
      setEditError("Could not rename. Try again.");
    }
  }

  function startDeleteConfirm(id: string, event: MouseEvent<HTMLButtonElement>) {
    deleteTriggerRef.current = event.currentTarget;
    setEditingId(null);
    setConfirmingId(id);
    setDeleteErrorId(null);
    setDeleteError("");
  }

  function cancelDeleteConfirm() {
    setConfirmingId(null);
    setDeleteErrorId(null);
    setDeleteError("");
    deleteTriggerRef.current?.focus();
  }

  async function confirmDelete(id: string) {
    setDeleteBusyId(id);
    setDeleteErrorId(null);

    try {
      const response = await fetch(`${apiBase}/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setDeleteErrorId(id);
        setDeleteError(payload?.error ?? "Could not delete. Try again.");
        setDeleteBusyId(null);
        return;
      }
      setItems((prev) => prev.filter((item) => item.id !== id));
      setConfirmingId(null);
      setDeleteBusyId(null);
    } catch {
      setDeleteErrorId(id);
      setDeleteError("Could not delete. Try again.");
      setDeleteBusyId(null);
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      {/* No heading+small-button row here: the heading is a plain h2 in
          dashboard.astro (this component takes no `heading` prop), and this
          explainer is the first child here instead, same classes as
          ApiKeySection.tsx's own explainer paragraph ("text-body
          text-ink-muted", spaced by this wrapper's own flex gap-4, not an
          explicit margin). */}
      <p className="text-body text-ink-muted">
        Groups of saved icons that sync to the Mac app and your coding agents - curate once, use them everywhere.
      </p>

      {upsell ? (
        <div className="rounded-card border-2 border-ink bg-surface p-6">
          <p className="text-body font-semibold text-ink">{upsell.headline}</p>
          <p className="mt-2 text-meta text-ink-muted">{upsell.body}</p>
          {upsell.href && (
            <a href={upsell.href} className={`${BUTTON_PRIMARY_SM} mt-4 no-underline`}>
              {upsell.ctaLabel ?? "Learn more"}
            </a>
          )}
        </div>
      ) : formOpen ? (
        <form
          onSubmit={submitCreate}
          aria-label={`New ${noun}`}
          className="flex flex-col gap-3 rounded-card border-2 border-ink bg-surface p-5"
        >
          <label htmlFor={`${kind}-new-name`} className="text-pill font-bold text-ink-muted uppercase">
            {noun} name
          </label>
          <input
            id={`${kind}-new-name`}
            type="text"
            autoFocus
            maxLength={MAX_NAME_LENGTH}
            value={formValue}
            placeholder={namePlaceholder}
            onChange={(event) => {
              setFormValue(event.target.value);
              if (formStatus === "error") setFormStatus("idle");
            }}
            aria-invalid={formStatus === "error" ? "true" : undefined}
            aria-describedby={formStatus === "error" ? `${kind}-new-error` : undefined}
            className={`w-full rounded-control border-2 bg-surface px-4 py-3 text-body text-ink placeholder:text-ink-muted focus:shadow-card ${
              formStatus === "error" ? "border-danger" : "border-ink"
            }`}
          />
          {formStatus === "error" && <ErrorLine id={`${kind}-new-error`} message={formError} />}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={formStatus === "loading"}
              aria-busy={formStatus === "loading"}
              className={BUTTON_PRIMARY_SM}
            >
              {formStatus === "loading" && <SpinnerIcon />}
              Create
            </button>
            <button type="button" onClick={closeCreateForm} disabled={formStatus === "loading"} className={BUTTON_SECONDARY_SM}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={openCreateForm}
          className={`${BUTTON_PRIMARY} w-full sm:w-1/3`}
        >
          {createLabel}
        </button>
      )}

      {items.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-card border-2 border-ink bg-surface px-8 py-7 shadow-card">
          <EmptyGlyph name={emptyIcon} />
          <p className="text-body font-semibold text-ink">{emptyTitle}</p>
          <p className="text-meta text-ink-muted">
            {emptyBody}
            {emptyLink && (
              <>
                {" "}
                <a href={emptyLink.href} className="prose-link font-semibold">
                  {emptyLink.text}
                </a>
              </>
            )}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id} className="rounded-card border-2 border-ink bg-surface px-5 py-4">
              {editingId === item.id ? (
                <form
                  onSubmit={(event) => submitRename(item.id, event)}
                  aria-label={`Rename ${item.name}`}
                  className="flex flex-col gap-3"
                >
                  <input
                    type="text"
                    autoFocus
                    maxLength={MAX_NAME_LENGTH}
                    value={editValue}
                    onChange={(event) => {
                      setEditValue(event.target.value);
                      if (editStatus === "error") setEditStatus("idle");
                    }}
                    aria-invalid={editStatus === "error" ? "true" : undefined}
                    aria-describedby={editStatus === "error" ? `${kind}-edit-error-${item.id}` : undefined}
                    className={`w-full rounded-control border-2 bg-surface px-4 py-2 text-body text-ink focus:shadow-card ${
                      editStatus === "error" ? "border-danger" : "border-ink"
                    }`}
                  />
                  {editStatus === "error" && <ErrorLine id={`${kind}-edit-error-${item.id}`} message={editError} />}
                  <div className="flex gap-3">
                    <button
                      type="submit"
                      disabled={editStatus === "loading"}
                      aria-busy={editStatus === "loading"}
                      className={BUTTON_PRIMARY_SM}
                    >
                      {editStatus === "loading" && <SpinnerIcon />}
                      Save
                    </button>
                    <button type="button" onClick={cancelEdit} disabled={editStatus === "loading"} className={BUTTON_SECONDARY_SM}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col gap-0.5">
                    {item.href ? (
                      <a
                        href={item.href}
                        className="group inline-flex items-center gap-1.5 text-[20px] font-bold text-ink no-underline hover:text-blue-deep"
                      >
                        {item.name}
                        <ChevronIcon />
                      </a>
                    ) : (
                      <span className="text-[20px] font-bold text-ink">{item.name}</span>
                    )}
                    {item.count === 0 ? (
                      <span className="text-pill text-ink-muted">
                        No icons yet - open it, press Add icons, find what you like, and
                        press the star.
                      </span>
                    ) : (
                      typeof item.count === "number" && (
                        <span className="text-pill text-ink-muted">
                          {item.count} {item.count === 1 ? "icon" : "icons"}
                        </span>
                      )
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {/* Navigates to the same destination the row title link
                        already uses -
                        `item.href` (dashboard.astro's
                        `/collections/{id}` - no separate route invented).
                        A real anchor, not a button + programmatic
                        navigation, so Enter/middle-click/new-tab keep
                        working for free - same class constant as Rename,
                        so it is pixel-identical secondary styling and
                        already clears the 44px touch target. Guarded by
                        `item.href` the same way the title link above is:
                        no dead link if a future resource kind omits it. */}
                    {item.href && (
                      <a href={item.href} aria-label={`Edit ${item.name}`} className={BUTTON_SECONDARY_SM}>
                        Edit
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => startEdit(item)}
                      aria-label={`Rename ${item.name}`}
                      className={BUTTON_SECONDARY_SM}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={(event) => startDeleteConfirm(item.id, event)}
                      aria-label={`Delete ${item.name}`}
                      className={BUTTON_DANGER_TEXT_SM}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {confirmingId && (
        <ConfirmDeleteModal
          name={items.find((item) => item.id === confirmingId)?.name ?? ""}
          busy={deleteBusyId === confirmingId}
          error={deleteErrorId === confirmingId ? deleteError : ""}
          onConfirm={() => confirmDelete(confirmingId)}
          onCancel={cancelDeleteConfirm}
        />
      )}
    </div>
  );
}
