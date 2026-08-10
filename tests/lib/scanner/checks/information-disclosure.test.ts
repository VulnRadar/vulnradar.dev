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

import { detectors } from "@/lib/scanner/checks/information-disclosure";
import { runDetectorTests, type DetectorFixtures } from "./_test-harness";

const fixtures: DetectorFixtures = {
  // ── IP / PII — handled by secrets-extended.ts (wins detectorMap as bundle 8 > 6) ────────────────

  // ── Errors / stack traces ───────────────────────────────────────────

  "exposed-error-messages": [
    {
      description: "Fatal error with line number",
      body: "<html><body>Fatal error: Call to undefined function foo() in /var/www/app.php on line 42</body></html>",
      expect: "fire",
      evidenceIncludes: "PHP",
    },
  ],

  "stack-trace-exposed": [],

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

  // "env-file-reference" is implemented in content.ts (owns the
  // "content"-category definition), so its fixtures live in
  // content.test.ts, not here -- fixture hygiene would fail otherwise
  // since this file's `detectors` map no longer has that key.

  "backup-file-reference": [
    {
      description: ".bak file in href attribute",
      body: '<html><body><a href="/backup/config.bak">Download</a></body></html>',
      expect: "fire",
    },
    {
      description:
        "bare .bak mention in text (not in attribute, no longer fires)",
      body: "<html><body>Cannot load /var/www/config.bak</body></html>",
      expect: "skip",
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
      description: "/admin URL is directly scanned",
      url: "https://example.com/admin/",
      expect: "fire",
    },
    {
      description:
        "body mentions /admin but URL is not admin (no longer fires on body)",
      url: "https://example.com/",
      body: '<html><body>Visit <a href="/admin/login">admin</a></body></html>',
      expect: "skip",
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

  // aws-metadata-reference, s3-bucket-exposed, firebase-config-exposed, jwt-in-html,
  // jwt-in-url, token-exposure — moved to secrets-extended.ts (bundle 8 wins). Smoke-only.

  // token-exposure, exposed-session-id, outdated-angular, api-version-exposed,
  // open-api-schema-version-leak, cdn-cors-exposes-internal, email-enumeration,
  // oauth-state-missing, remember-me-token
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

  // outdated-jquery and outdated-angular — handled by content.ts; smoke-only here

  "exposed-api-version": [
    {
      description: "X-API-Version header",
      headers: { "x-api-version": "2.0" },
      expect: "fire",
    },
  ],

  "privacy-policy-missing": [
    {
      description: "legal concern, not a security vulnerability (removed)",
      body: "<html><body><h1>About</h1></body></html>",
      expect: "skip",
    },
  ],

  "terms-of-service-missing": [
    {
      description: "legal concern, not a security vulnerability (removed)",
      body: "<html><body><h1>Welcome</h1></body></html>",
      expect: "skip",
    },
  ],

  "sitemap-missing": [
    {
      description: "SEO concern, not a security vulnerability (removed)",
      body: "<html><body><h1>Welcome</h1></body></html>",
      expect: "skip",
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
      description: "csrftoken cookie with no security attributes at all",
      cookies: ["csrftoken=abc123; Path=/"],
      expect: "fire",
      evidenceIncludes: "missing",
    },
    {
      description:
        "csrftoken cookie with Secure and SameSite set does NOT fire just for using the default name",
      cookies: ["csrftoken=abc123; Path=/; Secure; SameSite=Strict"],
      expect: "skip",
    },
  ],

  "laravel-session-cookie-exposes": [
    {
      description: "laravel_session cookie with no security attributes at all",
      cookies: ["laravel_session=abc"],
      expect: "fire",
      evidenceIncludes: "missing",
    },
    {
      description:
        "laravel_session cookie with all attributes set does NOT fire just for using the default name",
      cookies: ["laravel_session=abc; Secure; HttpOnly; SameSite=Strict"],
      expect: "skip",
    },
  ],

  "express-cookie-exposes": [
    {
      description: "connect.sid cookie with no security attributes at all",
      cookies: ["connect.sid=abc"],
      expect: "fire",
      evidenceIncludes: "missing",
    },
    {
      description:
        "connect.sid cookie with all attributes set does NOT fire just for using the default name",
      cookies: ["connect.sid=abc; Secure; HttpOnly; SameSite=Lax"],
      expect: "skip",
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
      description: "reCAPTCHA site keys are public by design (removed)",
      body: "<html><body>site_key=6Lc-abc123</body></html>",
      expect: "skip",
    },
  ],

  "ga-tracking-id-leaked": [
    {
      description: "GA tracking IDs are public by design (removed)",
      body: "<html><body>UA-12345-67</body></html>",
      expect: "skip",
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
      description: "URL is sitemap.xml directly",
      url: "https://example.com/sitemap.xml",
      expect: "fire",
    },
    {
      description:
        "body mentions sitemap but URL is not sitemap.xml (no longer fires on body)",
      url: "https://example.com/",
      body: '<html><body><a href="/sitemap.xml">Sitemap</a></body></html>',
      expect: "skip",
    },
  ],

  "robots-txt-allows-all": [
    {
      description:
        "allowing all crawlers is a design choice, not a vulnerability (removed)",
      body: "User-agent: *\nAllow: /",
      expect: "skip",
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
