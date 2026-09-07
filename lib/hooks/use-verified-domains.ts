"use client";

import { useEffect, useState } from "react";
import { API } from "@/lib/config/client-constants";
import { domainListCovers } from "@/lib/domains/covering";

/**
 * The caller's verified domains, for surfaces that need to say whether an
 * intrusive capability will be ALLOWED before the user commits to it.
 *
 * The scan form is the reason this exists. A port sweep needs a verified
 * domain, the API enforces that with a 403, and the 403 rejects the ENTIRE
 * scan: ticking "Scan common ports" against a domain you have not verified
 * did not give you a scan without the sweep, it gave you no scan at all, with
 * the failure arriving only after you had picked your options and pressed the
 * button. Meanwhile the same sweep offered from a finished result
 * (components/scanner/port-scan-panel.tsx) says up front that the domain has
 * to be verified, and a refusal there costs you nothing. Same capability, same
 * gate, two completely different experiences of hitting it.
 *
 * This is a HINT, never a gate. The server re-checks ownership against the
 * database on every request (lib/domains/scope.ts) and that is the thing that
 * actually refuses the work. A stale or failed fetch here must never be the
 * reason something is allowed, so `covers` answers false while loading and
 * false on error: the form then shows its normal "needs a verified domain"
 * note, which is what it said before this existed.
 */
export interface VerifiedDomains {
  /** The verified domain names on this account, lowercased. */
  domains: string[];
  /** False until the fetch settles, so nothing flashes an answer it does not have. */
  loaded: boolean;
  /** Whether a verified domain covers this host, under the zone-control rule. */
  covers: (host: string | null) => boolean;
}

export function useVerifiedDomains(enabled = true): VerifiedDomains {
  const [domains, setDomains] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(API.DOMAINS);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        const rows: Array<{ domain?: unknown; status?: unknown }> =
          Array.isArray(data?.domains) ? data.domains : [];
        if (cancelled) return;
        setDomains(
          rows
            .filter(
              (r) => r.status === "verified" && typeof r.domain === "string",
            )
            .map((r) => String(r.domain).toLowerCase()),
        );
      } catch {
        // Signed out, verification turned off, or the request failed. All
        // three mean "we cannot claim this host is covered", which is the
        // empty list. Nothing is logged: this is a hint, and a hint that
        // cannot be fetched is not an error the user needs told about.
        if (!cancelled) setDomains([]);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return {
    domains,
    loaded,
    covers: (host) => (host ? domainListCovers(host, domains) : false),
  };
}
