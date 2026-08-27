"use client";

import {
  createContext,
  useContext,
  ReactNode,
  useEffect,
  useMemo,
} from "react";
import useSWR, { mutate as swrMutate } from "swr";
import { API } from "@/lib/config/constants";
import {
  isStaffRole,
  hasStaffPermission,
  canAccessAdmin,
  canAccessStaffPage,
  getStaffPermissions,
  type StaffPermission,
} from "@/lib/auth/permissions-client";
import { computeAuthPresence } from "@/lib/auth/auth-presence";

export interface MeResponse {
  userId: number;
  email: string;
  name: string | null;
  tosAcceptedAt: string | null;
  /** True when this session is an active admin-impersonation session. */
  isImpersonating: boolean;
  totpEnabled: boolean;
  twoFactorMethod: string | null;
  role: string;
  avatarUrl: string | null;
  onboardingCompleted: boolean;
  backupCodesInvalid: boolean;
  /** Account-level "scans are private by default" setting (Profile ->
   *  Privacy). Seeds the pre-scan "Keep this scan private" toggle's
   *  initial value -- see components/scanner/scan-form.tsx. */
  scansPrivateByDefault: boolean;
  discordId: string | null;
  discordUsername: string | null;
  discordAvatar: string | null;
  googleId: string | null;
  googleEmail: string | null;
  googleName: string | null;
  googleAvatarUrl: string | null;
  githubId: string | null;
  githubEmail: string | null;
  githubName: string | null;
  githubLogin: string | null;
  githubAvatarUrl: string | null;
  plan: string;
  /** Real, admin-configurable per-plan limit (lib/billing/plan-limits.ts),
   *  -1 meaning unlimited (billing disabled) -- see
   *  components/scanner/scan-form.tsx, which uses this to cap bulk-scan
   *  URL entry at what the caller's plan actually allows. */
  bulkScanUrls: number;
  subscriptionStatus: string | null;
  giftedSubscription: {
    plan: string;
    expiresAt: string;
  } | null;
  badges: Array<{
    id: number;
    name: string;
    display_name: string;
    color: string | null;
    awarded_at: string;
  }>;
}

interface AuthContextType {
  me: MeResponse | null;
  isLoading: boolean;
  // Permission helpers
  isStaff: boolean;
  canAccessAdmin: boolean;
  canAccessStaffPage: boolean;
  hasPermission: (permission: StaffPermission) => boolean;
  permissions: StaffPermission[];
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: me, isLoading } = useSWR<MeResponse>(API.AUTH.ME, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 300000,
    keepPreviousData: true,
  });

  // Compute permissions based on role
  const userRole = me?.role || null;
  const authHelpers = useMemo(
    () => ({
      isStaff: isStaffRole(userRole),
      canAccessAdmin: canAccessAdmin(userRole),
      canAccessStaffPage: canAccessStaffPage(userRole),
      hasPermission: (permission: StaffPermission) =>
        hasStaffPermission(userRole, permission),
      permissions: getStaffPermissions(userRole),
    }),
    [userRole],
  );

  // Keep localStorage + the injected <style> in sync so the blocking script
  // in layout.tsx shows the right elements before React loads. Runs on EVERY
  // resolved /me result, signed in or out: a logged-out result must actively
  // tear the cache + CSS down, or a session revoked elsewhere ("Sign out
  // everywhere", an admin force-logout, another device, or plain expiry)
  // leaves this browser reading a stale vr_auth_cache on the next visit and
  // showing a logged-in shell for an account that is no longer signed in.
  useEffect(() => {
    // `me` is undefined only while the very first fetch is in flight; don't
    // clobber the cache mid-load, wait for the real result.
    if (isLoading) return;

    const { cache, css } = computeAuthPresence(me);
    try {
      if (cache === null) localStorage.removeItem("vr_auth_cache");
      else localStorage.setItem("vr_auth_cache", cache);
    } catch {}

    let el = document.getElementById("vr-auth-css");
    if (!el && css) {
      el = document.createElement("style");
      el.id = "vr-auth-css";
      document.head.appendChild(el);
    }
    if (el) el.textContent = css;
  }, [me, isLoading]);

  return (
    <AuthContext.Provider value={{ me: me ?? null, isLoading, ...authHelpers }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}

/**
 * Mirror of clearAuthCache below, for the opposite direction: call right
 * after a successful login so components reading useAuth() (the AI chat
 * widget, nav, etc.) see the signed-in state immediately instead of
 * whatever /api/v3/auth/me returned before login, cached for up to
 * dedupingInterval (5 minutes) since AuthProvider lives in the root layout
 * and survives the client-side navigation a login redirect performs.
 */
export function refreshAuthCache() {
  swrMutate(API.AUTH.ME);
}

export function clearAuthCache() {
  // Immediately set SWR's in-memory cache to null so any still-mounted
  // components (AuthProvider lives in root layout, so it persists across
  // navigations) see no user data before the page reload completes.
  swrMutate(API.AUTH.ME, null, { revalidate: false });

  try {
    localStorage.removeItem("vr_auth_cache");
    // Wipe all app-namespaced keys so no user data leaks after sign-out
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("vulnradar_")) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch {}
  const el = document.getElementById("vr-auth-css");
  if (el) el.textContent = "";
}
