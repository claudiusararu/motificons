import { useEffect, useState } from "react";
import {
  TILE_CLASS,
  TILE_GLYPH_CLASS,
  TILE_GRID_CLASS,
  TILE_NAME_CLASS,
} from "../../lib/tile-classes";

interface RelatedItem {
  prefix: string;
  name: string;
}

/**
 * The "Related icons" row on an icon detail page, hydrated AFTER the page's SSR
 * finishes (mounted client:visible). The page no longer computes related icons
 * server-side - that shard search was blowing the Worker CPU limit and 500-ing
 * the whole render on long icon names. Here it runs client-side, off the page's
 * critical path: the SSR ships a cheap skeleton, this fetches the real results
 * from /api/related once the section scrolls into view, and swaps them in.
 *
 * Results are the FULL search (no query cap) - identical to what the server
 * used to render, just a moment later. A real visitor loses nothing. Crawlers
 * (no JS) simply never see this row, which is fine: icon pages are noindex.
 */
export default function RelatedIcons({
  prefix,
  name,
}: {
  prefix: string;
  name: string;
}) {
  const [items, setItems] = useState<RelatedItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/related/${prefix}/${name}`)
      .then((response) => (response.ok ? response.json() : []))
      .then((data: unknown) => {
        if (!cancelled) {
          setItems(Array.isArray(data) ? (data as RelatedItem[]) : []);
        }
      })
      .catch(() => {
        /* A detail page must stand on its own - a failed related fetch just
           leaves the row empty, never an error. */
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [prefix, name]);

  /* Loaded and genuinely empty - drop the whole section rather than leave a
     heading over nothing. */
  if (items !== null && items.length === 0) return null;

  return (
    <section className="mt-16">
      <h2 className="text-h2 font-semibold">Related icons</h2>
      <p className="mt-2 text-meta text-ink-muted">
        The same idea drawn by other sets.
      </p>
      <div className={`mt-6 ${TILE_GRID_CLASS}`}>
        {items === null
          ? Array.from({ length: 12 }).map((_, index) => (
              <div
                key={index}
                className={`${TILE_CLASS} animate-pulse motion-reduce:animate-none`}
                aria-hidden="true"
              />
            ))
          : items.map((item) => (
              <a
                key={`${item.prefix}:${item.name}`}
                href={`/${item.prefix}/${item.name}`}
                title={item.name}
                aria-label={item.name}
                className={TILE_CLASS}
              >
                <span className={`${TILE_GLYPH_CLASS} glyph-checker`}>
                  <img
                    src={`/api/icon/${item.prefix}/${item.name}.svg`}
                    width={30}
                    height={30}
                    alt=""
                    loading="lazy"
                  />
                </span>
                <span className={TILE_NAME_CLASS}>{item.name}</span>
              </a>
            ))}
      </div>
    </section>
  );
}
