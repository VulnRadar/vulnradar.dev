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
  "email-spf-plus-all": () => null,
  "email-dmarc-rua-missing": () => null,
  "email-dmarc-ruf-missing": () => null,
  "email-dmarc-pct-not-100": () => null,
  "email-dmarc-p-none": () => null,
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
  "email-smtp-plain-login-auth": () => null,
  "email-smtp-no-starttls": () => null,
  "email-bimi-logo-invalid": () => null,
  "email-dmarc-subdomain-policy-weaker": () => null,
  "email-dkim-weak-key": () => null,
  "email-spf-multiple-records": () => null,
  "email-spf-all-mechanism-missing": () => null,
  "email-spf-redirect-ignored-with-all": () => null,
  "email-spf-macro-mechanism": () => null,
  "email-spf-include-unresolvable": () => null,
  "email-dmarc-multiple-records": () => null,
  "email-dmarc-rua-invalid-uri": () => null,
  "email-dmarc-rua-external-unauthorized": () => null,
  "email-dkim-testing-mode": () => null,
  "email-dkim-revoked-key": () => null,
  "email-dkim-sha1-hash": () => null,
  "email-mx-ip-literal": () => null,
  "email-mta-sts-max-age-short": () => null,
  "email-mta-sts-mx-mismatch": () => null,
};

// ── Live email-authentication probes ────────────────────────────────────
//
// The `detectors` map above is dispatch bookkeeping only (see the file
// header). The functions below are the real probes for the checks this
// module's JSON gained. They follow the same conventions as
// async-checks.ts's exported `check*` functions: `(domain, url) =>
// Promise<Vulnerability[]>`, every DNS call raced against a deadline, and
// a lookup failure treated as "unknown" rather than as "absent", so a slow
// resolver never turns into a false positive.
//
// Every DNS lookup goes through lib/scanner/dns-memo, so when these run
// inside a scan alongside checkSPF / checkDMARC / checkDKIM they reuse the
// answers those probes already fetched instead of re-querying.

import type { Vulnerability, Severity } from "../types";
import { generateId } from "../_helpers";
import { resolveTxtOnce, resolveMxOnce } from "../dns-memo";
import { safeFetch } from "../safe-fetch";

const DNS_TIMEOUT_MS = 4000;

function withTimeout<T>(promise: Promise<T>, ms = DNS_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("dns timeout")), ms),
    ),
  ]);
}

function makeEmailVuln(
  checkId: string,
  url: string,
  title: string,
  severity: Severity,
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
    category: "email",
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
 * Flattened TXT records at `name`.
 *
 * An empty array means the resolver answered and there are no TXT records;
 * null means the query never completed. Keeping those apart is the whole
 * point: "this domain published no DMARC report authorization" and "the
 * lookup timed out" are the same shape to a `catch`, and reporting the
 * second as the first invents a finding out of a network blip. Same
 * ENODATA/ENOTFOUND/ENOENT convention as checks/dns.ts.
 */
async function txtRecords(name: string): Promise<string[] | null> {
  try {
    const records = await withTimeout(resolveTxtOnce(name));
    return records.map((r) => r.join(""));
  } catch (err: unknown) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : "";
    if (code === "ENODATA" || code === "ENOTFOUND" || code === "ENOENT") {
      return [];
    }
    return null;
  }
}

// ── SPF ─────────────────────────────────────────────────────────────────

/**
 * Every SPF finding that can be read off the apex TXT set, plus the one
 * that needs a bounded second round of lookups (unresolvable include).
 * Grouped into one probe because they all start from the same TXT answer,
 * which the memo has usually already fetched for checkSPF.
 */
