/**
 * A collection's saved icons, resolved from "prefix:name" ids into real
 * artwork plus the set metadata the rest of the app needs.
 *
 * Shared by the two surfaces that need the whole collection at once:
 * pages/collections/[id].astro (the tile grid it server-renders) and
 * api/collections/[id]/download/[name].zip (the zip it builds). They must
 * agree about which icons are in a collection and what each one's licence
 * is, so the resolution happens once, here.
 *
 * Ownership is the caller's job: both callers reach this only after
 * `getCollection` has already scoped the id to the signed-in visitor's own
 * workspace, the same trust `listCollectionItems` itself takes.
 */

import type { Database } from "../../db/client";
import type { CollectionIconLicense } from "../collection-download";
import { getIcon, getSet, type Tier } from "../data";
import { listCollectionItems } from "./collection-items";

export interface CollectionIcon {
  /** "{prefix}:{name}" - the identity the icons route removes by, and the
      React key of the tile it becomes. */
  iconId: string;
  prefix: string;
  name: string;
  body: string;
  width: number;
  height: number;
  /** Which style-engine capabilities this icon's set has. Null only in the
      rare case below, where the set itself no longer resolves. */
  tier: Tier | null;
  /** What LICENSES.txt says about this icon's set. `policy` (not
      `set.license` directly) is the exact object the icon detail page's own
      attribution snippet reads from, reused here so the two never phrase a
      set's licence differently. */
  license: CollectionIconLicense | null;
}

/**
 * A saved icon can stop resolving - a set removed at a pipeline re-sync,
 * say. Those are dropped rather than rendered broken, and the collectionItem
 * row is deliberately left alone, so a future re-sync that restores the icon
 * brings it back on its own.
 */
export async function loadCollectionIcons(
  database: Database,
  collectionId: string,
): Promise<CollectionIcon[]> {
  const saved = await listCollectionItems(database, collectionId);

  const resolved = await Promise.all(
    saved.map(async (item): Promise<CollectionIcon | null> => {
      const [prefix, name] = item.iconId.split(":");
      if (!prefix || !name) return null;

      const icon = await getIcon(prefix, name);
      if (!icon) return null;

      const set = await getSet(prefix);
      const policy = set?.license.policy ?? null;

      return {
        iconId: item.iconId,
        prefix,
        name,
        body: icon.body,
        width: icon.width,
        height: icon.height,
        tier: set?.tier ?? null,
        license:
          set && policy
            ? {
                setName: set.name,
                authorName: set.author.name,
                authorUrl: set.author.url || null,
                licenseName: policy.name,
                licenseSpdx: policy.spdx || null,
                licenseUrl: policy.url || null,
                attributionRequired: policy.attributionRequired,
              }
            : null,
      };
    }),
  );

  return resolved.filter((item): item is CollectionIcon => item !== null);
}
