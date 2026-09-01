/**
 * Per-detector tests for the code category.
 *
 * Covers 154 detectors in lib/scanner/checks/code.ts. Every detector
 * is exercised by the smoke harness (callable, no-throw, deterministic);
 * a small number of detectors with simple enough patterns also get
 * explicit positive fixtures.
 *
 * Most code detectors look for specific JS patterns in `<script>`
 * blocks; the fixtures below use straightforward patterns that the
 * detector regexes match directly. Detectors with very narrow patterns
 * (e.g. requiring ≥2 occurrences of a sink) are smoke-only.
 */

import { detectors } from "@/lib/scanner/checks/code";
import { runDetectorTests, type DetectorFixtures } from "./_test-harness";

const fixtures: DetectorFixtures = {
  "hardcoded-credentials": [
    {
      description: "a real-looking hardcoded password value fires",
      body: '<script>const config = { password: "Tr0ub4dor&3xyz" };</script>',
      expect: "fire",
    },
    {
      description:
        "React/Vue form-state initializer with an empty password field does not fire",
      body: "<script>const [form, setForm] = useState({ email: '', password: '' });</script>",
      expect: "skip",
    },
    {
      description:
        'a role dropdown option ({ role: "admin" }) does not fire -- a role label is not a credential',
      body: '<script>const roles = [{ role: "admin", label: "Administrator" }];</script>',
      expect: "skip",
    },
    {
      description:
        "UI copy telling the user to enter their password does not fire",
      body: '<div data-i18n=\'{"password": "Enter your password"}\'></div>',
      expect: "skip",
    },
    {
      description: "a masked-input placeholder value does not fire",
      body: '<script>const input = { password: "********" };</script>',
      expect: "skip",
    },
    {
      description:
        "a role-label map with admin/root as KEYS (RBAC display names, not credentials) does not fire -- 3+ sibling key:value pairs signal a label map",
      body: '<script>const ROLE_LABELS = { admin: "Administrator", root: "FullAccess", editor: "Editor" };</script>',
      expect: "skip",
    },
  ],

  "insecure-auth": [
    {
      description:
        "an i18n/translation blob with label text for both fields does not fire",
      body: '<script>const t = { username: "Username", password: "Password" };</script>',
      expect: "skip",
    },
    {
      description:
        "a real hardcoded default-credential pair (ordinary username value, real-looking password value) fires",
      body: '<script>const DEFAULT_LOGIN = { username: "admin", password: "hunter2fake" };</script>',
      expect: "fire",
    },
  ],

  "code-auth-sessionstorage-passwords": [
    {
      description:
        "a password-visibility UI toggle flag (pwdVisible) does not fire",
      body: '<script>sessionStorage.setItem("pwdVisible", "false");</script>',
      expect: "skip",
    },
    {
      description:
        "a differently-prefixed key (passwordResetRequested) does not fire",
      body: '<script>sessionStorage.setItem("passwordResetRequested", "1");</script>',
      expect: "skip",
    },
    {
      description: "an exact 'password' key fires",
      body: '<script>sessionStorage.setItem("password", userPassword);</script>',
      expect: "fire",
    },
  ],

  "innerhtml-xss-sink": [
    {
      description:
        "two innerHTML assignments from plain variables (no sanitizer) fire",
      body: "<script>el1.innerHTML = userInput; el2.innerHTML = otherInput;</script>",
      expect: "fire",
      evidenceIncludes: "innerHTML assignments",
    },
    {
      description:
        "el.innerHTML = DOMPurify.sanitize(x) is the documented-correct fix for this sink, not the vulnerability -- rendering a list of sanitized comments does not fire",
      body: "<script>el1.innerHTML = DOMPurify.sanitize(c.html); el2.innerHTML = DOMPurify.sanitize(c.html2);</script>",
      expect: "skip",
    },
  ],

  "outerhtml-xss-sink": [
    {
      description: "outerHTML assignment",
      body: "<html><body><script>document.body.outerHTML = name + '<div>' + '</div>';</script></body></html>",
      expect: "fire",
    },
  ],

  "document-write-sink": [
    {
      description: "document.write call",
      body: "<html><body><script>document.write('<h1>' + title + '</h1>');</script></body></html>",
      expect: "fire",
    },
  ],

  "insertadjacenthtml-sink": [
    {
      description: "insertAdjacentHTML call",
      body: "<html><body><script>el.insertAdjacentHTML('beforeend', html);</script></body></html>",
      expect: "fire",
    },
  ],

  "unsafe-setattribute": [
    {
      description: "setAttribute with on-handler",
      body: "<html><body><script>el.setAttribute('onclick', 'do(' + x + ')');</script></body></html>",
      expect: "fire",
    },
  ],

  "code-xss-template-tag": [
    {
      description:
        "interpolation inside the same html`...` tagged template fires -- genuine risk if unescaped",
      body: "<script>function render(x){ return html`<div>${x}</div>`; }</script>",
      expect: "fire",
    },
    {
      description:
        "regression: a static html`...` template with no interpolation of its own must NOT fire just because an unrelated ${...} interpolation exists later in the same script -- the middle wildcard used to be unbounded and matched across the closing backtick into unrelated code, misfiring on lit-html usage across dozens of real-world bulk-scan sites",
      body: "<script>function render(){ return html`<div>static content only</div>`; } function unrelated(){ const msg = `Hello ${name}`; return msg; }</script>",
      expect: "skip",
    },
  ],

  "eval-usage": [
    {
      description:
        "eval() — covered by eval-in-scripts; removed to reduce noise from minified bundles",
      body: "<html><body><script>eval(userInput);</script></body></html>",
      expect: "skip",
    },
  ],

  "function-constructor": [
    {
      description: "new Function() constructor",
      body: "<html><body><script>const fn = new Function('a', 'b', code);</script></body></html>",
      expect: "fire",
    },
  ],

  "settimeout-string": [
    {
      description:
        "covered by code-eval-setinterval-string; removed to avoid duplicate",
      body: "<html><body><script>setTimeout('alert(1)', 100);</script></body></html>",
      expect: "skip",
    },
  ],

  "localstorage-sensitive": [
    {
      description: "localStorage with token",
      body: "<html><body><script>localStorage.setItem('token', authToken);</script></body></html>",
      expect: "fire",
    },
  ],

  "default-credentials": [
    {
      description:
        "a bare default-credential reference with no surrounding warning language fires",
      body: "<html><body><p>Backend login: admin/admin</p></body></html>",
      expect: "fire",
      evidenceIncludes: "admin/admin",
    },
    {
      description:
        "a first-login banner telling the user to change the default credentials does not fire -- it's a security notice, not an exposed credential",
      body: "<html><body><p>Default username and password is admin/admin. Please change it after first login.</p></body></html>",
      expect: "skip",
    },
  ],

  "sql-injection-patterns": [
    {
      description:
        "a SQL query concatenated with a request-derived variable inside an inline script fires",
      body: '<html><body><script>const q = "SELECT * FROM users WHERE id = " + req.query.id;</script></body></html>',
      expect: "fire",
      evidenceIncludes: "SQL patterns in inline scripts",
    },
    {
      description:
        "a static hardcoded SQL string constant (e.g. sample/demo query text) with no concatenation does not fire",
      body: '<html><body><script>const sample = "SELECT * FROM users WHERE active = 1"; console.log(sample);</script></body></html>',
      expect: "skip",
    },
    {
      description:
        "regression: a doc page that prints a query in a <pre> block AND then genuinely concatenates the identical query in a script still fires -- each hit is scored at its own offset, where the old body.indexOf(text) lookup collapsed both onto the <pre> copy and dropped the real one",
      body:
        "<html><body><pre>\nSELECT * FROM users WHERE id = 1\n</pre>\n<p>" +
        "filler ".repeat(60) +
        '</p>\n<script>\nconst q = "SELECT * FROM users WHERE id = 1" + req.query.id;\n</script></body></html>',
      expect: "fire",
      evidenceIncludes: "SQL patterns in inline scripts",
    },
  ],

  "code-timing-no-constant-time-compare": [
    {
      description:
        "detector disabled (100% false positive rate on client-side JS)",
      body: "<html><body><script>if (token === stored) { allow = true; }</script></body></html>",
      expect: "skip",
    },
  ],

  // ── hardcoded-secrets severity tiers ──────────────────────────────────
  //
  // Split by whether the credential format has a legitimate reason to be
  // client-visible (see lib/scanner/checks/code.ts for the full pattern
  // lists and reasoning per tier). The AWS-key case pins the critical tier
  // still fires for genuine server-only secrets; the Google-API-key case
  // is the regression test for the bug that motivated the split — a
  // scan of walmart.com matched Google API keys via this check's old flat
  // "critical" severity, which alone was enough to mark the whole scan
  // "unsafe" even though Google API keys are designed to be client-visible
  // and are already covered at "medium" by google-api-key-exposed
  // (content.json) and secret-google-maps-api-key (secrets-extended.json).
  "hardcoded-secrets": [
    {
      description:
        "AWS access key — genuine server-only secret, stays critical",
      body: "<script>const key = 'AKIAABCDEFGHIJKLMNOP';</script>",
      expect: "fire",
      evidenceIncludes: "AWS Access Key",
    },
    {
      description:
        "Google API key ALONE must not fire here — no legitimate-secret pattern present, and the format is covered by google-api-key-exposed / secret-google-maps-api-key at medium severity instead of being re-flagged critical",
      body: "<script>const mapsKey = 'AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe';</script>",
      expect: "skip",
    },
    {
      description:
        "Twilio SID as a real quoted string literal near a Twilio-related identifier — genuine embedded credential shape, stays critical",
      body: "<script>const twilioAccountSid = 'AC1234567890abcdef1234567890abcdef';</script>",
      expect: "fire",
      evidenceIncludes: "Twilio Account SID",
    },
    {
      description:
        "regression: 'AC' + 32 hex chars occurring unquoted inside an unrelated hash (a cache-busting asset hash, not a credential) must NOT fire — this exact shape misfired on google.com/bing.com bulk-scan output before the quote-boundary fix",
      body: '<html><body><img src="/logo.png?v=ffffACfedcba9876543210fedcba98765432"></body></html>',
      expect: "skip",
    },
    {
      description:
        "regression: 'AC' + 32 hex chars quoted but with no Twilio-related keyword anywhere nearby must NOT fire — this exact shape misfired on google.com's minified homepage bundle after the quote-boundary fix alone",
      body: "<script>const x = 'ACAAACEAAAAAAAAAAAAAAAAAAAAAAAACEA';</script>",
      expect: "skip",
    },
    {
      description:
        "Facebook token as a real quoted string literal, stays critical",
      body: `<script>const fbToken = 'EAA${"a".repeat(100)}';</script>`,
      expect: "fire",
      evidenceIncludes: "Facebook Token",
    },
    {
      description:
        "regression: 'EAA' + 100 alphanumeric chars occurring unquoted inside an unrelated base64-ish blob must NOT fire",
      body: `<html><body><div data-tracking-blob="xxEAA${"b".repeat(100)}yy"></div></body></html>`,
      expect: "skip",
    },
    {
      description:
        "a real hardcoded database connection string assigned to dsn= still fires",
      body: '<script>const dsn = "postgres://user:pass@db.internal:5432/mydb";</script>',
      expect: "fire",
      evidenceIncludes: "Connection String",
    },
    {
      description:
        'regression: a Sentry DSN (dsn: "https://...@sentry.io/...") must NOT fire as "Connection String" -- this codebase\'s own Sentry DSN pattern (client-exposed tier) already documents it as not a secret per Sentry\'s own docs, but the old bare "dsn=" match with no scheme check flagged it critical anyway; reproduces the roblox.com bulk-scan false positive',
      body: '<script>Sentry.init({ dsn: "https://abc123def456abc123def456abc123df@o123456.ingest.sentry.io/1234304" });</script>',
      expect: "skip",
    },
  ],

  "hardcoded-secrets-high-risk": [
    {
      description:
        "HuggingFace write token — real secret, but blast radius is one vendor account, not full infra (high, not critical)",
      body: "<script>const t = 'hf_1234567890abcdefghijklmnopqrstuvwxyzAB';</script>",
      expect: "fire",
      evidenceIncludes: "HuggingFace Token",
    },
    {
      description: "clean page has nothing to flag",
      body: "<html><body><p>Nothing sensitive here.</p></body></html>",
      expect: "skip",
    },
  ],

  "hardcoded-secrets-client-exposed": [
    {
      description:
        "Mapbox public token (pk. prefix is Mapbox's own client-safe convention) — medium, matches this codebase's Google-key precedent",
      body: "<script>mapboxgl.accessToken = 'pk.eyJhbGciOiJIUzI1NiJ9.aBcDeFgHiJkLmN123';</script>",
      expect: "fire",
      evidenceIncludes: "Mapbox Public Token",
    },
    {
      description: "clean page has nothing to flag",
      body: "<html><body><p>Nothing sensitive here.</p></body></html>",
      expect: "skip",
    },
  ],

  "hardcoded-secrets-low-risk": [
    {
      description:
        "Firebase Realtime Database URL is a hostname, not a credential — informational (low)",
      body: "<script>const db = 'https://my-app-prod.firebaseio.com';</script>",
      expect: "fire",
      evidenceIncludes: "Firebase Database URL",
    },
    {
      description: "clean page has nothing to flag",
      body: "<html><body><p>Nothing sensitive here.</p></body></html>",
      expect: "skip",
    },
  ],

  "code-cookie-samesite-none-http": [
    {
      description:
        "a cookie genuinely sets SameSite=None without Secure, among other Set-Cookie headers that are fine",
      cookies: [
        "isoLoc=US_CA; Domain=.example.com; Path=/",
        "widget=1; SameSite=None",
        "bm_mi=xyz; Secure; SameSite=None",
      ],
      expect: "fire",
      evidenceIncludes: "downgrade risk",
    },
    {
      description:
        "the ONLY cookie using SameSite=None also has Secure — must not fire just because another unrelated cookie in the same response lacks Secure",
      cookies: [
        "isoLoc=US_CA; Domain=.example.com; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT",
        "ak_bmsc=abc123; Path=/; HttpOnly",
        "bm_mi=xyz; Secure; SameSite=None",
      ],
      expect: "skip",
    },
    {
      description: "no cookies at all",
      body: "<html><body>Hello</body></html>",
      expect: "skip",
    },
  ],
};

runDetectorTests(detectors, fixtures);
