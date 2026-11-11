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
  /** The verified domain names this account may scan under, lowercased. */
  domains: string[];
  /** False until the fetch settles, so nothing flashes an answer it does not have. */
  loaded: boolean;
  /** Whether a verified domain covers this host, under the zone-control rule. */
  covers: (host: string | null) => boolean;
}

/**
 * The domain names, lowercased, from GET /api/v3/domains rows that would let
 * this account scan with active probes or a port sweep.
 *
 * `usableForScanning` and not `status`: the list also holds teammates' rows
 * shared into a team where this account is only a viewer or a manager, and
 * those are verified but do not let it scan (lib/domains/scope.ts honours a
 * team row only for a team it may assign scans to). Counting them promised a
 * port sweep the server then refused, which 403'd the whole scan
 * (gap-domain-verification-active-gating-6). Strictly `true`, so a row from a
 * server that does not send the flag reads as "cannot claim it", the same
 * answer as loading or an error.
 */
export function usableDomainNames(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(
      (r): r is { domain: string } =>
        !!r &&
        typeof r === "object" &&
        (r as { usableForScanning?: unknown }).usableForScanning === true &&
        typeof (r as { domain?: unknown }).domain === "string",
    )
    .map((r) => r.domain.toLowerCase());
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
        if (cancelled) return;
        setDomains(usableDomainNames(data?.domains));
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
