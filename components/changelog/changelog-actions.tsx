"use server";

import type { ReactNode } from "react";
import { CHANGELOG } from "@/lib/changelog/data";
import { ChangelogRelease } from "@/components/changelog/changelog-release";

// Not exported: a "use server" module may only export async functions, and
// the client does not need it anyway -- every response carries the next
// offset and the total back with it.
const LOAD_MORE_BATCH = 4;

/**
 * Renders the next batch of releases on the server and returns the markup.
 *
 * A plain data response is not an option here: `Change.icon` is a lucide
 * component reference, not a string, so the release records cannot cross the
 * boundary as JSON. Returning already-rendered nodes is what lets
 * lib/changelog/data.ts (about 480 KB, and growing by a block per change)
 * stay entirely on the server. Same accepted pattern as app/actions/stripe.ts,
 * the other "use server" module in the tree.
 */
export async function loadMoreReleases(offset: number): Promise<{
  nodes: ReactNode;
  nextOffset: number;
  total: number;
}> {
  const total = CHANGELOG.length;
  // The offset arrives from the browser, so it is untrusted input into an
  // array slice: clamp it rather than letting a negative or absurd value
  // produce a surprise slice.
  const start = Number.isFinite(offset)
    ? Math.min(Math.max(Math.trunc(offset), 0), total)
    : 0;
  const end = Math.min(start + LOAD_MORE_BATCH, total);

  const nodes = CHANGELOG.slice(start, end).map((release) => (
    <ChangelogRelease
      key={release.version}
      release={release}
      isLatest={false}
    />
  ));

  return { nodes, nextOffset: end, total };
}
