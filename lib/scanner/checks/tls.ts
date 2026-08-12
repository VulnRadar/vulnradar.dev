/**
 * TLS / deep certificate checks placeholder.
 *
 * All TLS checks run from lib/scanner/async-checks.ts (checkTLSCert and
 * related probes) because they need a raw TLS socket to inspect the
 * certificate chain, cipher suites, and protocol negotiation. The JSON
 * entries in checks-data/tls.json document what those async probes
 * check for; the inline detectors below are placeholders so the
 * registry's coverage test can map every JSON id to a known name.
 *
 * NOTE: this module is NOT registered in registry.ts BUNDLES — TLS is
 * async-only. Do not import these placeholders from the synchronous
 * scan orchestrator.
 */

import type { EvidenceFn as DetectFn } from "../_helpers";

export const detectors: Record<string, DetectFn> = {
  "tls-certificate-expiry": () => null,
  "tls-protocol-version": () => null,
  "tls-cert-key-size-rsa": () => null,
  "tls-cert-key-size-ecdsa": () => null,
  "tls-cert-self-signed": () => null,
  "tls-tls-1-3-not-supported": () => null,
  "tls-cert-san-missing": () => null,
  "tls-cert-expired-ca-chain": () => null,
};
