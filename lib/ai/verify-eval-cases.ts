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

/**
 * "uncertain" is a first-class label. A probe that is a challenge page or a
 * 403 cannot settle a finding either way, and a prompt that answers
 * possible_fp (or confirmed) to it is wrong in the way that matters most:
 * possible_fp is written to the feedback table and discounts the check for
 * every user, while uncertain writes nothing.
 */
export type ExpectedVerdict = "confirmed" | "possible_fp" | "uncertain";

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
      id: "inline-style-attr",
      title: "Inline style attributes in markup",
      category: "content",
      severity: "low",
      evidence: "14 elements with an inline style attribute found.",
      evidenceExcerpts: [
        {
          label: "element",
          value: '<div style="display:none;position:absolute">Menu</div>',
        },
      ],
    }),
    probe: probe(),
    expected: "confirmed",
    rationale:
      "body_snippet is the first 24KB and the matches are deeper in the document. evidence_excerpts carries the scanner's own verbatim match, which is authoritative. Truncation is a limit of the probe, not evidence against the finding. The id is inline-style-attr rather than target-blank-no-noopener on purpose: the latter is no longer a vulnerability in a supported browser, so a case that pins it to confirmed would teach the blind-confirm path this set exists to catch.",
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

  // ── Added with the observation-versus-interpretation rewrite ──────────
  {
    name: "CSP genuinely absent on a normal page",
    rule: "The header is absent from response_headers of a usable probe",
    regression: true,
    finding: finding({
      id: "csp-missing",
      title: "Content-Security-Policy header missing",
      category: "code",
      severity: "medium",
      evidence: "No Content-Security-Policy header in the response.",
    }),
    probe: probe({
      body_snippet:
        '<!doctype html><html><head><title>Home</title><meta charset="utf-8"></head><body><h1>Hello</h1>',
    }),
    expected: "confirmed",
    rationale:
      "A 200 HTML page with no CSP header and no CSP meta tag. This agent called a finding of exactly this shape a false positive on a Vercel app because the page 'does not need' one. Need is not the question: the header is not sent, and the check says so. Included so that tightening the interpretation rule cannot be passed by answering possible_fp to every header finding.",
  },
  {
    name: "pinned CDN script with no integrity attribute",
    rule: "A version-pinned file on a public CDN",
    finding: finding({
      id: "supply-chain-sri-external-script",
      title: "External script loaded without subresource integrity",
      category: "supply-chain",
      severity: "medium",
      evidence:
        "Script https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js has no integrity attribute.",
      evidenceExcerpts: [
        {
          label: "script",
          value:
            '<script src="https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js"></script>',
        },
      ],
    }),
    probe: probe({ final_url: "https://shop.example.com/" }),
    expected: "confirmed",
    rationale:
      "A version-pinned file on a public CDN is the case SRI exists for: the bytes never change legitimately, so a hash costs nothing and a compromised CDN would otherwise run in the page. Third-party host, no integrity attribute, nothing that prevents one.",
  },
  {
    name: "target=_blank link with the opener left on",
    rule: 'Only rel="opener"',
    finding: finding({
      id: "page-anchor-target-blank-no-noopener",
      title: "Link opens a new tab and keeps window.opener",
      category: "content",
      severity: "low",
      evidence: 'Anchor with target="_blank" and rel="opener".',
      evidenceExcerpts: [
        {
          label: "anchor",
          value: '<a href="https://x.test" target="_blank" rel="opener">x</a>',
        },
      ],
    }),
    probe: probe(),
    expected: "confirmed",
    rationale:
      "rel=opener asks for the old behaviour explicitly, so the implicit noopener default does not apply and the new page gets a window.opener reference to this one.",
  },
  {
    name: "missing HttpOnly on a PHP session cookie",
    rule: "PHPSESSID, MoodleSession and other real session cookies",
    finding: finding({
      id: "page-cookie-missing-httponly",
      title: "Cookie set without HttpOnly",
      category: "cookies",
      severity: "medium",
      evidence: "Cookie PHPSESSID is set without the HttpOnly attribute.",
    }),
    probe: probe({
      response_headers: {
        "content-type": "text/html",
        "set-cookie": ["PHPSESSID=abc123; path=/; Secure"],
      },
    }),
    expected: "confirmed",
    rationale:
      "A real session identifier readable by script is exactly what HttpOnly is for, and the probe shows the cookie with no HttpOnly. The contrast with XSRF-TOKEN below is the point: the same finding id is a true positive on one cookie and a false one on another, and the cookie name decides.",
  },
  {
    name: "deliberate wildcard record on the owner's own domain",
    rule: "a wildcard DNS record the owner set on their own domain",
    regression: true,
    finding: finding({
      id: "dns-wildcard-record-present",
      title: "Wildcard DNS record present",
      category: "dns",
      severity: "low",
      evidence:
        "*.example.org resolves to 76.76.21.21 (Vercel). Random labels all resolve.",
    }),
    probe: probe({ final_url: "https://example.org/" }),
    expected: "confirmed",
    rationale:
      "The domain belongs to the operator, who pointed a wildcard at Vercel on purpose. Deliberate refutes nothing: any label now resolves, which widens subdomain takeover and phishing surface, and the reader decides whether that is worth it. The agent called this a false positive on two real domains because the setup looked intentional.",
  },
  {
    name: "SMTP TLSA missing for mail hosts in a signed zone",
    rule: "When both facts hold, the missing record is real",
    finding: finding({
      id: "async-tlsa-dane-record-missing",
      title: "TLSA (DANE) Record Missing",
      category: "dns",
      severity: "info",
      evidence:
        "example.com is DNSSEC-signed and accepts mail, but none of its mail exchangers publish a TLSA record at _25._tcp. MX: mx1.example.com, mx2.example.com.",
    }),
    probe: probe(),
    expected: "confirmed",
    rationale:
      "This is the check's real shape: the MX hosts are inside the domain's own signed zone, so DANE for mail is possible and the record is absent. The web-host TLSA case above is possible_fp because nothing on the web reads TLSA; here the consumer is a sending mail server, and some of them do.",
  },

  // ── More false positives ──────────────────────────────────────────────
  {
    name: "first-party script flagged for missing SRI",
    rule: "A first-party resource is the page's own code",
    finding: finding({
      id: "supply-chain-sri-external-script",
      title: "External script loaded without subresource integrity",
      category: "supply-chain",
      severity: "medium",
      evidence:
        "Script https://learn.example.edu/lib/javascript.php/1735/main.js has no integrity attribute.",
      evidenceExcerpts: [
        {
          label: "script",
          value:
            '<script src="https://learn.example.edu/lib/javascript.php/1735/main.js"></script>',
        },
      ],
    }),
    probe: probe({ final_url: "https://learn.example.edu/" }),
    expected: "possible_fp",
    rationale:
      "The script is served from the page's own host. SRI defends the page against a third party that serves the bytes; for the origin's own file there is no third party to defend against, and an attacker who can change that file can change the page too. This check produced a 14 confirmed to 37 false positive split on a single Moodle site.",
  },
  {
    name: "bare target=_blank link",
    rule: 'target="_blank" without rel on a link',
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
    expected: "possible_fp",
    rationale:
      "Chrome 88, Firefox 79 and Safari 12.1 imply noopener for target=_blank, so a bare link no longer exposes window.opener. The observation (no rel) is right and the interpretation (reverse tabnabbing) is dead in every supported browser. This was the 31 false positive row check.",
  },
  {
    name: "Laravel cookies read as a Rails framework leak",
    rule: "laravel_session, <app>_session and an XSRF-TOKEN cookie together mean Laravel",
    finding: finding({
      id: "rails-version-exposure",
      title: "Ruby on Rails framework exposed",
      category: "information-disclosure",
      severity: "low",
      evidence: "Session cookie ending in _session suggests Ruby on Rails.",
    }),
    probe: probe({
      response_headers: {
        "content-type": "text/html",
        "set-cookie": [
          "XSRF-TOKEN=eyJpdiI6; path=/; samesite=lax",
          "billing_app_session=eyJpdiI6; path=/; httponly; samesite=lax",
        ],
      },
    }),
    expected: "possible_fp",
    rationale:
      "An XSRF-TOKEN cookie next to a <app>_session cookie is the Laravel pair, not Rails. The finding guessed a framework from a name suffix and guessed wrong, so what it reports is not true of this site.",
  },
  {
    name: "XSRF-TOKEN cookie without HttpOnly",
    rule: "XSRF-TOKEN (Laravel, Angular) is readable by JavaScript on purpose",
    finding: finding({
      id: "page-cookie-missing-httponly",
      title: "Cookie set without HttpOnly",
      category: "cookies",
      severity: "medium",
      evidence: "Cookie XSRF-TOKEN is set without the HttpOnly attribute.",
    }),
    probe: probe({
      response_headers: {
        "content-type": "text/html",
        "set-cookie": ["XSRF-TOKEN=eyJpdiI6; path=/; samesite=lax"],
      },
    }),
    expected: "possible_fp",
    rationale:
      "The client has to read this cookie and echo it in a request header, so HttpOnly would break the protection it implements. The observation is right and the interpretation (session theft) does not apply to a token whose job is to be read by script.",
  },
  {
    name: "mail records reported missing on a platform subdomain",
    rule: "Does the owner control this zone?",
    finding: finding({
      id: "async-no-dkim-records-found",
      title: "No DKIM records found",
      category: "email",
      severity: "medium",
      evidence:
        "No DKIM selector records found for civilian-operations.vercel.app.",
    }),
    probe: probe({ final_url: "https://civilian-operations.vercel.app/" }),
    expected: "possible_fp",
    rationale:
      "vercel.app is Vercel's zone. The tenant cannot publish DKIM, MX or SPF there and the host does not send mail, so the DNS state is as reported and the conclusion (publish a DKIM record) is something nobody can do. The agent confirmed 71 findings of this family without looking at the name.",
  },

  // ── Findings where "uncertain" is the only honest answer ──────────────
  {
    name: "bot-challenge page as the probe",
    rule: "Never use an unusable probe to refute a finding",
    regression: true,
    finding: finding({
      id: "xcto-missing",
      title: "X-Content-Type-Options header missing",
      evidence: "No X-Content-Type-Options header found.",
    }),
    probe: probe({
      status_code: 403,
      response_headers: {
        "content-type": "text/html; charset=UTF-8",
        "cf-mitigated": "challenge",
        "x-content-type-options": "nosniff",
        "x-frame-options": "SAMEORIGIN",
      },
      body_snippet:
        "<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>Enable JavaScript and cookies to continue",
    }),
    expected: "uncertain",
    rationale:
      "The nosniff header in this probe belongs to Cloudflare's challenge page, not to the site, so 'the header IS present' (possible_fp) is wrong, and confirming is wrong too because the probe never saw the real page. A site's own page and its challenge page carry different header sets; the verifier marked seven findings false on one such host from exactly this.",
  },
  {
    name: "403 probe on a header finding",
    rule: "status_code is 401, 403, 429 or any 5xx",
    finding: finding({
      id: "hsts-missing",
      title: "Strict-Transport-Security header missing",
      evidence: "No Strict-Transport-Security header in the response.",
    }),
    probe: probe({
      status_code: 403,
      response_headers: { "content-type": "text/html", server: "cloudflare" },
      body_snippet: "<html><body><h1>Access denied</h1></body></html>",
    }),
    expected: "uncertain",
    rationale:
      "A 403 block page has no HSTS because block pages rarely send it, which says nothing about the site. Confirming would repeat the scanner's own mistake of grading a refusal; possible_fp is unavailable because the header is not there. The honest answer is that this probe cannot decide.",
  },
  {
    name: "scanner and probe disagree on the value",
    rule: "The finding quotes a header, cookie or body value and the probe shows a different one",
    finding: finding({
      id: "hsts-short-max-age",
      title: "HSTS max-age is too short",
      evidence: "Strict-Transport-Security: max-age=300",
    }),
    probe: probe({
      response_headers: {
        "content-type": "text/html",
        "strict-transport-security": "max-age=63072000; includeSubDomains",
      },
    }),
    expected: "uncertain",
    rationale:
      "The scanner saw max-age=300 and the probe sees two years. Either the site answers different clients differently or the config changed between the scan and the probe. Neither response is shown to be the real one, so neither confirming nor calling the scanner wrong is supported.",
  },
  {
    name: "proof-of-work interstitial",
    rule: "a proof-of-work or",
    finding: finding({
      id: "csp-missing",
      title: "Content-Security-Policy header missing",
      category: "code",
      evidence: "No Content-Security-Policy header in the response.",
    }),
    probe: probe({
      status_code: 200,
      response_headers: { "content-type": "text/html", server: "nginx" },
      body_snippet:
        "<html><head><title>Please wait</title></head><body><p>Checking your browser before accessing the site.</p><script>/* pow solver */ solve(4096)</script></body></html>",
    }),
    expected: "uncertain",
    rationale:
      "A 'Please wait' page with one inline script and no content is a gate, and every finding about it is a finding about the gate. The verifier may have been handed the gate while the scan saw the site, or the reverse. Not confirmable, not refutable.",
  },
  {
    name: "count-only evidence with nothing to check",
    rule: "the evidence only counts instances",
    finding: finding({
      id: "html-injection-patterns",
      title: "Possible HTML injection patterns",
      category: "content",
      severity: "medium",
      evidence: "50 elements with inline event handlers were found.",
    }),
    probe: probe(),
    expected: "uncertain",
    rationale:
      "No excerpt, a bare count, and nothing in the snippet to look at. The old rule confirmed this because the scanner had the whole document; the result was 16 confirmed and 3 false positive verdicts on the same 50 benign onerror attributes. A count you cannot inspect is not evidence either way.",
  },
];

/** The two halves, for a scorecard that reports them separately. */
export function splitByExpected(cases: VerifyEvalCase[]) {
  return {
    shouldConfirm: cases.filter((c) => c.expected === "confirmed"),
    shouldFlag: cases.filter((c) => c.expected === "possible_fp"),
    shouldDefer: cases.filter((c) => c.expected === "uncertain"),
  };
}