export async function checkSpfRecordQuality(
  domain: string,
  url: string,
): Promise<Vulnerability[]> {
  const flat = await txtRecords(domain);
  if (flat === null) return [];
  const spfRecords = flat.filter((r) => /^v=spf1(?:\s|$)/i.test(r.trim()));
  if (spfRecords.length === 0) return []; // "no SPF at all" is checkSPF's job

  const findings: Vulnerability[] = [];

  if (spfRecords.length > 1) {
    findings.push(
      makeEmailVuln(
        "email-spf-multiple-records",
        url,
        "Multiple SPF Records Published",
        "medium",
        `${domain} publishes ${spfRecords.length} separate TXT records beginning with v=spf1. RFC 7208 allows exactly one, and a domain with more than one is a permanent error.`,
        `SPF records found at ${domain}: ${spfRecords.map((r) => `"${r.slice(0, 90)}"`).join(" | ")}`,
        "A receiver that finds two SPF records does not merge them or pick one, it returns permerror and stops evaluating SPF entirely. The domain is left with no working sender policy at all, so mail from any source passes the SPF stage, and DMARC alignment then has only DKIM to fall back on. In practice a second SPF record is worse than having none, because it looks configured.",
        "This almost always happens when a second service is onboarded and its setup guide says to add a TXT record: the record gets added alongside the existing one rather than merged into it. The fix is one record containing every include, which is also where the ten-lookup limit starts to matter, so merging is a good moment to check that count.",
        [
          "Merge every mechanism into a single v=spf1 TXT record at the apex and delete the others.",
          "Count the DNS-querying mechanisms while merging: include, a, mx, ptr, exists and redirect each cost one, and the total limit is ten.",
          `Verify with: dig +short TXT ${domain} | grep spf1`,
        ],
        [
          {
            label: "One merged record",
            language: "dns",
            code: `${domain}. IN TXT "v=spf1 include:_spf.google.com include:sendgrid.net ~all"`,
          },
        ],
        90,
      ),
    );
    // Everything below judges a single policy; with two records there is no
    // single policy to judge, and the permerror above is the finding.
    return findings;
  }

  const record = spfRecords[0].trim();
  const terms = record.split(/\s+/).slice(1);

  const allTerm = terms.find((t) => /^[-~+?]?all$/i.test(t));
  const redirect = terms.find((t) => /^redirect=/i.test(t));

  if (!allTerm && !redirect) {
    findings.push(
      makeEmailVuln(
        "email-spf-all-mechanism-missing",
        url,
        "SPF Record Has No all Mechanism",
        "low",
        `The SPF record for ${domain} ends without an all mechanism and without a redirect modifier, so any sender not matched by an earlier mechanism gets the default result, neutral.`,
        `SPF record for ${domain}: "${record.slice(0, 200)}"`,
        "Neutral is explicitly defined to be treated the same as no policy at all, so every sender the record does not list is neither permitted nor denied. The listed senders still pass, which makes the record look like it is working, while the whole point of publishing SPF, saying that everyone else is not authorised, is missing.",
        "The all mechanism is what makes an SPF record a closed list rather than an open one. Use -all once you are confident the record covers every legitimate sender, or ~all (softfail) while you are still finding them, and let DMARC aggregate reports tell you what you missed before tightening. A record with neither is the only variant that says nothing at all about unlisted senders.",
        [
          "Add ~all to the end of the record while you confirm every legitimate sender is listed.",
          "Use DMARC aggregate reports to find senders the record does not yet cover.",
          "Tighten to -all once the reports are clean.",
          `Verify with: dig +short TXT ${domain} | grep spf1`,
        ],
        [
          {
            label: "Closed policy",
            language: "dns",
            code: `${domain}. IN TXT "v=spf1 include:_spf.google.com -all"`,
          },
        ],
        85,
      ),
    );
  }

  if (allTerm && redirect) {
    findings.push(
      makeEmailVuln(
        "email-spf-redirect-ignored-with-all",
        url,
        "SPF redirect Modifier Ignored Because all Is Present",
        "low",
        `The SPF record for ${domain} contains both an all mechanism (${allTerm}) and a ${redirect} modifier. RFC 7208 section 6.1 says redirect is ignored whenever an all mechanism is present, so the redirect never takes effect.`,
        `SPF record for ${domain}: "${record.slice(0, 200)}"`,
        "The policy that actually applies is the one before the all mechanism, not the redirected one. Whoever added the redirect believes the shared policy at the target domain is in force, so a sender added there, or removed from there, has no effect here. The gap between the intended policy and the evaluated one is invisible until legitimate mail starts failing.",
        "redirect= is designed for the case where one domain wants to defer entirely to another domain's policy, which is why it is only consulted when no mechanism matched and there is no all to produce a result first. If you want to reuse another domain's senders and still set your own default, use include: rather than redirect=: include brings the other policy's senders in as a mechanism and leaves your own all in charge.",
        [
          "Decide which one you want: keep redirect= and remove the all mechanism, or keep all and switch redirect= to include:.",
          "include: plus your own all is usually the intended behaviour.",
          `Verify with: dig +short TXT ${domain} | grep spf1`,
        ],
        [
          {
            label: "include instead of redirect",
            language: "dns",
            code: `; wrong: the redirect is dead\n; "v=spf1 include:_spf.google.com -all redirect=_spf.example.net"\n\n; right\n${domain}. IN TXT "v=spf1 include:_spf.google.com include:_spf.example.net -all"`,
          },
        ],
        85,
      ),
    );
  }

  const macroTerm = terms.find((t) => /%\{[a-z]/i.test(t));
  if (macroTerm) {
    findings.push(
      makeEmailVuln(
        "email-spf-macro-mechanism",
        url,
        "SPF Record Uses Macro Expansion",
        "info",
        `The SPF record for ${domain} contains a macro expansion (${macroTerm.slice(0, 80)}). Macros substitute parts of the incoming message, such as the sender's local part or client IP, into a DNS name that is then queried.`,
        `SPF record for ${domain}: "${record.slice(0, 200)}"`,
        "Every macro-expanded lookup sends attacker-influenced data into a DNS query aimed at whichever nameserver the macro's domain points to. That is a side channel: a sender who controls the local part of the envelope address can make your receivers emit a DNS query encoding data of their choosing, and where the macro domain is third-party, the operator of that nameserver observes it. Macros with exists: also multiply the query count against the ten-lookup budget.",
        "Macros are a legitimate RFC 7208 feature and are used by some large senders for per-user authorisation, so this is informational rather than a defect. It is flagged because it is rare, hard to review, and easy to inherit from a vendor's setup guide without understanding what it queries. If you did not add it deliberately, find out which include brought it in.",
        [
          "Confirm the macro is deliberate and that you understand which nameserver receives the expanded queries.",
          "Prefer plain ip4, ip6 and include mechanisms where per-sender granularity is not actually needed.",
          `Verify with: dig +short TXT ${domain} | grep spf1`,
        ],
        [
          {
            label: "What a macro expands to",
            language: "text",
            code: "v=spf1 exists:%{l}._spf.%{d} -all\n\n; for MAIL FROM alice@example.com the receiver queries\n; alice._spf.example.com",
          },
        ],
        75,
      ),
    );
  }

  // Bounded second round: does each include: target actually publish SPF?
  const includeTargets = terms
    .filter((t) => /^include:/i.test(t))
    .map((t) => t.slice("include:".length))
    .filter((t) => t.length > 0 && !t.includes("%"))
    .slice(0, 10);
  if (includeTargets.length > 0) {
    const results = await Promise.allSettled(
      includeTargets.map(async (target) => ({
        target,
        records: await txtRecords(target),
      })),
    );
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      const { target, records } = r.value;
      if (records === null) continue; // lookup did not answer: unknown, not absent
      if (records.some((v) => /^v=spf1(?:\s|$)/i.test(v.trim()))) continue;
      findings.push(
        makeEmailVuln(
          "email-spf-include-unresolvable",
          url,
          "SPF include Target Publishes No SPF Record",
          "medium",
          `The SPF record for ${domain} includes ${target}, but ${target} publishes no v=spf1 TXT record, which makes the whole SPF evaluation a permanent error.`,
          `include:${target} resolved, and its TXT set contains no v=spf1 record.`,
          "An include whose target has no SPF record produces permerror, and permerror is not a partial failure: the receiver abandons SPF evaluation for the entire message. Every other mechanism in your record, including the -all at the end, stops being applied, so the policy you published is not the policy being enforced.",
          "This usually happens when a vendor is decommissioned and their SPF include domain is retired, or when an include name is mistyped and happens to resolve to a real domain with no SPF record. Because the failure mode is silent, the record can be broken for a long time before anyone notices, and DMARC aggregate reports are usually the first place it shows up.",
          [
            `Remove include:${target} if the service is no longer used.`,
            "If it is still in use, check the exact include hostname against the vendor's current documentation, since these change.",
            `Verify with: dig +short TXT ${target}`,
          ],
          [
            {
              label: "Check an include target directly",
              language: "bash",
              code: `dig +short TXT ${target}\n# an empty result, or one with no v=spf1, breaks the including domain's SPF`,
            },
          ],
          85,
        ),
      );
      break; // one finding is enough; the fix is to audit the whole record
    }
  }

  return findings;
}

