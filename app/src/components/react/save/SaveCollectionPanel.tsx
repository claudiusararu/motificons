import { MAX_NAME_LENGTH } from "../../../lib/workspace/limits";
import type { UpsellCopy } from "../ResourceManager";
import type { SavePicker } from "./useSavePicker";
import { CheckIcon, ErrorLine, SpinnerIcon } from "./icons";

const BUTTON_BASE =
  "press press-sm relative inline-flex items-center justify-center gap-2 rounded-control border-2 border-ink text-body font-semibold leading-[1.25] disabled:cursor-not-allowed disabled:opacity-[0.55]";
const BUTTON_PRIMARY_SM = `${BUTTON_BASE} bg-primary px-4 py-[10px] text-ink`;

function UpsellBlock({ upsell }: { upsell: UpsellCopy }) {
  return (
    <div className="rounded-control border-2 border-ink bg-canvas p-4">
      <p className="text-meta font-semibold text-ink">{upsell.headline}</p>
      <p className="mt-1.5 text-meta text-ink-muted">{upsell.body}</p>
      {upsell.href && (
        <a href={upsell.href} className={`${BUTTON_PRIMARY_SM} mt-3 w-full no-underline`}>
          {upsell.ctaLabel ?? "Learn more"}
        </a>
      )}
    </div>
  );
}

/**
 * The dropdown body used by both SaveButton (icon detail page) and SaveStar
 * (search results grid): the signed-out prompt, or the collections list
 * with inline create - one implementation, reused rather than forked.
 *
 * Collections belong to an account, so this is one of the few surfaces that
 * needs a visitor to have one. Accounts are free, so the prompt asks for a
 * sign-up and nothing more.
 */
export default function SaveCollectionPanel({
  panelId,
  signedIn,
  picker,
}: {
  panelId: string;
  signedIn: boolean;
  picker: SavePicker;
}) {
  if (!signedIn) {
    return (
      <div>
        <p className="text-meta text-ink">
          Create a free account to save icons into collections.
        </p>
        <a href="/register" className={`${BUTTON_PRIMARY_SM} mt-3 w-full no-underline`}>
          Create a free account
        </a>
        <a
          href="/sign-in"
          className="mt-3 block text-center text-pill font-semibold text-blue-deep underline underline-offset-2"
        >
          Already have an account? Sign in
        </a>
      </div>
    );
  }

  return (
    <div>
      {picker.listStatus === "loading" && (
        <div className="flex items-center gap-2 py-2 text-meta text-ink-muted">
          <SpinnerIcon />
          Loading your collections&hellip;
        </div>
      )}

      {picker.listStatus === "error" && (
        <div>
          <ErrorLine id={`${panelId}-list-error`} message="Could not load your collections." />
          <button
            type="button"
            onClick={() => picker.loadCollections()}
            className={`${BUTTON_BASE} bg-surface px-4 py-[10px] text-ink mt-3 w-full`}
          >
            Try again
          </button>
        </div>
      )}

      {picker.listStatus === "loaded" && (
        <>
          {picker.saveUpsell && <UpsellBlock upsell={picker.saveUpsell} />}

          {!picker.saveUpsell && picker.collections.length > 0 && (
            <ul className="flex flex-col gap-1">
              {picker.collections.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    onClick={() => picker.toggle(option)}
                    disabled={picker.busyId === option.id}
                    aria-busy={picker.busyId === option.id}
                    aria-pressed={option.saved}
                    className="flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-left text-body text-ink transition-colors duration-[120ms] ease-in hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border-2 border-ink ${
                        option.saved ? "bg-primary text-ink" : "bg-surface text-transparent"
                      }`}
                    >
                      {picker.busyId === option.id ? <SpinnerIcon /> : <CheckIcon />}
                    </span>
                    <span className="flex-1 truncate">{option.name}</span>
                  </button>
                  {picker.rowErrorId === option.id && (
                    <ErrorLine id={`${panelId}-row-error-${option.id}`} message={picker.rowError} />
                  )}
                </li>
              ))}
            </ul>
          )}

          {!picker.saveUpsell && picker.collections.length === 0 && !picker.newOpen && (
            <p className="text-meta text-ink-muted">No collections yet.</p>
          )}

          {picker.createUpsell ? (
            <div className="mt-3 border-t-2 border-ink pt-3">
              <UpsellBlock upsell={picker.createUpsell} />
            </div>
          ) : picker.newOpen ? (
            <form
              onSubmit={picker.submitNewCollection}
              aria-label="New collection"
              className="mt-3 flex flex-col gap-2 border-t-2 border-ink pt-3"
            >
              <input
                type="text"
                autoFocus
                maxLength={MAX_NAME_LENGTH}
                value={picker.newValue}
                placeholder='e.g. "Settings screen"'
                onChange={(event) => picker.setNewValue(event.target.value)}
                aria-invalid={picker.newStatus === "error" ? "true" : undefined}
                aria-describedby={picker.newStatus === "error" ? `${panelId}-new-error` : undefined}
                className={`w-full rounded-control border-2 bg-surface px-3 py-2 text-body text-ink placeholder:text-ink-muted focus:shadow-card ${
                  picker.newStatus === "error" ? "border-danger" : "border-ink"
                }`}
              />
              {picker.newStatus === "error" && (
                <ErrorLine id={`${panelId}-new-error`} message={picker.newError} />
              )}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={picker.newStatus === "loading"}
                  aria-busy={picker.newStatus === "loading"}
                  className={`${BUTTON_PRIMARY_SM} flex-1`}
                >
                  {picker.newStatus === "loading" && <SpinnerIcon />}
                  Create
                </button>
                <button
                  type="button"
                  onClick={picker.closeNewCollectionForm}
                  disabled={picker.newStatus === "loading"}
                  className={`${BUTTON_BASE} bg-surface px-4 py-[10px] text-ink flex-1`}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={picker.openNewCollectionForm}
              className="mt-3 flex w-full items-center gap-2 border-t-2 border-ink pt-3 text-meta font-semibold text-blue-deep"
            >
              + New collection
            </button>
          )}
        </>
      )}
    </div>
  );
}
