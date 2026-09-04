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
  "dns-dnssec-algorithm-weak": () => null,
  "dns-dnssec-key-size-weak": () => null,
  "dns-ds-digest-algorithm-weak": () => null,
  "dns-nsec3-iterations-nonzero": () => null,
  "dns-cname-chain-too-long": () => null,
  "dns-cname-at-apex": () => null,
  "dns-caa-iodef-missing": () => null,
  "dns-txt-verification-tokens-stale": () => null,
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
// The functions below are real, live probes for the checks this module's
// JSON gained (see checks-data/dns.json for their full write-ups). The
// first three read records dns/promises exposes directly
// (dns-ns-single-provider-concentration, dns-wildcard-record-present,
// dns-null-mx-recommended); the group after them needs record CONTENT for
// types Node's resolver has no method for, so they go over DNS-over-HTTPS
// (DNSSEC algorithm and key size, DS digest type, NSEC/NSEC3 parameters)
// or walk a chain (CNAME depth and apex). They follow the
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

import { randomBytes } from "crypto";
import type { Vulnerability } from "../types";
import { generateId } from "../_helpers";
import { extractRootDomain } from "../root-domain";
// Shared per-scan DNS memo: checkDNSSecurity resolves several of these exact
// records too, so routing through it collapses the duplicates when this
// module runs inside a scan. ref: AUDIT-012#perf-09
import {
  resolveTxtOnce,
  resolveMxOnce,
  resolveNsOnce,
  resolve4Once,
  resolve6Once,
  resolveCnameOnce,
  resolveCaaOnce,
} from "../dns-memo";

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
    const records = await withTimeout(resolveMxOnce(domain));
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
    records = await withTimeout(resolveNsOnce(domain));
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
    const addrs = await withTimeout(resolve4Once(probe));
    if (addrs.length > 0) recordType = "A";
  } catch (err: unknown) {
    const code = dnsErrorCode(err);
    if (code !== "ENODATA" && code !== "ENOTFOUND" && code !== "ENOENT") {
      return []; // timeout or transient network error -- don't false-positive
    }
  }

  if (!recordType) {
    try {
      const addrs6 = await withTimeout(resolve6Once(probe));
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
    const records = await withTimeout(resolveMxOnce(domain));
    if (records.length > 0) return []; // has real MX -- not this check's job
  } catch (err: unknown) {
    const code = dnsErrorCode(err);
    if (code !== "ENODATA" && code !== "ENOTFOUND" && code !== "ENOENT") {
      return []; // transient DNS error -- don't false-positive
    }
  }

  try {
    const txt = await withTimeout(resolveTxtOnce(domain));
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

// ── DNSSEC parameter and zone-hygiene probes ────────────────────────────
//
// The DNSSEC checks below need record CONTENT, not just presence, so they
// cannot go through dns/promises: Node's resolver exposes no DNSKEY, DS or
// NSEC3PARAM type. They use DNS-over-HTTPS against the same two public
// resolvers async-checks.ts's checkDNSSEC/checkDSRecord already use, with
// the same rule: if both resolvers fail, report nothing rather than
// treating a network problem as a missing record.

interface DohAnswer {
  name: string;
  type: number;
  data: string;
}

/**
 * The Answer section for `name`/`type` from whichever of Google or
 * Cloudflare replies first with a usable JSON body. Returns null when both
 * fail, which callers must treat as "unknown", never as "absent".
 */
async function dohAnswers(
  name: string,
  type: string,
): Promise<DohAnswer[] | null> {
  const [g, c] = await Promise.allSettled([
    fetch(
      `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
      { signal: AbortSignal.timeout(4000) },
    ).then((r) => r.json()),
    fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
      {
        signal: AbortSignal.timeout(4000),
        headers: { Accept: "application/dns-json" },
      },
    ).then((r) => r.json()),
  ]);
  const answersOf = (value: unknown): DohAnswer[] | null => {
    const answer = (value as { Answer?: unknown })?.Answer;
    if (!Array.isArray(answer)) return null;
    return answer.filter(
      (a): a is DohAnswer => !!a && typeof (a as DohAnswer).data === "string",
    );
  };
  if (g.status === "fulfilled") {
    const a = answersOf(g.value);
    if (a) return a;
  }
  if (c.status === "fulfilled") {
    const a = answersOf(c.value);
    if (a) return a;
  }
  // A resolver that answered with no Answer section is a real "no records"
  // result; only treat it as unknown when neither resolver answered at all.
  if (g.status === "fulfilled" || c.status === "fulfilled") return [];
  return null;
}

/** DNSSEC algorithm numbers that are no longer considered safe to sign with. */
const WEAK_DNSSEC_ALGORITHMS: Record<number, string> = {
  1: "RSAMD5",
  3: "DSA/SHA-1",
  5: "RSA/SHA-1",
  6: "DSA-NSEC3-SHA1",
  7: "RSASHA1-NSEC3-SHA1",
  12: "ECC-GOST",
};

/** Algorithm numbers whose DNSKEY public key is an RFC 3110 RSA blob. */
const RSA_DNSSEC_ALGORITHMS = new Set([1, 5, 7, 8, 10]);

interface ParsedDnskey {
  flags: number;
  algorithm: number;
  key: string;
}

function parseDnskey(data: string): ParsedDnskey | null {
  const parts = data.trim().split(/\s+/);
  if (parts.length < 4) return null;
  const flags = Number(parts[0]);
  const algorithm = Number(parts[2]);
  if (!Number.isFinite(flags) || !Number.isFinite(algorithm)) return null;
  return { flags, algorithm, key: parts.slice(3).join("") };
}

/**
 * The RSA modulus size in bits of an RFC 3110 DNSKEY public key: a one- or
 * three-byte exponent-length prefix, the exponent, then the modulus.
 */
function rsaModulusBits(base64Key: string): number | null {
  let buf: Buffer;
  try {
    buf = Buffer.from(base64Key, "base64");
  } catch {
    return null;
  }
  if (buf.length < 3) return null;
  let offset: number;
  let expLen: number;
  if (buf[0] === 0) {
    expLen = (buf[1] << 8) | buf[2];
    offset = 3;
  } else {
    expLen = buf[0];
    offset = 1;
  }
  const modulusBytes = buf.length - offset - expLen;
  if (modulusBytes <= 0) return null;
  return modulusBytes * 8;
}

/**
 * Flags a signed zone whose DNSKEY set uses an algorithm with a broken or
 * deprecated hash, or an RSA key below the 2048-bit floor. Only fires when
 * DNSKEY records actually exist, so an unsigned zone (already reported by
 * checkDNSSEC) is never double-reported.
 */
export async function checkDnssecAlgorithmStrength(
  domain: string,
  url: string,
): Promise<Vulnerability[]> {
  const answers = await dohAnswers(domain, "DNSKEY");
  if (!answers || answers.length === 0) return [];
  const keys = answers
    .map((a) => parseDnskey(a.data))
    .filter((k): k is ParsedDnskey => k !== null);
  if (keys.length === 0) return [];

  const findings: Vulnerability[] = [];
  const weak = keys.find((k) => WEAK_DNSSEC_ALGORITHMS[k.algorithm]);
  if (weak) {
    const name = WEAK_DNSSEC_ALGORITHMS[weak.algorithm];
    findings.push(
      makeDnsVuln(
        "dns-dnssec-algorithm-weak",
        url,
        "DNSSEC Signed With a Deprecated Algorithm",
        "medium",
        `${domain} is DNSSEC-signed, but a DNSKEY in the zone uses algorithm ${weak.algorithm} (${name}), which is deprecated for DNSSEC signing.`,
        `DNSKEY for ${domain}: flags ${weak.flags}, algorithm ${weak.algorithm} (${name}).`,
        "DNSSEC is only as strong as the algorithm behind the signature. SHA-1 and MD5 have practical collision attacks, and validating resolvers are progressively removing support for these algorithms outright: a zone signed only with a removed algorithm is treated as unsigned, which silently discards the protection the zone was configured for.",
        "RFC 8624 marks RSAMD5 as must-not-implement and the SHA-1 based algorithms as not-recommended for signing. The current recommendation is ECDSAP256SHA256 (algorithm 13), which is also far smaller on the wire than RSA, or RSASHA256 (algorithm 8) where the resolver population still needs it. An algorithm rollover has an order to it: publish the new DNSKEY, re-sign, then update the DS record at the registrar.",
        [
          "Roll the zone to algorithm 13 (ECDSAP256SHA256), or 8 (RSASHA256) if ECDSA support is a concern.",
          "Publish the new DNSKEY and re-sign before withdrawing the old key, then update the DS record at the registrar.",
          `Verify with: dig +short DNSKEY ${domain}`,
        ],
        [
          {
            label: "Inspect the zone's keys",
            language: "bash",
            code: `dig +dnssec +multi DNSKEY ${domain} @1.1.1.1`,
          },
        ],
        80,
      ),
    );
  }

  const weakRsa = keys.find((k) => {
    if (!RSA_DNSSEC_ALGORITHMS.has(k.algorithm)) return false;
    const bits = rsaModulusBits(k.key);
    return bits !== null && bits < 2048;
  });
  if (weakRsa) {
    const bits = rsaModulusBits(weakRsa.key);
    const role =
      (weakRsa.flags & 1) === 1 ? "key-signing key" : "zone-signing key";
    findings.push(
      makeDnsVuln(
        "dns-dnssec-key-size-weak",
        url,
        "DNSSEC RSA Key Below 2048 Bits",
        "medium",
        `${domain} publishes an RSA ${role} with a ${bits}-bit modulus, below the 2048-bit minimum RFC 8624 sets for DNSSEC signing keys.`,
        `DNSKEY for ${domain}: flags ${weakRsa.flags}, algorithm ${weakRsa.algorithm}, ${bits}-bit RSA modulus.`,
        "An undersized signing key is the weakest link in the chain of trust no matter how strong the hash is. Forging a signature over any record in the zone lets an attacker who can reach a validating resolver answer with data of their choosing, which is precisely the substitution DNSSEC exists to prevent.",
        "RFC 8624 sets 2048 bits as the floor for RSA DNSSEC keys. A 1024-bit key-signing key is the more serious case, since it is the key the DS record commits to and it usually has a much longer lifetime than a zone-signing key. Rolling to ECDSAP256SHA256 fixes the size problem and shrinks responses at the same time, which matters for a protocol that still has to fit in UDP where it can.",
        [
          "Roll the affected key to at least 2048-bit RSA, or move the zone to ECDSAP256SHA256.",
          "If the key-signing key is the one affected, plan the rollover with the registrar so the DS record is updated in step.",
          `Verify with: dig +short DNSKEY ${domain}`,
        ],
        [
          {
            label: "Inspect key sizes",
            language: "bash",
            code: `dig +multi DNSKEY ${domain} @1.1.1.1`,
          },
        ],
        80,
      ),
    );
  }

  return findings;
}

/** Flags a DS record set published with only the SHA-1 digest type. */
export async function checkDsDigestAlgorithm(
  domain: string,
  url: string,
): Promise<Vulnerability[]> {
  const answers = await dohAnswers(domain, "DS");
  if (!answers || answers.length === 0) return [];
  const digestTypes = new Set<number>();
  for (const a of answers) {
    const parts = a.data.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const digestType = Number(parts[2]);
    if (Number.isFinite(digestType)) digestTypes.add(digestType);
  }
  if (digestTypes.size === 0) return [];
  // A zone publishing both SHA-1 and SHA-256 is mid-rollover and validators
  // use the stronger one, so only a SHA-1-only set is a finding.
  const strongDigest = [...digestTypes].some((d) => d === 2 || d === 4);
  if (!digestTypes.has(1) || strongDigest) return [];

  return [
    makeDnsVuln(
      "dns-ds-digest-algorithm-weak",
      url,
      "DNSSEC DS Record Uses Only the SHA-1 Digest",
      "low",
      `The DS record for ${domain} in the parent zone uses digest type 1 (SHA-1) with no SHA-256 alternative published alongside it.`,
      `DS record for ${domain} publishes digest type(s): ${[...digestTypes].join(", ")}.`,
      "The DS digest is the single link between the parent zone and this zone's key. Validators that stop accepting SHA-1 digests, which is the direction every implementation is moving, will treat the delegation as unsigned, silently dropping DNSSEC protection for the whole zone.",
      "RFC 8624 marks SHA-1 as not-recommended for DS records and SHA-256 (digest type 2) as mandatory to implement. Publishing both during a transition is fine and is deliberately not reported here; publishing only SHA-1 is. The change is made at the registrar, since the DS record lives in the parent zone rather than in yours.",
      [
        "Generate a SHA-256 DS record from the current key-signing key and submit it to the registrar.",
        "Publish both digests during the transition, then remove the SHA-1 one once the new record has propagated.",
        `Verify with: dig +short DS ${domain}`,
      ],
      [
        {
          label: "Generate a SHA-256 DS record",
          language: "bash",
          code: `dig DNSKEY ${domain} | dnssec-dsfromkey -f - -2 ${domain}`,
        },
      ],
      75,
    ),
  ];
}

/**
 * Authenticated denial of existence. A signed zone using NSEC1 lets anyone
 * enumerate every name in it; an NSEC3 zone with a non-zero iteration count
 * pays a cost RFC 9276 says buys nothing.
 */
export async function checkNsecParameters(
  domain: string,
  url: string,
): Promise<Vulnerability[]> {
  const dnskeys = await dohAnswers(domain, "DNSKEY");
  // Unsigned, or the lookup failed: neither finding applies, and "DNSSEC
  // not enabled" is checkDNSSEC's job.
  if (!dnskeys || dnskeys.length === 0) return [];

  const nsec3param = await dohAnswers(domain, "NSEC3PARAM");
  if (nsec3param === null) return [];

  if (nsec3param.length === 0) {
    return [
      makeDnsVuln(
        "dns-nsec-zone-walking",
        url,
        "Signed Zone Uses NSEC, Allowing Zone Walking",
        "low",
        `${domain} is DNSSEC-signed but publishes no NSEC3PARAM record, so the zone uses NSEC for authenticated denial of existence.`,
        `DNSKEY records exist for ${domain} and no NSEC3PARAM record is published.`,
        "An NSEC record proves a name does not exist by naming the next name that does, so walking the chain returns the complete contents of the zone. Every internal hostname in it becomes public: vpn, jira, staging, backup, the lot. That is a full target list produced without sending a single request to any of those hosts.",
        "This is a design property of NSEC rather than a misconfiguration, which is why NSEC3 exists. Whether it matters depends on the zone: for one whose names are all public anyway it is close to irrelevant, and for one holding internal infrastructure names it hands over the network map. RFC 9276 recommends NSEC3 with zero iterations and no salt, which gives the enumeration resistance without the cost that made early NSEC3 deployments expensive.",
        [
          "Switch the zone to NSEC3 with zero iterations and an empty salt (RFC 9276) if it contains names you would rather not publish.",
          "Confirm whether zone enumeration actually matters here before treating it as urgent; for a zone of entirely public names, NSEC is a reasonable choice.",
          `Verify with: dig +short NSEC3PARAM ${domain}`,
        ],
        [
          {
            label: "Walk the zone to see what is exposed",
            language: "bash",
            code: `ldns-walk ${domain}`,
          },
        ],
        70,
      ),
    ];
  }

  const iterations = (() => {
    const parts = nsec3param[0].data.trim().split(/\s+/);
    const value = Number(parts[2]);
    return Number.isFinite(value) ? value : null;
  })();
  if (iterations === null || iterations === 0) return [];

  return [
    makeDnsVuln(
      "dns-nsec3-iterations-nonzero",
      url,
      "NSEC3 Configured With Extra Hash Iterations",
      "info",
      `${domain} publishes an NSEC3PARAM record with ${iterations} extra hash iterations. RFC 9276 says the only value that should be used is zero.`,
      `NSEC3PARAM for ${domain}: ${nsec3param[0].data}`,
      "Every extra iteration costs the authoritative server and every validating resolver an additional hash computation on each negative answer, and buys no meaningful additional protection against enumeration. That makes the parameter a denial-of-service amplifier aimed at your own nameservers: an attacker querying random non-existent names forces the extra work on every request.",
      "The original NSEC3 specification allowed iterations as a defence against dictionary attacks on the hashed names, but the protection turned out to be negligible because the name space being hashed is small and guessable regardless. RFC 9276 is unambiguous: zero iterations, empty salt. Several large resolvers now cap or ignore high iteration counts, and some treat zones above a threshold as insecure.",
      [
        "Set the NSEC3 iteration count to 0 and use an empty salt, then re-sign the zone.",
        "Most managed DNS providers expose this as a single setting; on BIND it is the iterations argument to the NSEC3 parameters.",
        `Verify with: dig +short NSEC3PARAM ${domain}`,
      ],
      [
        {
          label: "BIND: zero iterations, no salt",
          language: "bash",
          code: `rndc signing -nsec3param 1 0 0 - ${domain}`,
        },
      ],
      75,
    ),
  ];
}

/**
 * CNAME chain depth and an apex CNAME. Both read the same iterative walk,
 * so they share one probe. Every hop is a separate resolution a client has
 * to make before it reaches an address.
 */
export async function checkCnameChain(
  domain: string,
  url: string,
): Promise<Vulnerability[]> {
  const findings: Vulnerability[] = [];
  const apex = extractRootDomain(domain);

  // RFC 1034: a CNAME may not coexist with any other record at a name, and
  // the apex always carries SOA and NS, so a CNAME there is a violation.
  if (apex && apex === domain) {
    try {
      const apexCname = await withTimeout(resolveCnameOnce(apex));
      if (apexCname.length > 0) {
        findings.push(
          makeDnsVuln(
            "dns-cname-at-apex",
            url,
            "CNAME Record Published at the Zone Apex",
            "medium",
            `${apex} answers a CNAME query with ${apexCname[0]}, but the zone apex always carries SOA and NS records, which RFC 1034 forbids a CNAME from coexisting with.`,
            `CNAME at ${apex}: ${apexCname.join(", ")}`,
            "Resolvers handle this inconsistently. Some follow the CNAME and never see the zone's MX record, which silently breaks inbound mail for the domain; others return the SOA and NS and ignore the CNAME, so the site does not resolve. Because the outcome depends on the resolver, the failure is intermittent and looks different to different users, which makes it very hard to diagnose from your side.",
            "This is what ALIAS, ANAME and CNAME-flattening record types exist to solve: the provider resolves the target itself and answers with A and AAAA records at the apex, so what goes on the wire stays legal. A literal CNAME at the apex means either the provider has no such type or the record was created through an API path that skipped the check.",
            [
              "Replace the apex CNAME with the provider's ALIAS, ANAME, or CNAME-flattening record type.",
              "If the provider has no such type, publish A and AAAA records at the apex and keep the CNAME on www.",
              `Verify with: dig ${apex} MX +short (an empty result on a mail-carrying domain confirms the breakage)`,
            ],
            [
              {
                label: "Check what the apex actually answers",
                language: "bash",
                code: `dig ${apex} ANY +noall +answer\ndig ${apex} MX +short`,
              },
            ],
            80,
          ),
        );
      }
    } catch {
      /* no CNAME at the apex, which is the normal case */
    }
  }

  // Chain depth: each hop is another round trip before the client has an
  // address, and another name whose ownership has to stay correct.
  //
  // The walk is necessarily sequential (each hop's target comes from the
  // previous answer), so its cost is per-hop timeout times hop count. A
  // whole-walk deadline bounds that at roughly one lookup's worth rather
  // than six, which keeps a slow chain from eating the async branch's
  // budget. Stopping early only loses depth we would have reported; it
  // never invents one.
  const chain: string[] = [];
  const walkDeadline = Date.now() + 6000;
  let current = domain;
  for (let hop = 0; hop < 6; hop++) {
    const remaining = walkDeadline - Date.now();
    if (remaining <= 0) break;
    let next: string[];
    try {
      next = await withTimeout(
        resolveCnameOnce(current),
        Math.min(4000, remaining),
      );
    } catch {
      break;
    }
    if (next.length === 0) break;
    const target = next[0];
    if (chain.includes(target)) break; // loop guard
    chain.push(target);
    current = target;
  }

  if (chain.length > 3) {
    findings.push(
      makeDnsVuln(
        "dns-cname-chain-too-long",
        url,
        "CNAME Chain Longer Than Three Hops",
        "low",
        `Resolving ${domain} follows ${chain.length} CNAME hops before reaching an address record.`,
        `CNAME chain from ${domain}: ${[domain, ...chain].join(" -> ")}`,
        "Every hop is another name whose registration, zone and provider account have to stay under someone's control. A single link that expires, gets deleted, or points at a decommissioned service is a subdomain-takeover opportunity, and the deeper the chain the more likely one link belongs to a team that has forgotten it exists. Each hop also adds a resolution round trip to every cold lookup.",
        "Long chains grow through migrations: a vendor is replaced with another vendor, and rather than repointing the original record, a new CNAME is appended. Some resolvers cap chain following, commonly at eight or sixteen, and return a failure past the limit, so a chain that works today can break when one more hop is added.",
        [
          "Collapse the chain by pointing the first record directly at the final target.",
          "Check ownership of every intermediate name; any that no longer resolves or points at an unclaimed service is a takeover risk.",
          `Verify with: dig +trace ${domain}`,
        ],
        [
          {
            label: "Follow the chain",
            language: "bash",
            code: `dig ${domain} +noall +answer`,
          },
        ],
        75,
      ),
    );
  }

  return findings;
}

/** CAA is published but names no incident-reporting address. */
export async function checkCaaIodef(
  domain: string,
  url: string,
): Promise<Vulnerability[]> {
  let records: { critical: number; issue?: string; iodef?: string }[];
  try {
    records = (await withTimeout(resolveCaaOnce(domain))) as typeof records;
  } catch {
    return []; // no CAA at all is checkCAA's finding, not this one
  }
  if (records.length === 0) return [];
  if (records.some((r) => typeof r.iodef === "string" && r.iodef.length > 0)) {
    return [];
  }
  const issuers = records
    .map((r) => r.issue)
    .filter((v): v is string => typeof v === "string");

  return [
    makeDnsVuln(
      "dns-caa-iodef-missing",
      url,
      "CAA Record Names No Incident Reporting Address",
      "info",
      `${domain} publishes CAA records restricting issuance${issuers.length > 0 ? ` to ${issuers.join(", ")}` : ""}, but no iodef property, so a CA that receives a request violating the policy has nowhere to report it.`,
      `CAA records for ${domain} contain no iodef property.`,
      "The iodef property is the only channel that turns a blocked issuance into a signal you actually receive. Without it, someone attempting to obtain a certificate for your domain from a CA you have not authorised is quietly refused and you never learn the attempt happened, which is exactly the early warning worth having.",
      "This is a hygiene recommendation rather than a weakness: the issuance restriction itself is working. RFC 8659 defines iodef as a mailto or https URL a CA may use to report policy violations. Reporting is discretionary rather than mandatory, so treat it as one useful input, not a guaranteed alert.",
      [
        `Add a CAA iodef record: ${domain}. IN CAA 0 iodef "mailto:security@${domain}"`,
        "Point it at a monitored mailbox or ticket queue rather than an individual.",
        `Verify with: dig +short CAA ${domain}`,
      ],
      [
        {
          label: "CAA with issuance restriction and reporting",
          language: "dns",
          code: `${domain}. IN CAA 0 issue "letsencrypt.org"\n${domain}. IN CAA 0 issuewild ";"\n${domain}. IN CAA 0 iodef "mailto:security@${domain}"`,
        },
      ],
      70,
    ),
  ];
}

/** Accumulated SaaS domain-verification TXT records. */
export async function checkVerificationTokenSprawl(
  domain: string,
  url: string,
): Promise<Vulnerability[]> {
  let records: string[][];
  try {
    records = await withTimeout(resolveTxtOnce(domain));
  } catch {
    return [];
  }
  const flat = records.map((r) => r.join(""));
  const vendors = new Set<string>();
  for (const record of flat) {
    const trimmed = record.trim();
    const m =
      /^([\w.-]{2,60})[-_](?:site|domain|domain-ownership|ownership)?[-_]?verification[=\s]/i.exec(
        trimmed,
      ) ??
      /^([\w.-]{2,60})[-_](?:verify|challenge|validation)[=\s-]/i.exec(trimmed);
    if (m) vendors.add(m[1].toLowerCase());
  }
  if (vendors.size < 5) return [];

  const sample = [...vendors].slice(0, 8).join(", ");
  return [
    makeDnsVuln(
      "dns-txt-verification-tokens-stale",
      url,
      "Accumulated SaaS Domain-Verification TXT Records",
      "info",
      `${domain} publishes ${vendors.size} distinct SaaS domain-verification TXT records (${sample}${vendors.size > 8 ? ", ..." : ""}).`,
      `TXT records at ${domain} carry verification tokens for ${vendors.size} distinct vendors.`,
      "The set is a public list of the SaaS platforms this organisation has onboarded, which is directly useful for a targeted phishing campaign: a message naming the exact tools someone actually uses is far more convincing than a generic one. Tokens for services that were trialled and abandoned are worse than useless, because they can leave a dormant claim on the domain inside a vendor account nobody monitors any more.",
      "Verification records are meant to be temporary for many vendors and permanent for a few, and nothing ever prompts you to remove the temporary ones, so they accumulate. This is informational: their presence is not a vulnerability. It is a prompt to audit which of these services are still in use and to close the accounts behind the ones that are not.",
      [
        "List the verification records and match each one to a service that is still in use.",
        "Remove tokens for services that were trialled or retired, and close the corresponding vendor accounts.",
        `Verify with: dig +short TXT ${domain}`,
      ],
      [
        {
          label: "List the verification records",
          language: "bash",
          code: `dig +short TXT ${domain} | grep -i -E 'verification|verify|challenge'`,
        },
      ],
      70,
    ),
  ];
}
