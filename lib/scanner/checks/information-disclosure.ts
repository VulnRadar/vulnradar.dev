/**
 * Information-disclosure detectors.
 *
 * Detectors that flag PII / fingerprint / private-IP exposure in the
 * response body or in headers that are widely considered sensitive.
 *
 * "Secrets" patterns (API keys, JWTs, private keys) live in
 * secrets-extended.ts so this file stays focused on passive disclosure
 * rather than active credential leaks.
 */

import {
  getHeader,
  getSetCookies,
  hasHeader,
  parseCookieName,
  stripExampleContent,
  type EvidenceFn as DetectFn,
} from "../_helpers";

export const detectors: Record<string, DetectFn> = {
  // ── Private / internal IPs / email / PII — moved to secrets-extended.ts ──────────────────────────────
  // secrets-extended (bundle 8) loads after information-disclosure (bundle 6), so its versions win the
  // detectorMap. Keeping duplicate implementations here would be dead code.

  // "hardcoded-ip-addresses" is implemented in content.ts (uses stripExampleContent) — removed duplicate here

  // "internal-ip-exposed" is implemented in content.ts — removed dead stub here

  // ── Errors / stack traces ───────────────────────────────────────────────

  "exposed-error-messages": (_url, _headers, body) => {
    const patterns = [
      { name: "PHP error", pattern: /(?:Fatal|Parse) error:.*on line \d+/i },
      {
        name: "MySQL error",
        pattern:
          /(?:mysql_|mysqli_).*error|You have an error in your SQL syntax/i,
      },
      {
        name: "PostgreSQL error",
        pattern: /ERROR:\s+(?:relation|column|syntax error at)/i,
      },
      {
        name: ".NET error",
        pattern:
          /Server Error in ['"]\/['"] Application|Stack Trace:.*at System\./i,
      },
      {
        name: "Django error",
        pattern: /Traceback \(most recent call last\)|SyntaxError at \//i,
      },
    ];
    const found: string[] = [];
    for (const { name, pattern } of patterns) {
      if (pattern.test(body)) found.push(name);
    }
    return found.length > 0
      ? `Error messages exposed: ${found.join(", ")}`
      : null;
  },

  "stack-trace-exposed": (_url, _headers, body) => {
    // Python traceback is unambiguous on its own
    if (/Traceback \(most recent call last\)/i.test(body)) {
      return "Stack trace exposed in page output (Python traceback detected).";
    }
    // JS/Node stack traces: require ≥2 frame lines to avoid FPs on doc pages
    const frames = body.match(/at\s+[\w.$<>[\]/]+\s+\([^)]+:\d+:\d+\)/gm) || [];
    if (frames.length >= 2) {
      return `Stack trace exposed in page output: ${frames.slice(0, 2).join("; ")}`;
    }
    return null;
  },

  // "sql-error-in-page" is implemented in content.ts (uses stripExampleContent + tighter regex) — removed duplicate here

  "php-error-in-page": (_url, _headers, body) => {
    if (
      /PHP (Fatal|Parse|Warning|Notice) error/i.test(body) ||
      /on line \d+ in \/[^\s]+\.php/i.test(body)
    ) {
      return "PHP error/warning message found in page output.";
    }
    return null;
  },

  "asp-error-in-page": (_url, _headers, body) => {
    if (
      /Server Error in .* Application/i.test(body) ||
      /ASP\.NET.*Unhandled Exception/i.test(body)
    ) {
      return "ASP.NET error page detected in response.";
    }
    return null;
  },

  "django-debug-page": (_url, _headers, body) => {
    if (
      /Django Version:|Traceback.*most recent call/i.test(body) &&
      /settings\.py|INSTALLED_APPS/i.test(body)
    ) {
      return "Django debug page detected with framework details exposed.";
    }
    return null;
  },

  "laravel-debug-page": (_url, _headers, body) => {
    if (/Whoops.*Laravel|Illuminate\\.*Exception/i.test(body)) {
      return "Laravel debug page (Whoops) detected with framework details.";
    }
    return null;
  },

  "debug-indicators": (_url, headers, body) => {
    const found: string[] = [];
    if (headers.has("x-debug-token")) found.push("X-Debug-Token header");
    if (headers.has("x-debug-token-link"))
      found.push("X-Debug-Token-Link header");
    if (body.includes("Traceback (most recent call last)"))
      found.push("Python traceback");
    if (body.includes("at Object.<anonymous>") && body.includes(".js:"))
      found.push("Node.js stack trace");
    if (/SQLSTATE\[/i.test(body)) found.push("SQL error");
    if (/Fatal error:.+on line \d+/i.test(body)) found.push("PHP fatal error");
    if (/Exception in thread/i.test(body)) found.push("Java exception");
    if (body.includes("Laravel") && body.includes("Stack trace"))
      found.push("Laravel debug mode");
    if (body.includes("DEBUG = True") || body.includes("debug_toolbar"))
      found.push("Debug mode enabled");
    return found.length > 0
      ? `Debug indicators found: ${found.join(", ")}`
      : null;
  },

  "verbose-error-messages": (_url, _headers, body) => {
    // Only fire on unambiguous runtime error patterns — not common prose phrases
    // like "syntax error" in documentation or "at line 1" in changelogs.
    const patterns = [
      /undefined variable (?:\$\w+|\w+)/i,
      /null pointer (?:exception|dereference)/i,
      /access violation at address/i,
      /Fatal error: Uncaught .+ in \/[^\s]+\.php on line \d+/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) return "Verbose error message found in page output.";
    }
    return null;
  },

  // ── Source maps / debug paths ────────────────────────────────────────────

  "sourcemap-reference": (_url, _headers, body) => {
    if (/\/\/[#@]\s*sourceMappingURL\s*=\s*\S+\.map/i.test(body)) {
      return "JavaScript source map URL reference found. Source maps expose original source code.";
    }
    return null;
  },

  // "source-maps" is a duplicate of "sourcemap-reference"; both JSON defs are in content.json.
  // Removing from here restores content.ts as the handler for both IDs.

  "git-directory-exposed": (_url, _headers, body) => {
    if (/\/?\.git\/(HEAD|config|objects|refs)/i.test(body)) {
      return ".git directory paths detected in page source.";
    }
    return null;
  },

  // "env-file-reference" is implemented in content.ts (owns the
  // "content"-category definition per registry.ts's resolveDetector) --
  // removed dead duplicate here.

  "backup-file-reference": (_url, _headers, body) => {
    // Only fire when the extension appears inside a href/src/action attribute to avoid FPs
    // on CSS class names, documentation, or changelog text.
    const m = body.match(
      /(?:href|src|action)=["'][^"']*\.(bak|old|orig|save|swp|tmp|backup)["']/gi,
    );
    if (m && m.length > 0) {
      return `Backup file references found in links/assets: ${m.slice(0, 2).join(", ")}`;
    }
    return null;
  },

  "phpinfo-exposed": (_url, _headers, body) => {
    if (/<title>phpinfo\(\)/i.test(body) || /phpinfo\.php/i.test(body)) {
      return "phpinfo() page or reference detected. This exposes complete server configuration.";
    }
    return null;
  },

  "wp-login-exposed": (_url, _headers, body) => {
    if (
      /wp-login\.php|wp-admin\//i.test(body) &&
      /<meta[^>]*generator[^>]*wordpress/i.test(body)
    ) {
      return "WordPress admin/login page paths exposed with WordPress generator tag.";
    }
    return null;
  },

  "sensitive-endpoints": (_url, _headers, body) => {
    const endpoints = [
      /\/api\/v\d+\/(?:users|admin|internal|debug|graphql|webhook)/gi,
      /\/wp-admin/gi,
      /\/phpmyadmin/gi,
      /\/\.env/gi,
      /\/actuator/gi,
      /\/elmah\.axd/gi,
      /\/server-status/gi,
    ];
    const found: string[] = [];
    for (const p of endpoints) {
      const matches = body.match(p);
      if (matches) found.push(...matches.slice(0, 2));
    }
    const unique = [...new Set(found)];
    return unique.length > 0
      ? `Sensitive endpoint references: ${unique.slice(0, 5).join(", ")}`
      : null;
  },

  "debug-endpoint": (_url, _headers, body) => {
    if (/\/debug\/|\/trace\/|\/profiler\/|\/_debug\//gi.test(body)) {
      return "Debug endpoints referenced in page source.";
    }
    return null;
  },

  "admin-endpoint": (url, _headers, _body) => {
    if (
      /\/admin(?:\/|$)|\/administrator(?:\/|$)|\/management(?:\/|$)/i.test(url)
    ) {
      return "Admin/management endpoint is publicly accessible.";
    }
    return null;
  },

  // ── CMS / framework fingerprints ─────────────────────────────────────────

  "cms-fingerprinting": (_url, headers, body) => {
    // Only report version-specific fingerprints (not framework presence alone).
    // Next.js, Nuxt.js, and bare WordPress are too common to flag without version info.
    const found: string[] = [];
    const generator = body.match(
      /<meta[^>]*name=["']generator["'][^>]*content=["']([^"']+)["']/i,
    );
    if (generator) found.push(`Generator: ${generator[1]}`);
    // Only flag X-Powered-By if it exposes a version string (e.g. "PHP/8.1.2")
    const powered = headers.get("x-powered-by");
    if (powered && /\d/.test(powered)) found.push(`X-Powered-By: ${powered}`);
    if (/drupal\.js|Drupal\.settings/i.test(body)) found.push("Drupal");
    if (/\/joomla\//i.test(body)) found.push("Joomla");
    return found.length > 0
      ? `Technology fingerprints: ${found.join(", ")}`
      : null;
  },

  "graphql-endpoint-exposed": (_url, _headers, body) => {
    if (/["']\/graphi?ql["']|__schema\s*\{|introspectionQuery/i.test(body)) {
      return "GraphQL endpoint or introspection references found in page source.";
    }
    return null;
  },

  "swagger-docs-exposed": (_url, _headers, body) => {
    if (/swagger-ui|\/api-docs|openapi\.json|\/swagger\.json/i.test(body)) {
      return "Swagger/OpenAPI documentation endpoints referenced in page source.";
    }
    return null;
  },

  "spring-boot-actuator": (_url, _headers, body) => {
    if (/\/actuator\/(health|env|info|beans|mappings)/i.test(body)) {
      return "Spring Boot Actuator endpoints found in page source.";
    }
    return null;
  },

  // ── Cloud / infra references — moved to secrets-extended.ts ─────────────────────────────────────────
  // aws-metadata-reference, s3-bucket-exposed, firebase-config-exposed, jwt-in-html,
  // jwt-in-url, token-exposure: secrets-extended (bundle 8) wins; removed dead duplicates here.

  "exposed-session-id": (_url, _headers, body) => {
    if (
      /[?&](?:session_id|sid|PHPSESSID|JSESSIONID|ASP\.NET_SessionId)=/gi.test(
        body,
      )
    ) {
      return "Session ID exposed in URL - session fixation risk.";
    }
    return null;
  },

  "password-in-get": (_url, _headers, body) => {
    if (/[?&](?:password|passwd|pwd|pass)=/gi.test(body)) {
      return "Password parameter found in URL (GET request) - credentials exposed in logs.";
    }
    return null;
  },

  "remember-me-token": (_url, _headers, body) => {
    if (/[?&](?:remember|rememberme|remember_token)=/gi.test(body)) {
      return "Remember-me token exposed in URL.";
    }
    return null;
  },

  "oauth-state-missing": (_url, _headers, _body) => {
    // Broken: negative lookahead + global flag causes incorrect match state;
    // also fires on legitimate OAuth flows where state appears later in the URL.
    return null;
  },

  "email-enumeration": (_url, _headers, body) => {
    if (/email.*(?:already exists|not found|is taken|invalid)/gi.test(body)) {
      return "Error message reveals email existence - user enumeration risk.";
    }
    return null;
  },

  // ── Outdated libraries ──────────────────────────────────────────────────

  "outdated-js-libs": (_url, _headers, body) => {
    const libs: { name: string; pattern: RegExp; maxSafe: string }[] = [
      {
        name: "jQuery < 3.5.0",
        pattern: /jquery[./\-]([123]\.\d+\.\d+)/i,
        maxSafe: "3.5.0",
      },
      {
        name: "Angular.js 1.x",
        pattern: /angular(?:\.min)?\.js.*?(\d+\.\d+\.\d+)/i,
        maxSafe: "2.0.0",
      },
      {
        name: "Lodash < 4.17.21",
        pattern: /lodash.*?(\d+\.\d+\.\d+)/i,
        maxSafe: "4.17.21",
      },
      {
        name: "Bootstrap < 5.3.0",
        pattern: /bootstrap(?:\.min)?\.(?:js|css).*?(\d+\.\d+\.\d+)/i,
        maxSafe: "5.3.0",
      },
      {
        name: "Moment.js (deprecated)",
        pattern: /moment(?:\.min)?\.js/i,
        maxSafe: "",
      },
    ];
    const found: string[] = [];
    for (const lib of libs) {
      const match = body.match(lib.pattern);
      if (match) {
        if (!lib.maxSafe) {
          found.push(lib.name);
        } else if (match[1]) {
          const v = match[1].split(".").map(Number);
          const s = lib.maxSafe.split(".").map(Number);
          if (
            v[0] < s[0] ||
            (v[0] === s[0] && v[1] < s[1]) ||
            (v[0] === s[0] && v[1] === s[1] && v[2] < s[2])
          ) {
            found.push(`${lib.name} (found ${match[1]})`);
          }
        }
      }
    }
    return found.length > 0
      ? `Outdated libraries detected: ${found.join("; ")}`
      : null;
  },

  "outdated-angular": (_url, _headers, _body) => {
    return null;
  },

  "prototype-js-outdated": (_url, _headers, body) => {
    if (/<script[^>]+src=["'][^"']*prototype/i.test(body)) {
      return "Prototype.js detected as a loaded script — outdated library with known vulnerabilities.";
    }
    return null;
  },

  "mootools-outdated": (_url, _headers, body) => {
    if (/<script[^>]+src=["'][^"']*mootools/i.test(body)) {
      return "MooTools detected as a loaded script — outdated library with potential security issues.";
    }
    return null;
  },

  // ── Version info in headers / body ──────────────────────────────────────

  "exposed-api-version": (_url, headers, body) => {
    const exposed: string[] = [];
    for (const hdr of ["x-api-version", "x-app-version", "x-build-id"]) {
      const val = headers.get(hdr);
      if (val) exposed.push(`${hdr}: ${val}`);
    }
    const bodyVersions =
      body.match(
        /(?:api[_-]?version|build[_-]?id)\s*[:=]\s*["'][\d.]+["']/gi,
      ) || [];
    if (bodyVersions.length > 0) exposed.push(...bodyVersions.slice(0, 2));
    return exposed.length > 0
      ? `Exposed version info: ${exposed.join("; ")}`
      : null;
  },

  "api-version-exposed": (_url, _headers, body) => {
    if (
      /["']\/api\/v[0-9]+/gi.test(body) &&
      /["']\/api\/v[0-9]+.*["']\/api\/v[0-9]+/gi.test(body)
    ) {
      return "Multiple API versions exposed - older versions may have vulnerabilities.";
    }
    return null;
  },

  // ── privacy / compliance ─────────────────────────────────────────────────

  "privacy-policy-missing": (_url, _headers, _body) => {
    // Absence of a privacy policy link is a legal/compliance concern, not a
    // security vulnerability. Removed to avoid noise on every homepage.
    return null;
  },

  "terms-of-service-missing": (_url, _headers, _body) => {
    // Absence of ToS is a legal concern, not a security vulnerability.
    return null;
  },

  // ── Robots / site map ────────────────────────────────────────────────────

  "sitemap-missing": (_url, _headers, _body) => {
    // A missing sitemap is an SEO concern, not a security vulnerability.
    return null;
  },

  // ── New JSON entries ─────────────────────────────────────────────────────

  "html-comment-leaks": (_url, _headers, body) => {
    const allComments = body.match(/<!--([\s\S]*?)-->/g) || [];
    // Strip Next.js / React RSC framework markers (<!--$-->, <!--/$-->, <!--$!-->, <!--$?-->, <!--[-->, <!----> etc.)
    const comments = allComments.filter(
      (c) => !/^<!--[$!?/\[]?[\]$]?-->$/.test(c.trim()),
    );
    const sensitive = [
      // Require an attached value so a bare mention ("CSRF token injected by
      // server") doesn't get treated the same as an actual embedded credential.
      /(?:password|passwd|pwd)\s*[:=]\s*['"]?[^\s'">]{4,}/i,
      /(?:api[_-]?key|secret|token)\s*[:=]\s*['"]?[^\s'">]{6,}/i,
      // TODO|FIXME|XXX|HACK removed: appears in virtually every real
      // website's production HTML (<!-- TODO: add favicon --> etc.), the
      // same reason it was already stripped from content.ts's
      // sensitive-comments detector -- these are developer-workflow
      // markers, not credential leaks, and don't belong in this list.
      /BEGIN (?:RSA |OPENSSH |)PRIVATE KEY/i,
      /Bearer\s+[A-Za-z0-9\-_.=]{20,}/i,
    ];
    const found: string[] = [];
    for (const c of comments) {
      for (const p of sensitive) {
        if (p.test(c)) {
          found.push(c.trim().slice(0, 80));
          break;
        }
      }
    }
    if (found.length > 0) {
      return `Sensitive keywords found in HTML comments: ${found.length} occurrence(s).`;
    }
    return null;
  },

  "sql-error-exposure": (_url, _headers, body) => {
    // Same two bugs content.ts's sibling sql-error-in-page had, fixed the
    // same way: (1) the multi-word patterns had no distance bound, so
    // "PostgreSQL" early on a page and an unrelated "ERROR:" much later
    // counted as one match; (2) stripExampleContent deletes each matched
    // <pre>/<code>/etc region entirely (replaces with ""), which can pull
    // two previously tag-separated, unrelated mentions directly adjacent
    // to each other -- defeating a [^<]-based bound on its own. A local
    // strip variant that replaces matched regions with a long placeholder
    // instead of deleting them keeps them reliably apart.
    const html = body.replace(
      /<(?:code|pre|kbd|samp|template)\b[^>]*>[\s\S]*?<\/(?:code|pre|kbd|samp|template)\s*>/gi,
      " ".repeat(200),
    );
    const patterns = [
      /SQL syntax[^<]{0,80}MySQL/i,
      /ORA-\d{5}/,
      /Microsoft\s+SQL\s+Server[^<]{0,80}Driver/i,
      /PostgreSQL[^<]{0,80}ERROR:/i,
      /pg_query\(\)/i,
      /sqlite3?\.OperationalError/i,
      /SQLSTATE\[/i,
      /mysql_fetch/i,
      /SqlException/i,
    ];
    for (const p of patterns) {
      if (p.test(html)) {
        return `SQL error message exposed in body — matches pattern ${p.source}.`;
      }
    }
    return null;
  },

  "timing-allow-origin-wide": (_url, headers, _body) => {
    const tao = getHeader(headers, "timing-allow-origin");
    if (tao && /^\s*\*/.test(tao)) {
      return "Timing-Allow-Origin is '*' — any origin can read high-resolution Resource Timing data.";
    }
    return null;
  },

  "server-header-truncated": (_url, headers, _body) => {
    const server = getHeader(headers, "server");
    if (server && /\(truncated\)/i.test(server)) {
      return `Server header ends with '(truncated)' (${server}) — verify the upstream is not echoing real versions.`;
    }
    return null;
  },

  // ── Framework-revealing cookie names ─────────────────────────────────────

  "php-version-exposed-in-cookie": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const name = parseCookieName(c);
      if (/^phpsessid$/i.test(name)) {
        return "Cookie 'PHPSESSID' reveals the PHP runtime — rename to a generic opaque value.";
      }
    }
    // Removed: fallback that fired for ANY cookie with "verify no
    // framework-revealing names" — fires on every site with cookies.
    return null;
  },

  "rails-version-exposure": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const name = parseCookieName(c);
      if (/_session$/i.test(name)) {
        return `Cookie '${name}' matches the Rails '_session' default — set a custom session_store :key.`;
      }
    }
    // Removed: fallback that fired for ANY cookie.
    return null;
  },

  "django-csrftoken-cookie-exposed": (_url, headers) => {
    // The JSON metadata for this check (title/description) claims it detects
    // a cookie "missing security attributes" -- the old body only matched the
    // cookie NAME and never actually looked at the attributes, so it fired
    // identically for a Django deployment with perfectly-flagged cookies and
    // one with none at all. csrftoken is intentionally JS-readable by Django's
    // own CSRF scheme (sent back via a request header), so HttpOnly isn't
    // expected there -- only django-session should have it.
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const name = parseCookieName(c);
      const isCsrfCookie = /^csrftoken$/i.test(name);
      const isSessionCookie = /^django-session$/i.test(name);
      if (!isCsrfCookie && !isSessionCookie) continue;
      const missing: string[] = [];
      if (!/secure/i.test(c)) missing.push("Secure");
      if (!/samesite/i.test(c)) missing.push("SameSite");
      if (isSessionCookie && !/httponly/i.test(c)) missing.push("HttpOnly");
      if (missing.length === 0) return null;
      return `Cookie '${name}' (Django default name) is missing ${missing.join(", ")} — set CSRF_COOKIE_SECURE / SESSION_COOKIE_SECURE = True and SESSION_COOKIE_HTTPONLY = True in settings.`;
    }
    return null;
  },

  "laravel-session-cookie-exposes": (_url, headers) => {
    // Same fix as django-csrftoken-cookie-exposed above: verify the claimed
    // missing attributes instead of firing on the default cookie name alone.
    // XSRF-TOKEN is intentionally JS-readable (Laravel's Axios/fetch CSRF
    // wiring reads it and echoes it back as a header), so only Secure and
    // SameSite apply there; the *_session cookie should also be HttpOnly.
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const name = parseCookieName(c);
      const isXsrfCookie = /^XSRF-TOKEN$/i.test(name);
      const isSessionCookie = /_session$/i.test(name);
      if (!isXsrfCookie && !isSessionCookie) continue;
      const missing: string[] = [];
      if (!/secure/i.test(c)) missing.push("Secure");
      if (!/samesite/i.test(c)) missing.push("SameSite");
      if (isSessionCookie && !/httponly/i.test(c)) missing.push("HttpOnly");
      if (missing.length === 0) return null;
      return `Cookie '${name}' (Laravel default name) is missing ${missing.join(", ")} — set the corresponding options in config/session.php.`;
    }
    return null;
  },

  "express-cookie-exposes": (_url, headers) => {
    // Same fix: verify the claimed missing attributes on the actual cookie
    // instead of firing purely on the default 'connect.sid' name.
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const name = parseCookieName(c);
      if (!/^connect\.sid$/i.test(name)) continue;
      const missing: string[] = [];
      if (!/secure/i.test(c)) missing.push("Secure");
      if (!/httponly/i.test(c)) missing.push("HttpOnly");
      if (!/samesite/i.test(c)) missing.push("SameSite");
      if (missing.length === 0) return null;
      return `Cookie 'connect.sid' (default express-session name) is missing ${missing.join(", ")} — pass { secure: true, httpOnly: true, sameSite: 'lax' } as the session cookie option.`;
    }
    return null;
  },

  "rails-cookie-httponly": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const name = parseCookieName(c);
      if (/_session(?:_id)?$/i.test(name) && !/httponly/i.test(c)) {
        return `Rails-style session cookie '${name}' is missing the HttpOnly flag — set config.session_store :httponly => true.`;
      }
    }
    // Removed: fallback that fired for ANY cookie missing HttpOnly, which is
    // already covered by cookie-httponly-missing in cookies.ts.
    return null;
  },

  // ── Public config / env exposure ─────────────────────────────────────────

  "config-js-leaked": (_url, _headers, body) => {
    if (/<script[^>]+src=["'][^"']*(?:config|settings)\.js["']/i.test(body)) {
      return "Public config.js/settings.js loaded as a script — verify it contains no API keys or credentials.";
    }
    return null;
  },

  "env-js-leaked": (_url, _headers, body) => {
    if (/<script[^>]+src=["'][^"']*(?:env|environment)\.js["']/i.test(body)) {
      return "Public env.js/environment.js loaded as a script — never serve environment files from public paths.";
    }
    return null;
  },

  // ── Sitemap / robots ─────────────────────────────────────────────────────

  "sitemap-public": (url, _headers, _body) => {
    if (/sitemap\.xml/i.test(url)) {
      return "sitemap.xml is publicly accessible — audit it for admin or private paths.";
    }
    return null;
  },

  "robots-txt-allows-all": (_url, _headers, _body) => {
    // Allowing all crawlers is a design choice, not a security vulnerability.
    // Removed to eliminate noise on every site with an open robots.txt.
    return null;
  },

  // ── API schema / version exposure ────────────────────────────────────────

  "open-api-schema-version-leak": (url, _headers, body) => {
    // Only fire when the URL is an actual OpenAPI/Swagger schema endpoint
    // AND the version number appears in the path itself.
    if (/\/openapi[\.\-_]?v?\d+/i.test(url)) {
      return "OpenAPI schema version is embedded in the URL — serve it at a generic path like /api/schema.";
    }
    // Or when the response body looks like a literal OpenAPI document
    // (has "openapi": "3.x.x" or "swagger": "2.x" at root)
    if (
      /"openapi"\s*:\s*"\d+\.\d+/i.test(body) ||
      /"swagger"\s*:\s*"\d+\.\d+/i.test(body)
    ) {
      return "OpenAPI/Swagger schema document is publicly accessible — restrict access to authenticated users.";
    }
    return null;
  },

  "cdn-cors-exposes-internal": (_url, headers) => {
    const acao = getHeader(headers, "access-control-allow-origin");
    if (acao) {
      // cloudfront.net / cdn-*.amazonaws.com removed: these are frequently
      // the site's own legitimate, publicly known asset domain (raw
      // CloudFront distribution URLs are common for smaller apps/static
      // sites), not internal-only infrastructure like .internal/.local/.corp.
      const internalHints = [/\.internal\b/i, /\.local\b/i, /\.corp\b/i];
      for (const p of internalHints) {
        if (p.test(acao)) {
          return `Access-Control-Allow-Origin '${acao}' exposes an internal CDN/host — restrict to the customer-facing origin.`;
        }
      }
    }
    // Removed second branch: absence of CORS headers on an API subdomain is the safe default,
    // not a vulnerability. Firing on every api.* URL with no ACAO generated FPs on every API.
    return null;
  },

  // ── Public-but-fingerprintable keys ──────────────────────────────────────

  "recaptcha-key-leaked": (_url, _headers, _body) => {
    // reCAPTCHA SITE keys are public by design — they must be included in
    // client-side code and are visible to every visitor. Not a security finding.
    return null;
  },

  "ga-tracking-id-leaked": (_url, _headers, _body) => {
    // Google Analytics tracking IDs are public by design (embedded in client JS).
    // Exposing them is intentional and required for GA to function. Not a finding.
    return null;
  },

  // ── Server 404 / error page version leaks ────────────────────────────────

  "nginx-version-404-disclosure": (_url, headers, body) => {
    const server = getHeader(headers, "server") || "";
    if (/nginx\/\d+\.\d+\.\d+/i.test(server)) {
      return `Server header exposes nginx version: '${server}' — set 'server_tokens off;' in nginx.conf.`;
    }
    // stripExampleContent so a docs page's own sample API response (our
    // /docs/api documents a scan result's responseHeaders shape, which
    // includes a literal "server": "nginx/1.18.0" example) doesn't flag
    // itself -- same pairing several sibling checks in content.ts use.
    if (/nginx\/\d+\.\d+\.\d+/i.test(stripExampleContent(body))) {
      return "Body references 'nginx/X.Y.Z' — a default nginx error page is leaking the version.";
    }
    return null;
  },

  "apache-version-404-disclosure": (_url, headers, body) => {
    const server = getHeader(headers, "server") || "";
    if (/Apache\/\d+\.\d+\.\d+/i.test(server)) {
      return `Server header exposes Apache version: '${server}' — set 'ServerTokens Prod' and 'ServerSignature Off'.`;
    }
    const html = stripExampleContent(body);
    if (/Apache\/\d+\.\d+\.\d+/i.test(html)) {
      return "Body references 'Apache/X.Y.Z' — a default Apache error page is leaking the version and modules.";
    }
    if (
      /<html/i.test(html) &&
      /\bApache\b/i.test(html) &&
      /Server at/i.test(html)
    ) {
      return "HTML body contains the Apache 'Server at example.com Port N' footer — default error page disclosure.";
    }
    return null;
  },

  "iis-version-404-disclosure": (_url, headers, body) => {
    const server = getHeader(headers, "server") || "";
    if (/Microsoft-IIS\/\d+\.\d+/i.test(server)) {
      return `Server header exposes IIS version: '${server}' — use URL Rewrite or web.config to remove the Server header.`;
    }
    if (/Microsoft-IIS\/\d+\.\d+/i.test(stripExampleContent(body))) {
      return "Body references 'Microsoft-IIS/X.Y' — a default IIS error page is leaking the version.";
    }
    return null;
  },

  // ── Framework error pages ────────────────────────────────────────────────

  "express-error-format-disclosure": (_url, _headers, body) => {
    // "Cannot GET /path" is Express's normal, production-safe 404 body and
    // was removed here: it isn't a stack trace and appears regardless of
    // NODE_ENV. Require an actual JS stack frame (file:line:col) instead.
    if (/at\s+\S+\s+\(.*:\d+:\d+\)\s*$/m.test(body)) {
      return "Express default error page / stack trace detected — set NODE_ENV=production and use a sanitized error handler.";
    }
    return null;
  },

  "flask-debug-page-exposure": (_url, _headers, body) => {
    // A bare "TRACEBACK (most recent call last)" is plain Python traceback
    // output produced by any framework, not proof of Flask's RCE-capable
    // Werkzeug debugger — require the Werkzeug-specific marker instead.
    if (/Werkzeug Debugger/i.test(body)) {
      return "Flask Werkzeug interactive debugger page exposed — set debug=False / FLASK_ENV=production.";
    }
    if (/<title>\s*Werkzeug Debugger/i.test(body)) {
      return "Werkzeug debugger console detected in HTML — disable debug mode in any internet-reachable environment.";
    }
    return null;
  },

  "django-debug-page-exposure": (_url, _headers, body) => {
    // DJANGO_SETTINGS_MODULE= is a standard env var name that also appears
    // verbatim in ordinary deployment docs; removed as a standalone signal
    // since it has no requirement for an actual technical-500 page marker.
    //
    // The bare "Django Version: X.Y" branch was the same bug already fixed
    // once for the sibling django-debug-page detector (content.ts): the
    // string alone appears in ordinary Django tutorials/migration guides,
    // not just a live debug page. Same fix here -- require the two
    // structural markers Django's technical_500 template always renders
    // alongside it. The DJANGO_DEBUG explanatory sentence is left as a
    // standalone OR since that exact wording is already specific enough
    // on its own; nothing else renders it.
    if (
      (/Django\s+Version\s*:\s*\d+\.\d+/i.test(body) &&
        /Environment:/i.test(body) &&
        /Request Method:/i.test(body)) ||
      /You're\s+seeing\s+this\s+error\s+because\s+you\s+have\s+<code>DJANGO_DEBUG<\/code>\s+set\s+to\s+True/i.test(
        body,
      )
    ) {
      return "Django technical 500 / debug page exposed — set DEBUG=False in production.";
    }
    return null;
  },

  "rails-error-page-disclosure": (_url, _headers, body) => {
    // A bare "Welcome aboard" title was removed: it's a generic English
    // phrase reused by many unrelated products (onboarding flows, hotel/
    // airline sites) and isn't itself an exception page even when the site
    // does run Rails -- it's Rails' default scaffold index, not an error.
    if (
      /ActionController::(Routing|Unknown|Render)\s+Error/i.test(body) ||
      /ActionView::(Template::)?Error/i.test(body) ||
      /Rails\s+\d+\.\d+\.\d+.*application/i.test(body) ||
      /Rails\.root\s*:/i.test(body)
    ) {
      return "Rails default / development error page detected — set RAILS_ENV=production and consider_all_requests_local=false.";
    }
    return null;
  },

  "spring-boot-actuator-exposed": (_url, _headers, body) => {
    // "management.endpoints.web.exposure" is a config *property name* that
    // shows up constantly in Spring Boot docs/tutorials (including ones
    // explaining how to lock actuator down) -- removed as a standalone
    // signal; the two patterns below already require the literal actuator
    // response/link format.
    if (
      /"\/_actuator\//i.test(body) ||
      /"\/actuator\/(env|health|info|beans|mappings|heapdump|threaddump|metrics)"/i.test(
        body,
      )
    ) {
      return "Spring Boot Actuator endpoints referenced in page source — disable or strongly authenticate them.";
    }
    return null;
  },

  // ── CI / monitoring fingerprints ─────────────────────────────────────────

  "jenkins-version-exposure": (_url, headers, body) => {
    if (hasHeader(headers, "x-jenkins")) {
      return `X-Jenkins header exposes Jenkins version: '${getHeader(headers, "x-jenkins")}'.`;
    }
    if (
      /X-Jenkins/i.test(body) ||
      /<title>\s*Jenkins\s*</i.test(body) ||
      /Jenkins\s+(?:ver\.?|v)?\s*\d+\.\d+/i.test(body)
    ) {
      return "Jenkins version disclosed in body — front with an authenticating reverse proxy that strips X-Jenkins.";
    }
    return null;
  },

  "grafana-version-exposure": (_url, headers, body) => {
    const gv = getHeader(headers, "x-grafana-version");
    if (gv) {
      return `X-Grafana-Version header exposes Grafana version: '${gv}' — front with a reverse proxy that strips the header.`;
    }
    if (/Grafana\s+(?:v|ver\.?|version)?\s*\d+\.\d+/i.test(body)) {
      return "Grafana version disclosed in body — front with a reverse proxy that strips version fingerprints.";
    }
    return null;
  },

  "nextjs-app-router-rsc-headers": (_url, headers, body) => {
    if (
      hasHeader(headers, "rsc") ||
      hasHeader(headers, "next-router-state-tree")
    ) {
      return "Next.js 13+ App Router RSC headers detected (RSC, Next-Router-State-Tree) — informational fingerprint.";
    }
    return null;
  },

  "sveltekit-detection": (_url, headers, body) => {
    for (const name of [
      "x-sveltekit-page",
      "x-sveltekit-data",
      "x-sveltekit-stale",
    ]) {
      if (hasHeader(headers, name)) {
        return `SvelteKit debug header '${name}' detected — informational fingerprint; consider stripping at the reverse proxy.`;
      }
    }
    if (
      /\/__data\.json/i.test(body) ||
      /data-sveltekit/i.test(body) ||
      /sveltekit:\/\//i.test(body)
    ) {
      return "SvelteKit runtime fingerprint found in body (e.g. __data.json, data-sveltekit) — informational only.";
    }
    return null;
  },

  "vite-client-exposed": (_url, _headers, body) => {
    // Bare substring matches on these paths also match Vite's own docs and
    // any tutorial explaining the dev server -- require the reference to
    // sit inside an actual <script src> tag, and exclude doc/example
    // context, mirroring the xml-external-entity check in code.ts.
    const patterns = [
      /<script[^>]+src=["'][^"']*\/@vite\/client["']/i,
      /<script[^>]+src=["'][^"']*\/@fs\//i,
      /\bvite\/hmr\b/i,
    ];
    for (const p of patterns) {
      const m = body.match(p);
      if (!m) continue;
      const idx = body.indexOf(m[0]);
      const before = body.slice(Math.max(0, idx - 200), idx).toLowerCase();
      if (/<code|<pre|```|example|documentation/i.test(before)) continue;
      return "Vite dev client / HMR script reference found — the dev server is exposed; build with 'vite build' and serve dist/ from a static host.";
    }
    return null;
  },

  // ── Cloud / DB error fingerprints ────────────────────────────────────────

  "aws-s3-nosuchbucket-error": (_url, _headers, body) => {
    if (
      /<Code>NoSuchBucket<\/Code>/i.test(body) ||
      /<Code>AccessDenied<\/Code>/i.test(body) ||
      /<Code>SlowDown<\/Code>/i.test(body)
    ) {
      return "AWS S3 XML error response (NoSuchBucket / AccessDenied / SlowDown) detected — front S3 with CloudFront and genericize error pages.";
    }
    if (
      /NoSuchBucket[:\s]/i.test(body) ||
      /The specified bucket does not exist/i.test(body) ||
      /AccessDenied[:\s].*(?:s3|bucket)/i.test(body)
    ) {
      return "AWS S3 error message exposed in body (NoSuchBucket / bucket does not exist) — front S3 with CloudFront and genericize error pages.";
    }
    return null;
  },

  "mysql-access-denied-error": (_url, _headers, body) => {
    // "using password: YES/NO" and "mysqli_connect...failed" alone match
    // troubleshooting prose with no real error on the page; restricted to
    // the two patterns that are unambiguously "Access denied"-specific.
    if (
      /Access denied for user\s+['"][^'"]+['"]@['"][^'"]+['"]/i.test(body) ||
      /SQLSTATE\[HY000\]\[1045\]/i.test(body)
    ) {
      return "MySQL 'Access denied' error pattern exposed — catch the exception in the app layer and return a generic 500.";
    }
    return null;
  },

  // ── Additional per-language stack-trace / crash fingerprints ─────────────

  "rust-panic-trace-exposed": (_url, _headers, body) => {
    if (
      /thread\s+'[\w:<>]+'\s+panicked\s+at\s+/i.test(body) &&
      /\.rs:\d+/i.test(body)
    ) {
      return "Rust panic trace exposed in response (thread panicked at ... .rs:LINE) — leaks source file paths and internal state.";
    }
    return null;
  },

  "golang-panic-trace-exposed": (_url, _headers, body) => {
    if (
      /panic:\s+.+\n?goroutine\s+\d+\s+\[running\]/i.test(body) ||
      (/goroutine\s+\d+\s+\[running\]/i.test(body) && /\.go:\d+/.test(body))
    ) {
      return "Go panic / goroutine stack trace exposed in response — leaks source file paths and internal call stack.";
    }
    return null;
  },

  "ruby-backtrace-exposed": (_url, _headers, body) => {
    const frames = body.match(/[\w./-]+\.rb:\d+:in `[^']+'/g) || [];
    if (frames.length >= 2) {
      return `Ruby exception backtrace exposed in response (${frames.length} frame(s), e.g. '${frames[0]}') — leaks source file paths.`;
    }
    return null;
  },

  "dotnet-core-developer-exception-page": (_url, _headers, body) => {
    if (
      /An unhandled exception occurred while processing the request/i.test(
        body,
      ) &&
      /Microsoft\.AspNetCore/i.test(body)
    ) {
      return "ASP.NET Core Developer Exception Page is enabled in a publicly reachable environment — restrict UseDeveloperExceptionPage() to the Development environment only.";
    }
    return null;
  },

  "phoenix-debug-error-exposed": (_url, _headers, body) => {
    if (
      /\*\*\s*\(\w*Error\)/.test(body) &&
      /lib\/[\w_]+_web\/(?:controllers|router)\.ex:\d+/i.test(body)
    ) {
      return "Phoenix (Elixir) debug error page exposed — leaks application module paths and stack context.";
    }
    return null;
  },

  "nodejs-unhandled-rejection-exposed": (_url, _headers, body) => {
    // Require an actual JS stack frame near the warning text, the same way
    // stack-trace-exposed requires real frames — otherwise the phrase
    // appearing in a tutorial/doc page (no crash, no leaked stack) matches too.
    if (
      /UnhandledPromiseRejectionWarning[\s\S]{0,300}?at\s+\S+\s+\(.*:\d+:\d+\)/i.test(
        body,
      )
    ) {
      return "Node.js 'UnhandledPromiseRejectionWarning' text found in response body — server console/error output is leaking into HTTP responses.";
    }
    return null;
  },

  "perl-cgi-error-exposed": (_url, _headers, body) => {
    if (
      /Software error:/i.test(body) &&
      /at\s+\S+\.pl\s+line\s+\d+/i.test(body)
    ) {
      return "Perl CGI 'Software error' page exposed — leaks script paths and line numbers.";
    }
    return null;
  },

  // ── Cloud / infra exposure ────────────────────────────────────────────

  "kubernetes-api-server-exposed": (url, _headers, body) => {
    // The meta/v1.Status object always carries kind + apiVersion + a numeric
    // HTTP code + a machine "reason" together, whether the request succeeded
    // or was denied — this exact field combination is the k8s.io/apimachinery
    // wire format, not a bare "kind"/"apiVersion" substring a doc page could
    // use loosely.
    const statusIdx = body.search(/"kind"\s*:\s*"Status"/);
    if (statusIdx !== -1) {
      const windowStart = Math.max(0, statusIdx - 200);
      const before = body.slice(windowStart, statusIdx).toLowerCase();
      const window = body.slice(windowStart, statusIdx + 500);
      const isDoc = /<code|<pre|```|example|documentation/i.test(before);
      const isStatusShape =
        /"apiVersion"\s*:\s*"v1"/.test(window) &&
        /"code"\s*:\s*\d{3}/.test(window) &&
        /"reason"\s*:\s*"(?:Forbidden|Unauthorized|NotFound|MethodNotAllowed)"/.test(
          window,
        );
      if (isStatusShape && !isDoc) {
        return `Kubernetes API server Status response found at ${url}, confirming the control plane is reachable from the internet.`;
      }
    }
    // /version returns Go's version.Info struct; gitVersion + gitCommit +
    // gitTreeState together are unique to that struct.
    const versionIdx = body.search(/"gitVersion"\s*:\s*"v\d+\.\d+/);
    if (versionIdx !== -1) {
      const windowStart = Math.max(0, versionIdx - 200);
      const before = body.slice(windowStart, versionIdx).toLowerCase();
      const window = body.slice(windowStart, versionIdx + 500);
      const isDoc = /<code|<pre|```|example|documentation/i.test(before);
      const isVersionShape =
        /"gitCommit"\s*:\s*"[0-9a-f]{7,40}"/.test(window) &&
        /"gitTreeState"\s*:\s*"(?:clean|dirty)"/.test(window);
      if (isVersionShape && !isDoc) {
        return `Kubernetes API server /version build info found at ${url}, confirming the control plane is reachable and fingerprintable from the internet.`;
      }
    }
    return null;
  },

  "docker-registry-v2-exposed": (url, headers, body) => {
    const apiVersion = getHeader(headers, "docker-distribution-api-version");
    if (!apiVersion || !/^registry\/2\.0$/i.test(apiVersion.trim())) {
      return null;
    }
    // A WWW-Authenticate challenge means the registry IS enforcing auth —
    // this is the correct, secure response and must not fire here.
    if (hasHeader(headers, "www-authenticate")) return null;
    if (!/^\{\s*\}$/.test(body.trim())) return null;
    return `Docker Registry HTTP API V2 root answered '{}' at ${url} with Docker-Distribution-Api-Version: ${apiVersion} and no auth challenge, the registry is open to anonymous access.`;
  },

  "terraform-state-file-exposed": (url, _headers, body) => {
    const idx = body.search(/"terraform_version"\s*:\s*"\d+\.\d+\.\d+"/);
    if (idx === -1) return null;
    const windowStart = Math.max(0, idx - 200);
    const before = body.slice(windowStart, idx).toLowerCase();
    if (/<code|<pre|```|example|documentation/i.test(before)) return null;
    const window = body.slice(windowStart, idx + 3000);
    const hasLineage =
      /"lineage"\s*:\s*"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/i.test(
        window,
      );
    const hasResources = /"resources"\s*:\s*\[/.test(window);
    if (hasLineage && hasResources) {
      return `Terraform state file structure found at ${url} (terraform_version, lineage UUID, and a resources array all present), .tfstate files routinely contain plaintext secrets.`;
    }
    return null;
  },

  "consul-api-exposed": (url, headers, body) => {
    if (
      !hasHeader(headers, "x-consul-index") ||
      !hasHeader(headers, "x-consul-knownleader")
    ) {
      return null;
    }
    const trimmed = body.trim();
    if (!/^[{[]/.test(trimmed)) return null;
    // ACL-denied responses carry the same Consul headers but plain-text
    // deny messages instead of a catalog/KV body — exclude those.
    if (/permission denied|acl not found|acl support disabled/i.test(trimmed)) {
      return null;
    }
    return `Consul HTTP API response found at ${url} (X-Consul-Index / X-Consul-Knownleader headers with a JSON catalog body), the agent answers queries without a valid ACL token.`;
  },

  "etcd-api-exposed": (url, _headers, body) => {
    const idx = body.search(/"etcdserver"\s*:\s*"\d+\.\d+\.\d+"/);
    if (idx === -1) return null;
    const windowStart = Math.max(0, idx - 200);
    const before = body.slice(windowStart, idx).toLowerCase();
    if (/<code|<pre|```|example|documentation/i.test(before)) return null;
    const window = body.slice(windowStart, idx + 300);
    if (/"etcdcluster"\s*:\s*"\d+\.\d+\.\d+"/.test(window)) {
      return `etcd /version response found at ${url} ('etcdserver' and 'etcdcluster' fields), the API is answering requests without a client certificate.`;
    }
    return null;
  },

  "prometheus-metrics-exposed": (url, _headers, body) => {
    const helpIdx = body.search(/^# HELP \S+ .+$/m);
    if (helpIdx === -1) return null;
    const windowStart = Math.max(0, helpIdx - 200);
    const before = body.slice(windowStart, helpIdx).toLowerCase();
    if (/<code|<pre|```|example|documentation/i.test(before)) return null;
    const hasType =
      /^# TYPE \S+ (?:counter|gauge|histogram|summary|untyped)\s*$/m.test(body);
    const hasSample =
      /^[a-zA-Z_:][a-zA-Z0-9_:]*(?:\{[^{}]*\})?\s+-?[0-9][0-9eE+\-.]*\s*$/m.test(
        body,
      );
    if (hasType && hasSample) {
      return `Prometheus text-exposition metrics found at ${url} (# HELP / # TYPE lines with sample data), the endpoint is reachable without authentication.`;
    }
    return null;
  },
};
