"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { APP_NAME } from "@/lib/config/constants";
import {
  CHANGE_CATEGORIES,
  CHANGELOG,
  type ChangeCategory,
} from "@/lib/changelog/data";

// How many releases render up front, and how many more load in each time the
// sentinel at the bottom of the list scrolls into view.
const INITIAL_BATCH = 4;
const LOAD_MORE_BATCH = 4;

// Reading order within a release, not authorship order: security first
// (the thing people scanning a changelog for "am I safer now" look for),
// then new capabilities, then bug fixes, then everything else. Within a
// group, original order is preserved (Array.prototype.sort is stable).
const CATEGORY_ORDER: ChangeCategory[] = [
  "security",
  "added",
  "fixed",
  "changed",
  "performance",
  "deprecated",
];
const UNCATEGORIZED_RANK = CATEGORY_ORDER.length;
function categoryRank(category?: ChangeCategory): number {
  if (!category) return UNCATEGORIZED_RANK;
  const i = CATEGORY_ORDER.indexOf(category);
  return i === -1 ? UNCATEGORIZED_RANK : i;
}

function CategoryBadge({ category }: { category?: ChangeCategory }) {
  if (!category) return null;
  const { label, color } = CHANGE_CATEGORIES[category];
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${color}`}
    >
      {label}
    </span>
  );
}

export function ChangelogList() {
  const [visibleCount, setVisibleCount] = useState(
    Math.min(INITIAL_BATCH, CHANGELOG.length),
  );
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const hasMore = visibleCount < CHANGELOG.length;

  useEffect(() => {
    if (!hasMore) return;
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((count) =>
            Math.min(count + LOAD_MORE_BATCH, CHANGELOG.length),
          );
        }
      },
      { rootMargin: "400px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore]);

  // Group by category (security first, then added/fixed/changed/perf/
  // deprecated) so a release with e.g. six unrelated changes and one
  // security fix doesn't bury the security fix in the middle of the list --
  // sorted once here rather than in the data file so CHANGELOG itself stays
  // in whatever order each entry was actually written/shipped.
  const visibleReleases = useMemo(
    () =>
      CHANGELOG.slice(0, visibleCount).map((release) => ({
        ...release,
        changes: [...release.changes].sort(
          (a, b) => categoryRank(a.category) - categoryRank(b.category),
        ),
      })),
    [visibleCount],
  );

  return (
    <>
      <div className="flex flex-col gap-6">
        {visibleReleases.map((release, index) => (
          <article
            key={release.version}
            className="rounded-xl border border-border/60 bg-card p-5 sm:p-6"
          >
            <div className="flex flex-col gap-1 mb-4">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-md px-2.5 py-0.5 text-sm font-semibold font-mono ${
                    index === 0
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-foreground"
                  }`}
                >
                  v{release.version}
                </span>
                <time className="text-sm text-muted-foreground">
                  {release.date}
                </time>
                {index === 0 && (
                  <span className="inline-flex items-center rounded-md bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 text-xs font-medium">
                    Latest
                  </span>
                )}
              </div>
              <h2 className="text-lg font-semibold text-foreground">
                {release.title}
              </h2>
              {release.summary && (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {release.summary}
                </p>
              )}
            </div>

            <ul className="flex flex-col gap-2">
              {release.changes.map((change, changeIndex) => (
                <li
                  key={changeIndex}
                  className="flex gap-3 rounded-lg bg-muted/30 p-3"
                >
                  <change.icon
                    className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-0.5">
                      <h3 className="font-medium text-sm text-foreground">
                        {change.label}
                      </h3>
                      <CategoryBadge category={change.category} />
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {change.desc}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      {hasMore ? (
        <div
          ref={sentinelRef}
          className="flex items-center justify-center py-10 text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          Loading more releases...
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-center mt-12 pt-8 border-t border-border/50">
          The beginning of {APP_NAME}
        </p>
      )}
    </>
  );
}
