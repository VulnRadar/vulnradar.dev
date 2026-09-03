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
 * The load-bearing case is logged-out: /me returns ApiResponse.unauthorized()
 * (a JSON body with no userId) once a session is gone, and a failed fetch
 * leaves `me` null/undefined. BOTH must return the cleared state, or a
 * session revoked elsewhere ("Sign out everywhere", an admin force-logout,
 * another device, or plain expiry) leaves this browser reading a stale
 * vr_auth_cache and showing a signed-in shell for an account that is no
 * longer signed in. Kept JSX-free (its own module) so it is unit-testable in
 * the backend-only vitest environment.
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
