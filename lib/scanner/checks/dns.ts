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
  "dns-caa-no-issue-restriction": () => null,
  "dns-caa-wildcard-only-restriction": () => null,
  "dns-soa-serial-stale": () => null,
  "dns-ns-single-provider-concentration": () => null,
  "dns-wildcard-record-present": () => null,
  "dns-null-mx-recommended": () => null,
};

// ── Live async DNS probes ───────────────────────────────────────────────
//
// The `detectors` map above is dispatch-registry bookkeeping only (see the
// file header): every entry is a `() => null` stub because the registry's
// `EvidenceFn` signature is synchronous `(url, headers, body) => string |
// null` and can't perform a real `dns/promises` lookup, and `registry.ts`
// never calls into this module anyway (it hardcodes `detectors: {}` for
// the "dns" category bundle -- DNS is dispatched from
// lib/scanner/async-checks.ts's `runAsyncChecks`/`checkDNSSecurity`
// instead, the same way checkCAA/checkNSCount/checkDNSSEC already work).
//
// The three functions below are real, live probes for the three new
// checks this module's JSON gained (see checks-data/dns.json for their
// full write-ups: dns-ns-single-provider-concentration,
// dns-wildcard-record-present, dns-null-mx-recommended). They follow the
// exact same shape as async-checks.ts's exported `check*` functions
// (`(domain, url) => Promise<Vulnerability[]>`, timeout-raced DNS calls,
// ENODATA/ENOTFOUND/ENOENT treated as "genuinely absent" vs. any other
// error treated as transient and skipped rather than false-positived), and
// are dispatched from `checkDNSSecurity` in async-checks.ts alongside the
// existing DNS probes.
//
// CAA-missing and DNSSEC-not-configured are intentionally NOT duplicated
// here even though they were on the original ask: both already exist as
// live checks (checkCAA / checkDNSSEC in async-checks.ts, paired with the
// dns-caa-record-missing / dns-ds-record-missing / dns-dnskey-record-missing
// entries already above). A second, differently-scored version of the same
// real-world condition would just double-report it.

import * as dns from "dns/promises";
import { randomBytes } from "crypto";
import type { Vulnerability } from "../types";
import { generateId } from "../_helpers";
import { extractRootDomain } from "../root-domain";

function dnsErrorCode(err: unknown): string {
  return err && typeof err === "object" && "code" in err
    ? String((err as { code: unknown }).code)
    : "";
}

function withTimeout<T>(promise: Promise<T>, ms = 4000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("dns timeout")), ms),
    ),
  ]);
}

function makeDnsVuln(
  checkId: string,
  url: string,
  title: string,
  severity: Vulnerability["severity"],
  description: string,
  evidence: string,
  riskImpact: string,
  explanation: string,
  fixSteps: string[],
  codeExamples: { label: string; language: string; code: string }[] = [],
  confidence = 80,
): Vulnerability {
  return {
    id: generateId(checkId, url),
    title,
    severity,
    category: "dns",
    description,
    evidence,
    riskImpact,
    explanation,
    fixSteps,
    codeExamples,
    references: [],
    confidence,
    detectionMethod: "Async DNS probe",
  };
}

/**
 * RFC 7505 null MX: a single MX record whose exchange is the root name
 * ("."). Mirrors async-checks.ts's private `hasNullMX()` helper -- not
 * imported from there (that helper isn't exported, and this module
 * intentionally stays self-contained; see the section note above).
 */
async function isNullMx(domain: string): Promise<boolean> {
  try {
    const records = await withTimeout(dns.resolveMx(domain));
    return records.length === 1 && /^\.?$/.test(records[0].exchange.trim());
  } catch {
    return false;
  }
}

