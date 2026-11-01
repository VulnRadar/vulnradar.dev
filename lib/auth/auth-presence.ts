import { isStaffRole } from "@/lib/auth/permissions-client";

/**
 * Minimal shape computeAuthPresence reads off a /api/v3/auth/me result. The
 * full object is passed through and cached verbatim; only userId and role
 * are inspected.
 */
export type AuthPresenceInput =
  { userId?: number | null; role?: string | null } | null | undefined;

/**
 * Decide what the browser should cache for a given /me result, so the
 * pre-React blocking script in app/layout.tsx reveals the right chrome
 * before React hydrates. `cache` is the value to persist under
 * vr_auth_cache (or null to clear it); `auth` and `staff` are the two
 * flags that script stamps onto <html> as data attributes.
 *
 * This used to return a stylesheet for that script to build a <style> element
 * from and append to document.head. That was the cause of a hydration failure
 * on every page of the app: the script runs before React hydrates, so React
 * walked into a <head> containing an element its tree knew nothing about,
 * declared the markup mismatched, and (in its own words) regenerated the tree
 * on the client. Regenerating re-entered the route's Suspense boundary, so
 * loading.tsx played a second time and every page showed two skeletons.
 *
 * Flags on <html> have none of that problem. The element already carries
 * suppressHydrationWarning for exactly this reason (next-themes stamps its
 * class the same way), the rules live in globals.css where they can be read,
 * and nothing is inserted into the document before React looks at it.
 *
 * The load-bearing case is logged-out: /me answers 401 once a session is
 * gone, which the fetcher turns into null, and that must return the cleared
 * state, or a session revoked elsewhere ("Sign out everywhere", an admin
 * force-logout, another device, or plain expiry) leaves this browser reading
 * a stale vr_auth_cache and showing a signed-in shell for an account that is
 * no longer signed in. A read that failed for another reason (a 429, a 502,
 * maintenance) is not an answer at all; authPresenceSettled keeps it from
 * reaching here. Kept JSX-free (its own module) so it is unit-testable in the
 * backend-only vitest environment.
 */
export function computeAuthPresence(me: AuthPresenceInput): {
  cache: string | null;
  auth: boolean;
  staff: boolean;
} {
  if (!me?.userId) {
    return { cache: null, auth: false, staff: false };
  }
  return {
    cache: JSON.stringify(me),
    auth: true,
    staff: isStaffRole(me.role ?? null),
  };
}

/**
 * Whether the /me read has an answer the shell may act on: a user, or null
 * for a 401. `undefined` means no answer yet, either in flight or every try so
 * far failed, and acting on it would sign the shell out of an account that is
 * still signed in.
 */
export function authPresenceSettled(
  me: AuthPresenceInput,
  isLoading: boolean,
): boolean {
  return !isLoading && me !== undefined;
}
