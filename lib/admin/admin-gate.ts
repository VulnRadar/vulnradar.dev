/**
 * Decides what the admin page renders, before any admin data has to load.
 *
 * The point is the deny case: a non-staff visitor must get "Access Denied"
 * without ever seeing the admin skeleton. That skeleton used to show on the
 * first paint (loading is true, forbidden is still false) while the
 * /api/v3/admin request was in flight, and only flipped to the denied screen
 * once the 403 came back -- a visible flash of admin chrome at people with no
 * access. Resolving the obvious deny from the client's own cached role closes
 * that window; the server's 403 stays authoritative on top.
 */
export type AdminGate = "deny" | "auth-pending" | "loading" | "ready";

export function resolveAdminGate(input: {
  /** The admin API returned 403 (authoritative). */
  forbidden: boolean;
  /** The client's own auth (useAuth) is still resolving. */
  authLoading: boolean;
  /** isStaffRole(me?.role) for the current viewer. */
  viewerIsStaff: boolean;
  /** The admin data fetch is in flight. */
  dataLoading: boolean;
}): AdminGate {
  const { forbidden, authLoading, viewerIsStaff, dataLoading } = input;

  // Server said no: deny outright.
  if (forbidden) return "deny";
  // Client already knows this viewer is not staff: deny now, before the admin
  // request would otherwise flash the skeleton.
  if (!authLoading && !viewerIsStaff) return "deny";
  // Auth still resolving with no cached staff role to trust: a neutral loader,
  // never the admin skeleton, so a non-staff visitor glimpses nothing.
  if (!viewerIsStaff) return "auth-pending";
  // Viewer is staff (cached or confirmed).
  if (dataLoading) return "loading";
  return "ready";
}
