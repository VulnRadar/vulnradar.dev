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
import { hasTagWith, stripTagElements } from "./_tag-scan";

/**
 * Whether a Grafana version is inside the range affected by CVE-2021-43798.
 *
 * Unauthenticated path traversal through the plugin route, reading any file
 * the Grafana process can read. Introduced in 8.0.0-beta1 and fixed on each
 * 8.x line separately, which is why this is a table rather than one bound:
 * 8.2.7 is patched and 8.3.0, a later release, is not.
 */
function hasGrafanaPathTraversal(version: string): boolean {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(version.trim());
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = m[3] === undefined ? 0 : Number(m[3]);
  if (major !== 8) return false;
  const FIXED_IN: Record<number, number> = { 0: 7, 1: 8, 2: 7, 3: 1 };
  const fixedAt = FIXED_IN[minor];
  if (fixedAt === undefined) return false;
  return patch < fixedAt;
}

export const detectors: Record<string, DetectFn> = {
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
    // Same single-forward-pass strip as content.ts's sibling, and for the
    // same reason: the local copy of `<tag\b[^>]*>[\s\S]*?</tag\s*>` measured
    // 3083 ms on a 256 KB body of `"<code>x"` repeated.
    const html = stripTagElements(
      body,
      ["code", "pre", "kbd", "samp", "template"],
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
      // continue, not return null: a correctly-flagged cookie only clears
      // itself. Returning here made the first matching cookie decide for the
      // whole response, so a hardened csrftoken hid a session cookie that was
      // genuinely missing attributes later in the same Set-Cookie list.
      if (missing.length === 0) continue;
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
      // continue, not return null: Laravel sets XSRF-TOKEN *and* the
      // *_session cookie on the same response, so returning on the first
      // clean one let a hardened XSRF-TOKEN mask a laravel_session that was
      // still missing HttpOnly.
      if (missing.length === 0) continue;
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
      // continue, not return null: same reason as the two detectors above, a
      // clean cookie clears only itself and must not end the scan early.
      if (missing.length === 0) continue;
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
    if (
      hasTagWith(body, "script", /src=["'][^"']*(?:config|settings)\.js["']/i)
    ) {
      return "Public config.js/settings.js loaded as a script — verify it contains no API keys or credentials.";
    }
    return null;
  },

  "env-js-leaked": (_url, _headers, body) => {
    if (
      hasTagWith(body, "script", /src=["'][^"']*(?:env|environment)\.js["']/i)
    ) {
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
      // A floating `.*` between the version and "application" rescans to the
      // end of the line from every `Rails N.N.N` in the document: a body of
      // `"Rails 1.1.1 "` repeated measured 32 ms at 16 KB and 1964 ms at
      // 128 KB. Bounding the gap and the version components caps the work per
      // occurrence; Rails prints "Rails 7.0.4 application starting in
      // development", so 80 characters is far more room than the real page
      // needs.
      /Rails\s{1,20}\d{1,4}\.\d{1,4}\.\d{1,4}[^\n]{0,80}application/i.test(
        body,
      ) ||
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
    const inBody =
      /Grafana\s+(?:v|ver\.?|version)?\s*(\d+\.\d+(?:\.\d+)?)/i.exec(body);
    const version = gv?.trim() || inBody?.[1];
    if (!version) return null;
    const where = gv ? "X-Grafana-Version header" : "page body";
    // The definition cites CVE-2021-43798, which is on CISA's Known
    // Exploited Vulnerabilities list, and this check used to name it at
    // every Grafana it found. A current Grafana 11 was handed an
    // unauthenticated-file-read CVE it has not been vulnerable to for four
    // years, which is the kind of finding that teaches a reader to stop
    // believing the report. The version is right there in the evidence, so
    // compare it.
    if (hasGrafanaPathTraversal(version)) {
      return `Grafana ${version} disclosed in the ${where}. That version is inside the range affected by CVE-2021-43798, an unauthenticated path traversal that reads any file the Grafana process can read, and it is on CISA's Known Exploited Vulnerabilities list. Upgrade before doing anything about the fingerprint.`;
    }
    return `Grafana ${version} disclosed in the ${where}. This version is not in the range affected by CVE-2021-43798. Publishing it still tells an attacker which advisories to go and read, so strip the fingerprint at a reverse proxy.`;
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
      /<script\b[^>]{0,2000}src=["'][^"']*\/@vite\/client["']/i,
      /<script\b[^>]{0,2000}src=["'][^"']*\/@fs\//i,
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
    // `panic:\s+.+` had `\s+` and `.+` competing for the same run of spaces
    // with "goroutine" never arriving: `"panic:" + " ".repeat(n)` measured
    // 514 ms at 16 KB and 21,561 ms at 128 KB, four times the cost for twice
    // the input. Go prints the panic value on the same line as `panic:`, so
    // a single required space/tab followed by a bounded rest-of-line says the
    // same thing with no two runs able to claim the same character.
    if (
      /panic:[ \t][^\n]{0,300}\n?goroutine[ \t]{1,20}\d{1,10}[ \t]{1,20}\[running\]/i.test(
        body,
      ) ||
      (/goroutine\s{1,20}\d{1,10}\s{1,20}\[running\]/i.test(body) &&
        /\.go:\d+/.test(body))
    ) {
      return "Go panic / goroutine stack trace exposed in response — leaks source file paths and internal call stack.";
    }
    return null;
  },

  "ruby-backtrace-exposed": (_url, _headers, body) => {
    // The leading class overlaps the `.rb` that follows it, so without a
    // left anchor a long run of word characters is re-attempted from every
    // offset: quadratic, measured at ~4.6s on 50KB, which extrapolates to
    // roughly half an hour against the 1MB body cap execute-scan.ts applies.
    // A scanned page controls this body, and every scan timeout is a
    // setTimeout, which cannot fire while a regex holds the event loop.
    // The lookbehind makes only the first position of a run eligible.
    // ref: AUDIT-012#inj-03
    const frames = body.match(/(?<![\w./-])[\w./-]+\.rb:\d+:in `[^']+'/g) || [];
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
    // page-stack-trace-disclosed requires real frames, otherwise the phrase
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
