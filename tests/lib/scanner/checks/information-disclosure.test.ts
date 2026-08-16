/**
 * Per-detector tests for the information-disclosure category.
 *
 * Covers 92 detectors in lib/scanner/checks/information-disclosure.ts.
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
      // TODO/FIXME/XXX/HACK are deliberately NOT flagged: they show up in
      // virtually every real production site's HTML comments and aren't a
      // credential leak. Same fix already applied once to content.ts's
      // sensitive-comments detector for the identical reason.
      description:
        "TODO in HTML comment is not flagged -- appears on nearly every real site",
      body: "<html><body><!-- TODO: remove debug print before launch --></body></html>",
      expect: "skip",
    },
    {
      description: "password with attached value in HTML comment fires",
      body: "<html><body><!-- password: hunter2fallback --></body></html>",
      expect: "fire",
      evidenceIncludes: "Sensitive keywords",
    },
    {
      description: "private key header in HTML comment fires",
      body: "<html><body><!-- -----BEGIN RSA PRIVATE KEY----- --></body></html>",
      expect: "fire",
    },
  ],

  "sql-error-exposure": [
    {
      description: "PostgreSQL error",
      body: '<html><body>pg_query(): Query failed: ERROR: syntax error at or near "FROM"</body></html>',
      expect: "fire",
      evidenceIncludes: "SQL error",
    },
    {
      description:
        "blog prose mentioning PostgreSQL and error handling, no actual DB error",
      body: "<html><body><p>We migrated our backend from MySQL to PostgreSQL. Error handling for failed queries is now centralized in a single wrapper.</p></body></html>",
      expect: "skip",
    },
    {
      description:
        "regression: a self-hosting guide mentioning PostgreSQL in one section, an unrelated <pre> env-var example, and an unrelated 'Error: ECONNREFUSED' troubleshooting entry does not fire -- fired on VulnRadar's own /docs/setup via this check's separate id from content.ts's sql-error-in-page, missed in the first pass because it's a differently-named duplicate",
      body: "<p>Configure PostgreSQL for the app.</p><pre>DATABASE_URL=postgresql://user:pass@host/db</pre><p>Error: ECONNREFUSED 127.0.0.1:5432</p>",
      expect: "skip",
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
    {
      description:
        "regression: an nginx version shown inside a documented sample API response does not fire -- fired on VulnRadar's own /docs/api, which documents a scan's responseHeaders shape including a literal 'server': 'nginx/1.18.0' example",
      body: '<pre>{"responseHeaders": {"server": "nginx/1.18.0"}}</pre>',
      expect: "skip",
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
      description: "Unhandled exception with a real JS stack frame",
      body: "<html><body>TypeError: foo is not a function\n    at Object.anonymous (/app/index.js:10:5)\n</body></html>",
      expect: "fire",
    },
    {
      description:
        "default 'Cannot GET' 404 is normal Express behavior, not a stack trace (no longer fires)",
      body: "<html><body>Error: Cannot GET /admin</body></html>",
      expect: "skip",
    },
  ],

  "flask-debug-page-exposure": [
    {
      description: "Werkzeug debugger page",
      body: "<html><body><h1>Werkzeug Debugger</h1></body></html>",
      expect: "fire",
    },
    {
      description:
        "bare Python traceback text is not Flask-specific (no longer fires)",
      body: "<html><body>Traceback (most recent call last):</body></html>",
      expect: "skip",
    },
  ],

  "django-debug-page-exposure": [
    {
      description:
        "real Django technical 500 page: version banner plus the structural markers the template always renders alongside it",
      body: "<html><body>Django Version: 4.2.1, Python Version: 3.11<br>Environment:<br>Request Method: GET</body></html>",
      expect: "fire",
    },
    {
      description:
        "bare version banner alone (e.g. a migration guide showing 'Django Version: 4.2') no longer fires -- same bug already fixed once for the sibling django-debug-page detector in content.ts",
      body: "<html><body><p>Upgrading from Django Version: 3.2 to 4.2 requires...</p></body></html>",
      expect: "skip",
    },
    {
      description:
        "bare DJANGO_SETTINGS_MODULE mention (e.g. deployment docs) no longer fires alone",
      body: "<html><body>export DJANGO_SETTINGS_MODULE=myproject.settings.production</body></html>",
      expect: "skip",
    },
    {
      description: "the DJANGO_DEBUG explanatory sentence fires on its own",
      body: "<html><body>You're seeing this error because you have <code>DJANGO_DEBUG</code> set to True.</body></html>",
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

  // ── Cloud / infra exposure ───────────────────────────────────────────

  "kubernetes-api-server-exposed": [
    {
      description: "real Kubernetes Status/Forbidden response body",
      body: '{"kind":"Status","apiVersion":"v1","metadata":{},"status":"Failure","message":"forbidden: User \\"system:anonymous\\" cannot get path \\"/api/v1\\"","reason":"Forbidden","details":{},"code":403}',
      expect: "fire",
      evidenceIncludes: "Status response",
    },
    {
      description: "same Status JSON shown as a documentation example in <pre>",
      body: '<html><body><p>Example Kubernetes error response:</p><pre>{"kind":"Status","apiVersion":"v1","metadata":{},"status":"Failure","message":"forbidden","reason":"Forbidden","code":403}</pre></body></html>',
      expect: "skip",
    },
  ],

  "docker-registry-v2-exposed": [
    {
      description: "open unauthenticated registry root ('{}')",
      headers: { "docker-distribution-api-version": "registry/2.0" },
      body: "{}",
      expect: "fire",
      evidenceIncludes: "no auth challenge",
    },
    {
      description:
        "properly authenticated registry (WWW-Authenticate challenge present)",
      headers: {
        "docker-distribution-api-version": "registry/2.0",
        "www-authenticate":
          'Bearer realm="https://auth.docker.io/token",service="registry.docker.io"',
      },
      body: '{"errors":[{"code":"UNAUTHORIZED","message":"authentication required"}]}',
      expect: "skip",
    },
  ],

  "terraform-state-file-exposed": [
    {
      description:
        "real .tfstate body with terraform_version, lineage UUID, and resources",
      body: '{"version":4,"terraform_version":"1.5.7","serial":12,"lineage":"a1b2c3d4-e5f6-4789-a012-3456789abcde","outputs":{},"resources":[{"mode":"managed","type":"aws_db_instance","name":"main"}]}',
      expect: "fire",
      evidenceIncludes: "terraform state file",
    },
    {
      description: "same shape shown as a documentation example",
      body: '<html><body><p>Example .tfstate structure (documentation):</p><pre>{"terraform_version":"1.5.7","lineage":"a1b2c3d4-e5f6-4789-a012-3456789abcde","resources":[]}</pre></body></html>',
      expect: "skip",
    },
  ],

  "consul-api-exposed": [
    {
      description: "Consul catalog response with Consul-specific headers",
      headers: { "x-consul-index": "42", "x-consul-knownleader": "true" },
      body: '{"consul":[],"web":["primary"],"redis":["primary","secondary"]}',
      expect: "fire",
      evidenceIncludes: "ACL token",
    },
    {
      description: "ACL enabled, permission denied",
      headers: { "x-consul-index": "42", "x-consul-knownleader": "true" },
      body: "Permission denied",
      expect: "skip",
    },
  ],

  "etcd-api-exposed": [
    {
      description: "real etcd /version response",
      body: '{"etcdserver":"3.5.9","etcdcluster":"3.5.0"}',
      expect: "fire",
      evidenceIncludes: "client certificate",
    },
    {
      description: "same fields shown as a documentation example",
      body: '<html><body><p>Example etcd version output:</p><pre>{"etcdserver":"3.5.9","etcdcluster":"3.5.0"}</pre></body></html>',
      expect: "skip",
    },
  ],

  "prometheus-metrics-exposed": [
    {
      description: "real Prometheus text-exposition output",
      body: '# HELP go_gc_duration_seconds A summary of the GC invocation durations.\n# TYPE go_gc_duration_seconds summary\ngo_gc_duration_seconds{quantile="0"} 1.7137e-05\nprocess_start_time_seconds 1.6987e+09\n',
      expect: "fire",
      evidenceIncludes: "without authentication",
    },
    {
      description: "same lines shown as a documentation example in <pre>",
      body: '<html><body><p>Example Prometheus output (documentation):</p><pre># HELP go_gc_duration_seconds A summary of GC durations.\n# TYPE go_gc_duration_seconds summary\ngo_gc_duration_seconds{quantile="0"} 1.7137e-05\n</pre></body></html>',
      expect: "skip",
    },
    {
      description: "prose mention of # HELP / # TYPE with no real metric data",
      body: "<html><body><p>Learn about Prometheus # HELP and # TYPE comment conventions in our guide.</p></body></html>",
      expect: "skip",
    },
  ],
};

runDetectorTests(detectors, fixtures);
