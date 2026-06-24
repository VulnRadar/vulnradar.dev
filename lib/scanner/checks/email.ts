/**
 * Email-authentication checks placeholder.
 *
 * All email checks (SPF, DMARC, DKIM, DNSSEC, MTA-STS, TLSRPT, BIMI,
 * ARC, MX hygiene, SMTP capability probing) run from
 * lib/scanner/async-checks.ts because they require DNS queries, HTTPS
 * GETs for .well-known policy files, and live SMTP probes. The JSON
 * entries in checks-data/email.json document what those async probes
 * check for; the inline detectors below are placeholders so the
 * registry's coverage test can map every JSON id to a known name.
 *
 * NOTE: this module is NOT registered in registry.ts BUNDLES — email
 * is async-only. Do not import these placeholders from the
 * synchronous scan orchestrator.
 */

import type { EvidenceFn as DetectFn } from "../_helpers";

export const detectors: Record<string, DetectFn> = {
  "spf-record": () => null,
  "dmarc-record": () => null,
  "dkim-record": () => null,
  "dnssec-enabled": () => null,
  "mta-sts": () => null,
  "tls-rpt": () => null,
  "email-spf-lookup-count-too-high": () => null,
  "email-spf-redirect-loop": () => null,
  "email-spf-ptr-mechanism": () => null,
  "email-dmarc-rua-missing": () => null,
  "email-dmarc-ruf-missing": () => null,
  "email-dmarc-pct-not-100": () => null,
  "email-dkim-sig-tag-missing": () => null,
  "email-bimi-record-missing": () => null,
  "email-mta-sts-policy-missing": () => null,
  "email-tls-rpt-rua-missing": () => null,
  "email-smtp-open-relay": () => null,
  "email-smtp-banner-disclosure": () => null,
  "email-arc-record-missing": () => null,
  "email-mta-sts-mode-none": () => null,
  "email-mta-sts-id-not-rotated": () => null,
  "email-bimi-without-vmc": () => null,
  "email-bimi-evidence-without-hash": () => null,
  "email-mx-hostname-cname": () => null,
  "email-mx-no-aaaa-backup": () => null,
  "email-spf-include-no-prefix": () => null,
  "email-smtp-plain-login-auth": () => null,
  "email-smtp-no-starttls": () => null,
};