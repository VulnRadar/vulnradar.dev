/**
 * Extended secrets detectors.
 *
 * Focused on credential / token / PII exposure — split out of the
 * generic "code" category so that consumers can scope scans to either
 * "is my code risky?" (code) or "is my data leaking?" (secrets-extended).
 */

import {
  redactSecret,
  stripExampleContent,
  type EvidenceFn as DetectFn,
} from "../_helpers";

/**
 * Neutralize placeholder-credential idioms before the per-provider
 * detectors below run their format regexes.
 *
 * code.ts's "hardcoded-secrets" detector filters its OWN matches against
 * this same term list, but the ~50 per-provider `secret-*` detectors in this
 * file never did: none of them called stripExampleContent, and none
 * filtered matched values at all. A `.env.example` file served raw (no HTML
 * to strip), or a README documenting a fake-but-correctly-shaped credential
 * ("STRIPE_SECRET_KEY=sk_live_YOUR_KEY_HERE", "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"),
 * would satisfy a provider's format regex and get reported as a confirmed
 * secret, several of them at "critical" severity.
 *
 * Masking works on the whole body rather than on each detector's individual
 * match: every placeholder marker below can appear adjacent to (and is
 * usually embedded inside) the credential-shaped token itself, so erasing
 * the entire contiguous identifier/token run that contains one of these
 * markers removes the value before any provider-specific regex can match
 * it, without needing to touch each detector's own extraction logic.
 *
 * perf/security: this used to be a single regex whose greedy
 * `[A-Za-z0-9_-]*` prefix wrapped the marker alternation. On a body with
 * long runs of word characters and no marker, the engine retried the run
 * from every offset, which is quadratic: measured 746ms at 20k characters,
 * 3.3s at 40k, 16.2s at 80k, 35.8s at 120k, against a body cap in the
 * megabytes. The wrapper below applies this per detector, so that cost was
 * multiplied by 74. A single unauthenticated /api/v3/demo-scan against a
 * host serving plain word characters pinned the event loop for minutes,
 * and because every timeout in the scan path is a setTimeout, nothing
 * could interrupt it.
 *
 * The scan is now linear: find each marker directly (no surrounding
 * quantifier, so no backtracking), then walk outward to the identifier
 * boundaries by hand. Same output, no catastrophic case.
 */
const PLACEHOLDER_MARKERS = /example|your_|xxxx|0000|placeholder|test_|dummy/gi;

function isIdentifierChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 95 || // _
    code === 45 // -
  );
}

function maskPlaceholderSecretsUncached(body: string): string {
  if (!body) return body;

  PLACEHOLDER_MARKERS.lastIndex = 0;
  let out = "";
  let copiedUpTo = 0;
  let match: RegExpExecArray | null;

  while ((match = PLACEHOLDER_MARKERS.exec(body)) !== null) {
    let start = match.index;
    let end = start + match[0].length;

    // Expand to the whole identifier run containing the marker.
    while (start > 0 && isIdentifierChar(body.charCodeAt(start - 1))) start--;
    while (end < body.length && isIdentifierChar(body.charCodeAt(end))) end++;

    // Overlapping runs (two markers in one identifier) collapse naturally:
    // the second match starts before copiedUpTo and contributes nothing.
    if (start >= copiedUpTo) {
      out += body.slice(copiedUpTo, start) + " ";
      copiedUpTo = end;
    } else if (end > copiedUpTo) {
      copiedUpTo = end;
    }

    // exec advances by the marker, not the expanded run: jump past the run
    // so a long identifier is not rescanned marker by marker.
    if (end > PLACEHOLDER_MARKERS.lastIndex) {
      PLACEHOLDER_MARKERS.lastIndex = end;
    }
  }

  return copiedUpTo === 0 ? body : out + body.slice(copiedUpTo);
}

/**
 * The wrapper below hands every one of the ~74 detectors the same body, so
 * without this the identical transform ran ~74 times per scan. One entry is
 * enough: the detectors run in sequence over one body, and holding a single
 * pair avoids growing memory across scans.
 */
let maskCacheInput: string | null = null;
let maskCacheOutput = "";

function maskPlaceholderSecrets(body: string): string {
  if (!body) return body;
  if (body === maskCacheInput) return maskCacheOutput;
  maskCacheInput = body;
  maskCacheOutput = maskPlaceholderSecretsUncached(body);
  return maskCacheOutput;
}

/**
 * Standard Luhn checksum. A random 16-digit run that merely starts with a
 * valid card-network prefix (4xxx, 51-55xx, 34/37xx, 6011/65xx) passes
 * roughly 1 in 10 times by chance alone -- order numbers, analytics/session
 * IDs, cache-busting hashes, and tracking parameters all produce plenty of
 * these on a real production site. Real card numbers (and the test numbers
 * payment processors publish, since those have to pass the same client-side
 * validation a real card would) are always Luhn-valid, so this alone
 * eliminates most non-card false positives without needing per-site tuning.
 */
/**
 * Email address in a page body.
 *
 * The previous form, `/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g`,
 * backtracked catastrophically. `.` and `-` are in the local-part class, so on
 * any long run of them the engine matched the entire run from EVERY starting
 * offset before failing to find an `@`: quadratic. Measured on a run of
 * `a.` pairs: 0.5s at 16k characters, 10.3s at 64k, against a body capped at
 * a megabyte. One page of dotted text was enough to pin the event loop, and
 * every timeout in the scan path is a setTimeout, so nothing could interrupt
 * it. Same failure mode, and the same reasoning, as the placeholder-masking
 * regex documented at the top of this file.
 *
 * Two changes fix it. The lookbehind means a match can only START where the
 * previous character is not itself a local-part character, so a long run is
 * attempted once instead of once per offset. And the domain is matched as
 * explicit dot-separated labels rather than one `[a-zA-Z0-9.-]+` blob, so the
 * label loop and the `\.` between labels cannot overlap. 24ms on a full 1MB
 * body, against minutes before. It is also slightly stricter, in the right
 * direction: a label now has to start and end alphanumeric, so `x@-foo.com`
 * and `x@a..com` no longer count as addresses. ref: AUDIT-002#scanner-02
 */
