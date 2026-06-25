/**
 * Per-detector tests for the information-disclosure category.
 *
 * Covers 86 detectors in lib/scanner/checks/information-disclosure.ts.
 * Every detector is exercised by the smoke harness (callable, no-throw,
 * deterministic); the curated fixtures below cover a subset of detectors
 * whose behavior we can verify by reading the regex patterns in source.
 *
 * Detectors that depend on specific page context (framework detection,
 * debug-page fingerprinting, etc.) are smoke-only — the harness ensures
 * they remain callable without throwing on empty inputs.
 */

import { detectors } from "./information-disclosure";
import { runDetectorTests, type DetectorFixtures } from "./_test-harness";

const fixtures: DetectorFixtures = {
  // ── IP / PII ─────────────────────────────────────────────────────────

  "private-ip-exposure": [
    {
      description: "multiple private IPs in body",
      body: "<html><body><p>Server: 10.0.0.5, Backup: 10.0.0.6</p></body></html>",
      expect: "fire",
      evidenceIncludes: "10.0.0",
    },
    {
      description: "no private IP",
      body: "<html><body><p>Hello</p></body></html>",
      expect: "skip",
    },
  ],

  "hardcoded-ip-addresses": [
    {
      description: "2+ public IPs in body",
      body: "<html><body><p>Connect to 8.8.8.8 or 1.1.1.1 for DNS</p></body></html>",
      expect: "fire",
    },
  ],

  "email-exposure": [
    {
      description: "real email in body (not on test-domain deny list)",
      body: '<html><body><p>Contact: <a href="mailto:admin@vulnradar.dev">admin@vulnradar.dev</a></p></body></html>',
      expect: "fire",
      evidenceIncludes: "vulnradar.dev",
    },
  ],

  "email-address-leak": [
    {
      description: "many real emails in body (>10)",
      body:
        "<html><body>" +
        Array.from({ length: 12 }, (_, i) => `user${i}@vulnradar.dev`).join(
          "<br>",
        ) +
        "</body></html>",
      expect: "fire",
    },
  ],

  "phone-number-leak": [
    {
      description: "many phone numbers in body (>5)",
      body:
        "<html><body>" +
        Array.from(
          { length: 7 },
          (_, i) => `(555) 123-${String(i).padStart(4, "0")}`,
        ).join("<br>") +
        "</body></html>",
      expect: "fire",
    },
  ],

  "credit-card-pattern": [
    {
      description: "credit-card-like number in body (no dashes)",
      body: "<html><body>Card: 4111111111111111</body></html>",
      expect: "fire",
      evidenceIncludes: "credit card",
    },
  ],

  "ssn-pattern": [
    {
      description: "SSN-like number outside <script>",
      body: "<html><body>SSN: 123-45-6789</body></html>",
      expect: "fire",
      evidenceIncludes: "SSN",
    },
  ],

  // ── Errors / stack traces ───────────────────────────────────────────

  "exposed-error-messages": [
    {
      description: "Fatal error with line number",
      body: "<html><body>Fatal error: Call to undefined function foo() in /var/www/app.php on line 42</body></html>",
      expect: "fire",
      evidenceIncludes: "PHP",
    },
  ],

  "exposed-stack-trace": [
    {
      description: "Node stack trace format",
      body: "<html><body>Error at MyClass (/var/www/app.js:42:13)</body></html>",
      expect: "fire",
    },
  ],

  "stack-trace-exposed": [],

  "sql-error-in-page": [
    {
      description: "MySQL error in body",
      body: "<html><body>You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version</body></html>",
      expect: "fire",
    },
  ],

  "php-error-in-page": [
    {
      description: "PHP Fatal error",
      body: "<html><body>PHP Fatal error: Allowed memory size exhausted in /var/www/app.php on line 42</body></html>",
      expect: "fire",
    },
  ],

  "asp-error-in-page": [
    {
      description: "ASP.NET error",
      body: "<html><body>Server Error in '/' Application. Runtime Error</body></html>",
      expect: "fire",
    },
  ],

  "django-debug-page": [
    {
      description: "Django debug page with settings.py reference",
      body: "<html><body>Django Version: 4.2 settings.py INSTALLED_APPS</body></html>",
      expect: "fire",
    },
  ],

  "laravel-debug-page": [
    {
      description: "Laravel Whoops error page",
      body: "<html><body>Whoops\\Run\\Illuminate\\Exception</body></html>",
      expect: "fire",
    },
  ],

  "verbose-error-messages": [
    {
      description: "verbose exception details",
      body: "<html><body>syntax error at line 42: undefined variable foo</body></html>",
      expect: "fire",
    },
  ],

  // ── Source maps / debug paths ───────────────────────────────────────

  "sourcemap-reference": [
    {
      description: "JS with sourceMappingURL",
      body: '<html><body><script src="/app.js">//# sourceMappingURL=/app.js.map</script></body></html>',
      expect: "fire",
      evidenceIncludes: "source map",
    },
  ],

  "env-file-reference": [
    {
      description: "/.env file reference",
      body: "<html><body>Cannot load /.env.local</body></html>",
      expect: "fire",
    },
  ],

  "backup-file-reference": [
    {
      description: ".bak file referenced",
      body: "<html><body>Cannot load /var/www/config.bak</body></html>",
      expect: "fire",
    },
  ],

  "phpinfo-exposed": [
    {
      description: "phpinfo() page title",
      body: "<html><head><title>phpinfo()</title></head></html>",
      expect: "fire",
    },
  ],

  // ── Endpoints / framework ───────────────────────────────────────────

  "wp-login-exposed": [
    {
      description: "wp-login + WordPress generator",
      body: '<html><head><meta name="generator" content="WordPress 6.4"></head><body><a href="/wp-login.php">Login</a></body></html>',
      expect: "fire",
    },
  ],

  "sensitive-endpoints": [
    {
      description: "/wp-admin referenced",
      body: '<html><body><a href="/wp-admin/setup-config.php">setup</a></body></html>',
      expect: "fire",
    },
  ],

  "debug-endpoint": [
    {
      description: "/debug endpoint",
      body: '<html><body>Visit <a href="/debug/pprof">debug</a></body></html>',
      expect: "fire",
    },
  ],

  "admin-endpoint": [
    {
      description: "/admin endpoint",
      body: '<html><body>Visit <a href="/admin/login">admin</a></body></html>',
      expect: "fire",
    },
  ],

  "swagger-docs-exposed": [
    {
      description: "Swagger UI link",
      body: '<html><body><a href="/swagger-ui">API docs</a></body></html>',
      expect: "fire",
    },
  ],

  "spring-boot-actuator": [
    {
      description: "Actuator /env endpoint",
      body: '<html><body><a href="/actuator/env">env</a></body></html>',
      expect: "fire",
    },
  ],

  "aws-metadata-reference": [
    {
      description: "AWS metadata IP",
      body: "<html><body>Server reachable at 169.254.169.254</body></html>",
      expect: "fire",
      evidenceIncludes: "169.254.169.254",
    },
  ],

  "s3-bucket-exposed": [],
  "firebase-config-exposed": [],

  // ── JWT / tokens ────────────────────────────────────────────────────

  "jwt-in-html": [
    {
      description: "JWT literal in HTML",
      body: "<html><body>token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c</body></html>",
      expect: "fire",
    },
  ],

  // token-exposure, exposed-session-id, outdated-angular, api-version-exposed,
  // open-api-schema-version-leak, cdn-cors-exposes-internal, email-enumeration,
  // oauth-state-missing, remember-me-token, s3-bucket-exposed, firebase-config-exposed
  // — detector patterns are too narrow / require specific page context. Smoke-only.

  "password-in-get": [
    {
      description: "password in URL query string",
      body: "<html><body>GET /login?user=admin&password=secret123</body></html>",
      expect: "fire",
    },
  ],

  "outdated-js-libs": [
    {
      description: "old jQuery 1.x",
      body: '<html><body><script src="/jquery-1.4.2.min.js"></script></body></html>',
      expect: "fire",
    },
  ],

  "outdated-jquery": [
    {
      description: "old jQuery",
      body: '<html><body><script src="/jquery-1.6.0.js"></script></body></html>',
      expect: "fire",
    },
  ],

  // outdated-angular — smoke-only (regex too narrow for fixture)

  "exposed-api-version": [
    {
      description: "X-API-Version header",
      headers: { "x-api-version": "2.0" },
      expect: "fire",
    },
  ],

  "privacy-policy-missing": [
    {
      description: "no privacy link in body",
      body: "<html><body><h1>About</h1></body></html>",
      expect: "fire",
    },
    {
      description: "privacy link present",
      body: '<html><body><a href="/privacy">Privacy Policy</a></body></html>',
      expect: "skip",
    },
  ],

  "terms-of-service-missing": [
    {
      description: "no terms link",
      body: "<html><body><h1>Welcome</h1></body></html>",
      expect: "fire",
    },
  ],

  "sitemap-missing": [
    {
      description: "no sitemap link",
      body: "<html><body><h1>Welcome</h1></body></html>",
      expect: "fire",
    },
  ],

  "html-comment-leaks": [
    {
      description: "TODO in HTML comment",
      body: "<html><body><!-- TODO: remove debug print before launch --></body></html>",
      expect: "fire",
    },
  ],

  "sql-error-exposure": [
    {
      description: "PostgreSQL error",
      body: '<html><body>pg_query(): Query failed: ERROR: syntax error at or near "FROM"</body></html>',
      expect: "fire",
    },
  ],

  // ── Cookies / framework versions ────────────────────────────────────

  "php-version-exposed-in-cookie": [
    {
      description: "PHPSESSID cookie",
      cookies: ["PHPSESSID=abc123; Path=/"],
      expect: "fire",
    },
  ],

  "django-csrftoken-cookie-exposed": [
    {
      description: "csrftoken cookie",
      cookies: ["csrftoken=abc123; Path=/"],
      expect: "fire",
    },
  ],

  "laravel-session-cookie-exposes": [
    {
      description: "laravel_session cookie",
      cookies: ["laravel_session=abc"],
      expect: "fire",
    },
  ],

  "express-cookie-exposes": [
    {
      description: "connect.sid cookie",
      cookies: ["connect.sid=abc"],
      expect: "fire",
    },
  ],

  "rails-cookie-httponly": [
    {
      description: "_session_id cookie",
      cookies: ["_session_id=abc"],
      expect: "fire",
    },
  ],

  "nextjs-app-router-rsc-headers": [
    {
      description: "RSC header",
      headers: { rsc: "1" },
      expect: "fire",
    },
  ],

  "vite-client-exposed": [
    {
      description: "Vite client in dev",
      body: '<html><body><script type="module" src="/@vite/client"></script></body></html>',
      expect: "fire",
    },
  ],

  "sveltekit-detection": [
    {
      description: "SvelteKit __data.json",
      body: '<html><body><script src="/__data.json"></script></body></html>',
      expect: "fire",
    },
  ],

  "config-js-leaked": [
    {
      description: "config.js script",
      body: '<html><body><script src="/config.js"></script></body></html>',
      expect: "fire",
    },
  ],

  "env-js-leaked": [
    {
      description: "env.js script",
      body: '<html><body><script src="/env.js"></script></body></html>',
      expect: "fire",
    },
  ],

  // ── 404 / version disclosure ─────────────────────────────────────────

  "nginx-version-404-disclosure": [
    {
      description: "nginx 404 page",
      body: "<html><body>nginx/1.18.0 (Ubuntu)</body></html>",
      expect: "fire",
    },
  ],

  "apache-version-404-disclosure": [
    {
      description: "Apache 404 page",
      body: "<html><body>Apache/2.4.41 (Ubuntu) Server at example.com Port 443</body></html>",
      expect: "fire",
    },
  ],

  "iis-version-404-disclosure": [
    {
      description: "IIS 404 page",
      body: "<html><body>Microsoft-IIS/10.0</body></html>",
      expect: "fire",
    },
  ],

  "express-error-format-disclosure": [
    {
      description: "Express error format",
      body: "<html><body>Error: Cannot GET /admin</body></html>",
      expect: "fire",
    },
  ],

  "flask-debug-page-exposure": [
    {
      description: "Flask traceback",
      body: "<html><body>Traceback (most recent call last):</body></html>",
      expect: "fire",
    },
  ],

  "django-debug-page-exposure": [
    {
      description: "Django settings module",
      body: "<html><body>DJANGO_SETTINGS_MODULE=myapp.settings</body></html>",
      expect: "fire",
    },
  ],

  "rails-error-page-disclosure": [
    {
      description: "Rails error page",
      body: "<html><body>Rails.root: /var/www/app</body></html>",
      expect: "fire",
    },
  ],

  "spring-boot-actuator-exposed": [
    {
      description: "Actuator endpoint in body",
      body: '<html><body><a href="/actuator/env">env</a></body></html>',
      expect: "fire",
    },
  ],

  "jenkins-version-exposure": [
    {
      description: "Jenkins version",
      body: "<html><body>Jenkins ver. 2.387.3</body></html>",
      expect: "fire",
    },
  ],

  "grafana-version-exposure": [
    {
      description: "Grafana version",
      body: "<html><body>Grafana v9.5.0</body></html>",
      expect: "fire",
    },
  ],

  "recaptcha-key-leaked": [
    {
      description: "reCAPTCHA site key",
      body: "<html><body>site_key=6Lc-abc123</body></html>",
      expect: "fire",
    },
  ],

  "ga-tracking-id-leaked": [
    {
      description: "Google Analytics ID",
      body: "<html><body>UA-12345-67</body></html>",
      expect: "fire",
    },
  ],

  "aws-s3-nosuchbucket-error": [
    {
      description: "S3 NoSuchBucket error",
      body: "<html><body>NoSuchBucket: The specified bucket does not exist</body></html>",
      expect: "fire",
    },
  ],

  "mysql-access-denied-error": [
    {
      description: "MySQL Access Denied",
      body: "<html><body>Access denied for user 'root'@'localhost' (using password: YES)</body></html>",
      expect: "fire",
    },
  ],

  "open-api-schema-version-leak": [],
  "cdn-cors-exposes-internal": [],

  "timing-allow-origin-wide": [
    {
      description: "Timing-Allow-Origin: *",
      headers: { "timing-allow-origin": "*" },
      expect: "fire",
    },
  ],

  "sitemap-public": [
    {
      description: "sitemap link in body",
      body: '<html><body><a href="/sitemap.xml">Sitemap</a></body></html>',
      expect: "fire",
    },
  ],

  "robots-txt-allows-all": [
    {
      description: "robots.txt allows all",
      body: "User-agent: *\nAllow: /",
      expect: "fire",
    },
  ],

  "email-enumeration": [],
  "oauth-state-missing": [],
  "remember-me-token": [],

  "debug-indicators": [
    {
      description: "DEBUG=True in body",
      body: "<html><body>DEBUG = True</body></html>",
      expect: "fire",
    },
  ],
};

runDetectorTests(detectors, fixtures);
