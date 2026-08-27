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
 * vr_auth_cache (or null to clear it); `css` is the injected auth-only /
 * staff-only stylesheet (empty string clears it).
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
  css: string;
} {
  if (!me?.userId) {
    return { cache: null, css: "" };
  }
  let css =
    ".vr-auth-only{visibility:visible!important;pointer-events:auto!important}";
  if (isStaffRole(me.role ?? null)) {
    css += ".vr-staff-only{display:flex!important}";
  }
  return { cache: JSON.stringify(me), css };
}
