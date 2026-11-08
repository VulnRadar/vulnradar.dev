"use client";

import { useEffect } from "react";
import { useDocsContext } from "@/components/docs/docs-shell";
import type { TocItem } from "@/components/docs/docs-types";

/**
 * The scroll-spy, as a leaf, so a docs page can stay a server component.
 *
 * It tracks the registry's table of contents, which the shell reads directly.
 * `items` is the prop this used to take to feed the contents in after
 * hydration; pages still passing it are ignored until each one's next owner
 * deletes the array.
 *
 * Colocated here rather than under components/docs because it is a leaf of
 * this route group and nothing outside app/docs renders it.
 */
export function DocsTocSpy(_props: { items?: TocItem[] }) {
  const { setActiveSection, tocItems } = useDocsContext();

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    );

    tocItems.forEach((item) => {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [tocItems, setActiveSection]);

  return null;
}
