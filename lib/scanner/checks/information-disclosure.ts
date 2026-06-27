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
  escapeRegExp,
  getHeader,
  getSetCookies,
  hasHeader,
  parseCookieName,
  type EvidenceFn as DetectFn,
} from "../_helpers";

export const detectors: Record<string, DetectFn> = {
  // ── Private / internal IPs in body ───────────────────────────────────────

  "private-ip-exposure": (_url, _headers, body) => {
    const privateIPs =
      body.match(
        /(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})/g,
      ) || [];
    const filtered = [...new Set(privateIPs)].filter((ip) => {
      const escapedIp = escapeRegExp(ip);
      const schemaPattern = new RegExp(
        `"@context"\\s*:\\s*"https?://schema\\.org"[\\s\\S]*?"${escapedIp}"|"${escapedIp}".{0,100}"@context"\\s*:\\s*"https?://schema\\.org"`,
        "i",
      );
      if (schemaPattern.test(body)) return false;
      return true;
    });
    return filtered.length > 0
      ? `Private IP addresses found: ${filtered.slice(0, 5).join(", ")}`
      : null;
  },

  "hardcoded-ip-addresses": (_url, _headers, body) => {
    const ipPattern =
      /(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)/g;
    const ips = body.match(ipPattern) || [];
    const filtered = ips.filter(
      (ip) =>
        ip !== "0.0.0.0" &&
        ip !== "127.0.0.1" &&
        ip !== "255.255.255.255" &&
        !ip.startsWith("0."),
    );
    const unique = [...new Set(filtered)];
    return unique.length >= 2
      ? `Found ${unique.length} IP address(es): ${unique.slice(0, 3).join(", ")}`
      : null;
  },

  "internal-ip-exposed": (_url, _headers, _body) => null,

  // ── Email / phone / SSN / credit-card ─────────────────────────────────────

  "email-exposure": (_url, _headers, body) => {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = body.match(emailRegex) || [];
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

  "email-address-leak": (_url, _headers, body) => {
    const matches =
      body.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    if (matches.length > 10) {
      return `Many email addresses (${matches.length}) found in page source - potential data leak.`;
    }
    return null;
  },

  "phone-number-leak": (_url, _headers, body) => {
    const matches =
      body.match(/(?:\+1|1)?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g) || [];
    if (matches.length > 5) {
      return `Multiple phone numbers (${matches.length}) found in page source.`;
    }
    return null;
  },

  "credit-card-pattern": (_url, _headers, body) => {
    if (
      /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b/.test(
        body,
      )
    ) {
      return "Potential credit card number pattern found in page source.";
    }
    return null;
  },

  "ssn-pattern": (_url, _headers, body) => {
    const idx = body.search(/\b\d{3}-\d{2}-\d{4}\b/);
    if (idx !== -1 && !/<script/i.test(body.substring(0, idx))) {
      return "Potential SSN pattern found in page content.";
    }
    return null;
  },

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

  "exposed-stack-trace": (_url, _headers, body) => {
    const patterns = [
      /at\s+\w+\s+\(\/[^\s)]+:\d+:\d+\)/i,
      /at\s+\w+\s+\(file:\/\/[^\s)]+:\d+:\d+\)/i,
      /at\s+\w+\s+\([A-Z]:\\[^\s)]+:\d+:\d+\)/i,
    ];
    for (const p of patterns) {
      if (p.test(body))
        return "Stack trace with file paths and line numbers found.";
    }
    return null;
  },

  "stack-trace-exposed": (_url, _headers, body) => {
    if (
      /at\s+[\w.]+\s+\([^)]+:\d+:\d+\)|Traceback \(most recent call last\)/i.test(
        body,
      )
    ) {
      return "Stack trace exposed in page output.";
    }
    return null;
  },

  "sql-error-in-page": (_url, _headers, body) => {
    const patterns = [
      /SQL syntax.*MySQL/i,
      /ORA-\d{5}/,
      /Microsoft SQL.*Driver/i,
      /PostgreSQL.*ERROR/i,
      /pg_query\(\)/i,
      /sqlite3?\.OperationalError/i,
      /SQLSTATE\[/,
    ];
    for (const p of patterns) {
      if (p.test(body))
        return `SQL error message detected: matches pattern ${p.source}.`;
    }
    return null;
  },

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
    const patterns = [
      /syntax error/i,
      /undefined variable/i,
      /null pointer/i,
      /access violation/i,
      /stack trace:/i,
      /at line \d+/i,
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

  "source-maps": (_url, _headers, body) => {
    const mapRefs = body.match(/\/\/[#@]\s*sourceMappingURL=[^\s]+/g) || [];
    const mapFiles = body.match(/\.js\.map/g) || [];
    const total = mapRefs.length + mapFiles.length;
    return total > 0 ? `Found ${total} source map reference(s).` : null;
  },

  "git-directory-exposed": (_url, _headers, body) => {
    if (/\/?\.git\/(HEAD|config|objects|refs)/i.test(body)) {
      return ".git directory paths detected in page source.";
    }
    return null;
  },

  "env-file-reference": (_url, _headers, body) => {
    if (/['"\/]\.env(\.(local|production|development|test))?\b/.test(body)) {
      return ".env file reference found in page source.";
    }
    return null;
  },

  "backup-file-reference": (_url, _headers, body) => {
    if (/\.(bak|old|orig|save|swp|tmp|backup)\b/i.test(body)) {
      return "Backup file extension references (.bak, .old, .orig, etc.) detected.";
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

  "admin-endpoint": (_url, _headers, body) => {
    if (
      /\/admin\/|\/administrator\/|\/management\/|\/dashboard\//gi.test(body)
    ) {
      return "Admin/management endpoints referenced in page source.";
    }
    return null;
  },

  // ── CMS / framework fingerprints ─────────────────────────────────────────

  "cms-fingerprinting": (_url, headers, body) => {
    const found: string[] = [];
    const generator = body.match(
      /<meta[^>]*name=["']generator["'][^>]*content=["']([^"']+)["']/i,
    );
    if (generator) found.push(`Generator: ${generator[1]}`);
    const powered = headers.get("x-powered-by");
    if (powered) found.push(`X-Powered-By: ${powered}`);
    if (/wp-content|wp-includes/i.test(body)) found.push("WordPress");
    if (/drupal\.js|Drupal\.settings/i.test(body)) found.push("Drupal");
    if (/\/joomla\//i.test(body)) found.push("Joomla");
    if (body.includes("__NEXT_DATA__") || body.includes("/_next/"))
      found.push("Next.js");
    if (body.includes("__nuxt") || body.includes("/_nuxt/"))
      found.push("Nuxt.js");
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

  // ── Cloud / infra references ────────────────────────────────────────────

  "aws-metadata-reference": (_url, _headers, body) => {
    if (body.includes("169.254.169.254")) {
      return "AWS metadata endpoint IP (169.254.169.254) found in page source.";
    }
    return null;
  },

  "s3-bucket-exposed": (_url, _headers, body) => {
    if (
      /[a-z0-9.-]+\.s3[.-](?:us|eu|ap|sa|ca|me|af)-[a-z]+-\d\.amazonaws\.com/i.test(
        body,
      ) ||
      /s3:\/\/[a-z0-9.-]+/i.test(body)
    ) {
      return "AWS S3 bucket reference found in page source.";
    }
    return null;
  },

  "firebase-config-exposed": (_url, _headers, body) => {
    if (
      /firebaseConfig\s*=\s*\{/.test(body) &&
      /apiKey/.test(body) &&
      /authDomain/.test(body)
    ) {
      return "Firebase configuration object with API key found in page source.";
    }
    return null;
  },

  // ── Auth state in URL ────────────────────────────────────────────────────

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

  "oauth-state-missing": (_url, _headers, body) => {
    if (/oauth2?.*(?:authorize|auth)[^"']*(?:\?|&)(?!.*state=)/gi.test(body)) {
      return "OAuth authorization URL without state parameter - CSRF risk.";
    }
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

  "outdated-jquery": (_url, _headers, body) => {
    const match = body.match(/jquery[-.v]?(\d+)\.(\d+)\.?(\d*)/i);
    if (match) {
      const major = parseInt(match[1]);
      const minor = parseInt(match[2]);
      if (major < 3 || (major === 3 && minor < 5)) {
        return `Potentially outdated jQuery version (${major}.${minor}) - check for security updates.`;
      }
    }
    return null;
  },

  "outdated-angular": (_url, _headers, body) => {
    if (
      /angular(?:\.min)?\.js|ng-app/i.test(body) &&
      !/angular\/\d{2}\./i.test(body)
    ) {
      return "AngularJS (1.x) detected - end-of-life framework with known vulnerabilities.";
    }
    return null;
  },

  "prototype-js-outdated": (_url, _headers, body) => {
    if (/prototype\.js/i.test(body)) {
      return "Prototype.js detected - outdated library with known vulnerabilities.";
    }
    return null;
  },

  "mootools-outdated": (_url, _headers, body) => {
    if (/mootools/i.test(body)) {
      return "MooTools detected - outdated library with potential security issues.";
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

  "privacy-policy-missing": (_url, _headers, body) => {
    if (!/\bprivacy[- ]?policy\b/i.test(body)) {
      return "No mention of a privacy policy on the page.";
    }
    return null;
  },

  "terms-of-service-missing": (_url, _headers, body) => {
    if (!/\bterms(?:\s+of\s+service|\s+of\s+use)?\b/i.test(body)) {
      return "No mention of terms of service on the page.";
    }
    return null;
  },

  // ── Robots / site map ────────────────────────────────────────────────────

  "sitemap-missing": (_url, _headers, body) => {
    if (
      !/sitemap\.xml/i.test(body) &&
      !/<link[^>]*rel=["']sitemap/i.test(body)
    ) {
      return "No sitemap.xml link or reference detected on the page.";
    }
    return null;
  },

  // ── New JSON entries ─────────────────────────────────────────────────────

  "html-comment-leaks": (_url, _headers, body) => {
    const comments = body.match(/<!--([\s\S]*?)-->/g) || [];
    const sensitive = [
      /password|passwd|pwd/i,
      /api[_-]?key|secret|token/i,
      /TODO|FIXME|XXX|HACK/i,
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
    if (comments.length > 0) {
      return `Page contains ${comments.length} HTML comment(s) — verify none reference secrets, TODOs, or internal notes.`;
    }
    return null;
  },

  "sql-error-exposure": (_url, _headers, body) => {
    const patterns = [
      /SQL syntax.*MySQL/i,
      /ORA-\d{5}/,
      /Microsoft\s+SQL\s+Server.*Driver/i,
      /PostgreSQL.*ERROR/i,
      /pg_query\(\)/i,
      /sqlite3?\.OperationalError/i,
      /SQLSTATE\[/i,
      /mysql_fetch/i,
      /SqlException/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) {
        return `SQL error message exposed in body — matches pattern ${p.source}.`;
      }
    }
    return null;
  },

  "timing-allow-origin-wide": (_url, headers, body) => {
    const tao = getHeader(headers, "timing-allow-origin");
    if (tao && /^\s*\*/.test(tao)) {
      return "Timing-Allow-Origin is '*' — any origin can read high-resolution Resource Timing data.";
    }
    if (tao) {
      return `Timing-Allow-Origin is '${tao}' — verify it is restricted to specific trusted origins.`;
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
    if (cookies.length > 0) {
      return `Cookie(s) present: ${cookies.map(parseCookieName).join(", ")} — verify no framework-revealing names (PHPSESSID, JSESSIONID, etc.).`;
    }
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
    if (cookies.length > 0) {
      return `Cookie(s) present: ${cookies.map(parseCookieName).join(", ")} — verify none match the Rails '_session' default.`;
    }
    return null;
  },

  "django-csrftoken-cookie-exposed": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const name = parseCookieName(c);
      if (/^csrftoken$/i.test(name) || /^django-session$/i.test(name)) {
        return `Cookie '${name}' reveals Django — override CSRF_COOKIE_NAME / SESSION_COOKIE_NAME in settings.`;
      }
    }
    if (cookies.length > 0) {
      return `Cookie(s) present: ${cookies.map(parseCookieName).join(", ")} — verify no Django defaults (csrftoken, django-session).`;
    }
    return null;
  },

  "laravel-session-cookie-exposes": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const name = parseCookieName(c);
      if (/^XSRF-TOKEN$/i.test(name) || /_session$/i.test(name)) {
        return `Cookie '${name}' matches the Laravel default — set SESSION_COOKIE and XSRF_COOKIE in config/session.php.`;
      }
    }
    if (cookies.length > 0) {
      return `Cookie(s) present: ${cookies.map(parseCookieName).join(", ")} — verify no Laravel defaults (XSRF-TOKEN, *_session).`;
    }
    return null;
  },

  "express-cookie-exposes": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const name = parseCookieName(c);
      if (/^connect\.sid$/i.test(name)) {
        return "Cookie 'connect.sid' is the default express-session name — pass name: 'sid' (or similar) to express-session.";
      }
    }
    if (cookies.length > 0) {
      return `Cookie(s) present: ${cookies.map(parseCookieName).join(", ")} — verify none match Express default 'connect.sid'.`;
    }
    return null;
  },

  "rails-cookie-httponly": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const name = parseCookieName(c);
      if (/_session$/i.test(name) && !/httponly/i.test(c)) {
        return `Rails-style session cookie '${name}' is missing the HttpOnly flag — set config.session_store :httponly => true.`;
      }
    }
    for (const c of cookies) {
      if (!/httponly/i.test(c)) {
        return `Cookie '${parseCookieName(c)}' is missing HttpOnly — required for any session-style cookie.`;
      }
    }
    return null;
  },

  // ── Public config / env exposure ─────────────────────────────────────────

  "config-js-leaked": (_url, _headers, body) => {
    if (
      /\bconfig\.js\b/i.test(body) ||
      /\bsettings\.js\b/i.test(body) ||
      /['"]\/config\.js['"]/i.test(body)
    ) {
      return "Reference to a public config.js / settings.js — verify it does not embed API keys or environment hints.";
    }
    return null;
  },

  "env-js-leaked": (_url, _headers, body) => {
    if (
      /\benv\.js\b/i.test(body) ||
      /\benvironment\.js\b/i.test(body) ||
      /['"]\/env\.js['"]/i.test(body)
    ) {
      return "Reference to a public env.js / environment.js — never serve env.js from a public path.";
    }
    return null;
  },

  // ── Sitemap / robots ─────────────────────────────────────────────────────

  "sitemap-public": (url, _headers, body) => {
    if (/sitemap\.xml/i.test(url) || /sitemap\.xml/i.test(body)) {
      return "sitemap.xml is publicly accessible — audit it for admin or private paths.";
    }
    if (/<sitemap/i.test(body) || /<link[^>]*rel=["']sitemap/i.test(body)) {
      return "Page references a sitemap — verify it does not include admin or private paths.";
    }
    return null;
  },

  "robots-txt-allows-all": (url, _headers, body) => {
    if (/\/robots\.txt(?:$|\?)/i.test(url)) {
      const lower = body.toLowerCase();
      const hasDisallow = /^\s*disallow\s*:/m.test(lower);
      if (!hasDisallow) {
        return "robots.txt disallows nothing — that's fine, but consider explicit Disallow for paths you don't want crawled.";
      }
      return null;
    }
    if (
      /^\s*user-agent\s*:\s*\*\s*$/im.test(body) &&
      !/disallow\s*:/i.test(body)
    ) {
      return "robots.txt-equivalent content allows all user-agents with no Disallow rules.";
    }
    return null;
  },

  // ── API schema / version exposure ────────────────────────────────────────

  "open-api-schema-version-leak": (url, _headers, body) => {
    if (
      /\/openapi[\.\-_]?v?\d+/i.test(url) ||
      /openapi.*version.*\d/i.test(body)
    ) {
      return "OpenAPI / Swagger schema version is exposed in the URL or body — move API version into the path prefix.";
    }
    if (/swagger|openapi/i.test(body) && /v\d+(\.\d+)*/i.test(body)) {
      return "OpenAPI/Swagger content references a versioned schema — verify versioning is not pinned to a vulnerable release.";
    }
    if (/^https?:\/\/api\./i.test(url)) {
      return "API endpoint served — verify OpenAPI/Swagger schema does not pin a vulnerable version in the URL.";
    }
    return null;
  },

  "cdn-cors-exposes-internal": (url, headers) => {
    const acao = getHeader(headers, "access-control-allow-origin");
    if (acao) {
      const internalHints = [
        /\.internal\b/i,
        /\.local\b/i,
        /\.corp\b/i,
        /cdn-[a-z0-9-]+\.amazonaws\.com/i,
        /cloudfront\.net/i,
      ];
      for (const p of internalHints) {
        if (p.test(acao)) {
          return `Access-Control-Allow-Origin '${acao}' exposes an internal CDN/host — restrict to the customer-facing origin.`;
        }
      }
    }
    if (/^https?:\/\/api\./i.test(url) && !acao) {
      return "API endpoint with no Access-Control-Allow-Origin — verify CORS config doesn't expose internal hostnames.";
    }
    return null;
  },

  // ── Public-but-fingerprintable keys ──────────────────────────────────────

  "recaptcha-key-leaked": (_url, _headers, body) => {
    const matches = body.match(/6[LM][A-Za-z0-9_-]{38,}/g);
    if (matches && matches.length > 0) {
      return `Google reCAPTCHA site key exposed: ${matches[0]!.slice(0, 12)}… — site keys are not secret, but rotate if abused.`;
    }
    if (/(?:6[LM][A-Za-z0-9_-]{8,})/.test(body)) {
      return "Possible Google reCAPTCHA site key pattern found in body — verify the value is benign.";
    }
    if (/google\.com\/recaptcha/i.test(body)) {
      return "Page references Google reCAPTCHA — site keys are not secret, but verify rotation policy.";
    }
    return null;
  },

  "ga-tracking-id-leaked": (_url, _headers, body) => {
    const ua = body.match(/UA-\d{4,}-\d{1,3}/g);
    const ga4 = body.match(/G-[A-Z0-9]{6,12}/g);
    if (ua || ga4) {
      const sample = (ua && ua[0]) || (ga4 && ga4[0]);
      return `Google Analytics tracking ID exposed: ${sample} — informational only.`;
    }
    if (/google-analytics\.com|googletagmanager\.com/i.test(body)) {
      return "Page references Google Analytics — tracking IDs are public but verify the property is the correct one.";
    }
    return null;
  },

  // ── Server 404 / error page version leaks ────────────────────────────────

  "nginx-version-404-disclosure": (_url, headers, body) => {
    const server = getHeader(headers, "server") || "";
    if (/nginx\/\d+\.\d+\.\d+/i.test(server)) {
      return `Server header exposes nginx version: '${server}' — set 'server_tokens off;' in nginx.conf.`;
    }
    if (/nginx\/\d+\.\d+\.\d+/i.test(body)) {
      return "Body references 'nginx/X.Y.Z' — a default nginx error page is leaking the version.";
    }
    return null;
  },

  "apache-version-404-disclosure": (_url, headers, body) => {
    const server = getHeader(headers, "server") || "";
    if (/Apache\/\d+\.\d+\.\d+/i.test(server)) {
      return `Server header exposes Apache version: '${server}' — set 'ServerTokens Prod' and 'ServerSignature Off'.`;
    }
    if (/Apache\/\d+\.\d+\.\d+/i.test(body)) {
      return "Body references 'Apache/X.Y.Z' — a default Apache error page is leaking the version and modules.";
    }
    if (
      /<html/i.test(body) &&
      /\bApache\b/i.test(body) &&
      /Server at/i.test(body)
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
    if (/Microsoft-IIS\/\d+\.\d+/i.test(body)) {
      return "Body references 'Microsoft-IIS/X.Y' — a default IIS error page is leaking the version.";
    }
    return null;
  },

  // ── Framework error pages ────────────────────────────────────────────────

  "express-error-format-disclosure": (_url, _headers, body) => {
    if (
      /Cannot\s+(GET|POST|PUT|DELETE|PATCH)\s+\//i.test(body) ||
      /TypeError:\s+[A-Za-z_.]+\s+is\s+not\s+(?:a\s+function|defined)/i.test(
        body,
      ) ||
      /at\s+\S+\s+\(.*:\d+:\d+\)\s*$/m.test(body)
    ) {
      return "Express default error page / stack trace detected — set NODE_ENV=production and use a sanitized error handler.";
    }
    return null;
  },

  "flask-debug-page-exposure": (_url, _headers, body) => {
    if (
      /Werkzeug Debugger|TRACEBACK\s*\(most recent call (?:first|last)\)/i.test(body)
    ) {
      return "Flask Werkzeug interactive debugger page exposed — set debug=False / FLASK_ENV=production.";
    }
    if (/<title>\s*Werkzeug Debugger/i.test(body)) {
      return "Werkzeug debugger console detected in HTML — disable debug mode in any internet-reachable environment.";
    }
    return null;
  },

  "django-debug-page-exposure": (_url, _headers, body) => {
    if (
      /Django\s+Version\s*:\s*\d+\.\d+/i.test(body) ||
      /You're\s+seeing\s+this\s+error\s+because\s+you\s+have\s+<code>DJANGO_DEBUG<\/code>\s+set\s+to\s+True/i.test(
        body,
      ) ||
      /DJANGO_SETTINGS_MODULE\s*=/i.test(body)
    ) {
      return "Django technical 500 / debug page exposed — set DEBUG=False in production.";
    }
    return null;
  },

  "rails-error-page-disclosure": (_url, _headers, body) => {
    if (
      /<title>\s*Welcome\s+aboard\s*<\/title>/i.test(body) ||
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
    if (
      /"\/_actuator\//i.test(body) ||
      /"\/actuator\/(env|health|info|beans|mappings|heapdump|threaddump|metrics)"/i.test(
        body,
      ) ||
      /management\.endpoints\.web\.exposure/i.test(body)
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
    if (
      /\/@vite\/client/i.test(body) ||
      /\/@fs\//i.test(body) ||
      /\bvite\/hmr\b/i.test(body)
    ) {
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
    if (
      /Access denied for user\s+['"][^'"]+['"]@['"][^'"]+['"]/i.test(body) ||
      /using password:\s*(YES|NO)/i.test(body) ||
      /mysqli?_?connect.*failed/i.test(body) ||
      /SQLSTATE\[HY000\]\[1045\]/i.test(body)
    ) {
      return "MySQL 'Access denied' error pattern exposed — catch the exception in the app layer and return a generic 500.";
    }
    return null;
  },
};
