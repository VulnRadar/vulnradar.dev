import type { Vulnerability } from "@/lib/scanner/types";
import type { ProbeData } from "./verify-findings";

/**
 * A labelled set for measuring whether the AI verification agent is actually
 * right, rather than whether it answered.
 *
 * This exists because of a specific failure. Guidance in verify-context.ts
 * told the agent that all of a domain's nameservers sitting at one provider
 * was "a deliberate reasonable trade" and that a framework-required style-src
 * carried "practically no exposure". The agent followed the instruction
 * exactly, and marked both findings possible_fp at high confidence, on our own
 * scan. Both verdicts were wrong. Nothing in the build noticed: the prompt is
 * a string, the tests asserted that it parsed and that a verdict came back,
 * and a wrong verdict is shaped exactly like a right one.
 *
 * A prompt is behaviour. The only way to know a prompt change made things
 * better is to run it against cases whose answers are known, so that is what
 * this is: findings paired with the verdict a competent engineer would give,
 * and a note on WHY, so the next person to edit the prompt can tell whether
 * they disagree with the label or have found a real bug.
 *
 * The cases are deliberately split between the two directions of error,
 * because a prompt can always be made to score well on one by getting worse
 * at the other. Confirming everything scores 100% on the "these are real"
 * half; a scanner that never confirms scores 100% on the false-positive half.
 * Neither is useful, and a set that only contained one half would reward it.
 *
 * Run with: AI_EVAL=1 npx vitest run tests/lib/ai/verify-eval.test.ts
 * (PowerShell: $env:AI_EVAL=1; npx vitest run tests/lib/ai/verify-eval.test.ts)
 */

export type ExpectedVerdict = "confirmed" | "possible_fp";

export interface VerifyEvalCase {
  /** Stable id for the scorecard. */
  name: string;
  /**
   * The rule in verify-context.ts this case exercises. Every rule that exists
   * to stop a specific wrong verdict should have a case pointing at it, and
   * the always-on test asserts the rule text is still in the prompt: a case
   * whose rule has been deleted is a case that will start failing for a
   * reason nobody will connect to the deletion.
   */
  rule: string;
  finding: Vulnerability;
  probe: ProbeData;
  expected: ExpectedVerdict;
  /** Why that is the right answer. Read this before "fixing" a failure. */
  rationale: string;
  /**
   * Set when this case is a regression: the agent got it WRONG in production
   * and the prompt was changed in response. These are the ones worth being
   * loudest about, because they have already happened once.
   */
  regression?: boolean;
}

/** Trimmed-down finding builder: the eval only sends what buildVerifyPrompt reads. */
function finding(
  over: Partial<Vulnerability> & Pick<Vulnerability, "id" | "title">,
): Vulnerability {
  return {
    severity: "medium",
    category: "headers",
    description: "",
    evidence: "",
    riskImpact: "",
    explanation: "",
    fixSteps: [],
    codeExamples: [],
    ...over,
  } as Vulnerability;
}

/** A boring, healthy HTTP response, for findings the probe cannot speak to. */
function probe(over: Partial<ProbeData> = {}): ProbeData {
  return {
    status_code: 200,
    final_url: "https://example.com/",
    response_headers: {
      "content-type": "text/html; charset=utf-8",
      server: "nginx",
    },
    body_snippet: "<!doctype html><html><head><title>Example</title></head>",
    ...over,
  };
}