// ── DMARC ───────────────────────────────────────────────────────────────

/** Reporting-address and record-count checks on the _dmarc TXT set. */
export async function checkDmarcReporting(
  domain: string,
  url: string,
): Promise<Vulnerability[]> {
  const flat = await txtRecords(`_dmarc.${domain}`);
  if (flat === null) return [];
  const records = flat.filter((r) => /^v=DMARC1\s*;/i.test(r.trim()));
  if (records.length === 0) return []; // "no DMARC" is checkDMARC's job

  const findings: Vulnerability[] = [];

  if (records.length > 1) {
    findings.push(
      makeEmailVuln(
        "email-dmarc-multiple-records",
        url,
        "Multiple DMARC Records Published",
        "medium",
        `_dmarc.${domain} returns ${records.length} separate TXT records beginning with v=DMARC1. RFC 7489 section 6.6.3 says a receiver that finds more than one must apply no DMARC policy at all.`,
        `DMARC records at _dmarc.${domain}: ${records.map((r) => `"${r.slice(0, 90)}"`).join(" | ")}`,
        "The domain has no enforced DMARC policy, while every dashboard that only checks for the presence of a record will report it as configured. Spoofed mail that fails SPF and DKIM alignment is delivered rather than quarantined or rejected, and no aggregate reports are generated, so the gap is invisible from your side too.",
        "The usual cause is the same as for duplicate SPF records: a second tool or vendor was onboarded and its setup guide said to add a TXT record at _dmarc, so one was added beside the existing one. Only one record may exist, and it has to contain every tag, including all reporting addresses, which can be a comma-separated list.",
        [
          "Delete all but one record at _dmarc and merge the tags into the survivor.",
          "Multiple report destinations go in one rua= value as a comma-separated list, not in separate records.",
          `Verify with: dig +short TXT _dmarc.${domain}`,
        ],
        [
          {
            label: "One merged record with two report destinations",
            language: "dns",
            code: `_dmarc.${domain}. IN TXT "v=DMARC1; p=reject; rua=mailto:dmarc@${domain},mailto:reports@vendor.example; adkim=s; aspf=s"`,
          },
        ],
        90,
      ),
    );
    return findings;
  }

  const record = records[0].trim();
  const ruaTag = /(?:^|;)\s*rua\s*=\s*([^;]{1,400})/i.exec(record)?.[1]?.trim();
  if (!ruaTag) return findings; // rua missing entirely is email-dmarc-rua-missing

  const uris = ruaTag
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);

  const malformed = uris.filter(
    (u) => !/^(?:mailto:[^@\s]+@[^@\s]+|https:\/\/\S+)$/i.test(u),
  );
  if (malformed.length > 0) {
    findings.push(
      makeEmailVuln(
        "email-dmarc-rua-invalid-uri",
        url,
        "DMARC Aggregate Report Address Is Not a Valid URI",
        "low",
        `The rua tag on ${domain}'s DMARC record contains a value that is not a usable DMARC reporting URI: ${malformed.map((u) => `"${u.slice(0, 80)}"`).join(", ")}. RFC 7489 requires each entry to be a URI, in practice mailto: or https:.`,
        `rua tag for _dmarc.${domain}: "${ruaTag.slice(0, 200)}"`,
        "A reporting address a receiver cannot parse is a reporting address that receives nothing. DMARC aggregate reports are the only feedback channel that shows which senders are failing authentication, so without them there is no way to tell a spoofing campaign from a misconfigured legitimate sender, and no safe basis on which to move the policy from none to quarantine or reject.",
        "The most common mistake is writing a bare email address without the mailto: scheme, which looks correct at a glance and is silently ignored by every receiver. Note also that reports go only to the addresses listed, and a receiver may drop the whole tag if any entry fails to parse, so one malformed entry can cost you the working ones next to it.",
        [
          "Prefix every mail address with mailto: and separate multiple destinations with commas, no spaces.",
          "Send a test report or use a DMARC report processor to confirm reports are arriving.",
          `Verify with: dig +short TXT _dmarc.${domain}`,
        ],
        [
          {
            label: "Correct rua syntax",
            language: "dns",
            code: `_dmarc.${domain}. IN TXT "v=DMARC1; p=none; rua=mailto:dmarc@${domain},mailto:agg@analyzer.example"`,
          },
        ],
        85,
      ),
    );
  }

  // External destinations need an authorization record in the destination's
  // own zone (RFC 7489 section 7.1), or receivers will not send reports.
  const externalTargets = uris
    .filter((u) => /^mailto:/i.test(u))
    .map((u) => u.slice("mailto:".length).split("@")[1]?.toLowerCase())
    .filter(
      (d): d is string => !!d && d !== domain && !d.endsWith(`.${domain}`),
    )
    .slice(0, 4);

  for (const target of externalTargets) {
    const authName = `${domain}._report._dmarc.${target}`;
    const auth = await txtRecords(authName);
    if (auth === null) continue; // lookup did not answer: unknown, not missing
    if (auth.some((r) => /^v=DMARC1/i.test(r.trim()))) continue;
    findings.push(
      makeEmailVuln(
        "email-dmarc-rua-external-unauthorized",
        url,
        "DMARC Reports Sent to an External Domain That Has Not Authorized Them",
        "medium",
        `${domain}'s DMARC record asks receivers to send aggregate reports to an address at ${target}, but ${target} publishes no authorization record at ${authName}, which RFC 7489 section 7.1 requires before a receiver will send cross-domain reports.`,
        `No v=DMARC1 TXT record found at ${authName}.`,
        "Conforming receivers, which is most of the large mailbox providers, will not send reports to a third-party domain that has not opted in. The reports are silently not sent, so the visibility DMARC was deployed for does not exist, and any decision to tighten the policy from none to quarantine or reject is being made without data on who would be affected.",
        "The authorization record lives in the destination's zone, not yours: the report processor has to publish <your-domain>._report._dmarc.<their-domain> with a v=DMARC1 value. Managed DMARC platforms usually create it automatically once you add the domain in their console, so the usual cause of this finding is a domain that was added to the DMARC record before it was added to the platform, or one that was removed from the platform later.",
        [
          `Add the domain in your report processor's console so it publishes ${authName}.`,
          "If you run the destination yourself, publish the authorization record there.",
          "Keep a mailbox on your own domain in the rua list as well, so reports do not depend entirely on a third party.",
          `Verify with: dig +short TXT ${authName}`,
        ],
        [
          {
            label: "The record the destination must publish",
            language: "dns",
            code: `${domain}._report._dmarc.${target}. IN TXT "v=DMARC1"`,
          },
        ],
        80,
      ),
    );
    break;
  }

  return findings;
}

