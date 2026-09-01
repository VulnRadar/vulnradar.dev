/**
 * Reads the same `vr_auth_cache` localStorage entry the auth provider writes
 * (components/providers/auth-provider.tsx) and the root layout's inline script
 * reads.
 *
 * This exists for the error and 404 screens specifically. Those render outside
 * any page's own data flow and, in the error case, are shown precisely because
 * something below the provider threw, so calling useAuth() there would add a
 * dependency on the very tree that just failed. Reading the cache directly is
 * dependency-free and cannot itself throw.
 *
 * It is a hint, never an authorization decision: it only picks which "go
 * somewhere useful" link to offer. Every route it points at does its own real
 * auth check.
 */
export function hasCachedSignIn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const cached = localStorage.getItem("vr_auth_cache");
    if (!cached) return false;
    const parsed = JSON.parse(cached) as { userId?: unknown } | null;
    return !!parsed?.userId;
  } catch {
    return false;
  }
}
