import { useCallback, useState, type SyntheticEvent } from "react";
import type { UpsellCopy } from "../ResourceManager";

export interface CollectionOption {
  id: string;
  name: string;
  saved: boolean;
}

export type ListStatus = "idle" | "loading" | "loaded" | "error";
export type FormStatus = "idle" | "loading" | "error";

export interface SavePicker {
  collections: CollectionOption[];
  listStatus: ListStatus;
  /** True once any collection in the list carries `saved: true`. `false`
      before the list has ever loaded - callers that need to distinguish
      "not saved" from "don't know yet" should check `listStatus` too. */
  savedAnywhere: boolean;
  saveUpsell: UpsellCopy | null;
  busyId: string | null;
  rowErrorId: string | null;
  rowError: string;
  newOpen: boolean;
  newValue: string;
  setNewValue: (value: string) => void;
  newStatus: FormStatus;
  newError: string;
  createUpsell: UpsellCopy | null;
  loadCollections: () => Promise<void>;
  /** Returns what actually happened, so a caller that does not render the
      list itself (SaveStar's direct quick-save path) can react without
      re-deriving it from state. */
  toggle: (option: CollectionOption) => Promise<"saved" | "removed" | "limited" | "error">;
  openNewCollectionForm: () => void;
  closeNewCollectionForm: () => void;
  submitNewCollection: (event: SyntheticEvent<HTMLFormElement>) => Promise<void>;
}

/**
 * The collection-picker data/actions shared by every "save this icon"
 * control in the app: the icon detail page's SaveButton and the search
 * results grid's quick-save star (SaveStar). Pulled out so the grid feature
 * can reuse the exact fetch/toggle/create-collection logic instead of a
 * second copy that drifts from this one - same rationale as tile-classes.ts.
 *
 * Deliberately does not know about `signedIn`/entitlements or WHEN to load -
 * callers decide that (SaveButton loads eagerly on mount for a signed-in
 * visitor; SaveStar only loads lazily, on first interaction, since a search
 * page can render dozens of tiles and must not fire a collections fetch per
 * tile up front).
 */
export function useSavePicker(
  iconId: string,
  onSaved?: (collection: { id: string; name: string }) => void,
): SavePicker {
  const [collections, setCollections] = useState<CollectionOption[]>([]);
  const [listStatus, setListStatus] = useState<ListStatus>("idle");
  const [saveUpsell, setSaveUpsell] = useState<UpsellCopy | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowErrorId, setRowErrorId] = useState<string | null>(null);
  const [rowError, setRowError] = useState("");

  const [newOpen, setNewOpen] = useState(false);
  const [newValue, setNewValue] = useState("");
  const [newStatus, setNewStatus] = useState<FormStatus>("idle");
  const [newError, setNewError] = useState("");
  const [createUpsell, setCreateUpsell] = useState<UpsellCopy | null>(null);

  const savedAnywhere = collections.some((c) => c.saved);

  const loadCollections = useCallback(async () => {
    setListStatus("loading");
    try {
      const response = await fetch(`/api/collections?icon=${encodeURIComponent(iconId)}`);
      const data = (await response.json().catch(() => null)) as
        | { collections?: CollectionOption[] }
        | null;
      if (!response.ok || !data?.collections) {
        setListStatus("error");
        return;
      }
      setCollections(data.collections);
      setListStatus("loaded");
    } catch {
      setListStatus("error");
    }
  }, [iconId]);

  const toggle = useCallback(
    async (option: CollectionOption): Promise<"saved" | "removed" | "limited" | "error"> => {
      setBusyId(option.id);
      setRowErrorId(null);
      setSaveUpsell(null);

      try {
        const response = await fetch(`/api/collections/${option.id}/icons`, {
          method: option.saved ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ icon: iconId }),
        });
        const data = (await response.json().catch(() => null)) as
          | { error?: string; limited?: true; upsell?: UpsellCopy; saved?: boolean }
          | null;

        if (!response.ok) {
          setRowErrorId(option.id);
          setRowError(data?.error ?? "Could not update. Try again.");
          setBusyId(null);
          return "error";
        }

        if (data?.limited) {
          setSaveUpsell(data.upsell ?? null);
          setBusyId(null);
          return "limited";
        }

        const saved = Boolean(data?.saved);
        setCollections((prev) =>
          prev.some((c) => c.id === option.id)
            ? prev.map((c) => (c.id === option.id ? { ...c, saved } : c))
            : prev,
        );
        setBusyId(null);
        if (saved) onSaved?.({ id: option.id, name: option.name });
        return saved ? "saved" : "removed";
      } catch {
        setRowErrorId(option.id);
        setRowError("Could not update. Try again.");
        setBusyId(null);
        return "error";
      }
    },
    [iconId, onSaved],
  );

  const openNewCollectionForm = useCallback(() => {
    setNewOpen(true);
    setNewValue("");
    setNewStatus("idle");
    setNewError("");
  }, []);

  const closeNewCollectionForm = useCallback(() => {
    setNewOpen(false);
    setNewValue("");
    setNewStatus("idle");
    setNewError("");
  }, []);

  const submitNewCollection = useCallback(
    async (event: SyntheticEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = newValue.trim();
      if (!trimmed) {
        setNewStatus("error");
        setNewError("Give your collection a name.");
        return;
      }

      setNewStatus("loading");
      setNewError("");

      try {
        const response = await fetch("/api/collections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        });
        const data = (await response.json().catch(() => null)) as
          | { error?: string; limited?: true; upsell?: UpsellCopy; collection?: { id: string; name: string } }
          | null;

        if (!response.ok) {
          setNewStatus("error");
          setNewError(data?.error ?? "Something went wrong. Try again.");
          return;
        }

        if (data?.limited) {
          setCreateUpsell(data.upsell ?? null);
          setNewOpen(false);
          setNewStatus("idle");
          return;
        }

        const created = data?.collection;
        if (!created) {
          setNewStatus("error");
          setNewError("Something went wrong. Try again.");
          return;
        }

        setCollections((prev) => [...prev, { id: created.id, name: created.name, saved: false }]);
        setNewOpen(false);
        setNewValue("");
        setNewStatus("idle");
      } catch {
        setNewStatus("error");
        setNewError("Something went wrong. Try again.");
      }
    },
    [newValue],
  );

  return {
    collections,
    listStatus,
    savedAnywhere,
    saveUpsell,
    busyId,
    rowErrorId,
    rowError,
    newOpen,
    newValue,
    setNewValue,
    newStatus,
    newError,
    createUpsell,
    loadCollections,
    toggle,
    openNewCollectionForm,
    closeNewCollectionForm,
    submitNewCollection,
  };
}
