/**
 * Remembers the last collection a visitor quick-saved an icon to (search
 * results grid only - SaveStar.tsx), so the next star click saves straight
 * there instead of reopening the picker. Client-only, best-effort: any
 * localStorage failure (Safari private mode, storage disabled) just falls
 * back to "no memory", which re-shows the picker - never a broken state.
 */

const KEY = "motificons:lastCollection";

export interface LastCollection {
  id: string;
  name: string;
}

export function getLastCollection(): LastCollection | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as LastCollection).id === "string" &&
      typeof (parsed as LastCollection).name === "string"
    ) {
      return parsed as LastCollection;
    }
    return null;
  } catch {
    return null;
  }
}

export function setLastCollection(collection: LastCollection): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(collection));
  } catch {
    /* best-effort - see header comment */
  }
}
