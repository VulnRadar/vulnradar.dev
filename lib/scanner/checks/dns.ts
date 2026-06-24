/**
 * DNS checks placeholder.
 *
 * All DNS checks (A/AAAA/CAA/MX/NS/SOA/SRV/TLSA/SSHFP/DS/DNSKEY/
 * RRSIG/NSEC/NSEC3, CNAME takeover detection, AXFR probing, recursive
 * resolver detection, DoH provider detection) run from
 * lib/scanner/async-checks.ts because they need to issue DNS queries
 * and follow CNAME chains. The JSON entries in checks-data/dns.json
 * document what those async probes check for; the inline detectors
 * below are placeholders so the registry's coverage test can map every
 * JSON id to a known name.
 *
 * NOTE: this module is NOT registered in registry.ts BUNDLES — DNS is
 * async-only. Do not import these placeholders from the synchronous
 * scan orchestrator.
 */

import type { EvidenceFn as DetectFn } from "../_helpers";

export const detectors: Record<string, DetectFn> = {
  "dns-resolves": () => null,
  "dns-caa-record-missing": () => null,
  "dns-ns-record-count": () => null,
  "dns-mx-record-missing": () => null,
  "dns-mx-backup-record": () => null,
  "dns-srv-records-missing": () => null,
  "dns-soa-refresh-high": () => null,
  "dns-tlsa-record-missing": () => null,
  "dns-open-dns-resolver": () => null,
  "dns-dangling-cname": () => null,
  "dns-zone-transfer-allowed": () => null,
  "dns-recursion-enabled": () => null,
  "dns-nxdomain-hijack-risk": () => null,
  "dns-naptr-record-present": () => null,
  "dns-loc-record-present": () => null,
  "dns-sshfp-record-missing": () => null,
  "dns-ds-record-missing": () => null,
  "dns-dnskey-record-missing": () => null,
  "dns-rrsig-record-missing": () => null,
  "dns-nsec-zone-walking": () => null,
  "dns-dangling-cname-cdn-paas": () => null,
  "dns-dangling-cname-saas": () => null,
  "dns-doh-provider-detected": () => null,
};