// ── DKIM selector quality ───────────────────────────────────────────────

/**
 * The same fixed selector list async-checks.ts's checkDKIMWeakKey probes.
 * Both go through the per-scan DNS memo, so running after it costs no
 * additional queries. Providers that mint a random selector per tenant
 * cannot be enumerated by a fixed list, so a domain on one of those simply
 * produces no finding here, which is the honest outcome.
 */
const DKIM_SELECTORS = [
  "default",
  "dkim",
  "mail",
  "selector1",
  "selector2",
  "google",
  "k1",
  "s1",
  "fm1",
  "zoho",
];

export async function checkDkimSelectorFlags(
  domain: string,
  url: string,
): Promise<Vulnerability[]> {
  const probes = await Promise.allSettled(
    DKIM_SELECTORS.map(async (sel) => {
      const flat = await txtRecords(`${sel}._domainkey.${domain}`);
      const record = flat?.find((r) => r.includes("p=") || /v=DKIM1/i.test(r));
      return record ? { sel, record } : null;
    }),
  );

  const found = probes
    .filter(
      (r): r is PromiseFulfilledResult<{ sel: string; record: string }> =>
        r.status === "fulfilled" && r.value !== null,
    )
    .map((r) => r.value);
  if (found.length === 0) return [];

  const findings: Vulnerability[] = [];

  const testing = found.find(({ record }) =>
    /(?:^|;)\s*t\s*=\s*[^;]*\by\b/i.test(record),
  );
  if (testing) {
    findings.push(
      makeEmailVuln(
        "email-dkim-testing-mode",
        url,
        "DKIM Selector Published in Testing Mode",
        "low",
        `The DKIM record at ${testing.sel}._domainkey.${domain} carries the t=y flag, which tells receivers the domain is still testing DKIM and that they should not treat a verification failure differently from unsigned mail.`,
        `DKIM record at ${testing.sel}._domainkey.${domain}: "${testing.record.slice(0, 160)}"`,
        "t=y asks receivers to disregard DKIM failures for this selector, so a forged message that fails signature verification is handled exactly like one that was never signed. Where DMARC alignment depends on DKIM, that removes the DKIM half of the policy for every message signed with this selector, and it does so silently: the record looks fully configured.",
        "The flag exists for the deployment window, while you confirm signing works end to end without risking legitimate mail. It is meant to be removed once that is confirmed, and it very often is not, because nothing breaks when it stays. RFC 6376 defines t=y for exactly this purpose and expects it to be temporary.",
        [
          `Remove the t=y flag from the DKIM record at ${testing.sel}._domainkey.${domain} once signing is verified working.`,
          "Confirm signatures are actually verifying first, using DMARC aggregate reports or a test send to a verifying receiver.",
          `Verify with: dig +short TXT ${testing.sel}._domainkey.${domain}`,
        ],
        [
          {
            label: "Record with the testing flag removed",
            language: "dns",
            code: `${testing.sel}._domainkey.${domain}. IN TXT "v=DKIM1; k=rsa; p=MIIBIjANBg..."`,
          },
        ],
        85,
      ),
    );
  }

  const revoked = found.find(({ record }) =>
    /(?:^|;)\s*p\s*=\s*(?:;|$)/i.test(record.trim()),
  );
  if (revoked) {
    findings.push(
      makeEmailVuln(
        "email-dkim-revoked-key",
        url,
        "DKIM Selector Published With an Empty (Revoked) Key",
        "low",
        `The DKIM record at ${revoked.sel}._domainkey.${domain} has an empty p= tag. RFC 6376 defines an empty public key as revoked, so every signature made with this selector fails verification.`,
        `DKIM record at ${revoked.sel}._domainkey.${domain}: "${revoked.record.slice(0, 160)}"`,
        "Any mail still being signed with this selector fails DKIM verification at every receiver. Under a DMARC policy of quarantine or reject, and with SPF not aligned, that mail is discarded rather than delivered. Because the selector is chosen by the signing system rather than by DNS, this only surfaces as unexplained delivery failures from one particular sending path.",
        "Revoking a selector by emptying p= is the correct way to retire a key, and a revoked selector left in place is normally harmless. It is worth checking because the two ways to reach this state look identical in DNS: a deliberate retirement, and a signing service that is still using the selector it was told to stop using. Confirm no system is still signing with it, then remove the record.",
        [
          "Confirm nothing still signs with this selector, then delete the record rather than leaving an empty key published.",
          "If mail is still being signed with it, publish the current public key or repoint the signer at an active selector.",
          `Verify with: dig +short TXT ${revoked.sel}._domainkey.${domain}`,
        ],
        [
          {
            label: "Check which selector your mail actually uses",
            language: "bash",
            code: "# In a received message's headers:\n#   DKIM-Signature: v=1; a=rsa-sha256; d=example.com; s=<selector>; ...\n# The s= tag names the selector the signer used.",
          },
        ],
        80,
      ),
    );
  }

  const sha1 = found.find(({ record }) =>
    /(?:^|;)\s*h\s*=\s*(?:[^;]*\b)?sha1\b/i.test(record),
  );
  if (sha1 && !/sha256/i.test(sha1.record)) {
    findings.push(
      makeEmailVuln(
        "email-dkim-sha1-hash",
        url,
        "DKIM Selector Restricted to the SHA-1 Hash Algorithm",
        "medium",
        `The DKIM record at ${sha1.sel}._domainkey.${domain} declares h=sha1 with no sha256 alternative, restricting signatures under this selector to the rsa-sha1 algorithm.`,
        `DKIM record at ${sha1.sel}._domainkey.${domain}: "${sha1.record.slice(0, 160)}"`,
        "SHA-1 is collision-vulnerable, and a DKIM signature covers a hash of the message. RFC 8301 formally deprecated rsa-sha1 for DKIM and instructs verifiers to treat such signatures as failing, so receivers that follow it discard the signature entirely. That is both a security weakness and a deliverability problem: mail signed only with SHA-1 loses DKIM alignment under DMARC.",
        "The h= tag is a restriction rather than a declaration of what is used: it tells verifiers which hash algorithms are acceptable for this key. A selector limited to sha1 usually predates RFC 8301 and has never been rotated. Removing the tag entirely is normal, since the default already permits sha256.",
        [
          `Reissue the key and publish it without the h=sha1 restriction, or with h=sha256.`,
          "Configure the signing service to use rsa-sha256 (or ed25519-sha256).",
          "Rotate to a new selector rather than editing in place, so in-flight mail signed with the old key still verifies.",
          `Verify with: dig +short TXT ${sha1.sel}._domainkey.${domain}`,
        ],
        [
          {
            label: "Generate a SHA-256 capable key",
            language: "bash",
            code: `opendkim-genkey -b 2048 -d ${domain} -s ${sha1.sel}2\n# publish the new key at ${sha1.sel}2._domainkey.${domain} without an h= restriction`,
          },
        ],
        85,
      ),
    );
  }

  return findings;
}