const EMAIL_RE =
  /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}/g;

function passesLuhnCheck(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48; // '0' === 48
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

// Test card numbers published by major payment processors for use in
// integration docs and sandboxes. These are real, Luhn-valid numbers by
// design (they have to pass the same client-side format validation a real
// card would), so passesLuhnCheck alone does not exclude them -- a payment
// processor's own docs/marketing site (the exact case that exposed this)
// would otherwise flag its own published test cards as a live leak.
const KNOWN_TEST_CARD_NUMBERS = new Set([
  "4111111111111111", // Visa (generic test)
  "4242424242424242", // Stripe
  "4000056655665556", // Stripe (Visa debit)
  "5555555555554444", // Stripe/generic Mastercard
  "5200828282828210", // Stripe (Mastercard debit)
  "378282246310005", // Amex (generic test / Stripe)
  "371449635398431", // Amex (Stripe)
  "6011111111111117", // Discover (generic test / Stripe)
  "6011000990139424", // Discover (Stripe)
  "3056930009020004", // Diners Club (Stripe)
  "36227206271667", // Diners Club (Amex-style, Stripe)
  "3566002020360505", // JCB (Stripe)
  "5500000000000004", // Mastercard (generic test)
  "6200000000000005", // UnionPay (Stripe)
]);

/**
 * Payment vocabulary that has to appear next to a card-shaped number before
 * it counts as a leak.
 *
 * Luhn is a single check digit: roughly one in ten 16-digit strings with a
 * card-network prefix passes it by chance, and card prefixes ("4", "51"-"55",
 * "34"/"37", "6011", "65") cover a large slice of the digit space. Order
 * references, tracking numbers, analytics identifiers, ISBN/EAN-shaped codes
 * and space-separated numeric tables therefore clear both the format regex
 * and Luhn regularly, and this check has never once been confirmed by a user
 * as a real finding while firing at "critical". A genuine card number in a
 * response is essentially always adjacent to payment vocabulary (a form
 * label, a field name, a receipt line), so requiring that context removes
 * the noise class without touching the leak it exists to catch.
 *
 * Deliberately excludes the weak signals "card" on its own (UI "cards" are
 * everywhere), "visa" (travel copy) and "discover" (marketing copy).
 */
const CARD_CONTEXT_RE =
  /credit[\s_-]*card|debit[\s_-]*card|card[\s_-]*(?:number|holder|no\b|num\b|nr\b)|cardnumber|\bccnum|\bcc[\s_-]*(?:number|num\b|no\b)|\bpayment|\bbilling|\bcheckout|\bcvv\b|\bcvc\b|\bexp(?:iry|iration)|\bexp[\s_-]*(?:month|year|date)|\bmastercard\b|\bamex\b|american express|\bpan\b/i;

/**
 * Shannon entropy in bits/character. Higher means the character sequence
 * is closer to uniformly random (no repeated substructure), which is the
 * shape of generated credential material as opposed to prose, identifiers,
 * or file paths.
 */
function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * 4.0 bits/char is a commonly used general-purpose entropy cutoff for
 * mixed-alphabet secret detection (e.g. the threshold family used by
 * detect-secrets and truffleHog-style scanners for base64/alphanumeric
 * charsets, as opposed to the lower ~3.0 threshold usually reserved for
 * pure hex). Natural-language and structured text (URLs, slugs, sentence
 * fragments, file paths) built from English words and repeated separators
 * overwhelmingly sits below 4.0 for 20+ character runs; random-looking
 * generated tokens in the 20-40 character range this check targets
 * routinely land at 4.3+. Set as a named constant rather than inlined so
 * the rationale stays attached to the one place it's used.
 */
const GENERIC_SECRET_MIN_ENTROPY = 4.0;

/**
 * Variable/key-name shapes a developer would use to hold a credential:
 * "token", "secret", or one of the "<vendor-word>[-_]?key" compounds.
 * Deliberately narrower than catch-all secret-name heuristics elsewhere in
 * the codebase (no bare "password"/"client") so this stays a low-noise
 * fallback for secret *shapes* nobody has written a vendor-specific
 * pattern for yet, not a second copy of an existing check. Word-bounded so
 * it matches "token"/"api_key"/"apiKey" as whole identifiers, not as a
 * substring of an unrelated longer word.
 */
const GENERIC_SECRET_ASSIGNMENT =
  /\b(token|secret|api[-_]?key|access[-_]?key|private[-_]?key|auth[-_]?key)\b\s*[:=]\s*["']([A-Za-z0-9+/=_.-]{20,200})["']/gi;

/**
 * Value shapes already owned by a dedicated vendor-specific check in this
 * file or in code.ts: every distinctive prefix from code.ts's
 * `hardcoded-secrets` pattern list, plus the prefixes the ~50 `secret-*`
 * detectors below match on. A generic entropy match whose value satisfies one
 * is skipped by `secret-generic-high-entropy-value` so the same leaked
 * value is never reported twice under two different check ids. Also
 * excludes the JWT shape, which `jwt-in-html`/`jwt-in-url` already cover.
 * Deliberately built from distinctive prefixes only (never a bare
 * fixed-length charset run) -- a bare "40 hex chars" or "40 base64 chars"
 * pattern would match nearly any value this detector's own 20-200 char
 * range captures, silently disabling it.
 */
const KNOWN_VENDOR_VALUE_FORMAT = new RegExp(
  [
    String.raw`AKIA[0-9A-Z]{16}`,
    String.raw`sk_live_[0-9a-zA-Z]{24,}`,
    String.raw`rk_live_[0-9a-zA-Z]{24,}`,
    String.raw`whsec_[0-9a-zA-Z]{24,}`,
    String.raw`sq0atp-[0-9A-Za-z_-]{22}`,
    String.raw`sq0csp-[0-9A-Za-z_-]{43}`,
    String.raw`sq0sigp-[A-Za-z0-9_-]{40,}`,
    String.raw`gh[pousr]_[0-9A-Za-z]{36,}`,
    String.raw`github_pat_[A-Za-z0-9_]{82,}`,
    String.raw`glpat-[0-9A-Za-z_-]{20,}`,
    String.raw`gldt-[A-Za-z0-9_-]{20,}`,
    String.raw`GR1348941[A-Za-z0-9_-]{20,}`,
    String.raw`ATBB[0-9A-Za-z]{32,}`,
    String.raw`xox[bpras]-[0-9]{10,}-[0-9a-zA-Z-]+`,
    String.raw`AC[0-9a-fA-F]{32}`,
    String.raw`SK[a-f0-9]{32}`,
    String.raw`SG\.[0-9A-Za-z_-]{22}\.[0-9A-Za-z_-]{43}`,
    String.raw`key-[0-9a-f]{32}`,
    String.raw`ya29\.[0-9A-Za-z_-]{68,}`,
    String.raw`sk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}`,
    String.raw`sk-proj-[A-Za-z0-9_-]{40,}`,
    String.raw`sk-ant-[A-Za-z0-9_-]{40,}`,
    String.raw`hf_[A-Za-z0-9]{34,}`,
    String.raw`r8_[A-Za-z0-9]{40}`,
    String.raw`NRAK-[A-Z0-9]{27}`,
    String.raw`NRBR-[A-Z0-9]{27}`,
    String.raw`AIzaSy[0-9A-Za-z_-]{33}`,
    String.raw`pk\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`,
    String.raw`sk\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`,
    String.raw`EAA[0-9A-Za-z]{100,}`,
    String.raw`npm_[A-Za-z0-9]{36,}`,
    String.raw`pypi-AgEIcHlwaS[A-Za-z0-9_-]{10,}`,
    String.raw`dckr_(?:pat|oat)_[A-Za-z0-9_-]{20,}`,
    String.raw`tskey-[A-Za-z0-9_-]{20,}`,
    String.raw`dop_v1_[a-f0-9]{64}`,
    String.raw`rubygems_[A-Za-z0-9_-]{20,}`,
    String.raw`oy2_[a-z0-9]{30,}`,
    String.raw`gsk_[A-Za-z0-9]{20,}`,
    String.raw`phc_[A-Za-z0-9]{40,}`,
    String.raw`pplx-[A-Za-z0-9]{40,}`,
    String.raw`re_[A-Za-z0-9_]{20,}`,
    String.raw`lin_api_[A-Za-z0-9]{40,}`,
    String.raw`ssws_[0-9A-Za-z_-]{20,}`,
    String.raw`eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]{20,})?`,
  ].join("|"),
);

const rawDetectors: Record<string, DetectFn> = {
  // ── Credit cards / SSN / phone / email ────────────────────────────────────

  "credit-card-pattern": (_url, _headers, body) => {
    const stripped = stripExampleContent(body);
    const re =
      /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g;
    const matches: string[] = [];
    for (const m of stripped.matchAll(re)) {
      const digitsOnly = m[0].replace(/[\s-]/g, "");
      if (KNOWN_TEST_CARD_NUMBERS.has(digitsOnly)) continue;
      if (!passesLuhnCheck(digitsOnly)) continue;
      const idx = m.index ?? 0;
      const end = idx + m[0].length;
      // Part of a longer run of separated digit groups (a numeric table, an
      // SVG path's coordinate list, a serialized binary blob): the \b anchors
      // are satisfied by the separator, so the format regex happily carves a
      // card-shaped window out of the middle of one.
      if (/\d[\s-]$/.test(stripped.slice(Math.max(0, idx - 8), idx))) continue;
      if (/^[\s-]\d/.test(stripped.slice(end, end + 2))) continue;
      if (
        !CARD_CONTEXT_RE.test(stripped.slice(Math.max(0, idx - 120), end + 60))
      )
        continue;
      matches.push(m[0]);
    }
    if (matches.length > 0)
      return `Found ${matches.length} credit-card-number-pattern match(es) in source.`;
    return null;
  },

  "ssn-pattern": (_url, _headers, body) => {
    const stripped = stripExampleContent(body);
    const re = /\b\d{3}-\d{2}-\d{4}\b/g;
    const matches = stripped.match(re) || [];
    if (matches.length >= 3)
      return `${matches.length} US SSN-pattern value(s) found in source.`;
    return null;
  },

  "phone-number-leak": (_url, _headers, body) => {
    const matches =
      body.match(
        /(?:\+1[-.\s]?)?\(?\d{3}\)?[.\-](?:\d{3}[.\-]\d{4})|(?:\+1[-.\s]?)?\(\d{3}\)\s?\d{3}[-.\s]\d{4}|(?:\+1[-.\s]?\d{3}[-.\s]\d{3}[-.\s]\d{4})/g,
      ) || [];
    if (matches.length > 5) {
      return `Multiple phone numbers (${matches.length}) found in page source.`;
    }
    return null;
  },

  "email-exposure": (_url, _headers, body) => {
    const emails = body.match(EMAIL_RE) || [];
    const filtered = emails.filter((e) => {
      const lower = e.toLowerCase();
      const atIndex = lower.indexOf("@");
      if (atIndex === -1) return false;
      const domain = lower.substring(atIndex + 1);
      if (
        domain.endsWith(".png") ||
        domain.endsWith(".jpg") ||
        domain.endsWith(".svg") ||
        domain.endsWith(".gif") ||
        domain.endsWith(".webp")
      )
        return false;
      const testDomains = [
        "example.com",
        "example.org",
        "test.com",
        "test.org",
        "schema.org",
        "w3.org",
        "sentry.io",
      ];
      if (testDomains.some((d) => domain === d || domain.endsWith("." + d)))
        return false;
      if (lower.includes("@2x") || lower.includes("@3x")) return false;
      return true;
    });
    const unique = [...new Set(filtered)];
    return unique.length > 0
      ? `Found ${unique.length} email address(es): ${unique.slice(0, 3).join(", ")}`
      : null;
  },

  // "email-address-leak" removed: threshold has no security basis and the check overlaps email-exposure.
  // "private-ip-exposure" removed: dead code — no JSON entry; "internal-ip-exposed" (content.json) covers this.
  // "email-exposure" removed: dead code — no JSON entry; removed intentionally for high FP rate.
  // "connection-string-exposed" removed: dead code — covered by hardcoded-secrets patterns.
  // "private-key-in-source" removed: dead code — covered by secret-private-key-pem.

  "internal-ip-exposed": (_url, _headers, body) => {
    const stripped = stripExampleContent(body);
    const patterns = [
      /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
      /\b192\.168\.\d{1,3}\.\d{1,3}\b/,
      /\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/,
      /\b127\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
      /\b169\.254\.\d{1,3}\.\d{1,3}\b/,
      /\b0\.0\.0\.0\b/,
    ];
    for (const p of patterns) {
      if (p.test(stripped)) return "Internal/private IP address found in body.";
    }
    return null;
  },

  // ── Cloud creds / service-account / connection strings ──────────────────

  "firebase-config-exposed": (_url, _headers, body) => {
    // firebase.initializeApp(...) and a `firebaseConfig` variable name used
    // to be part of this check, but they're mandatory boilerplate on every
    // Firebase web app and carry no secret material by themselves -- per
    // Firebase's own docs the client config (including apiKey) is meant to
    // be public, gated by Security Rules rather than by hiding this call.
    // Only an actual inline key literal is a real signal.
    if (/apiKey\s*:\s*["']AIza[0-9A-Za-z_\-]{35}["']/.test(body))
      return "Firebase configuration pattern detected in source.";
    return null;
  },

  "s3-bucket-exposed": (_url, _headers, body) => {
    // A bare bucket.s3.amazonaws.com URL is ordinary, deliberate static-
    // asset hosting (logos, downloads, images), not a misconfiguration --
    // only flag it when the object path itself suggests sensitive content,
    // mirroring aws-metadata-reference's context check below.
    // "config" and "private" used to be in this list as bare substrings and
    // were the noise: /assets/config.json is an ordinary public front-end
    // config, and "private" matches inside privacy-policy.pdf, private-beta,
    // reconfigure, configurator. The tokens below are ones that only appear
    // on an object nobody meant to publish, and each has to be a whole path
    // segment or a real file extension rather than a substring.
    const sensitivePath =
      /(?:^|[/_.-])(?:backups?|dumps?|db[_-]?dumps?|credentials?|secrets?|id_rsa|private[_-]?keys?)(?:$|[/_.-])|\.(?:env|sql|bak|dump|pem|key|p12|pfx|kdbx)(?:$|[?#.])/i;
    const re =
      /https?:\/\/[\w.-]+\.s3(?:\.[\w-]+)?\.amazonaws\.com(\/[^\s"'<>]*)?/gi;
    const matches = [...body.matchAll(re)].filter((m) =>
      sensitivePath.test(m[1] || ""),
    );
    if (matches.length > 0)
      return `Found ${matches.length} AWS S3 bucket URL reference(s) with a sensitive path segment in source.`;
    return null;
  },

  "aws-metadata-reference": (_url, _headers, body) => {
    const patterns = [
      /169\.254\.169\.254/,
      /latest\/meta-data/i,
      /\/metadata\/instance/i,
    ];
    for (const p of patterns) {
      const m = body.match(p);
      if (m) {
        const idx = body.indexOf(m[0]);
        const before = body.slice(Math.max(0, idx - 200), idx).toLowerCase();
        if (/<code|<pre|```|example|documentation/i.test(before)) continue;
        return "AWS metadata endpoint reference detected.";
      }
    }
    // Removed: fallback that fired for every api.* URL regardless of content.
    return null;
  },

  "base64-credentials": (_url, _headers, body) => {
    const re =
      /(?:Authorization|Proxy-Authorization)\s*:\s*Basic\s+([A-Za-z0-9+/=]{8,})/i;
    const matches = body.match(re) || [];
    if (matches.length > 0)
      return `Found ${matches.length} Basic Authorization header(s) with Base64 credential in source.`;
    // Removed: fallback that fired for every api.* URL regardless of content.
    return null;
  },

  "connection-string-exposed": (_url, _headers, body) => {
    const patterns = [
      /(?:mongodb|postgres|mysql|redis):\/\/[^\s"']+:[^\s"']+@[^\s"']+/i,
      /Server=[\w.-]+;.*Password=[^;]+/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) return "Database connection string pattern detected.";
    }
    // Removed: fallback that fired for every api.* URL regardless of content.
    return null;
  },

  // ── JWT / tokens / private keys ──────────────────────────────────────────

  "jwt-in-html": (_url, _headers, body) => {
    if (
      /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(
        body,
      )
    ) {
      return "JWT token found embedded in HTML page source.";
    }
    return null;
  },

  "jwt-in-url": (_url, _headers, body) => {
    const jwtUrls =
      body.match(
        /(?:href|src|action|url)\s*=\s*["'][^"']*(?:\?|&)(?:token|jwt|access_token|auth)=eyJ[A-Za-z0-9_-]+/gi,
      ) || [];
    return jwtUrls.length > 0
      ? `Found ${jwtUrls.length} URL(s) containing JWT tokens.`
      : null;
  },

  "token-exposure": (_url, _headers, body) => {
    const sessions =
      body.match(
        /(?:PHPSESSID|JSESSIONID|ASP\.NET_SessionId)\s*=\s*[a-f0-9]{16,}/gi,
      ) || [];
    return sessions.length > 0
      ? `Session ID(s) exposed in source: ${sessions.length} found`
      : null;
  },

  "private-key-in-source": (_url, _headers, body) => {
    if (
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/.test(body)
    ) {
      return "Private key material detected in source.";
    }
    // Removed: fallback that fired for every api.* URL regardless of content.
    return null;
  },

  // "hardcoded-secrets" used to have a second, full implementation here, a
  // copy of the one in code.ts. It was dead: the definition lives in
  // checks-data/code.json with category "code", and registry.ts resolves a
  // detector from the bundle that owns the definition's category, so code.ts's
  // copy has always been the one that runs. Worse, this copy still carried the
  // Google API Key pattern (AIzaSy*) that code.ts deliberately removed, because
  // google-api-key-exposed and secret-google-maps-api-key already report the
  // same evidence and the triple count was pushing an ordinary site to
  // "critical". Every pattern it held is covered by code.ts's live list or by a
  // secret-* detector below, so nothing was folded back in. ref: AUDIT-009#dup-06

  // ── Generic entropy-based secret detection ──────────────────────────────
  // Fallback for credential *shapes* that don't match any of the ~50
  // vendor-specific formats below: a variable/key name that reads like a
  // secret holder, assigned a long, high-entropy quoted value. See the
  // detector's own comment for the entropy threshold and the double-count
  // guard against the vendor-specific checks in this same file.

  "secret-generic-high-entropy-value": (_url, _headers, body) => {
    if (!body) return null;
    const found: { name: string; value: string }[] = [];
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    GENERIC_SECRET_ASSIGNMENT.lastIndex = 0;
    while ((m = GENERIC_SECRET_ASSIGNMENT.exec(body))) {
      const [, name, value] = m;
      // Already owned by a dedicated vendor-specific check in this file
      // (hardcoded-secrets or one of the secret-* detectors below) --
      // skip so the same leaked value isn't reported twice under two ids.
      if (KNOWN_VENDOR_VALUE_FORMAT.test(value)) continue;
      if (shannonEntropy(value) < GENERIC_SECRET_MIN_ENTROPY) continue;
      const key = `${name.toLowerCase()}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ name, value });
      if (found.length >= 5) break;
    }
    if (found.length === 0) return null;
    const redacted = found
      .map((f) => `${f.name}: ${redactSecret(f.value)}`)
      .join(", ");
    return `Found ${found.length} high-entropy value(s) assigned to a secret-shaped variable name that does not match a known vendor token format and may be an unrecognized credential (verify manually): ${redacted}`;
  },

  // ── Per-pattern secret detectors (one per JSON entry) ──────────────
  // Each detector scans the response body for a specific provider's
  // credential format and returns a short evidence string when it
  // matches. The registry's coverage test enforces that every JSON
  // entry has an inline detector; the tests below keep that contract.

  "secret-stripe-webhook-endpoint": (_url, _headers, body) => {
    if (!body) return null;
    if (/whsec_[0-9a-zA-Z]{24,}/.test(body)) {
      return "Response contains Stripe webhook signing secret (whsec_*).";
    }
    return null;
  },

  "secret-google-maps-api-key": (_url, _headers, body) => {
    if (!body) return null;
    // AIzaSy* is the shared prefix for every Google Cloud/Firebase API key
    // product, not Maps-specific; require nearby Maps context, mirroring
    // secret-firebase-api-key-public's "firebase" context requirement.
    const m = body.match(/AIzaSy[0-9A-Za-z_-]{33}/);
    if (m) {
      const idx = body.indexOf(m[0]);
      const ctx = body
        .substring(Math.max(0, idx - 200), idx + 200)
        .toLowerCase();
      if (
        ctx.includes("maps.googleapis.com") ||
        ctx.includes("google.maps.") ||
        ctx.includes("maps/api/js")
      ) {
        return "Response contains Google Maps / API key (AIzaSy*).";
      }
    }
    return null;
  },

  "secret-google-oauth-client-secret": (_url, _headers, body) => {
    if (!body) return null;
    // Require "google" context: bare "client_secret" is a standard OAuth2
    // field name that fires on every provider (Spotify, GitLab, a generic
    // OIDC client), same fix already applied to secret-auth0-client-secret.
    if (/google[_\-]?client_secret[\s"'=:]+[A-Za-z0-9_-]{20,}/i.test(body)) {
      return "Response contains a Google OAuth client_secret.";
    }
    return null;
  },

  "secret-firebase-api-key-public": (_url, _headers, body) => {
    if (!body) return null;
    if (/firebase[\s\S]{0,200}?AIzaSy[0-9A-Za-z_-]{33}/i.test(body)) {
      return "Response contains a Firebase Web API key (AIzaSy*).";
    }
    return null;
  },

  "secret-aws-secret-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:aws_?secret_access_key|AKIA[0-9A-Z]{16})[\s\S]{0,200}?[A-Za-z0-9/+=]{40}/.test(
        body,
      )
    ) {
      return "Response contains an AWS Secret Access Key near an AKIA pair.";
    }
    return null;
  },

  // "secret-github-personal-access-token" removed: always returned null; secret-github-pat covers this.

  "secret-github-pat": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /gh[pousr]_[0-9A-Za-z]{36,}/.test(body) ||
      /github_pat_[A-Za-z0-9_]{82,}/.test(body)
    ) {
      return "GitHub personal access token detected in response body.";
    }
    return null;
  },

  "secret-npm-token": (_url, _headers, body) => {
    if (!body) return null;
    if (/npm_[A-Za-z0-9]{36,}/.test(body)) {
      return "Response contains an npm auth token (npm_*).";
    }
    return null;
  },

  "secret-pypi-token": (_url, _headers, body) => {
    if (!body) return null;
    if (/pypi-AgEIcHlwaS[A-Za-z0-9_-]{10,}/.test(body)) {
      return "Response contains a PyPI upload token (pypi-AgEIcHlwaS*).";
    }
    return null;
  },

  "secret-docker-hub-token": (_url, _headers, body) => {
    if (!body) return null;
    if (/dckr_(?:pat|oat)_[A-Za-z0-9_-]{20,}/.test(body)) {
      return "Response contains a Docker Hub access token (dckr_pat_*/dckr_oat_*).";
    }
    return null;
  },

  "secret-cloudflare-api-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /cloudflare[_\-]?(?:api[_\-]?key|api[_\-]?token)[\s"'=:]+[a-f0-9]{37,40}/i.test(
        body,
      )
    ) {
      return "Response contains a Cloudflare API key/token (40-char hex).";
    }
    return null;
  },

  "secret-tailscale-key": (_url, _headers, body) => {
    if (!body) return null;
    if (/tskey-[A-Za-z0-9_-]{20,}/.test(body)) {
      return "Response contains a Tailscale auth key (tskey-*).";
    }
    return null;
  },

  "secret-algolia-admin-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /algolia[_\-]?(?:admin|api)[_\-]?key[\s"'=:]+[A-Za-z0-9]{32,}/i.test(body)
    ) {
      return "Response contains an Algolia admin/search API key.";
    }
    return null;
  },

  "secret-mapbox-secret-token": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:mapbox[_\-]?(?:secret|token)[\s"'=:]+sk\.[A-Za-z0-9_.\-]{20,}|sk\.eyJ[A-Za-z0-9_.\-]+)/i.test(
        body,
      )
    ) {
      return "Response contains a Mapbox secret token (sk.*).";
    }
    return null;
  },

  "secret-pagerduty-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /pagerduty[_\-]?(?:api[_\-]?key|rest[_\-]?key)[\s"'=:]+[A-Za-z0-9_\-+]{16,}/i.test(
        body,
      )
    ) {
      return "Response contains a PagerDuty REST API key.";
    }
    return null;
  },

  "secret-twilio-account-sid": (_url, _headers, body) => {
    if (!body) return null;
    // AC[32hex] is insufficiently specific alone; require twilio context within 200 chars
    const m = body.match(/AC[a-f0-9]{32}/);
    if (m) {
      const idx = body.indexOf(m[0]);
      const ctx = body
        .substring(Math.max(0, idx - 100), idx + 134)
        .toLowerCase();
      if (
        ctx.includes("twilio") ||
        ctx.includes("account_sid") ||
        ctx.includes("accountsid")
      ) {
        return "Response contains a Twilio Account SID (AC*).";
      }
    }
    return null;
  },

  "secret-datadog-api-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:datadog[_\-]?(?:api[_\-]?key|app[_\-]?key))[\s"'=:]+[a-f0-9]{32,}/i.test(
        body,
      )
    ) {
      return "Response contains a Datadog API key.";
    }
    return null;
  },

  "secret-huggingface-write-token": (_url, _headers, body) => {
    if (!body) return null;
    if (/hf_[A-Za-z0-9]{34,}/.test(body)) {
      return "Response contains a HuggingFace write token (hf_*).";
    }
    return null;
  },

  "secret-pinecone-api-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:pinecone|pcsk)[_\-]?(?:api[_\-]?)?key[\s"'=:]+[A-Za-z0-9_\-]{40,}/i.test(
        body,
      )
    ) {
      return "Response contains a Pinecone API key.";
    }
    return null;
  },

  "secret-supabase-service-role": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /service_role[\s\S]{0,80}?eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(
        body,
      )
    ) {
      return "Response contains a Supabase service_role JWT.";
    }
    return null;
  },

  "secret-supabase-anon-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:supabase[_\-]?anon[_\-]?key|anon[\s"'=:]+eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/i.test(
        body,
      )
    ) {
      return "Response contains a Supabase anon JWT.";
    }
    return null;
  },

  "secret-aws-access-key-id": (_url, _headers, body) => {
    if (!body) return null;
    if (/AKIA[0-9A-Z]{16}/.test(body)) {
      return "Response contains AWS Access Key ID.";
    }
    return null;
  },

  "secret-private-key-pem": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/.test(body)
    ) {
      return "Response contains a PEM private key block.";
    }
    return null;
  },

  // "secret-jwt-in-config" removed: exact duplicate of "jwt-in-html" (same regex, same finding).

  "secret-oracle-cloud-credentials": (_url, _headers, body) => {
    if (!body) return null;
    // A bare OCID is a non-sensitive resource identifier (Oracle documents
    // it as safe to share, like an AWS ARN); require actual API signing
    // key material nearby before treating it as a credential leak.
    const m = body.match(/ocid1\.[a-z]+\.[a-z0-9]+\.[a-z0-9]{20,}/);
    if (m) {
      const idx = body.indexOf(m[0]);
      const ctx = body.substring(Math.max(0, idx - 300), idx + 300);
      if (
        /-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(ctx) ||
        /\bfingerprint\s*[:=]/i.test(ctx) ||
        /\bprivate_key\s*[:=]/i.test(ctx)
      ) {
        return "Response contains an Oracle Cloud (OCI) OCID alongside API signing key material.";
      }
    }
    return null;
  },

  "secret-ibm-cloud-iam-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:ibm[_\-]?cloud[_\-]?(?:iam[_\-]?)?api[_\-]?key[\s"'=:]+[A-Za-z0-9]{20,}|IBM-[A-Za-z0-9_-]{20,}|bx-[A-Za-z0-9]{40,})/i.test(
        body,
      )
    ) {
      return "Response contains an IBM Cloud IAM API key.";
    }
    return null;
  },

  "secret-digitalocean-pat": (_url, _headers, body) => {
    if (!body) return null;
    if (/dop_v1_[a-f0-9]{64}/.test(body)) {
      return "Response contains a DigitalOcean personal access token (dop_v1_*).";
    }
    return null;
  },

  "secret-linode-api-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:linode[_\-]?(?:api[_\-]?)?(?:key|token))[\s"'=:]+[a-f0-9]{64}/i.test(
        body,
      )
    ) {
      return "Response contains a Linode API token (64-char hex).";
    }
    return null;
  },

  "secret-vultr-api-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:vultr[_\-]?(?:api[_\-]?)?(?:key|token))[\s"'=:]+[A-Za-z0-9]{20,}/i.test(
        body,
      )
    ) {
      return "Response contains a Vultr API key.";
    }
    return null;
  },

  "secret-rubygems-api-key": (_url, _headers, body) => {
    if (!body) return null;
    if (/rubygems_[A-Za-z0-9_-]{20,}/.test(body)) {
      return "Response contains a RubyGems API key (rubygems_*).";
    }
    return null;
  },

  "secret-nuget-api-key": (_url, _headers, body) => {
    if (!body) return null;
    if (/oy2_[a-z0-9]{30,}/.test(body)) {
      return "Response contains a NuGet API key (oy2_*).";
    }
    return null;
  },

  "secret-jfrog-api-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:jfrog|artifactory)[_\-]?(?:api[_\-]?)?(?:key|token)[\s"'=:]+[A-Za-z0-9_\-+/=]{20,}/i.test(
        body,
      )
    ) {
      return "Response contains a JFrog Artifactory API key/token.";
    }
    return null;
  },

  "secret-newrelic-browser-key": (_url, _headers, body) => {
    if (!body) return null;
    if (/NRBR-[A-Z0-9]{27}/.test(body)) {
      return "Response contains a New Relic browser license key (NRBR-*).";
    }
    return null;
  },

  "secret-honeycomb-write-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:honeycomb|hcaak)[_\-]?(?:write[_\-]?)?(?:api[_\-]?)?(?:key|token)[\s"'=:]+[A-Za-z0-9]{20,}/i.test(
        body,
      )
    ) {
      return "Response contains a Honeycomb events API key.";
    }
    return null;
  },

  "secret-datadog-client-token": (_url, _headers, body) => {
    if (!body) return null;
    if (/pub_[a-f0-9]{32,}/.test(body)) {
      return "Response contains a Datadog client token (pub_*).";
    }
    return null;
  },

  "secret-gitlab-deploy-token": (_url, _headers, body) => {
    if (!body) return null;
    if (/gldt-[A-Za-z0-9_-]{20,}/.test(body)) {
      return "Response contains a GitLab deploy token (gldt-*).";
    }
    return null;
  },

  "secret-gitlab-runner-registration": (_url, _headers, body) => {
    if (!body) return null;
    if (/GR1348941[A-Za-z0-9_-]{20,}/.test(body)) {
      return "Response contains a GitLab runner registration token (GR1348941*).";
    }
    return null;
  },

  "secret-bitbucket-app-password": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:bitbucket[_\-]?(?:app[_\-]?)?(?:password|token))[\s"'=:]+[A-Za-z0-9]{16,}/i.test(
        body,
      )
    ) {
      return "Response contains a Bitbucket app password/token.";
    }
    return null;
  },

  "secret-paypal-client-secret": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:paypal[_\-]?(?:client[_\-]?)?(?:secret|key))[\s"'=:]+[A-Za-z0-9_-]{20,}/i.test(
        body,
      )
    ) {
      return "Response contains a PayPal OAuth client secret.";
    }
    return null;
  },

  "secret-braintree-token": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:braintree[_\-]?(?:access[_\-]?)?(?:token|key))[\s"'=:]+[A-Za-z0-9]{16,}/i.test(
        body,
      )
    ) {
      return "Response contains a Braintree API access token.";
    }
    return null;
  },

  "secret-square-webhook-signature": (_url, _headers, body) => {
    if (!body) return null;
    if (/sq0sigp-[A-Za-z0-9_-]{40,}/.test(body)) {
      return "Response contains a Square webhook signature key (sq0sigp-*).";
    }
    return null;
  },

  "secret-twilio-api-key-sk": (_url, _headers, body) => {
    if (!body) return null;
    // SK[32hex] is insufficiently specific alone; require twilio context within 200 chars
    const m = body.match(/SK[a-f0-9]{32}/);
    if (m) {
      const idx = body.indexOf(m[0]);
      const ctx = body
        .substring(Math.max(0, idx - 100), idx + 134)
        .toLowerCase();
      if (
        ctx.includes("twilio") ||
        ctx.includes("api_key") ||
        ctx.includes("auth_token")
      ) {
        return "Response contains a Twilio API key SID (SK*).";
      }
    }
    return null;
  },

  "secret-messagebird-access-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /messagebird[_\-]?(?:access[_\-]?)?(?:key|token)[\s"'=:]+[A-Za-z0-9_-]{20,}/i.test(
        body,
      )
    ) {
      return "Response contains a MessageBird access key.";
    }
    return null;
  },

  "secret-vonage-nexmo-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:vonage|nexmo)[_\-]?(?:api[_\-]?)?(?:key|secret)[\s"'=:]+[A-Za-z0-9_-]{8,}/i.test(
        body,
      )
    ) {
      return "Response contains a Vonage / Nexmo API key/secret pair.";
    }
    return null;
  },

  "secret-replicate-api-token": (_url, _headers, body) => {
    if (!body) return null;
    if (/r8_[A-Za-z0-9]{40}/.test(body)) {
      return "Response contains a Replicate API token (r8_*).";
    }
    return null;
  },

  "secret-cohere-api-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:cohere[_\-]?(?:api[_\-]?)?(?:key|token))[\s"'=:]+[A-Za-z0-9_-]{30,}/i.test(
        body,
      )
    ) {
      return "Response contains a Cohere API key.";
    }
    return null;
  },

  "secret-mistral-api-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:mistral[_\-]?(?:api[_\-]?)?(?:key|token))[\s"'=:]+[A-Za-z0-9_-]{30,}/i.test(
        body,
      )
    ) {
      return "Response contains a Mistral AI API key.";
    }
    return null;
  },

  "secret-groq-api-key": (_url, _headers, body) => {
    if (!body) return null;
    if (/gsk_[A-Za-z0-9]{20,}/.test(body)) {
      return "Response contains a Groq API key (gsk_*).";
    }
    return null;
  },

  "secret-meilisearch-master-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:meilisearch|meili)[_\-]?(?:master[_\-]?)?(?:key|token)[\s"'=:]+[A-Za-z0-9_-]{32,}/i.test(
        body,
      )
    ) {
      return "Response contains a Meilisearch master/admin key.";
    }
    return null;
  },

  "secret-typesense-admin-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:typesense[_\-]?(?:admin[_\-]?)?(?:key|token))[\s"'=:]+[A-Za-z0-9]{32,}/i.test(
        body,
      )
    ) {
      return "Response contains a Typesense admin API key.";
    }
    return null;
  },

  "secret-planetscale-password": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:planetscale|pscale)[_\-]?(?:password|service[_\-]?token|api[_\-]?key)[\s"'=:]+[A-Za-z0-9_\-:.@]{20,}/i.test(
        body,
      )
    ) {
      return "Response contains a PlanetScale database password/service token.";
    }
    return null;
  },

  "secret-auth0-client-secret": (_url, _headers, body) => {
    if (!body) return null;
    // Require auth0 context AND an assigned value — bare "client_secret" fires
    // on every OAuth app (Google, GitHub, etc.), and without requiring a value
    // this also fired on prose that merely names the config key (e.g. a docs
    // page telling a reader to set AUTH0_CLIENT_SECRET) with no secret present.
    if (
      /auth0[_\-]?client[_\-]?secret[\s"'=:]+[A-Za-z0-9_-]{16,}/i.test(body)
    ) {
      return "Response contains an Auth0 client secret.";
    }
    return null;
  },

  "secret-okta-api-token": (_url, _headers, body) => {
    if (!body) return null;
    if (/ssws_[0-9A-Za-z_-]{20,}/.test(body)) {
      return "Response contains an Okta SSWS API token.";
    }
    return null;
  },

  "secret-keycloak-realm-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /keycloak[\s\S]{0,200}?(?:-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|\bMI[E][A-Za-z0-9+/=]{40,}\b)/i.test(
        body,
      )
    ) {
      return "Response contains a Keycloak realm signing private key.";
    }
    return null;
  },

  "secret-cloudflare-r2-access-key": (_url, _headers, body) => {
    if (!body) return null;
    // r2.cloudflarestorage.com is the S3-compatible endpoint unique to R2;
    // a bare 32/64-char hex string is otherwise indistinguishable from any
    // other identifier, so require both the endpoint and a labeled secret
    // key assignment nearby, mirroring secret-aws-secret-key's AKIA pairing.
    // Left-anchored: without it the leading class is retried from every
    // offset of a long run, which is quadratic. ref: AUDIT-012#inj-03
    const endpointRe = /(?<![a-z0-9-])[a-z0-9-]+\.r2\.cloudflarestorage\.com/i;
    const m = endpointRe.exec(body);
    if (m) {
      const idx = m.index;
      const window = body.substring(
        Math.max(0, idx - 300),
        idx + m[0].length + 300,
      );
      if (
        /(?:r2[_-]?secret[_-]?access[_-]?key|secretAccessKey|aws_secret_access_key)[\s"'=:]+[A-Za-z0-9+/]{32,}/i.test(
          window,
        )
      ) {
        return "Response contains a Cloudflare R2 secret access key near an r2.cloudflarestorage.com endpoint.";
      }
    }
    return null;
  },

  "secret-sentry-dsn-public": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /https:\/\/[0-9a-f]{32}@[a-z0-9.-]+\.ingest\.(?:[a-z0-9-]+\.)?sentry\.io\/\d+/i.test(
        body,
      )
    ) {
      return "Response contains a Sentry DSN with an embedded public key.";
    }
    return null;
  },

  "secret-posthog-project-api-key": (_url, _headers, body) => {
    if (!body) return null;
    if (/phc_[A-Za-z0-9]{40,}/.test(body)) {
      return "Response contains a PostHog project API key (phc_*).";
    }
    return null;
  },

  "secret-perplexity-api-key": (_url, _headers, body) => {
    if (!body) return null;
    if (/pplx-[A-Za-z0-9]{40,}/.test(body)) {
      return "Response contains a Perplexity API key (pplx-*).";
    }
    return null;
  },

  "secret-resend-api-key": (_url, _headers, body) => {
    if (!body) return null;
    // "re_" alone is too short a prefix to trust in isolation; require
    // "resend" context nearby (e.g. the RESEND_API_KEY env var name, an
    // Authorization header, or an npm import) before treating it as a hit.
    const m = body.match(/\bre_[A-Za-z0-9_]{20,}\b/);
    if (m) {
      const idx = body.indexOf(m[0]);
      const ctx = body
        .substring(Math.max(0, idx - 150), idx + 150)
        .toLowerCase();
      if (ctx.includes("resend")) {
        return "Response contains a Resend API key (re_*).";
      }
    }
    return null;
  },

  "secret-linear-api-key": (_url, _headers, body) => {
    if (!body) return null;
    if (/lin_api_[A-Za-z0-9]{40,}/.test(body)) {
      return "Response contains a Linear personal API key (lin_api_*).";
    }
    return null;
  },
};

// Every detector above receives the body already run through
// stripExampleContent (so a docs page rendering a fake credential inside
// <script>/<code>/<pre> as literal text doesn't self-trigger, matching the
// existing precedent set by the "hardcoded-secrets" detector) and
// maskPlaceholderSecrets (so a placeholder-shaped value -- in a .env.example
// served raw, a README, or anywhere else in the page -- can no longer
// satisfy a provider's format regex). See maskPlaceholderSecrets' doc
// comment above for why this runs as a single body-level pass rather than
// per-detector match filtering.
export const detectors: Record<string, DetectFn> = Object.fromEntries(
  Object.entries(rawDetectors).map(([id, fn]) => [
    id,
    ((url, headers, body) =>
      fn(
        url,
        headers,
        maskPlaceholderSecrets(stripExampleContent(body)),
      )) as DetectFn,
  ]),
);
