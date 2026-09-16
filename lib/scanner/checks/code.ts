/**
 * Code / SAST-style detectors.
 *
 * Pure regex-based detection of dangerous code patterns in inline
 * JavaScript, server-rendered HTML, and embedded source. Real SAST
 * requires AST parsing; this is a fast pre-filter that catches the
 * common sinks. Lives in its own category so the docs page can
 * present it as "code testing" instead of lumping it into headers.
 */

import {
  getEffectiveCsp,
  getSetCookies,
  isDemonstratedExample,
  withDocBlocksStripped,
  withProseStripped,
  type EvidenceFn as DetectFn,
  extractScriptContents,
} from "../_helpers";
import { openTags, hasTagWith } from "./_tag-scan";

/**
 * The leading run of `text` up to the first line terminator, matching what a
 * regex `.` (which never crosses a line break without the `s` flag) would have
 * been able to span. Used where a wildcard gap had to be replaced by an
 * explicit bounded window, so the window keeps the old single-line scope.
 */
function splitAtLineBreak(text: string): string {
  const end = text.search(/[\n\r]/);
  return end === -1 ? text : text.slice(0, end);
}

/**
 * The authored inline script on the page, as one string.
 *
 * This used to carry its own copy of the RSC-and-Cloudflare filter, which is
 * why every other module that wanted inline script kept reading Next.js flight
 * payloads as source: the fix lived here and nowhere else. It is in
 * extractScriptContents now, so there is one walk and one filter.
 */
function inlineScriptContent(body: string): string {
  return extractScriptContents(body).join("\n");
}

// ── Hardcoded-secrets pattern tiers ─────────────────────────────────────
//
// Shared by the four "hardcoded-secrets*" detectors below. Split out so
// each severity tier is a plain, reviewable list rather than one flat
// array that forces every match to the same severity regardless of
// whether the credential format was ever meant to be secret.

interface SecretPattern {
  name: string;
  pattern: RegExp;
  /** When set, a match only counts if this keyword appears within ~100
   *  chars of it. For patterns that are just a fixed-length hex/alphanumeric
   *  shape (no vendor-specific charset like "sk_" or "AKIA" to anchor on),
   *  format alone collides with unrelated tokens often enough on a large
   *  enough page (seen live: a Twilio Account SID pattern matching inside
   *  google.com's minified bundle). */
  requireNearby?: RegExp;
}

