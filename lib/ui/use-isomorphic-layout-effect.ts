import { useEffect, useLayoutEffect } from "react";

/**
 * useLayoutEffect in the browser, useEffect on the server.
 *
 * For state that is seeded from something React cannot see (the URL query
 * string, read through lib/ui/url-state), and where seeding it a frame late is
 * visible. A plain useEffect runs after the browser has painted, so the page
 * paints its default branch first and then swaps: on /history?scan=X that meant
 * the list skeleton was painted, then replaced by the scan-detail skeleton, and
 * the reader saw two different loading states before any content. A layout
 * effect runs after the DOM is updated but before paint, so the swap is never
 * shown.
 *
 * The seed cannot simply move into a useState initializer instead. The server
 * has no window and so renders the default branch either way, and a first
 * client render that disagreed with that HTML is a hydration mismatch, which
 * React answers by regenerating the tree, which is the far worse version of
 * this same bug (see lib/auth/auth-presence.ts). Matching on the first render
 * and correcting before paint is what keeps both properties.
 *
 * The branch is on `window` rather than a mount flag because it is resolved
 * once at module load: useLayoutEffect during SSR warns, and there is no
 * layout to measure there anyway.
 */
export const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;