/**
 * Flags when every authoritative NS hostname for the domain shares the same
 * registrable domain (eTLD+1). Real-world AWS Route 53 delegations, for
 * example, deliberately spread across awsdns-*.com/.net/.org/.co.uk
 * (different eTLD+1s each), so this does NOT fire on that common,
 * genuinely-diversified pattern; four nameservers that all end in
 * ns.example-dns.com (same eTLD+1) does fire. This is a simple, honestly
 * scoped heuristic, not a definitive infrastructure map: it flags
 * shared-domain concentration only, not shared-provider risk in general,
 * since a large distributed provider can still offer real redundancy
 * behind one brand's domain.
 */
export async function checkNsProviderConcentration(
  domain: string,
  url: string,
): Promise<Vulnerability[]> {
  let records: string[];
  try {
    records = await withTimeout(dns.resolveNs(domain));
  } catch {
    return []; // DNS failure, or genuinely no NS -- dns-ns-record-count's job
  }
  if (records.length < 2) return []; // single-NS is dns-ns-record-count's job

  const providerDomains = new Set(records.map((ns) => extractRootDomain(ns)));
  if (providerDomains.size > 1) return [];

  const [provider] = providerDomains;
  return [
    makeDnsVuln(
      "dns-ns-single-provider-concentration",
      url,
      "All Nameservers Concentrated at a Single Provider",
      "info",
      `All ${records.length} authoritative nameservers for ${domain} share the same registrable domain (${provider}), so they all depend on one DNS provider's infrastructure.`,
      `NS records for ${domain}: ${records.join(", ")}, all resolving under ${provider}.`,
      "An outage, misconfiguration, or targeted attack against that single provider takes every nameserver for this domain offline at once: the same single point of failure the 'at least two NS records' rule exists to prevent, just one layer up the stack.",
      "This is a simple heuristic, same eTLD+1 across every NS hostname, not a definitive infrastructure map. A large, geographically distributed provider can still offer real redundancy behind one domain; this only flags that every NS shares the same registrable domain.",
      [
        "Add at least one nameserver from a second, independent DNS provider (a different eTLD+1) alongside the existing ones.",
        "If relying on one large, distributed provider intentionally, confirm their SLA covers your redundancy requirements; this finding does not necessarily mean action is needed.",
        `Verify with: dig +short NS ${domain}`,
      ],
      [
        {
          label: "Check NS records",
          language: "bash",
          code: `dig +short NS ${domain}`,
        },
      ],
      70,
    ),
  ];
}

/**
 * Queries a random, near-certainly-nonexistent subdomain (16 hex chars).
 * If it resolves anyway, the domain has a wildcard DNS record answering
 * for any subdomain, whether or not that subdomain was ever intentionally
 * created.
 */
export async function checkWildcardDns(
  domain: string,
  url: string,
): Promise<Vulnerability[]> {
  const probe = `${randomBytes(8).toString("hex")}.${domain}`;
  let recordType: "A" | "AAAA" | null = null;

  try {
    const addrs = await withTimeout(dns.resolve4(probe));
    if (addrs.length > 0) recordType = "A";
  } catch (err: unknown) {
    const code = dnsErrorCode(err);
    if (code !== "ENODATA" && code !== "ENOTFOUND" && code !== "ENOENT") {
      return []; // timeout or transient network error -- don't false-positive
    }
  }

  if (!recordType) {
    try {
      const addrs6 = await withTimeout(dns.resolve6(probe));
      if (addrs6.length > 0) recordType = "AAAA";
    } catch (err: unknown) {
      const code = dnsErrorCode(err);
      if (code !== "ENODATA" && code !== "ENOTFOUND" && code !== "ENOENT") {
        return [];
      }
    }
  }

  if (!recordType) return []; // random name genuinely doesn't resolve -- no wildcard

  return [
    makeDnsVuln(
      "dns-wildcard-record-present",
      url,
      "Wildcard DNS Record Detected",
      "low",
      `A randomly generated subdomain (${probe}) resolved successfully via ${recordType} record, meaning ${domain} has a wildcard DNS record that answers for any subdomain.`,
      `Queried ${probe}, a name never created, and it resolved (${recordType}), indicating a wildcard (*.${domain}) DNS record is in effect.`,
      "Every possible subdomain resolves, whether or not it was intentionally created. Phishing pages hosted at unexpected subdomains inherit this domain's trust and any wildcard TLS certificate, and if the wildcard target is a shared or reassignable resource, it also widens the subdomain-takeover surface: an attacker no longer needs to find an existing dangling record, any name they pick already resolves.",
      "Wildcards are sometimes intentional (multi-tenant platforms, preview-branch hosting), so this is a prompt to confirm the wildcard is deliberate and scoped correctly, not proof of a misconfiguration on its own.",
      [
        "Confirm the wildcard is intentional; if not, remove the * record and add explicit records only for subdomains actually in use.",
        "If intentional, make sure its target cannot be hijacked and that any wildcard TLS certificate is scoped and monitored like the rest of the domain's certificates.",
        `Verify with: dig +short A random-string.${domain}`,
      ],
      [
        {
          label: "Verify wildcard",
          language: "bash",
          code: `dig +short A $(openssl rand -hex 8).${domain}\n# A non-empty answer for a name you never created confirms a wildcard record`,
        },
      ],
      85,
    ),
  ];
}