// No legitimate reason to appear in client-visible source: compromise
// means full account, database, or infrastructure access.
const CRITICAL_SECRET_PATTERNS: SecretPattern[] = [
  { name: "AWS Access Key", pattern: /AKIA[0-9A-Z]{16}/g },
  {
    name: "Azure Storage Key",
    pattern:
      /DefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=[A-Za-z0-9+/=]{86,88}/g,
  },
  {
    name: "GCP Service Account",
    pattern: /"type"\s*:\s*"service_account"/g,
  },
  { name: "Stripe Secret Key", pattern: /sk_live_[0-9a-zA-Z]{24,}/g },
  { name: "Stripe Restricted Key", pattern: /rk_live_[0-9a-zA-Z]{24,}/g },
  { name: "Stripe Webhook Secret", pattern: /whsec_[0-9a-zA-Z]{24,}/g },
  // Square has no "publishable" token tier like Stripe's pk_live_ — both
  // sq0atp- (OAuth access token) and sq0csp- (OAuth client secret) are
  // server-side credentials per Square's own docs, so both stay critical.
  { name: "Square Access Token", pattern: /sq0atp-[0-9A-Za-z_-]{22}/g },
  { name: "Square OAuth Secret", pattern: /sq0csp-[0-9A-Za-z_-]{43}/g },
  { name: "GitHub Token", pattern: /gh[pousr]_[0-9A-Za-z]{36,}/g },
  { name: "GitHub OAuth", pattern: /gho_[0-9A-Za-z]{36,}/g },
  { name: "GitLab Token", pattern: /glpat-[0-9A-Za-z_-]{20,}/g },
  { name: "Bitbucket Token", pattern: /ATBB[0-9A-Za-z]{32,}/g },
  { name: "Slack Token", pattern: /xox[bpras]-[0-9]{10,}-[0-9a-zA-Z-]+/g },
  {
    name: "Slack Webhook",
    pattern:
      /hooks\.slack\.com\/services\/T[0-9A-Z]{8,}\/B[0-9A-Z]{8,}\/[0-9A-Za-z]{24}/g,
  },
  {
    name: "Discord Bot Token",
    // (?<![A-Za-z\d]) left-anchors the token to the start of an alphanumeric
    // run. Without it every M or N inside a long unbroken run was a candidate
    // start, and the unbounded [A-Za-z\d]{23,} then scanned that whole run and
    // backtracked looking for a '.' that never comes: quadratic, measured at
    // 4x the cost for 2x the input on a body of repeated AKIA-shaped text. A
    // real token always starts after a quote, space, or delimiter, so no
    // genuine match is lost. Same fix as the three detectors named in
    // tests/lib/scanner/_perf-budget.test.ts.
    pattern: /(?<![A-Za-z\d])[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{38,}/g,
  },
  // Bare SID, no adjacent auth token match — genuinely low-value on its
  // own, but kept critical per explicit product guidance: a leaked SID is
  // still an account identifier worth treating cautiously by default.
  // Quote-delimited (see the lookaround) because the un-anchored shape --
  // literal "AC" + 32 hex chars -- matches anywhere inside an unrelated
  // 32+ hex-char blob (an MD5-based cache-busting hash, a tracking ID) on
  // a completely unrelated page; a real embedded SID is a JS string
  // literal, so it is always quoted.
  {
    name: "Twilio Account SID",
    pattern: /(?<=["'])AC[0-9a-fA-F]{32}(?=["'])/g,
    requireNearby: /twilio/i,
  },
  {
    name: "SendGrid Key",
    pattern: /SG\.[0-9A-Za-z_-]{22}\.[0-9A-Za-z_-]{43}/g,
  },
  // Same MD5-shaped false-collision risk as the Twilio SID above ("key-" +
  // 32 hex chars matches inside an unrelated hash), same quote-boundary fix.
  { name: "Mailgun Key", pattern: /(?<=["'])key-[0-9a-f]{32}(?=["'])/g },
  {
    name: "MongoDB URI",
    pattern: /mongodb(?:\+srv)?:\/\/[^:]+:[^\s@"'<>]+@[^\s"'<>]{5,}/g,
  },
  {
    name: "PostgreSQL URI",
    pattern: /postgres(?:ql)?:\/\/[^:]+:[^\s@"'<>]+@[^\s"'<>]{5,}/g,
  },
  { name: "MySQL URI", pattern: /mysql:\/\/[^:]+:[^\s@"'<>]+@[^\s"'<>]{5,}/g },
  {
    name: "Redis URI",
    pattern: /rediss?:\/\/[^:]+:[^\s@"'<>]+@[^\s"'<>]{5,}/g,
  },
  { name: "OAuth Token", pattern: /ya29\.[0-9A-Za-z_-]{68,}/g },
  {
    name: "OpenAI Key",
    pattern: /sk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}/g,
  },
  { name: "OpenAI Project Key", pattern: /sk-proj-[A-Za-z0-9_-]{40,}/g },
  { name: "Anthropic Key", pattern: /sk-ant-[A-Za-z0-9_-]{40,}/g },
  // NRAK- is the New Relic full account/user API key (manage alerts,
  // users, query data via NerdGraph) — not to be confused with the
  // NRBR- browser monitoring key, which vendors embed client-side by
  // design (secret-newrelic-browser-key, medium, is the check for that).
  { name: "New Relic Key", pattern: /NRAK-[A-Z0-9]{27}/g },
  // Quote-delimited for the same reason as the Twilio SID above: unanchored,
  // this matches anywhere inside an unrelated long alphanumeric blob (a
  // base64 asset, a tracking payload) that happens to contain "EAA".
  {
    name: "Facebook Token",
    pattern: /(?<=["'])EAA[0-9A-Za-z]{100,}(?=["'])/g,
  },
  { name: "RSA Private Key", pattern: /-----BEGIN RSA PRIVATE KEY-----/g },
  { name: "EC Private Key", pattern: /-----BEGIN EC PRIVATE KEY-----/g },
  {
    name: "PGP Private Key",
    pattern: /-----BEGIN PGP PRIVATE KEY BLOCK-----/g,
  },
  {
    name: "SSH Private Key",
    pattern: /-----BEGIN (?:OPENSSH |DSA )?PRIVATE KEY-----/g,
  },
  {
    name: "Generic Secret",
    pattern:
      /(?:api_secret|secret_key|private_key|client_secret|app_secret)\s*[:=]\s*["'][a-zA-Z0-9/+=_-]{20,}["']/gi,
  },
  // "dsn" alone (no scheme requirement on the value) collided with Sentry's
  // own naming convention: Sentry SDKs are configured with a `dsn: "https://
  // ...@sentry.io/..."` field, which this codebase's own Sentry DSN pattern
  // (below, client-exposed tier) documents as "not a secret" per Sentry's
  // docs -- so the same string was simultaneously "critical" here and
  // "not a secret" there. Requiring an actual DB-protocol scheme keeps this
  // matching real hardcoded connection strings (postgres://, mongodb://,
  // etc.) without catching every dsn="https://..." tracking config.
  {
    name: "Connection String",
    pattern:
      /(?:connection_string|database_url|dsn)\s*[:=]\s*["'](?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|mssql|oracle|sqlserver):\/\/[^"']{10,}["']/gi,
  },
];

// Genuine server-side secrets, but the blast radius is narrower than the
// critical tier — abuse of a single third-party service's quota/billing
// or spoofed notifications, not account or infrastructure takeover.
// Matches this codebase's own secrets-extended.json precedent for the
// same vendors (secret-huggingface-write-token, secret-replicate-api-token
// are both "high").
const ELEVATED_RISK_SECRET_PATTERNS: SecretPattern[] = [
  // Legacy Firebase Cloud Messaging *server* key (distinct from the
  // AIzaSy* Firebase client config key below) — Google's own docs say
  // this must stay server-side. A leak allows spoofed/spam push
  // notifications to every user of the app, but not data or account
  // compromise, so "high" rather than "critical".
  {
    name: "Firebase Cloud Messaging Server Key",
    pattern: /AAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{140}/g,
  },
  { name: "HuggingFace Token", pattern: /hf_[A-Za-z0-9]{34,}/g },
  { name: "Replicate Token", pattern: /r8_[A-Za-z0-9]{40}/g },
];

// Vendor-documented client-exposed-by-design credentials, secured via
// restrictions (referrer/domain allowlists, write-only scopes, quota
// limits) rather than secrecy. Presence alone is normal; the risk is
// billing/quota abuse if the key is unrestricted.
const CLIENT_EXPOSED_SECRET_PATTERNS: SecretPattern[] = [
  // Discord webhooks are meant to be POSTed to from server code, but a
  // leaked URL lets anyone post as the webhook (spam/impersonation in
  // the target channel) — real abuse, bounded impact.
  {
    name: "Discord Webhook",
    pattern: /discord(?:app)?\.com\/api\/webhooks\/\d{17,20}\/[\w-]{60,68}/g,
  },
  // Sentry's own docs: "the DSN is not a secret" — it is meant to be
  // public and only allows writing events, not reading data. Risk is
  // quota exhaustion via a flood of bogus events.
  {
    name: "Sentry DSN",
    pattern: /https:\/\/[0-9a-f]{32}@[a-z0-9.]+\.sentry\.io\/\d+/g,
  },
  // "pk." is Mapbox's own public-token prefix convention (mirrors
  // Stripe's pk_/sk_ split) — meant for client-side use and restricted
  // by URL allowlist, not secrecy. secret-mapbox-secret-token (this
  // codebase, "high") is the actual secret "sk." token; this pattern
  // only ever matches the public one.
  {
    name: "Mapbox Public Token",
    pattern: /pk\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  },
];

// Near-public identifiers with no credential material — informational
// signal that a service is in use, not a leak by itself.
const LOW_RISK_SECRET_PATTERNS: SecretPattern[] = [
  // A Firebase Realtime Database hostname, nothing more — no key, no
  // token. Worth flagging so security-rules hygiene gets a look, but not
  // itself a secret.
  {
    name: "Firebase Database URL",
    pattern: /https:\/\/[a-z0-9-]+\.firebaseio\.com/g,
  },
];

/**
 * A secret-shaped string that is being shown rather than leaked.
 *
 * The test used to be whether the body contained the words "documentation",
 * "example" and "api" anywhere at all, and any page that did had all four
 * hardcoded-secrets tiers switched off, one of them critical. That is not a
 * description of a documentation page; it is a description of most websites.
 * A footer carrying a Documentation link and an API link, beside any sentence
 * using the word example, was enough to make a genuinely leaked key on that
 * page invisible. This product's own pages were in exactly that state, which
 * is how it was found.
 *
 * What actually separates the two cases is where the string sits, not what
 * vocabulary surrounds it, so the question is asked per match: a value that
 * appears only inside <code>, <pre>, <kbd> or <samp> is being demonstrated.
 * The same value anywhere else on the page is a finding, whatever else the
 * page says, and a page full of examples that also leaks one real key now
 * reports the real one.
 */

/** Redact a matched secret to `prefix****suffix`, same shape for every tier. */
function redactMatch(match: string): string {
  const len = match.length;
  return len <= 12
    ? match.slice(0, 4) + "****"
    : match.slice(0, 8) + "****" + match.slice(-4);
}

/**
 * Run one severity tier's patterns against the body, filtering obvious
 * placeholders (docs/example values) the same way for every tier.
 */
function matchSecretPatterns(
  body: string,
  patterns: SecretPattern[],
): string[] {
  const found: string[] = [];
  for (const { name, pattern, requireNearby } of patterns) {
    const occurrences = [...body.matchAll(pattern)].filter((m) => {
      if (isDemonstratedExample(body, m[0])) return false;
      const lower = m[0].toLowerCase();
      if (
        lower.includes("example") ||
        lower.includes("your_") ||
        lower.includes("xxxx") ||
        lower.includes("0000")
      )
        return false;
      if (
        lower.includes("placeholder") ||
        lower.includes("test_") ||
        lower.includes("dummy")
      )
        return false;
      if (/localhost|127\.0\.0\.1/.test(m[0])) return false;
      if (requireNearby) {
        const nearby = body.slice(
          Math.max(0, m.index - 100),
          m.index + m[0].length + 100,
        );
        if (!requireNearby.test(nearby)) return false;
      }
      return true;
    });
    const unique = [...new Set(occurrences.map((m) => m[0]))];
    if (unique.length === 0) continue;
    for (const match of unique.slice(0, 3)) {
      found.push(`${name}: ${redactMatch(match)}`);
    }
    if (unique.length > 3) {
      found.push(`  ...and ${unique.length - 3} more ${name} occurrence(s)`);
    }
  }
  return found;
}

function formatSecretFindings(found: string[]): string | null {
  return found.length > 0
    ? `Potential secrets detected:\n${found.join("\n")}`
    : null;
}

// Words/phrases the "hardcoded-credentials" patterns below routinely
// capture as the "value" side of `password: "..."` / `admin: "..."` that
// are UI copy or React/Vue form-state initializers, not an actual secret --
// e.g. useState({ password: "" }), a translations blob's "password":
// "Password", or a role dropdown's { role: "admin" }. Checked
// case-insensitively against the trimmed captured value.
const CREDENTIAL_VALUE_PLACEHOLDERS = new Set([
  "password",
  "passwd",
  "pwd",
  "admin",
  "root",
  "username",
  "user",
  "email",
  "text",
  "string",
  "true",
  "false",
  "null",
  "undefined",
  "your password",
  "enter password",
  "enter your password",
  "confirm password",
  "new password",
  "old password",
  "current password",
  // Form/DOM vocabulary that lands on the value side of `password: "..."`
  // in field descriptors and validation schemas.
  "input",
  "hidden",
  "field",
  "label",
  "value",
  "required",
  "optional",
  "number",
  "boolean",
  "object",
  "array",
]);

/**
 * Whether a value captured by the hardcoded-credentials patterns actually
 * looks like a real, live secret rather than a placeholder/UI-copy string.
 * A real credential is a single opaque token: non-empty, no spaces (UI
 * copy like "Enter your password" always has spaces; a real password
 * rarely does, and even one that legitimately contains a space is
 * indistinguishable from copy here, so excluding it trades a rare miss for
 * a common false positive), and not a template-interpolation placeholder
 * (`{{password}}`, `${password}`) left in a framework template.
 *
 * Two further shapes were added after this check reached a 0-confirmed /
 * all-false-positive record at "critical" severity:
 *
 *  - A route, URL, selector or data URI (`/account/password`, `#password`,
 *    `https://…/reset`). These have no spaces and pass every other rule, but
 *    a link target is not a credential.
 *  - A capitalised, purely alphabetic word. That is the shape of UI copy and
 *    of an i18n bundle's translated label ("Password", "Passwort",
 *    "Contraseña", "Senha"), never of a secret anyone typed into source.
 *    Lower-case dictionary words are deliberately still allowed through:
 *    "changeme", "hunter", "secret" are real hard-coded passwords.
 */
function isPlausibleCredentialValue(value: string): boolean {
  const v = value.trim();
  if (v.length < 4) return false;
  if (/\s/.test(v)) return false;
  if (/^[*•.]+$/.test(v)) return false; // masked-input placeholder dots
  if (/^\{\{.*\}\}$|^\$\{.*\}$|^%[sd]$/.test(v)) return false;
  if (/^(?:[a-z][a-z0-9+.-]*:|[./#]|\.\.?\/)/i.test(v)) return false; // URL / path / selector
  if (/^\p{Lu}\p{L}*$/u.test(v)) return false; // "Password", "Contraseña"
  return !CREDENTIAL_VALUE_PLACEHOLDERS.has(v.toLowerCase());
}

const rawDetectors: Record<string, DetectFn> = {
  // ── DOM XSS sinks ─────────────────────────────────────────────────────────

  "innerhtml-xss-sink": (_url, _headers, body) => {
    const pattern = /\.innerHTML\s*=(?!\s*["'])/g;
    const matches: string[] = [];
    for (const m of body.matchAll(pattern)) {
      // el.innerHTML = DOMPurify.sanitize(x) is the documented, secure fix
      // for this exact sink -- not the vulnerability. Only count assignments
      // that aren't immediately handed to a sanitizer.
      const after = body.slice(
        m.index + m[0].length,
        m.index + m[0].length + 40,
      );
      if (
        /DOMPurify\.sanitize|sanitize-html|purify\(|\.sanitize\(/i.test(after)
      )
        continue;
      matches.push(m[0]);
    }
    if (matches.length < 2) return null;
    return `Found ${matches.length} innerHTML assignments that may be XSS sinks.`;
  },

  "outerhtml-xss-sink": (_url, _headers, body) => {
    const matches = body.match(/\.outerHTML\s*=(?!\s*["'])/g) || [];
    if (matches.length < 1) return null;
    return `Found ${matches.length} outerHTML assignment(s) - potential XSS sink.`;
  },

  "document-write-sink": (_url, _headers, body) => {
    const matches =
      body.match(
        /document\.write(?:ln)?\s*\([^)]*(?:\+|\$\{|JSON\.parse|location|document\.referrer|document\.URL|window\.name)/g,
      ) || [];
    if (matches.length < 1) return null;
    return `Found ${matches.length} document.write() call(s) with dynamic content - DOM XSS sink.`;
  },

  "insertadjacenthtml-sink": (_url, _headers, body) => {
    if (/\.insertAdjacentHTML\s*\(/.test(body)) {
      return "insertAdjacentHTML() found - potential DOM XSS sink.";
    }
    return null;
  },

  "unsafe-setattribute": (_url, _headers, body) => {
    // The `\s*` guarding the literal-value exclusion has to live INSIDE the
    // lookahead, not before it -- a shared `\s*` ahead of a negative
    // lookahead lets the regex engine backtrack to consuming zero
    // whitespace, land on the space itself (not the quote), and slip past
    // the exclusion for any value with a space after the comma.
    if (
      /\.setAttribute\s*\(\s*["']on\w+["']\s*,(?!\s*(["'])(?:(?!\1).)*\1\s*\))/i.test(
        body,
      )
    ) {
      return "setAttribute() used to set an event handler from a computed value - XSS risk.";
    }
    if (
      /\.setAttribute\s*\(\s*["'](?:href|src|action)["']\s*,(?!\s*(["'])(?:(?!\1).)*\1\s*\))/i.test(
        body,
      )
    ) {
      return "setAttribute() used with href/src/action and a computed value - XSS risk.";
    }
    return null;
  },

  // ── Eval / function / setTimeout strings ────────────────────────────────

  "eval-in-scripts": (_url, _headers, body) => {
    // Its own raw <script> scan until now, which is how a check living in the
    // same file as the RSC filter still read Next.js flight payloads as
    // authored script: a page that merely wrote about eval( in a paragraph
    // was reported as calling it, and every documentation page and security
    // blog on the internet does that. extractScriptContents is the one walk.
    for (const script of extractScriptContents(body)) {
      if (/\beval\s*\(/.test(script) && !script.includes("JSON.parse")) {
        return "eval() usage detected in inline scripts.";
      }
    }
    return null;
  },

  "function-constructor": (_url, _headers, body) => {
    if (/new\s+Function\s*\(/.test(inlineScriptContent(body))) {
      return "Function constructor used - similar risks to eval().";
    }
    return null;
  },

  // ── Prototype / misc ─────────────────────────────────────────────────────

  "prototype-pollution": (_url, _headers, body) => {
    const patterns = [
      // Only a __proto__ occurrence written as an object-literal/bracket key
      // (["__proto__"]: / __proto__":) or a chained/assigned property access
      // (.__proto__. / .__proto__ =) counts as a pollution sink. This
      // naturally excludes defensive guards like `key === '__proto__'`,
      // which never put a `:`, `]`, `.`, or `=` right after the literal.
      /["'`]__proto__["'`]\s*[:\]]|\.__proto__\s*(?:[.[]|=(?!=))/g,
      /Object\.assign\s*\(\s*{}\s*,\s*(?:req|request|params|query|body)\./gi,
      /constructor\s*\[\s*["']prototype["']\s*\]/gi,
    ];
    const found: string[] = [];
    for (const p of patterns) {
      const matches = body.match(p);
      if (matches) found.push(`${matches[0].slice(0, 25)} (${matches.length})`);
    }
    return found.length > 0
      ? `Prototype pollution patterns: ${found.join(", ")}`
      : null;
  },

  "insecure-crypto": (_url, _headers, body) => {
    const patterns = [
      {
        name: "MD5",
        pattern:
          /(?:CryptoJS\.)?MD5\s*\(.*(?:token|password|key|secret|nonce|salt)/i,
      },
      {
        name: "SHA-1",
        pattern:
          /(?:CryptoJS\.)?SHA1?\s*\(.*(?:token|password|key|secret|nonce|salt)/i,
      },
      {
        name: "Math.random for crypto",
        pattern:
          /Math\.random\s*\(\s*\).*(?:token|password|key|secret|nonce|salt)/i,
      },
    ];
    const found: string[] = [];
    for (const { name, pattern } of patterns) {
      if (pattern.test(body)) found.push(name);
    }
    return found.length > 0
      ? `Insecure crypto usage: ${found.join(", ")}`
      : null;
  },

  // ── SQL / command / SSRF / XXE / path / SSTI / LDAP ──────────────────────

  "sql-injection-patterns": (_url, _headers, body) => {
    const found: string[] = [];

    // Every hit below is judged at ITS OWN offset. body.match() returns only
    // the matched text, and the old body.indexOf(text) lookup collapsed every
    // repeat of the same query onto the FIRST occurrence: a page that prints a
    // query as a <pre> example and then genuinely concatenates the identical
    // query inside a script had the script copy scored against the <pre>
    // copy's surroundings and silently dropped.

    // ── Full statement (verb ... FROM/INTO/SET table ... WHERE/VALUES) ──
    //
    // This was one regex with two unbounded gaps:
    //   /(?:SELECT|INSERT|UPDATE|DELETE)\s+.*(?:FROM|INTO|SET)\s+\w+.*(?:WHERE|VALUES)/gi
    // On a body that repeats a SQL verb and never supplies the WHERE/VALUES
    // tail ("SELECT * FROM " over and over), every candidate FROM inside the
    // first `.*` makes the second `.*` rescan to end of line and back, so the
    // cost explodes with body length: measured 184 SECONDS on a 24 KB body,
    // against the 1 MB body cap execute-scan allows from any scanned page,
    // reachable unauthenticated through the demo scan. Same defect class as
    // the three quadratic detectors caught by tests/lib/scanner/
    // _perf-budget.test.ts, so it is fixed the same way: no wildcard gap that
    // can be re-split. Walk the verbs once and test a bounded window after
    // each, which makes every step linear in the window and the detector
    // linear in the body.
    const STATEMENT_WINDOW = 240;
    const statements: string[] = [];
    for (const verb of body.matchAll(/(?:SELECT|INSERT|UPDATE|DELETE)\s+/gi)) {
      const idx = verb.index;
      // Context gates first: they reject nearly every candidate for the cost
      // of one 200-char slice, before any window work happens.
      const before = body.slice(Math.max(0, idx - 200), idx);
      if (!/<script/i.test(before) || /<code|<pre|```/i.test(before)) continue;
      // The old `.*` never matched a newline (no `s` flag), so the statement
      // has to stay on one line here too.
      const line = splitAtLineBreak(body.slice(idx, idx + STATEMENT_WINDOW));
      const afterVerb = line.slice(verb[0].length);
      const table = /(?:FROM|INTO|SET)\s+\w/i.exec(afterVerb);
      if (!table) continue;
      const tailStart = table.index + table[0].length;
      const term = /WHERE|VALUES/i.exec(afterVerb.slice(tailStart));
      if (!term) continue;
      const text = line.slice(
        0,
        verb[0].length + tailStart + term.index + term[0].length,
      );
      // A bare SQL string constant used as sample/demo text (a SQL
      // playground's saved query preview) is not a finding -- require a
      // concatenation/interpolation signal nearby, the same gate the
      // code-sqli-* checks below use, so the query has to actually be BUILT
      // from something else to count.
      const around = body.slice(
        Math.max(0, idx - 80),
        Math.min(body.length, idx + text.length + 80),
      );
      if (!/\+|\$\{/.test(around)) continue;
      statements.push(text);
      if (statements.length >= 2) break;
    }
    found.push(...statements);

    // ── Tautology / UNION payloads ──
    // Literal alternatives joined by \s+ / \s* only: no gap for a match to be
    // re-split across, so this one was already linear and keeps its shape.
    const payloads: string[] = [];
    for (const m of body.matchAll(
      /(?:UNION\s+ALL\s+SELECT|OR\s+1\s*=\s*1|AND\s+1\s*=\s*1|'\s*OR\s*')/gi,
    )) {
      const idx = m.index;
      const before = body.slice(Math.max(0, idx - 200), idx);
      if (!/<script/i.test(before) || /<code|<pre|```/i.test(before)) continue;
      payloads.push(m[0]);
      if (payloads.length >= 2) break;
    }
    found.push(...payloads);

    return found.length > 0
      ? `SQL patterns in inline scripts: ${found
          .slice(0, 2)
          .map((f) => f.slice(0, 50))
          .join("; ")}`
      : null;
  },

  "command-injection": (_url, _headers, body) => {
    const patterns = [
      /(?:exec|spawn|execSync|system|popen)\s*\([^)]*\+\s*(?:req|request|params|query|body)\./gi,
    ];
    const found: string[] = [];
    for (const p of patterns) {
      if (p.test(body)) found.push(p.source.slice(0, 30));
    }
    return found.length > 0 ? `Command injection patterns detected.` : null;
  },

  "command-injection-indicators": (url, _headers, _body) => {
    if (/[?&](?:cmd|exec|command|run|shell)=/gi.test(url)) {
      return "Command-related parameter names found in the scanned URL - potential command injection vector.";
    }
    return null;
  },

  "ssrf-vulnerability": (_url, _headers, body) => {
    const patterns = [
      /fetch\s*\(\s*(?:req|request|params|query|body)\./gi,
      /axios\s*\.\s*(?:get|post)\s*\(\s*(?:req|request|params|query)\./gi,
      /http\.(?:get|request)\s*\(\s*(?:req|request|params|query)\./gi,
    ];
    const found: string[] = [];
    for (const p of patterns) {
      if (p.test(body)) found.push("User input in URL fetch");
    }
    return found.length > 0 ? `SSRF risk: ${found[0]}` : null;
  },

  "path-traversal": (_url, _headers, body) => {
    const patterns = [
      /\.\.[\/\\]/g,
      /(?:readFile|readFileSync|createReadStream)\s*\([^)]*(?:\+|`\$\{).*(?:req|request|params|query)\./gi,
    ];
    const contextual = body.match(patterns[1]) || [];
    return contextual.length > 0
      ? `Path traversal risk: user input in file read operations.`
      : null;
  },

  "path-traversal-indicators": (_url, _headers, body) => {
    const pattern =
      /[?&](?:file|path|dir|folder|include)=[^&]*(?:\.\.\/|\.\.%2F)/gi;
    const match = body.match(pattern);
    if (!match) return null;
    const idx = body.indexOf(match[0]);
    const before = body.slice(Math.max(0, idx - 200), idx).toLowerCase();
    if (/<code|<pre|```|example|documentation/i.test(before)) return null;
    return "Potential path traversal pattern in URL parameters.";
  },

  "xml-external-entity": (_url, _headers, body) => {
    const xxePattern =
      /<!DOCTYPE[^>]{0,2000}\[[\s\S]*?<!ENTITY[^>]{0,2000}(?:SYSTEM|PUBLIC)/i;
    if (xxePattern.test(body)) {
      const match = body.match(xxePattern);
      if (match) {
        const idx = body.indexOf(match[0]);
        const before = body.slice(Math.max(0, idx - 200), idx).toLowerCase();
        if (/<code|<pre|```|example|documentation/i.test(before)) return null;
        return "XML external entity declaration found - potential XXE vulnerability.";
      }
    }
    return null;
  },

  "insecure-deserialization": (_url, _headers, body) => {
    const patterns = [
      /unserialize\s*\(\s*\$_/gi,
      /pickle\.loads\s*\([^)]*(?:req|request|input|file|read)/gi,
      /yaml\.(?:load|safe_load)\s*\(\s*(?:req|request)/gi,
    ];
    const found: string[] = [];
    for (const p of patterns) {
      if (p.test(body)) found.push("Deserialization of user input");
    }
    return found.length > 0 ? `Insecure deserialization risk detected.` : null;
  },

  "insecure-auth": (_url, _headers, body) => {
    const patterns = [
      // Quote-tolerant, so the header as a script writes it
      // ({ "Authorization": "Basic ..." }) matches, not only as a raw dump.
      {
        name: "Basic auth over HTTP",
        pattern: /Authorization["']?\s*:\s*["']?Basic\s/gi,
      },
      {
        name: "Password in URL",
        pattern: /[?&](?:password|passwd|pwd)\s*=\s*[^&\s]{3,}/gi,
      },
    ];
    const found: string[] = [];
    for (const { name, pattern } of patterns) {
      if (pattern.test(body)) found.push(name);
    }

    // Same false-positive class as "hardcoded-credentials" above (see
    // isPlausibleCredentialValue's doc comment): matched here as a
    // separate detector because this one requires BOTH a username-shaped
    // AND a password-shaped assignment near each other, e.g. an i18n/
    // translation blob ({ username: "Username", password: "Password" })
    // rendered into the page -- extremely common and totally benign. Only
    // the PASSWORD side (m[2]) is checked against isPlausibleCredentialValue,
    // not the username side (m[1]): a real hardcoded default-credential pair
    // routinely has an ordinary-looking username value ("admin", "root"),
    // and that alone shouldn't suppress the finding -- what matters is
    // whether the password half looks like a real secret.
    const credPairPattern =
      /(?:username|user|login)\s*[:=]\s*["']([^"']+)["']\s*[,;\n].*(?:password|passwd|pwd)\s*[:=]\s*["']([^"']+)["']/gi;
    for (const m of body.matchAll(credPairPattern)) {
      if (isPlausibleCredentialValue(m[2])) {
        found.push("Hardcoded credentials");
        break;
      }
    }

    return found.length > 0
      ? `Insecure auth patterns: ${found.join(", ")}`
      : null;
  },

  "ssti-indicators": (_url, _headers, body) => {
    // Only match double-curly arithmetic PoC ({{7*7}}) — the classic SSTI probe.
    // ${ } is in every JS template literal; <% %> fires on ERB/JSP docs.
    if (/\{\{\s*\d+\s*\*\s*\d+\s*\}\}/.test(body)) {
      return "Template injection probe detected in output ({{N*N}}) - potential SSTI.";
    }
    return null;
  },

  "ldap-injection-indicators": (_url, _headers, body) => {
    if (
      /[?&](?:user|uid|cn|dn|filter)=[^&]*\([a-zA-Z][\w.-]*=[^()&]*\)/i.test(
        body,
      )
    ) {
      return "LDAP filter characters in URL parameters - potential LDAP injection.";
    }
    return null;
  },

  // ── Auth enumeration / hardcoded credentials ────────────────────────────

  "hardcoded-credentials": (_url, _headers, body) => {
    // The `\b(admin|root)\b\s*[:=]\s*"..."` pattern that used to sit
    // alongside this one is gone. The value bound to a key named `admin` or
    // `root` is not a credential -- it is a route (`admin: "/admin"`), a
    // class name (`root: "MuiButton-root"`), a role label, or a container
    // selector (`root: "#app"`), and none of those are secrets. It fired at
    // "critical" on all of them. The case it was reaching for, a default
    // administrator login, is covered by `default-credentials` (admin/admin
    // style pairs) and by `insecure-auth`'s username+password pair pattern,
    // both of which require the password half to be present.
    const patterns = [
      /\b(?:password|passwd|pwd)\b\s*[:=]\s*["']([^"']+)["']/gi,
    ];
    const siblingPairPattern = /\w+\s*[:=]\s*["'][^"']+["']/g;
    const hits: string[] = [];
    for (const p of patterns) {
      for (const m of body.matchAll(p)) {
        if (!isPlausibleCredentialValue(m[1])) continue;
        // Same "denylist/label-map, not a real credential" shape as
        // vibe-placeholder-auth's chainCount heuristic: a real hardcoded
        // admin/root/password value doesn't typically sit among 3+ other
        // key:value string pairs -- that's a role-label map or i18n blob
        // (e.g. { admin: "Administrator", root: "Full Access", editor: ... }).
        const nearby = body.slice(
          Math.max(0, (m.index ?? 0) - 150),
          (m.index ?? 0) + m[0].length + 150,
        );
        const chainCount = (nearby.match(siblingPairPattern) || []).length;
        if (chainCount >= 3) continue;
        hits.push(m[0].slice(0, 60));
        if (hits.length >= 5) break;
      }
    }
    return hits.length > 0
      ? `Hardcoded credentials pattern detected: ${hits.slice(0, 3).join("; ")}`
      : null;
  },

  "default-credentials": (_url, _headers, body) => {
    const defaults = [
      "admin/admin",
      "root/root",
      "admin/password",
      "guest/guest",
    ];
    for (const d of defaults) {
      // Reject a hit preceded by "/" or another word char -- that's a nested
      // URL path segment like /admin/admin-settings, not a credential pair.
      const pattern = new RegExp(
        `(?<![\\w/-])${d.replace("/", "\\/")}(?![\\w-])`,
        "i",
      );
      const match = pattern.exec(body);
      if (!match) continue;
      // A first-login banner telling the user to change the default
      // ("Default credentials: admin/admin, please change after first
      // login") is a security notice, not a live exposed credential --
      // same before-context exclusion path-traversal-indicators and
      // xml-external-entity already use for doc/example content.
      const before = body
        .slice(Math.max(0, match.index - 150), match.index)
        .toLowerCase();
      if (/default|change|please|first login|documentation/.test(before))
        continue;
      return `Default credentials reference: ${d}`;
    }
    return null;
  },

  // ── Source-map / debug paths in code ────────────────────────────────────

  // "sourcemap-reference" used to have an identical copy here (and a third in
  // information-disclosure.ts). Its definition lives in checks-data/
  // content.json with category "content", so registry.ts's resolveDetector has
  // always run content.ts's copy and both others were dead.
  //
  // "source-maps" was removed with it: no category file defines that id, and
  // registry.ts only builds a detector for ids that have a JSON definition, so
  // it could never produce a finding no matter what it returned. Its behaviour
  // is covered by sourcemap-reference anyway. ref: AUDIT-009#dup-07

  // ── Hardcoded secrets (SAST) ────────────────────────────────────────────
  //
  // Severity is split by whether the credential format has any legitimate
  // reason to be client-visible — see the CRITICAL/ELEVATED_RISK/
  // CLIENT_EXPOSED/LOW_RISK pattern lists above this object for the full
  // reasoning per pattern. The Google API Key pattern (AIzaSy*) that used
  // to live in this list has been removed entirely: `google-api-key-exposed`
  // (content.json, medium) and `secret-google-maps-api-key` /
  // `secret-firebase-api-key-public` (secrets-extended.json, medium/low)
  // already detect the exact same evidence. Keeping it here too meant one
  // Google API key on a page produced three findings, one of which called
  // it "critical" — that mismatch is what drove a scan of a normal site to
  // "unsafe".

  // The doc-page gate that used to stand in front of all four of these has
  // moved inside matchSecretPatterns, where it judges each match instead of
  // switching the whole tier off for the page.
  "hardcoded-secrets": (_url, _headers, body) =>
    formatSecretFindings(matchSecretPatterns(body, CRITICAL_SECRET_PATTERNS)),

  "hardcoded-secrets-high-risk": (_url, _headers, body) =>
    formatSecretFindings(
      matchSecretPatterns(body, ELEVATED_RISK_SECRET_PATTERNS),
    ),

  "hardcoded-secrets-client-exposed": (_url, _headers, body) =>
    formatSecretFindings(
      matchSecretPatterns(body, CLIENT_EXPOSED_SECRET_PATTERNS),
    ),

  "hardcoded-secrets-low-risk": (_url, _headers, body) =>
    formatSecretFindings(matchSecretPatterns(body, LOW_RISK_SECRET_PATTERNS)),

  // ── Form / page semantics (no-prefix, JSON category=code) ────────────────

  "insecure-form-submission": (_url, _headers, body) => {
    if (hasTagWith(body, "form", /action\s*=\s*["']http:\/\//i)) {
      return "Form posts data over insecure HTTP.";
    }
    // Removed: "HTML form present - verify all form actions use HTTPS."
    // This fired on every HTML page that contained any form — virtually every
    // login page, contact page, and search page.
    return null;
  },

  "postmessage-wildcard": (_url, _headers, body) => {
    // [,)]: a third, transfer-list argument does not change the target origin.
    if (/\.postMessage\s*\([^)]*,\s*["']\*["']\s*[,)]/.test(body)) {
      return "postMessage() called with wildcard '*' target origin.";
    }
    // Removed: "postMessage listener found - verify origin is not wildcard."
    // This fired on any page with any postMessage listener, even when the
    // listener properly validates origin. The postmessage-no-origin check in
    // content.ts already does this correctly.
    return null;
  },

  "localstorage-sensitive": (_url, _headers, body) => {
    if (
      /localStorage\.setItem\s*\(\s*["'](?:token|jwt|auth|password|secret|session|api[_-]?key|ssn|credit)/i.test(
        body,
      )
    ) {
      return "Sensitive data being written to localStorage.";
    }
    return null;
  },

  "sessionstorage-tokens": (_url, _headers, body) => {
    if (
      /sessionStorage\.setItem\s*\(\s*["'](?:token|jwt|auth|access[_-]?token|refresh)/i.test(
        body,
      )
    ) {
      return "Authentication tokens stored in sessionStorage.";
    }
    return null;
  },

  "indexeddb-sensitive": (_url, _headers, body) => {
    if (
      /indexedDB\.open\s*\([^)]*(?:token|password|secret|user|credentials)/i.test(
        body,
      )
    ) {
      return "IndexedDB opened with potentially sensitive key name.";
    }
    // Removed: "IndexedDB usage detected - audit stored object stores for
    // sensitive data." Many modern PWAs use IndexedDB for legitimate
    // non-sensitive data. Any IndexedDB use fired this.
    return null;
  },

  "window-name-storage": (_url, _headers, body) => {
    if (/window\.name\s*=\s*[^;]*(?:token|password|secret|user)/i.test(body)) {
      return "Sensitive data assigned to window.name - cross-origin readable.";
    }
    // Removed: "window.name assignment - avoid storing any cross-origin
    // transferable data." Any window.name = ... fired this, including
    // frame-title or navigation-state assignments.
    return null;
  },

  "service-worker-insecure": (_url, _headers, body) => {
    // Only flag if explicitly registered over HTTP — an HTTPS registration is
    // required by the spec and is not an issue.
    if (/navigator\.serviceWorker\.register\s*\(\s*["']http:\/\//i.test(body)) {
      return "Service worker registered over insecure HTTP origin.";
    }
    return null;
  },

  "debugger-statement": (_url, _headers, body) => {
    if (/(^|[^.\w])debugger\s*;/.test(body)) {
      return "JavaScript 'debugger' statement - remove from production code.";
    }
    return null;
  },

  // ── DOM XSS sinks (code-* prefix, category=code) ─────────────────────────

  "code-xss-insertadjacentelement": (_url, _headers, body) => {
    const match = body.match(/\.insertAdjacentElement\s*\(/i);
    if (match) {
      const idx = body.indexOf(match[0]);
      const before = body.slice(Math.max(0, idx - 200), idx);
      if (
        /\.innerHTML\s*=|createContextualFragment|DOMParser|\.write\s*\(/i.test(
          before,
        )
      ) {
        return "insertAdjacentElement sink - DOM XSS via live-node insertion.";
      }
    }
    return null;
  },

  "code-xss-createcontextualfragment": (_url, _headers, body) => {
    if (
      /createContextualFragment\s*\([^)]*(?:\+|\$\{|req\.|request\.|params\.|query\.|body\.)/i.test(
        body,
      )
    ) {
      return "Range.createContextualFragment sink - parses HTML into DocumentFragment.";
    }
    return null;
  },

  "code-xss-documentwrite-jsonparse": (_url, _headers, body) => {
    if (/document\.write(?:ln)?\s*\([^)]*JSON\.parse/i.test(body)) {
      return "document.write(JSON.parse(...)) - direct DOM XSS via parsed JSON.";
    }
    // Removed generic document.write fallback — already caught by document-write-sink.
    return null;
  },

  "code-xss-dangerouslysetinnerhtml-dynamic": (_url, _headers, body) => {
    if (
      /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:\s*(?!["'])[^}]*[+`]/.test(
        body,
      )
    ) {
      return "dangerouslySetInnerHTML receives a computed/concatenated string.";
    }
    return null;
  },

  "code-xss-vue-v-html-dynamic": (_url, _headers, body) => {
    if (/v-html\s*=\s*["'][^"']*[+`{][^"']*["']/i.test(body)) {
      return "Vue v-html bound to a dynamic expression - XSS via template concatenation.";
    }
    const bareMatch = body.match(/v-html\s*=\s*["']([^"']*)["']/i);
    if (bareMatch && !/sanitize|clean|purify|safe/i.test(bareMatch[1])) {
      return "Vue v-html directive found - audit dynamic expressions.";
    }
    return null;
  },

  "code-xss-angular-bypass-dynamic": (_url, _headers, body) => {
    const bypassCall = body.match(
      /bypassSecurityTrust(?:Html|Script|Style|Url|ResourceUrl)\s*\((?!\s*["'`])[^)]*\)/i,
    );
    if (bypassCall) {
      const idx = body.indexOf(bypassCall[0]);
      const window = body.slice(
        Math.max(0, idx - 150),
        idx + bypassCall[0].length,
      );
      if (
        /(?:req|request|params|query|body|@Input|queryParams|paramMap|route\.snapshot)/i.test(
          window,
        )
      ) {
        return "Angular bypassSecurityTrust* defeats DomSanitizer - XSS risk.";
      }
    }
    // Match Angular-specific bindings only, not React's dangerouslySetInnerHTML.
    // [innerHTML]="expr" or [attr.innerHTML]="expr" — Angular property binding.
    if (/\[\s*(?:attr\.innerHTML|innerHTML)\s*\]\s*=/i.test(body)) {
      return "Angular [innerHTML] property binding - confirm content is sanitized.";
    }
    if (/\bng-bind-html\s*=/i.test(body)) {
      return "Angular ng-bind-html directive - confirm content is sanitized.";
    }
    return null;
  },

  "code-xss-domparser-parsefromstring": (_url, _headers, body) => {
    if (/DOMParser\s*\(\s*\)\s*\.parseFromString/i.test(body)) {
      return "DOMParser.parseFromString sink - parses user-controlled HTML into a Document.";
    }
    // Removed: "DOMParser usage - audit parseFromString calls for user HTML."
    // DOMParser is a native browser API used legitimately for RSS/XML parsing.
    // Any DOMParser reference fired this — too broad.
    return null;
  },

  "code-cmdi-spawn-shell-true": (_url, _headers, body) => {
    if (
      /spawn\s*\([^)]*\+[^)]*\{\s*shell\s*:\s*true\s*\}/i.test(body) ||
      /spawn\s*\([^)]*\$\{[^)]*\{\s*shell\s*:\s*true\s*\}/i.test(body)
    ) {
      return "child_process.spawn called with shell:true and a concatenated/interpolated command - command injection risk.";
    }
    return null;
  },

  "code-cmdi-exec": (_url, _headers, body) => {
    if (/(?:child_process\.)?exec\s*\(\s*["'`].*\+/i.test(body)) {
      return "child_process.exec with concatenated argument - shell injection risk.";
    }
    // Removed: "child_process.exec usage - audit first argument for user input."
    // Any exec() call fired this, including exec('git status') which is safe.
    return null;
  },

  "code-cmdi-os-exec": (_url, _headers, body) => {
    if (/os\.(?:system|exec[a-z]*|popen)\s*\([^)]*\+/i.test(body)) {
      return "os.system / os.exec* / os.popen with concatenated input - shell injection.";
    }
    // Removed: "Python 'os' module imported - audit system/exec/popen callers."
    // Any Python file importing os fired this, including trivial os.path.join usage.
    return null;
  },

  "code-cmdi-bin-sh-concat": (_url, _headers, body) => {
    if (
      /["']\/bin\/sh\s+-c\s*["']\s*\+\s*\w+|"sh\s+-c\s*"\s*\+\s*\w+/i.test(body)
    ) {
      return "/bin/sh -c built via string concatenation - shell injection risk.";
    }
    return null;
  },

  "code-cmdi-popen": (_url, _headers, body) => {
    if (
      /subprocess\.(?:Popen|call|run)\s*\([^)]*shell\s*=\s*True/i.test(body)
    ) {
      return "subprocess.Popen / call / run with shell=True - command injection risk.";
    }
    if (/os\.popen\s*\(/i.test(body)) {
      return "os.popen() - argument is passed to the shell verbatim.";
    }
    return null;
  },

  "code-cmdi-process-spawn": (_url, _headers, body) => {
    if (
      /(?:spawn|execFile)\s*\(\s*[`"'][^`"']*\+\s*\w+|(?:spawn|execFile)\s*\(\s*`[^`]*\$\{/i.test(
        body,
      )
    ) {
      return "child_process.spawn/execFile built from concatenation - argument injection.";
    }
    // Removed: "spawn/execFile usage - audit argument strings for concatenation."
    // Any spawn() call fired this, including spawn('ls') with a fixed command.
    return null;
  },

  // ── SQL injection (code-sqli-*) ──────────────────────────────────────────

  "code-sqli-mongodb-where": (_url, _headers, body) => {
    if (
      /\$where\s*:\s*["'`].*\+/i.test(body) ||
      /\$where\s*:\s*Function/i.test(body)
    ) {
      return "MongoDB $where clause built from concatenation - server-side JS injection.";
    }
    // Removed: "$where usage - audit for user-controlled JavaScript."
    // Any $where: key fired this, even with a static string value.
    return null;
  },

  "code-sqli-mongodb-regex": (_url, _headers, body) => {
    if (
      /\$regex\s*:\s*(?:req|request|params|query|body)\./i.test(body) ||
      /new\s+RegExp\s*\(\s*(?:req|request|params|query|body)\./i.test(body)
    ) {
      return "MongoDB $regex / RegExp built from user input - data leak or ReDoS.";
    }
    // Removed: "$regex usage - audit the source of the pattern."
    // Any $regex: key fired this, including static patterns.
    return null;
  },

  "code-sqli-raw-query-string": (_url, _headers, body) => {
    if (
      /\.query\s*\(\s*["'`][^"'`]*["'`]\s*\+\s*(?:req|request|params|query|body)\./i.test(
        body,
      )
    ) {
      return "SQL query concatenated with user input - SQL injection.";
    }
    // Removed: "Raw SQL query in source - audit concatenation with user input."
    // Any .query("...") with a string literal fired this, including parameterised
    // queries like .query("SELECT * FROM users WHERE id = ?", [id]).
    return null;
  },

  "code-sqli-template-literal-query": (_url, _headers, body) => {
    if (
      /\.query\s*\(\s*`[^`]*\$\{(?:req|request|params|query|body)\./i.test(body)
    ) {
      return "SQL query via template literal interpolation - SQL injection.";
    }
    // Removed: "Tag-less template literal used in .query() - SQL injection risk."
    // Any .query(`...`) with a static template literal fired this.
    return null;
  },

  "code-sqli-mongoose-find-user": (_url, _headers, body) => {
    if (
      /\.find\s*\(\s*(?:req|request|params|query|body)\./i.test(body) ||
      /\.find\s*\(\s*JSON\.parse\s*\(\s*(?:req|request)/i.test(body)
    ) {
      return "Mongoose .find() with user-supplied filter - operator injection risk.";
    }
    // Removed: "Mongoose .find() - audit argument for user JSON."
    // Any .find() call fired this, including .find({active: true}).
    return null;
  },

  "code-sqli-sequelize-literal": (_url, _headers, body) => {
    if (
      /Sequelize\.literal\s*\([^)]*(?:req|request|params|query|body)\./i.test(
        body,
      )
    ) {
      return "Sequelize.literal with user input - SQL injection risk.";
    }
    // Removed: "Sequelize.literal usage - audit argument for user input."
    // Any Sequelize.literal() fired this, including static SQL fragments.
    return null;
  },

  // ── Deserialization (code-deser-*) ───────────────────────────────────────

  "code-deser-yaml-load": (_url, _headers, body) => {
    if (/\byaml\.load\s*\(/i.test(body) && !/yaml\.safe_load/i.test(body)) {
      return "yaml.load() without safe loader - arbitrary Python object instantiation.";
    }
    // Removed: "PyYAML imported - audit yaml.load vs yaml.safe_load usage."
    // Any yaml import fired this. Importing yaml is fine; only yaml.load() is risky.
    return null;
  },

  "code-deser-pickle-loads": (_url, _headers, body) => {
    if (/pickle\.loads\s*\([^)]*(?:req|request|input|file|read)/i.test(body)) {
      return "pickle.loads() with untrusted bytes - arbitrary code execution risk.";
    }
    // Removed: "pickle imported - never unpickle untrusted data."
    // Any pickle import fired this, including pickle.dumps() which is safe.
    return null;
  },

  "code-deser-base64-eval": (_url, _headers, body) => {
    if (
      /\beval\s*\(\s*(?:atob|Buffer\.from\([^)]*['"]base64['"])/i.test(body) ||
      /\beval\s*\(\s*Buffer\.from\([^)]+,\s*['"]base64['"]/i.test(body)
    ) {
      return "eval(atob(...)) / eval(Buffer.from(..., 'base64')) - RCE via base64.";
    }
    return null;
  },

  "code-deser-jsonparse-newfunction": (_url, _headers, body) => {
    if (/new\s+Function\s*\([^)]*JSON\.parse/i.test(body)) {
      return "new Function('return ' + JSON.parse(input)) - function body from attacker JSON.";
    }
    if (
      /new\s+Function\s*\([^)]*(?:req|request|body|params|query)\./i.test(body)
    ) {
      return "new Function() with user-supplied source - arbitrary code execution.";
    }
    return null;
  },

  "code-deser-node-serialize": (_url, _headers, body) => {
    if (
      /require\s*\(\s*["']node-serialize["']\)/.test(body) ||
      /serialize\.(?:unserialize|deserialize)\s*\(/i.test(body)
    ) {
      return "node-serialize deserialize() - IIFE payload can achieve RCE.";
    }
    return null;
  },

  "code-deser-php-unserialize": (_url, _headers, body) => {
    if (/unserialize\s*\(\s*\$_/i.test(body)) {
      return "PHP unserialize() on user input - POP gadget chain / RCE risk.";
    }
    // Removed: "unserialize() call - audit source of bytes."
    // Any unserialize() fired this, including internal data serialization
    // that never touches user input.
    return null;
  },

  // ── SSRF (code-ssrf-*) ────────────────────────────────────────────────────

  "code-ssrf-fetch-port": (_url, _headers, body) => {
    if (
      /fetch\s*\(\s*["']https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|169\.254\.169\.254|10\.|192\.168\.)/i.test(
        body,
      )
    ) {
      return "fetch() targets loopback or cloud-metadata IP - SSRF risk.";
    }
    return null;
  },

  "code-ssrf-fetch-user-input": (_url, _headers, body) => {
    if (/fetch\s*\(\s*(?:req|request|params|query|body)\./i.test(body)) {
      return "fetch() URL built from user input - SSRF.";
    }
    return null;
  },

  "code-ssrf-axios-user-input": (_url, _headers, body) => {
    if (
      /axios\s*\.\s*(?:get|post|put|patch|delete)\s*\(\s*(?:req|request|params|query|body)\./i.test(
        body,
      ) ||
      /axios\s*\(\s*\{\s*url\s*:\s*(?:req|request|params|query|body|`[^`]*\$\{)/i.test(
        body,
      )
    ) {
      return "axios request with user-controlled URL - SSRF.";
    }
    return null;
  },

  "code-ssrf-xhr-user-input": (_url, _headers, body) => {
    if (
      /XMLHttpRequest\s*\(\s*\)|new\s+XMLHttpRequest/i.test(body) &&
      /\.open\s*\(\s*["'](?:GET|POST)["']\s*,\s*(?:req|request|params|query|body)\./i.test(
        body,
      )
    ) {
      return "XMLHttpRequest URL from user input - SSRF in server contexts.";
    }
    return null;
  },

  "code-ssrf-got-user-input": (_url, _headers, body) => {
    if (
      /\b(?:got|node-fetch|undici)\s*\(\s*(?:req|request|params|query|body)\./i.test(
        body,
      )
    ) {
      return "got / node-fetch / undici request with user URL - SSRF.";
    }
    return null;
  },

  // ── ReDoS (code-redos-*) ─────────────────────────────────────────────────

  // code-redos-nested-quantifier and code-redos-catastrophic-backtrack removed:
  // their detection regexes were themselves O(n²) on 200KB+ HTML bodies,
  // hanging the scan server. No safe linear-time rewrite existed for the
  // detection patterns they used.

  // ── Redirects (code-redirect-*) ──────────────────────────────────────────

  "code-redirect-window-location-href": (_url, _headers, body) => {
    if (
      /window\.location(?:\.href)?\s*=\s*(?:req|request|params|query|body)\./i.test(
        body,
      ) ||
      /window\.location(?:\.href)?\s*=\s*[`"][^`"]*[`"]\s*\+\s*\w+/i.test(body)
    ) {
      return "window.location.href assigned to user input - open redirect.";
    }
    // Removed: "window.location referenced - audit assignments for user input."
    // Any use of window.location (including window.location.pathname,
    // window.location.origin) fired this — ubiquitous in every SPA.
    return null;
  },

  "code-redirect-location-replace": (_url, _headers, body) => {
    if (
      /location\.replace\s*\(\s*(?:req|request|params|query|body)\./i.test(body)
    ) {
      return "location.replace() with user input - open redirect.";
    }
    // Removed: "location.replace() called - audit argument for user input."
    // Any location.replace() fired this, including location.replace('/home').
    return null;
  },

  "code-redirect-top-location": (_url, _headers, body) => {
    if (
      /(?:top|parent)\.location(?:\.href)?\s*=\s*(?:req|request|params|query|body|["'][^"']*["']\s*\+\s*\w+)/i.test(
        body,
      )
    ) {
      return "top.location / parent.location assigned to user input - iframe redirect.";
    }
    // Removed: "top.location / parent.location referenced - audit for user input."
    // top.location is used by legitimate frame-busting code (a security measure,
    // not a vulnerability). Flagging all uses is misleading.
    return null;
  },

  // ── Prototype pollution (code-proto-pollution-*) ─────────────────────────

  "code-proto-pollution-deep-merge": (_url, _headers, body) => {
    // _.merge alone is code-proto-pollution-lodash-merge's job (it's already
    // scoped to a user-input source); only match the OTHER deep-merge
    // helpers here, and require the same user-input proximity so a plain
    // internal-config merge doesn't fire.
    const match = body.match(
      /(?:_\.mergeWith|deep-extend|deepmerge|extend\s*\(\s*true)/i,
    );
    if (!match) return null;
    const idx = body.indexOf(match[0]);
    const window = body.slice(idx, idx + 150);
    if (/(?:req|request|params|query|body)\./i.test(window)) {
      return "Deep merge helper used with user-controlled source - prototype pollution risk.";
    }
    return null;
  },

  "code-proto-pollution-lodash-merge": (_url, _headers, body) => {
    if (/_\.merge\s*\([^)]*(?:req|request|body|input|user)/i.test(body)) {
      return "_.merge(target, userInput) - pre-4.17.12 lodash prototype pollution.";
    }
    // Removed: "_.merge usage - audit second argument for user input."
    // Any _.merge() call fired this — very common for non-user-input merging.
    return null;
  },

  "code-proto-pollution-object-assign-proto": (_url, _headers, body) => {
    if (
      /Object\.assign\s*\(\s*\w+\s*,\s*(?:JSON\.parse|JSON\.stringify)/i.test(
        body,
      )
    ) {
      return "__proto__ assignment / Object.assign with parsed JSON - pollution risk.";
    }
    if (/Object\.assign\s*\(\s*\w+\s*,\s*JSON/i.test(body)) {
      return "Object.assign from JSON - audit for __proto__ key copy.";
    }
    return null;
  },

  "code-proto-pollution-recursive-merge": (_url, _headers, body) => {
    // A merge function only qualifies as a real pollution risk if it does
    // NOT already guard against a __proto__/constructor/prototype key --
    // the scanner's own recommended fix for this exact check has that
    // shape, so the regex has to look past the match for the guard before
    // flagging it as vulnerable.
    const guard =
      /(?:===|==|!==|!=)\s*['"`]__proto__['"`]|['"`]__proto__['"`]\s*(?:===|==|!==|!=)/i;
    const primary = body.match(
      /Object\.keys\s*\(\s*\w+\s*\)\s*[\s\S]{0,80}function[^{]*\{[\s\S]{0,300}__proto__[\s\S]{0,60}|function\s+\w*[mM]erge\s*\([^)]*\)\s*\{[\s\S]{0,300}for\s*\([^)]*Object\.keys[\s\S]{0,150}/i,
    );
    if (primary && !guard.test(primary[0])) {
      return "Custom recursive merge iterates Object.keys - prototype pollution risk.";
    }
    const fallback = body.match(
      /function\s+\w*[mM]erge\s*\([^)]*Object\.keys[\s\S]{0,150}/i,
    );
    if (fallback && !guard.test(fallback[0])) {
      return "Hand-rolled merge function detected - audit for __proto__ writes.";
    }
    return null;
  },

  // ── JWT (code-jwt-*) ──────────────────────────────────────────────────────

  "code-jwt-verify-no-secret": (_url, _headers, body) => {
    // A single-argument jwt.verify(token) call throws synchronously in the
    // real jsonwebtoken library ("secret or public key must be provided") --
    // it doesn't silently accept the token, so it isn't flagged here. The
    // actual silent-bypass footgun is passing an empty/undefined secret,
    // which the library treats as a (weak but real) verification key.
    // No `\s*` before the token argument: `[^,)]` already matches whitespace,
    // so `\s*[^,)]+` let both runs claim the same characters while the
    // mandatory `,` never arrived. `"jwt.verify( " + " \t".repeat(n)`
    // measured 379 ms at 16 KB and 19,524 ms at 128 KB. Bounding the run is
    // what caps the failed match at 200 steps per occurrence: a token
    // argument longer than that is not a real call.
    const pattern =
      /jwt\.verify\s*\([^,)]{1,200},\s*(?:''|""|``|undefined)\s*[,)]/i;
    const match = body.match(pattern);
    if (!match) return null;
    const idx = body.indexOf(match[0]);
    const before = body.slice(Math.max(0, idx - 200), idx).toLowerCase();
    if (/<code|<pre|```|example|documentation/i.test(before)) return null;
    return "jwt.verify() called with an empty/undefined secret - signature check can be bypassed.";
  },

  "code-jwt-decode-only": (_url, _headers, body) => {
    if (/jwt\.decode\s*\(/i.test(body) && !/jwt\.verify/i.test(body)) {
      return "jwt.decode() used without jwt.verify() - signature not validated.";
    }
    // Removed: "jwt.decode call - confirm jwt.verify is also used for auth decisions."
    // This fired when both jwt.decode AND jwt.verify were present — a false positive
    // since verify was already being called.
    return null;
  },

  "code-jwt-hs256-weak-secret": (_url, _headers, body) => {
    if (/jwt\.sign\s*\([^)]*,\s*["'][^"']{1,15}["']/i.test(body)) {
      return "jwt.sign with short/literal HS256 secret - brute-forceable.";
    }
    return null;
  },

  "code-jwt-none-algorithm": (_url, _headers, body) => {
    if (/algorithms\s*:\s*\[[^\]]*["']none["']/i.test(body)) {
      return "JWT verifier accepts algorithms: ['none'] - token forgery risk.";
    }
    // Removed second branch: jwt.verify with any 'algorithms' key is CORRECT behavior.
    // Flagging correct usage was a false positive.
    return null;
  },

  // ── Trusted Types (code-csp-*) ────────────────────────────────────────────

  "code-csp-no-trustedtypes": (_url, _headers, body) => {
    if (/trustedTypes\.createPolicy\s*\(/i.test(body)) return null;
    const scripts = inlineScriptContent(body);
    if (
      /(?:innerHTML\s*=|document\.write\s*\(|eval\s*\()/i.test(scripts) &&
      !/trustedTypes/i.test(scripts)
    ) {
      return "DOM sinks without Trusted Types policy - prefer a sanitizing policy.";
    }
    return null;
  },

  "code-csp-missing-trusted-types": (_url, headers, body) => {
    const csp = getEffectiveCsp(headers, body);
    // The CSP directives are require-trusted-types-for and trusted-types.
    // This matched /trustedTypes/, the JavaScript API's camelCase name, which
    // no CSP ever contains, so every site that had correctly enforced Trusted
    // Types was still told it had not.
    if (
      !csp ||
      /require-trusted-types-for|(?:^|;)\s*trusted-types\b/i.test(csp)
    )
      return null;
    const scripts = inlineScriptContent(body);
    if (/innerHTML\s*=|document\.write\s*\(/i.test(scripts)) {
      return "Page renders dynamic HTML without Trusted Types enforcement.";
    }
    return null;
  },

  // ── Auth / storage / cookies (code-auth-*, code-cookie-*) ────────────────

  "code-auth-sessionstorage-passwords": (_url, _headers, body) => {
    // The key must be an EXACT password/passwd/pwd match (closing quote
    // right after), not a prefix -- a plain prefix match also fired on the
    // extremely common "show/hide password" UI toggle pattern
    // (sessionStorage.setItem("pwdVisible", ...) or
    // ("passwordResetRequested", ...)), neither of which stores an actual
    // password, just a boolean/flag.
    if (
      /sessionStorage\.setItem\s*\(\s*["'](?:password|passwd|pwd)["']\s*,/i.test(
        body,
      )
    ) {
      return "Plaintext password stored in sessionStorage.";
    }
    return null;
  },

  "code-cookie-samesite-none-http": (_url, headers, body) => {
    if (/SameSite\s*=\s*None/i.test(body) && !/;\s*Secure/i.test(body)) {
      return "SameSite=None cookie without Secure flag - browsers reject, leaks via HTTP.";
    }
    // AUDIT-008 follow-up: this used to read headers.get("set-cookie"),
    // which comma-joins every Set-Cookie header into one string (the Fetch
    // spec's Headers.get() combines multi-value headers; Set-Cookie is only
    // exempted from that via the separate getSetCookie() method). On a
    // response with multiple cookies, that join let one cookie's own
    // "Secure" attribute satisfy the /;\s*Secure/ test for a completely
    // different cookie's SameSite=None, and vice versa. It also only
    // checked for the presence of "SameSite=None" anywhere in that joined
    // blob without checking Secure at all in this branch, so it fired
    // whenever ANY cookie declared SameSite=None regardless of whether
    // Secure was present. Iterate each Set-Cookie header on its own (same
    // per-cookie approach as cookies.ts's set-cookie-samesite-none-no-secure)
    // so both flags are checked together against the same cookie.
    for (const cookie of getSetCookies(headers)) {
      if (/SameSite\s*=\s*None/i.test(cookie) && !/;\s*Secure/i.test(cookie)) {
        return "Set-Cookie uses SameSite=None without Secure - downgrade risk.";
      }
    }
    return null;
  },

  "code-cookie-missing-secure-http": (_url, headers, body) => {
    if (
      /document\.cookie\s*=[^;]*(?:token|password|session)/i.test(body) &&
      !/;\s*Secure/i.test(body)
    ) {
      return "document.cookie write missing Secure flag - cookie can travel over HTTP.";
    }
    // Per cookie. headers.get("set-cookie") comma-joins every Set-Cookie, so
    // one Secure cookie anywhere in the response hid every insecure one next
    // to it. code-cookie-samesite-none-http already made this fix.
    for (const cookie of getSetCookies(headers)) {
      if (!/;\s*Secure(?:\s*;|\s*$)/i.test(cookie)) {
        return `Set-Cookie for '${cookie.split("=")[0]?.trim()}' lacks the Secure flag - sent on plaintext connections.`;
      }
    }
    return null;
  },

  // ── Clickjacking (code-clickjack-*) ──────────────────────────────────────

  "code-clickjack-target-blank-js-href": (_url, _headers, body) => {
    const tags = openTags(body, "a");
    for (const tag of tags) {
      // Inert idioms (javascript:void(0), javascript:;, javascript:"") execute
      // nothing and are the standard no-op click-handler-only anchor pattern.
      if (
        !/href\s*=\s*["']\s*javascript\s*:(?!\s*(?:void\s*\(|;?\s*["']))/i.test(
          tag,
        )
      )
        continue;
      if (/target\s*=\s*["']_blank["']/i.test(tag)) {
        return "Anchor with javascript: href and target=_blank - executes in new tab.";
      }
      return "javascript: href in source - even with noopener it executes.";
    }
    return null;
  },

  "code-clickjack-x-frame-options": (_url, headers, _body) => {
    if (
      headers.has("x-frame-options") &&
      /ALLOWALL/i.test(headers.get("x-frame-options") || "")
    ) {
      return "X-Frame-Options: ALLOWALL - defeats clickjacking protection.";
    }
    if (
      !headers.has("x-frame-options") &&
      !/frame-ancestors/i.test(headers.get("content-security-policy") || "")
    ) {
      return "Missing X-Frame-Options header and no frame-ancestors CSP directive - page can be embedded and clickjacked.";
    }
    return null;
  },

  // ── Timing-safe compare (code-timing-*) ──────────────────────────────────

  "code-timing-hmac-equality": (_url, _headers, body) => {
    if (/hmac\s*\([^)]+\)\s*===/.test(body) || /HMAC[^=]*===/.test(body)) {
      return "HMAC comparison via === - byte-by-byte timing leak.";
    }
    return null;
  },

  // ── Cloud credentials (code-cloud-*) ─────────────────────────────────────

  "code-cloud-aws-hardcoded-credentials": (_url, _headers, body) => {
    const found = matchSecretPatterns(body, [
      {
        name: "AWS accessKeyId",
        pattern: /accessKeyId\s*:\s*["'][A-Z0-9]{16,}["']/g,
      },
      {
        name: "AWS secretAccessKey",
        pattern: /secretAccessKey\s*:\s*["'][A-Za-z0-9/+=]{30,}["']/g,
      },
    ]);
    return found.length > 0
      ? "Hardcoded AWS accessKeyId / secretAccessKey in @aws-sdk client."
      : null;
  },

  "code-cloud-aws-s3-upload-no-acl": (_url, _headers, body) => {
    if (
      /PutObjectCommand\s*\([\s\S]*?ACL\s*:\s*["']public-read/i.test(body) ||
      /\.upload\s*\([\s\S]*?ACL\s*:\s*["']public-read/i.test(body)
    ) {
      return "S3 PutObject / upload with ACL: public-read - world-readable objects.";
    }
    return null;
  },

  "code-cloud-azure-blob-upload-no-acl": (_url, _headers, body) => {
    if (
      /(?:ContainerClient|BlobServiceClient|BlockBlobClient)[\s\S]{0,200}publicAccess/i.test(
        body,
      ) ||
      /accessLevel\s*:\s*["'](?:blob|container)["']/i.test(body)
    ) {
      return "Azure blob container accessLevel set to blob/container - public enumeration.";
    }
    return null;
  },

  // ── Code-prefixed entries with category=headers (placed in code.ts) ──────

  "code-axios-defaults-baseurl": (_url, headers, body) => {
    if (/axios\.defaults\.baseURL\s*=/i.test(body)) {
      return "axios.defaults.baseURL set globally - SSRF pivot if base is user-controlled.";
    }
    return null;
  },

  "code-eval-setinterval-string": (_url, headers, body) => {
    if (
      /set(?:Timeout|Interval)\s*\(\s*["'`]/i.test(body) ||
      /set(?:Timeout|Interval)\s*\(\s*[^,)]*[+`][^,)]*,/i.test(body)
    ) {
      return "setTimeout / setInterval with string argument - implicit eval().";
    }
    return null;
  },

  "code-object-assign-from-user": (_url, _headers, body) => {
    if (
      /Object\.assign\s*\(\s*\w+\s*,\s*(?:req|request|params|query|body|JSON\.parse)/i.test(
        body,
      )
    ) {
      return "Object.assign from user input - prototype pollution / mass-assignment risk.";
    }
    // Removed: "Object.assign usage - audit second argument for user input."
    // Object.assign() is used ubiquitously in virtually every JavaScript app
    // for non-user-input operations. Any use fired this.
    return null;
  },

  "code-spread-into-globals": (_url, headers, body) => {
    if (/\{\s*\.\.\.(?:req|request|params|query|body)\b/i.test(body)) {
      return "Spread of user input into object - prototype pollution / mass-assignment risk.";
    }
    return null;
  },

  "code-cookie-without-httponly": (_url, headers, body) => {
    if (
      /document\.cookie\s*=[^;]*\b(?:token|password|session|sid)/i.test(body) &&
      !/HttpOnly/i.test(body)
    ) {
      return "document.cookie write missing HttpOnly - readable from JS / XSS.";
    }
    if (
      headers.has("set-cookie") &&
      !/HttpOnly/i.test(headers.get("set-cookie") || "")
    ) {
      return "Set-Cookie header lacks HttpOnly - readable from JavaScript.";
    }
    return null;
  },

  "code-cookie-write-no-samesite": (_url, headers, body) => {
    if (
      /document\.cookie\s*=[^;]*(?:token|session|sid)/i.test(body) &&
      !/SameSite/i.test(body)
    ) {
      return "document.cookie write missing SameSite attribute.";
    }
    if (
      headers.has("set-cookie") &&
      !/SameSite/i.test(headers.get("set-cookie") || "")
    ) {
      return "Set-Cookie header lacks SameSite attribute.";
    }
    return null;
  },

  "code-window-open-without-noopener": (_url, _headers, body) => {
    if (/window\.open\s*\([^)]*\)/i.test(body) && !/noopener/i.test(body)) {
      return "window.open() without noopener - reverse tabnabbing risk.";
    }
    // Removed: "window.open usage - confirm features string includes noopener."
    // The first branch already handles the case where noopener is absent.
    // The fallback fired when noopener WAS present, which is correct behaviour.
    return null;
  },

  "code-jquery-html": (_url, _headers, body) => {
    if (/\$\([^)]*\)\.html\s*\((?!\s*(["'])(?:(?!\1).)*\1\s*\))/i.test(body)) {
      return "jQuery .html() with non-literal argument - DOM XSS sink.";
    }
    // Removed: "jQuery .html() usage - audit argument source."
    // The first branch already catches non-literal arguments. The fallback
    // fired when a static string literal was passed — that is safe.
    return null;
  },

  "code-jquery-global-event": (_url, headers, body) => {
    if (
      /\$\(\s*(?:document|["']body["'])\s*\)\.(?:on|bind)\s*\(\s*["'][^"']*["']\s*,\s*(?!["'])[^,)]+,/i.test(
        body,
      )
    ) {
      return "jQuery global delegated event binding - audit selector for user-controlled markup.";
    }
    return null;
  },

  "code-local-storage-pii": (_url, headers, body) => {
    if (
      /localStorage\.setItem\s*\(\s*["'](?:email|name|phone|address|ssn|user)/i.test(
        body,
      )
    ) {
      return "PII being written to localStorage - any XSS exfiltrates it.";
    }
    return null;
  },

  "code-service-worker-no-csp": (_url, headers, body) => {
    if (
      /navigator\.serviceWorker\.register/i.test(body) &&
      !headers.get("content-security-policy")
    ) {
      return "Service worker registered but no Content-Security-Policy header found.";
    }
    return null;
  },

  "code-cookie-write-via-jquery": (_url, headers, body) => {
    if (/\$\.cookie\s*\(/i.test(body) && !/HttpOnly/i.test(body)) {
      return "jQuery $.cookie write missing HttpOnly - readable from JS / XSS.";
    }
    return null;
  },

  "code-stripe-publishable-key": (_url, headers, body) => {
    if (/pk_live_[0-9a-zA-Z]{20,}/i.test(body)) {
      return "Stripe live publishable key in client source - rotate if unintended.";
    }
    if (/pk_test_[0-9a-zA-Z]{20,}/i.test(body)) {
      return "Stripe test publishable key in client source - move to env config.";
    }
    return null;
  },

  "code-react-refs-innerhtml": (_url, headers, body) => {
    if (/this\.refs\.\w+\.innerHTML\s*=/i.test(body)) {
      return "React ref.innerHTML assignment - DOM XSS sink.";
    }
    return null;
  },

  "code-angular-interpolation-bypass": (_url, headers, body) => {
    if (
      /\[innerHTML\]\s*=/i.test(body) ||
      /\[(?:ngStyle|ngClass)\]\s*=/i.test(body)
    ) {
      return "Angular property-binding bypass of interpolation - audit user content.";
    }
    return null;
  },

  // "reflected-input": implementation lives in checks/content.ts. The id is
  // defined in checks-data/content.json, and resolveDetector looks in the
  // bundle that owns the definition first, so this copy never ran: the
  // registry answered every scan with content.ts's version. The DOM-XSS
  // matching that was here is now the whole of that one.

  // ── Additional eval-family sinks (code-eval-*) ───────────────────────────

  "code-eval-vm-module": (_url, _headers, body) => {
    if (
      /vm\.(?:runInNewContext|runInThisContext|runInContext)\s*\(\s*(?:req|request|params|query|body)\./i.test(
        body,
      ) ||
      /new\s+vm\.Script\s*\(\s*(?:req|request|params|query|body)\./i.test(body)
    ) {
      return "Node.js vm module (runInNewContext/runInThisContext/Script) executed with request-derived source — sandbox escape / RCE risk.";
    }
    return null;
  },

  "code-eval-groovyshell": (_url, _headers, body) => {
    if (
      /new\s+GroovyShell\s*\(\s*\)\s*\.\s*evaluate\s*\(\s*(?:request|req)\./i.test(
        body,
      )
    ) {
      return "GroovyShell.evaluate() called with request data — arbitrary Groovy/Java code execution risk.";
    }
    return null;
  },

  "code-eval-php-assert-string": (_url, _headers, body) => {
    if (/\bassert\s*\(\s*\$_(?:GET|POST|REQUEST|COOKIE)/i.test(body)) {
      return "PHP assert() called with user input — assert() evaluates string arguments as PHP code (CVE-class RCE).";
    }
    if (/\bcreate_function\s*\(/i.test(body)) {
      return "PHP create_function() detected — internally uses eval(); deprecated and removed in PHP 8. Replace with an anonymous function.";
    }
    return null;
  },

  // ── Additional insecure deserialization sinks (code-deser-*) ─────────────

  "code-deser-dotnet-binaryformatter": (_url, _headers, body) => {
    if (
      /BinaryFormatter\s*\(\s*\)[\s\S]{0,80}\.Deserialize\s*\(/i.test(body) ||
      /new\s+BinaryFormatter\s*\(\s*\)/i.test(body)
    ) {
      return "BinaryFormatter usage detected — Microsoft has deprecated it as fundamentally unsafe; deserializing untrusted data with it enables RCE.";
    }
    return null;
  },

  "code-deser-java-objectinputstream": (_url, _headers, body) => {
    const hasUserStream =
      /new\s+ObjectInputStream\s*\([^)]*(?:request\.|req\.|getInputStream\(\))/i.test(
        body,
      );
    if (hasUserStream && /\.readObject\s*\(\s*\)/.test(body)) {
      return "ObjectInputStream constructed from request data with readObject() called — classic Java deserialization RCE gadget-chain sink.";
    }
    return null;
  },

  "code-deser-ruby-marshal-load": (_url, _headers, body) => {
    if (/Marshal\.load\s*\(\s*(?:params|request|req)\b/i.test(body)) {
      return "Ruby Marshal.load() called with request/params data — Marshal.load can instantiate arbitrary objects, a known RCE gadget-chain sink.";
    }
    return null;
  },
};

/**
 * Detectors that already decide, per match, whether a hit sits inside a
 * documentation block. matchSecretPatterns reports a secret shown in a <pre>
 * differently from one shipped in live code, so it needs the full body and
 * must not be handed a pre-stripped one.
 */
const JUDGES_DOC_BLOCKS_ITSELF = new Set([
  "hardcoded-secrets",
  "hardcoded-secrets-high-risk",
  "hardcoded-secrets-client-exposed",
  "hardcoded-secrets-low-risk",
  "code-cloud-aws-hardcoded-credentials",
]);

/**
 * Detectors whose evidence is text on the page rather than code in it, so they
 * read the body with only the example blocks removed. A default credential
 * pair or an SSTI probe's echo is printed into the page as text; an XML
 * DOCTYPE and a meta-delivered CSP live in markup the prose view blanks; a
 * publishable key is as often in a data-* attribute as in a script.
 */
const READS_PAGE_TEXT = new Set([
  "default-credentials",
  "ssti-indicators",
  "path-traversal-indicators",
  "ldap-injection-indicators",
  "xml-external-entity",
  "code-stripe-publishable-key",
  "code-csp-missing-trusted-types",
]);

/**
 * Every other detector here looks for a source-code pattern (string-built SQL,
 * exec with a shell, unsafe deserialisation, an SSRF-shaped fetch), and reads
 * the page as stripProse leaves it: tags, behavioural attributes and authored
 * script, without the prose. Removing only the <pre> and <code> examples was
 * not enough, because a page about a vulnerability names the vulnerable call
 * in its headings, link text and data attributes too: this product's check
 * catalog alone raised create_function() at critical and HMAC === at high. Both
 * strips are memoised, so each costs one pass per body however many detectors
 * and modules read it.
 */
const withoutProse = withProseStripped(rawDetectors);
const withoutExamples = withDocBlocksStripped(rawDetectors);

export const detectors: Record<string, DetectFn> = Object.fromEntries(
  Object.entries(rawDetectors).map(([id, fn]) => [
    id,
    JUDGES_DOC_BLOCKS_ITSELF.has(id)
      ? fn
      : READS_PAGE_TEXT.has(id)
        ? withoutExamples[id]
        : withoutProse[id],
  ]),
);
