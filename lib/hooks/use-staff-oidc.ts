"use client";

import { useEffect, useState } from "react";
import { API } from "@/lib/config/client-constants";

/**
 * Whether staff SSO (lib/auth/staff-oidc.ts) is configured on this
 * instance. Same "stays hidden until confirmed configured, and on any
 * fetch failure" pattern as useOAuthProviders -- the login page's "Sign in
 * with SSO" link only renders once this resolves true.
 */
export function useStaffOidcConfigured(): boolean {
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(API.AUTH.STAFF_OIDC_INFO)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setConfigured(Boolean(data.configured));
      })
      .catch(() => {
        /* stay hidden */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return configured;
}
