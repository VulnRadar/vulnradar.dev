"use client";

import { useState, useTransition, type ReactNode } from "react";
import { APP_NAME } from "@/lib/config/client-constants";
import { loadMoreReleases } from "@/components/changelog/changelog-actions";

/**
 * The reveal half of the changelog list.
 *
 * The releases it appends are rendered on the server and arrive as markup, so
 * this component never imports lib/changelog/data: it only knows an offset and
 * a total. That is the whole point of the split.
 *
 * Loading is button-only. It used to also fire from an IntersectionObserver
 * whenever the button came within 400px of the viewport, which meant the
 * footer (legal links, contact, status) was only reachable once every release
 * had loaded: someone scrolling or pressing End towards it kept triggering the
 * next batch, which pushed the footer away again, batch after batch, until the
 * whole history was on the page. Content also arrived ahead of a keyboard or
 * screen-reader user's position without their asking. With only the button,
 * the footer sits directly under it and a batch arrives when the reader says
 * so.
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

  const hasMore = offset < total;

  const loadMore = () => {
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
  };

  return (
    <>
      {batches.length > 0 && (
        <div className="mt-6 flex flex-col gap-6">{batches}</div>
      )}

      {hasMore ? (
        <div className="flex flex-col items-center justify-center gap-3 py-10">
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