/**
 * RFC 7505: a domain with no MX and no SPF looks like it never sends or
 * receives mail, but absence alone is ambiguous, it could just as easily
 * be an oversight. Recommends publishing an explicit null MX rather than
 * leaving mail intent unstated. Skipped when the domain already has a
 * null MX (isNullMx) or has any real MX record at all: that gap is
 * async-checks.ts's checkMX "MX Record Missing" job, which only fires
 * when SPF exists, the complementary case to this check.
 */
export async function checkNullMxRecommended(
  domain: string,
  url: string,
): Promise<Vulnerability[]> {
  if (await isNullMx(domain)) return []; // already doing the right thing

  try {
    const records = await withTimeout(dns.resolveMx(domain));
    if (records.length > 0) return []; // has real MX -- not this check's job
  } catch (err: unknown) {
    const code = dnsErrorCode(err);
    if (code !== "ENODATA" && code !== "ENOTFOUND" && code !== "ENOENT") {
      return []; // transient DNS error -- don't false-positive
    }
  }

  try {
    const txt = await withTimeout(dns.resolveTxt(domain));
    const hasSpf = txt
      .map((r) => r.join(""))
      .some((r) => r.startsWith("v=spf1"));
    if (hasSpf) return []; // domain does send mail -- checkMX's job, not this one
  } catch {
    /* no TXT records at all -- fine, proceed */
  }

  return [
    makeDnsVuln(
      "dns-null-mx-recommended",
      url,
      "Null MX Recommended for Non-Mail Domain",
      "info",
      `${domain} has no MX record and no SPF record, consistent with a domain that does not send or receive email. RFC 7505 defines a null MX as the explicit way to declare that in DNS instead of leaving it unstated.`,
      `No MX record and no v=spf1 TXT record found for ${domain}.`,
      "This is a hygiene recommendation, not a vulnerability. Leaving mail intent unstated is ambiguous to some receiving and anti-spoofing systems, while a null MX confirms the domain was never meant to send or receive mail.",
      "RFC 7505 defines a single MX record with exchange '.' as the standard way to declare a domain accepts no mail. Pairing it with a hard-fail SPF record documents both directions of that intent.",
      [
        `Add a null MX record: ${domain}. IN MX 0 .`,
        "Pair it with a hard-fail SPF record: v=spf1 -all",
        "Skip this if the domain does send or receive mail through infrastructure this scan couldn't see, e.g. mail routed only through a parent or organizational domain.",
      ],
      [
        {
          label: "DNS zone file",
          language: "dns",
          code: `${domain}. IN MX 0 .\n${domain}. IN TXT "v=spf1 -all"`,
        },
      ],
      65,
    ),
  ];
}