export const VERIFY_EVAL_CASES: VerifyEvalCase[] = [
  // ── Findings that are REAL and must be confirmed ──────────────────────
  {
    name: "all nameservers at one provider",
    rule: "An intentional configuration whose stated risk is real",
    regression: true,
    finding: finding({
      id: "async-single-ns-provider",
      title: "All nameservers are with a single provider",
      category: "dns",
      severity: "low",
      evidence:
        "NS records: ns1.example-dns.net, ns2.example-dns.net. All 2 nameservers are operated by the same provider.",
    }),
    probe: probe(),
    expected: "confirmed",
    rationale:
      "The agent called this a false positive because the arrangement is obviously deliberate. Deliberate refutes nothing: every nameserver being at one provider IS a single point of failure, and large managed DNS platforms do have global outages. Whether the operator would choose it again is their call to make, and a possible_fp verdict takes that call away from them by telling them there is nothing to decide.",
  },
  {
    name: "framework-required style-src unsafe-inline",
    rule: "An informational finding that reports a fact accurately",
    regression: true,
    finding: finding({
      id: "csp-style-unsafe-inline",
      title: "CSP allows inline styles",
      category: "code",
      severity: "info",
      evidence:
        "style-src includes 'unsafe-inline'. This is commonly required by CSS-in-JS frameworks and carries far less risk than script-src 'unsafe-inline'.",
    }),
    probe: probe({
      response_headers: {
        "content-type": "text/html",
        "content-security-policy":
          "default-src 'self'; script-src 'self' 'nonce-abc123'; style-src 'self' 'unsafe-inline'",
      },
    }),
    expected: "confirmed",
    rationale:
      "The finding's own text already says this is framework-required and lower risk than the script-src equivalent. The disclosure a possible_fp verdict would be trying to add is the text the finding is already made of, so the verdict contradicts the finding rather than correcting it. It is info severity: it is telling the reader something true, not claiming a vulnerability.",
  },
  {
    name: "missing DMARC, probe cannot see DNS",
    rule: "You CANNOT refute a DNS finding using HTTP probe data",
    finding: finding({
      id: "async-missing-dmarc-record",
      title: "No DMARC record published",
      category: "email",
      severity: "high",
      evidence: "TXT query for _dmarc.example.com returned no records.",
    }),
    probe: probe(),
    expected: "confirmed",
    rationale:
      "The scanner ran a real DNS query. An HTTP probe is a different protocol and cannot contradict it. Answering uncertain here because the probe carries no DNS data is the failure mode this rule exists to stop.",
  },
  {
    name: "body-content finding beyond the snippet",
    rule: "the scanner parsed the full document and the snippet is truncated",
    finding: finding({
      id: "target-blank-no-noopener",
      title: "External links without rel=noopener",
      category: "content",
      severity: "low",
      evidence: "14 anchor tags with target=_blank and no rel=noopener found.",
      evidenceExcerpts: [
        {
          label: "anchor",
          value: '<a href="https://x.test" target="_blank">Docs</a>',
        },
      ],
    }),
    probe: probe(),
    expected: "confirmed",
    rationale:
      "body_snippet is the first 24KB and the matches are deeper in the document. evidence_excerpts carries the scanner's own verbatim match, which is authoritative. Truncation is a limit of the probe, not evidence against the finding.",
  },
  {
    name: "HSTS genuinely absent",
    rule: "The header is absent from response_headers",
    finding: finding({
      id: "hsts-missing",
      title: "Strict-Transport-Security header missing",
      severity: "medium",
      evidence: "No Strict-Transport-Security header in the response.",
    }),
    probe: probe(),
    expected: "confirmed",
    rationale:
      "Directly checkable and directly true: the header is not in response_headers. The straightforward confirm, included so the set cannot be passed by a model that has learned to answer possible_fp to everything.",
  },
  {
    name: "risk with no available fix",
    rule: "Unfixable is not untrue",
    finding: finding({
      id: "shared-hosting-ip",
      title: "Host shares its IP with unrelated domains",
      category: "information-disclosure",
      severity: "low",
      evidence:
        "Reverse lookup shows 340 other domains resolving to this address.",
    }),
    probe: probe(),
    expected: "confirmed",
    rationale:
      "On a shared hosting tier there is nothing the reader can do short of moving host. That makes it inconvenient, not false. A finding does not stop being true because the answer is expensive.",
  },

  // ── Findings that are NOT real and must be called out ─────────────────
  {
    name: "NSEC on a live-signing provider",
    rule: "DNSSEC: NSEC without NSEC3PARAM on a live-signing provider",
    finding: finding({
      id: "async-dnssec-nsec-walkable",
      title: "DNSSEC zone may allow zone walking",
      category: "dns",
      severity: "low",
      evidence:
        "DNSKEY present, no NSEC3PARAM record. Zone appears to use NSEC, which permits enumeration of all names. Nameservers: ns1.cloudflare.com, ns2.cloudflare.com.",
    }),
    probe: probe(),
    expected: "possible_fp",
    rationale:
      "The observation is right and the inference is not. A live-signing provider synthesizes one NSEC record per query covering exactly the name asked for (black lies, RFC 4470 family). It never names a second real name, so there is no chain to follow and the zone cannot be walked. Identical record shape, no exposure.",
  },
  {
    name: "no TLSA record on a web host",
    rule: "TLSA / DANE records absent",
    finding: finding({
      id: "async-no-tlsa-record",
      title: "No DANE/TLSA record for HTTPS",
      category: "dns",
      severity: "low",
      evidence: "No TLSA record at _443._tcp.example.com.",
    }),
    probe: probe(),
    expected: "possible_fp",
    rationale:
      "No browser implements DANE. On a host using an ACME certificate that rotates automatically, a pinned TLSA record breaks the site at the next renewal. Absent TLSA on a web host is the correct configuration, not a gap.",
  },
  {
    name: "certificate publishes no OCSP URL",
    rule: "No OCSP responder / no AIA OCSP URL in the certificate",
    finding: finding({
      id: "ssl-no-ocsp-uri",
      title: "Certificate does not publish an OCSP responder",
      category: "ssl",
      severity: "low",
      evidence:
        "Certificate AIA extension contains no OCSP URI. Issuer: R11, Let's Encrypt.",
    }),
    probe: probe(),
    expected: "possible_fp",
    rationale:
      "Let's Encrypt removed OCSP URLs from its certificates in May 2025 and shut its responders off that August, moving to CRL-only revocation. A current certificate from that issuer having no OCSP URI is the expected state across a large share of the web.",
  },
  {
    name: "header the scanner reported missing is present",
    rule: "The header IS present in response_headers",
    finding: finding({
      id: "x-frame-options-missing",
      title: "X-Frame-Options header missing",
      evidence: "No X-Frame-Options header found.",
    }),
    probe: probe({
      response_headers: {
        "content-type": "text/html",
        "x-frame-options": "DENY",
      },
    }),
    expected: "possible_fp",
    rationale:
      "The header is right there in response_headers with a correct value. The scanner matched the wrong request. This is the plain measurement error, and the one an agent that never says possible_fp will get wrong.",
  },
  {
    name: "placeholder credential in documentation markup",
    rule: "placeholder patterns",
    finding: finding({
      id: "hardcoded-api-key",
      title: "Possible API key in page source",
      category: "secrets-extended",
      severity: "high",
      evidence: 'Matched pattern: api_key="YOUR_API_KEY_HERE"',
    }),
    probe: probe({
      body_snippet:
        "<pre><code>curl -H 'Authorization: Bearer YOUR_API_KEY_HERE' https://api.example.com</code></pre>",
    }),
    expected: "possible_fp",
    rationale:
      "The match is an obvious placeholder inside a <pre><code> documentation block. It is not shaped like a credential and it is not in a position where one would be used.",
  },
  {
    name: "private-range IP reported as hardcoded",
    rule: '"Hardcoded IP" is 127.0.0.1, 0.0.0.0, localhost, or RFC-1918',
    finding: finding({
      id: "hardcoded-ip-addresses",
      title: "Hardcoded IP address in page content",
      category: "information-disclosure",
      severity: "low",
      evidence: "Found IP address 192.168.1.1 in body content.",
    }),
    probe: probe({
      body_snippet:
        "<p>Open your router's admin page at <code>192.168.1.1</code> to continue.</p>",
    }),
    expected: "possible_fp",
    rationale:
      "192.168.1.1 is RFC-1918 private space and discloses nothing about this host. Here it is documentation telling a reader to visit their own router.",
  },
];

/** The two halves, for a scorecard that reports them separately. */
export function splitByExpected(cases: VerifyEvalCase[]) {
  return {
    shouldConfirm: cases.filter((c) => c.expected === "confirmed"),
    shouldFlag: cases.filter((c) => c.expected === "possible_fp"),
  };
}
