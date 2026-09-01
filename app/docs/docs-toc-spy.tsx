"use client";

import { useEffect, useRef } from "react";
import { useDocsContext } from "@/components/docs/docs-shell";
import type { TocItem } from "@/components/docs/docs-types";

/**
 * AUDIT-012 fe-03: every page under app/docs carried "use client" for
 * nothing but the two effects that used to live inline in each of them, one
 * registering a static tocItems array with the docs shell and one wiring the
 * scroll-spy. That put ~12,500 lines of static prose into the browser bundle
 * (each paragraph serialized twice, once as HTML and again as React element
 * JS) and hydrated thousands of nodes on pages where nothing is interactive.
 * /docs/config additionally shipped the whole 3,200-line settings registry to
 * anonymous readers, because a client component's imports are client imports.
 *
 * The behaviour is unchanged; it just lives in one leaf now. Drop
 * `<DocsTocSpy items={tocItems} />` at the top of a docs page and the page
 * itself stays a server component.
 *
 * Colocated here rather than under components/docs because it is a leaf of
 * this route group and nothing outside app/docs renders it.
 */
export function DocsTocSpy({ items }: { items: TocItem[] }) {
  const { setActiveSection, setTocItems } = useDocsContext();
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    setTocItems(items);
    return () => setTocItems([]);
  }, [items, setTocItems]);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    );

    items.forEach((item) => {
      const el = document.getElementById(item.id);
      if (el) observerRef.current?.observe(el);
    });

    return () => observerRef.current?.disconnect();
  }, [items, setActiveSection]);

  return null;
}