// ── BIMI ────────────────────────────────────────────────────────────────

/** A BIMI record that publishes a logo but no verified mark certificate. */
export async function checkBimiVmc(
  domain: string,
  url: string,
): Promise<Vulnerability[]> {
  const flat = await txtRecords(`default._bimi.${domain}`);
  if (flat === null) return [];
  const record = flat.find((r) => /^v=BIMI1\s*;/i.test(r.trim()));
  if (!record) return []; // no BIMI at all is not a finding

  const logo = /(?:^|;)\s*l\s*=\s*([^;]{1,400})/i.exec(record)?.[1]?.trim();
  if (!logo) return []; // declared-but-empty l= is a different condition
  const authority = /(?:^|;)\s*a\s*=\s*([^;]{1,400})/i
    .exec(record)?.[1]
    ?.trim();
  if (authority) return [];

  return [
    makeEmailVuln(
      "email-bimi-without-vmc",
      url,
      "BIMI Record Publishes a Logo With No Verified Mark Certificate",
      "info",
      `default._bimi.${domain} publishes a logo URL but no a= tag, so there is no Verified Mark Certificate backing the logo.`,
      `BIMI record at default._bimi.${domain}: "${record.slice(0, 200)}"`,
      "Without a VMC the major mailbox providers that display BIMI, Gmail and Apple Mail among them, will not show the logo, so the record produces no benefit. A logo that renders on the strength of DNS alone would also be the wrong outcome: the certificate is what ties the mark to a trademark holder, and without it a lookalike domain could publish the same image.",
      "This is informational because BIMI is a branding feature rather than a security control, and the record does no harm. The point is that the setup is incomplete: the DNS half is done and the expensive half, obtaining a VMC from an approved authority, is not, so nothing is gained. BIMI also requires DMARC at quarantine or reject before any provider will consider it, which is the more valuable prerequisite to get right first.",
      [
        "Obtain a Verified Mark Certificate from an approved authority and publish it, adding the a= tag pointing at the .pem.",
        "Confirm the domain is at DMARC p=quarantine or p=reject first, since no provider displays BIMI below that.",
        "If a VMC is not planned, consider removing the BIMI record rather than leaving an unused one published.",
        `Verify with: dig +short TXT default._bimi.${domain}`,
      ],
      [
        {
          label: "Complete BIMI record",
          language: "dns",
          code: `default._bimi.${domain}. IN TXT "v=BIMI1; l=https://${domain}/bimi/logo.svg; a=https://${domain}/bimi/vmc.pem"`,
        },
      ],
      80,
    ),
  ];
}

