"use client";

import { useEffect } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { API } from "@/lib/config/constants";

/**
 * Opt-in IPv4 capture. Does nothing unless NEXT_PUBLIC_IPV4_ECHO_URL points at
 * an IPv4-only echo host (a DNS A record with no AAAA, serving GET
 * /api/v3/whoami-ip). When it does, a signed-in browser pings that host once
 * per session: because the hostname resolves only to IPv4, a dual-stack
 * browser is forced onto its IPv4 path, so the echo host observes the real
 * IPv4 and returns a signed token. We relay the token to the same-origin
 * record endpoint, which stores the IPv4 on the current session for the
 * security page. Entirely best-effort: an IPv6-only client (no IPv4 route)
 * just never records one, and any network/CORS failure is swallowed.
 */
const ECHO_URL = process.env.NEXT_PUBLIC_IPV4_ECHO_URL;

export function Ipv4Capture() {
  const { me } = useAuth();
  const userId = me?.userId;

  useEffect(() => {
    if (!ECHO_URL || !userId) return;

    // Once per session per user: avoids re-pinging on every navigation.
    const flag = `vr_ipv4_recorded_${userId}`;
    try {
      if (sessionStorage.getItem(flag)) return;
    } catch {
      /* sessionStorage may be blocked; fall through and try once */
    }

    let cancelled = false;
    (async () => {
      try {
        // Credential-less: the echo host only reports the caller's own IP.
        const res = await fetch(ECHO_URL, { credentials: "omit" });
        if (!res.ok) return;
        const data = (await res.json()) as { ip?: string; token?: string };
        if (cancelled || !data?.token) return;

        await fetch(API.AUTH.SESSION_IPV4, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: data.token }),
        });
        try {
          sessionStorage.setItem(flag, "1");
        } catch {
          /* ignore */
        }
      } catch {
        /* best-effort: an IPv6-only client or a CORS/network error is fine */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  return null;
}
