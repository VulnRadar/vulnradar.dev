"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { APP_NAME } from "@/lib/config/client-constants";
import { loadMoreReleases } from "@/components/changelog/changelog-actions";

/**
 * The reveal half of the changelog list.
 *
 * The releases it appends are rendered on the server and arrive as markup, so
 * this component never imports lib/changelog/data: it only knows an offset and
 * a total. That is the whole point of the split.
 */
export function ChangelogLoadMore({
  initialOffset,
  total: initialTotal,
}: {
  initialOffset: number;
  total: number;
}) {
  const [batches, setBatches] = useState<ReactNode[]>([]);
  const [offset, setOffset] = useState(initialOffset);
  const [total, setTotal] = useState(initialTotal);
  const [failed, setFailed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const hasMore = offset < total;

  const loadMore = useCallback(() => {
    if (isPending) return;
    startTransition(async () => {
      try {
        const next = await loadMoreReleases(offset);
        setBatches((prev) => [...prev, next.nodes]);
        setOffset(next.nextOffset);
        setTotal(next.total);
        setFailed(false);
      } catch {
        // A failed batch used to be indistinguishable from "there is nothing
        // more": the button simply did nothing. Say so, and leave the button
        // live so it can be retried.
        setFailed(true);
      }
    });
  }, [isPending, offset]);

  useEffect(() => {
    if (!hasMore) return;
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "400px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  return (
    <>
      {batches.length > 0 && (
        <div className="mt-6 flex flex-col gap-6">{batches}</div>
      )}

      {hasMore ? (
        // The sentinel is an optimisation, not the mechanism. It used to be
        // the only way to advance the list, so anything without a working
        // IntersectionObserver (an older browser, a reader that never
        // scrolls the element into view, a keyboard user tabbing through)
        // sat on "Loading more releases..." forever with no way past it.
        // The button always works; the observer just means you rarely need
        // to press it.
        <div
          ref={sentinelRef}
          className="flex flex-col items-center justify-center gap-3 py-10"
        >
          <button
            type="button"
            onClick={loadMore}
            disabled={isPending}
            className="inline-flex h-10 items-center rounded-md border border-border/60 px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            {isPending ? "Loading..." : "Load more releases"}
          </button>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {failed
              ? "Those releases could not be loaded. Try again."
              : `Showing ${offset} of ${total}`}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-center mt-12 pt-8 border-t border-border/50">
          The beginning of {APP_NAME}
        </p>
      )}
    </>
  );
}