// ── MX hygiene ──────────────────────────────────────────────────────────

/** An MX record whose exchange is a bare IP address. */
export async function checkMxIpLiteral(
  domain: string,
  url: string,
): Promise<Vulnerability[]> {
  let records: { exchange: string; priority: number }[];
  try {
    records = await withTimeout(resolveMxOnce(domain));
  } catch {
    return [];
  }
  const ipLike = records.find((r) =>
    /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\.?$/.test(r.exchange.trim()),
  );
  if (!ipLike) return [];

  return [
    makeEmailVuln(
      "email-mx-ip-literal",
      url,
      "MX Record Points at an IP Address Instead of a Hostname",
      "medium",
      `The MX record for ${domain} names ${ipLike.exchange} as its exchange. RFC 1035 and RFC 2181 require the exchange to be a domain name with an address record, never an IP address literal.`,
      `MX record for ${domain}: priority ${ipLike.priority}, exchange ${ipLike.exchange}`,
      "Standards-conforming senders resolve the exchange as a hostname, get NXDOMAIN, and defer or bounce the message, so inbound mail fails from some senders and works from others depending on how tolerant their MTA is. Because it is partial, the failure is usually attributed to the sender rather than to the record. It also makes it impossible to present a certificate name that matches the exchange, which breaks MTA-STS and DANE.",
      "This is a straightforward record error rather than an attack surface, but it undermines everything built on top of the MX name. MTA-STS policies list permitted MX hostnames, TLS certificate validation for SMTP matches the exchange name, and DANE TLSA records are published under it. None of those can work when the exchange is a literal address.",
      [
        `Create an A/AAAA record for a mail hostname (for example mail.${domain}) and point the MX at that name.`,
        "Make sure the mail server presents a certificate valid for that hostname.",
        `Verify with: dig +short MX ${domain}`,
      ],
      [
        {
          label: "Correct MX configuration",
          language: "dns",
          code: `mail.${domain}. IN A    203.0.113.25\n${domain}.      IN MX 10 mail.${domain}.`,
        },
      ],
      90,
    ),
  ];
}

