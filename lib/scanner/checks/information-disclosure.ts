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

import { escapeRegExp, type EvidenceFn as DetectFn } from "../_helpers";

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
};