// ── MTA-STS policy content ──────────────────────────────────────────────

/**
 * Fetches the MTA-STS policy file and checks the two things its content can
 * be wrong about beyond mode: a max_age too short to be useful, and an mx
 * list that does not cover the domain's actual MX hosts. Only runs when the
 * DNS record exists, so a domain with no MTA-STS is not touched.
 */
export async function checkMtaStsPolicyContent(
  domain: string,
  url: string,
): Promise<Vulnerability[]> {
  const dnsRecords = await txtRecords(`_mta-sts.${domain}`);
  if (dnsRecords === null) return [];
  if (!dnsRecords.some((r) => r.includes("v=STSv1"))) return [];

  const policyUrl = `https://mta-sts.${domain}/.well-known/mta-sts.txt`;
  let text: string;
  try {
    const res = await safeFetch(policyUrl, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return []; // unreachable/errored is checkMTASTSPolicyFile's job
    text = (await res.text()).slice(0, 8192);
  } catch {
    return [];
  }
  if (!/version:\s*STSv1/i.test(text)) return []; // malformed is reported elsewhere

  const findings: Vulnerability[] = [];

  const maxAge = Number(/max_age:\s*(\d{1,12})/i.exec(text)?.[1] ?? NaN);
  if (Number.isFinite(maxAge) && maxAge > 0 && maxAge < 604800) {
    findings.push(
      makeEmailVuln(
        "email-mta-sts-max-age-short",
        url,
        "MTA-STS Policy max_age Shorter Than One Week",
        "low",
        `The MTA-STS policy at ${policyUrl} sets max_age to ${maxAge} seconds (about ${Math.round(maxAge / 3600)} hours). RFC 8461 recommends a value of at least 604800 seconds, one week, for a policy in enforce mode.`,
        `MTA-STS policy at ${policyUrl} declares max_age: ${maxAge}.`,
        "max_age is how long a sending server keeps the policy cached, and that cache is the entire protection: once it expires, the sender is back to fetching the policy over the network, which is exactly the moment an attacker who can interfere with DNS or HTTPS can prevent it from being retrieved and downgrade the connection to opportunistic TLS. A short max_age multiplies the number of those windows.",
        "Short values are usually left over from the rollout, when a low max_age is deliberately used so a mistake can be corrected quickly. That is the right approach while testing, and the wrong one afterwards. Raise it once the policy has been stable and every MX host in it is serving a valid certificate.",
        [
          "Raise max_age to at least 604800 (one week); 1209600 (two weeks) is common for a settled policy.",
          "Before raising it, confirm every MX host listed in the policy presents a valid certificate, since a mistake will be cached for the full duration.",
          "Change the policy id whenever the file changes, so senders refetch rather than waiting out the cache.",
        ],
        [
          {
            label: "Settled policy file",
            language: "text",
            code: `version: STSv1\nmode: enforce\nmx: mail.${domain}\nmax_age: 1209600`,
          },
        ],
        80,
      ),
    );
  }

  const policyMx = [...text.matchAll(/^\s*mx:\s*(\S{1,255})\s*$/gim)].map((m) =>
    m[1].toLowerCase().replace(/\.$/, ""),
  );
  if (policyMx.length > 0) {
    let mxHosts: string[] = [];
    try {
      mxHosts = (await withTimeout(resolveMxOnce(domain))).map((r) =>
        r.exchange.toLowerCase().replace(/\.$/, ""),
      );
    } catch {
      mxHosts = [];
    }
    const matches = (host: string) =>
      policyMx.some((pattern) =>
        pattern.startsWith("*.")
          ? host.endsWith(pattern.slice(1)) &&
            host.split(".").length === pattern.split(".").length
          : host === pattern,
      );
    const uncovered = mxHosts.filter((h) => h.length > 0 && !matches(h));
    if (mxHosts.length > 0 && uncovered.length > 0) {
      findings.push(
        makeEmailVuln(
          "email-mta-sts-mx-mismatch",
          url,
          "MTA-STS Policy Does Not Cover Every Published MX Host",
          "medium",
          `The MTA-STS policy at ${policyUrl} lists ${policyMx.join(", ")}, which does not cover ${uncovered.length} of the domain's published MX hosts: ${uncovered.join(", ")}.`,
          `MX records for ${domain}: ${mxHosts.join(", ")}. Policy mx entries: ${policyMx.join(", ")}.`,
          "A sending server honouring an enforce-mode policy will refuse to deliver to any MX host the policy does not list. Where the uncovered host is a backup MX, mail simply stops flowing to it during exactly the failover the backup exists for. Where it is a primary, inbound mail from MTA-STS-aware senders, which includes Gmail and Outlook, fails outright.",
          "The mismatch normally appears after an MX change: a new provider is added or a backup MX is introduced, and the policy file is not updated alongside it, because the policy lives on a web server rather than in DNS. Wildcards are permitted in the mx list and match one label, so a policy of mx: *.mail.example.com covers a.mail.example.com but not mail.example.com itself.",
          [
            "Add an mx: line for every published MX host, or a wildcard that covers them.",
            "Change the policy id in the _mta-sts TXT record whenever the file changes, so senders refetch instead of using the cached copy.",
            "Make the policy file part of whatever process changes MX records, so the two cannot drift again.",
            `Verify with: curl -s ${policyUrl} && dig +short MX ${domain}`,
          ],
          [
            {
              label: "Policy covering every MX host",
              language: "text",
              code: `version: STSv1\nmode: enforce\n${mxHosts.map((h) => `mx: ${h}`).join("\n")}\nmax_age: 1209600`,
            },
          ],
          85,
        ),
      );
    }
  }

  return findings;
}
