/**
 * HTTP header detectors.
 *
 * Each detector receives (url, headers, body) and returns either null
 * (no finding) or a string of evidence. The registry wires metadata
 * (title, severity, fix steps) from ./checks-data/headers.json.
 */

import { getHeader, hasHeader, type EvidenceFn as DetectFn } from "../_helpers";

const h = getHeader;

export const detectors: Record<string, DetectFn> = {
  // ── Security header presence ────────────────────────────────────────────────

  "hsts-missing": (_url, headers) => {
    if (hasHeader(headers, "strict-transport-security")) return null;
    return "Header 'Strict-Transport-Security' is not present in the response.";
  },

  "csp-missing": (_url, headers) => {
    if (hasHeader(headers, "content-security-policy")) return null;
    return "Header 'Content-Security-Policy' is not present in the response.";
  },

  "clickjack-missing": (_url, headers) => {
    const xfo = h(headers, "x-frame-options");
    const csp = h(headers, "content-security-policy");
    if (xfo) return null;
    if (csp && csp.includes("frame-ancestors")) return null;
    return "Neither 'X-Frame-Options' header nor CSP 'frame-ancestors' directive is set.";
  },

  "xcto-missing": (_url, headers) => {
    if (hasHeader(headers, "x-content-type-options")) return null;
    return "Header 'X-Content-Type-Options' is not present in the response.";
  },

  "referrer-policy-missing": (_url, headers) => {
    if (hasHeader(headers, "referrer-policy")) return null;
    return "Header 'Referrer-Policy' is not present in the response.";
  },

  "permissions-policy-missing": (_url, headers) => {
    if (
      hasHeader(headers, "permissions-policy") ||
      hasHeader(headers, "feature-policy")
    )
      return null;
    return "Neither 'Permissions-Policy' nor 'Feature-Policy' headers are present.";
  },

  "coop-missing": (_url, headers) => {
    if (hasHeader(headers, "cross-origin-opener-policy")) return null;
    return "Header 'Cross-Origin-Opener-Policy' is not present.";
  },

  "corp-missing": (_url, headers) => {
    if (hasHeader(headers, "cross-origin-resource-policy")) return null;
    return "Header 'Cross-Origin-Resource-Policy' is not present.";
  },

  "coep-missing": (_url, headers) => {
    if (hasHeader(headers, "cross-origin-embedder-policy")) return null;
    return "Header 'Cross-Origin-Embedder-Policy' is not present.";
  },

  "xxss-protection-missing": (_url, headers) => {
    if (hasHeader(headers, "x-xss-protection")) return null;
    if (hasHeader(headers, "content-security-policy")) return null;
    return "Neither 'X-XSS-Protection' nor CSP is set.";
  },

  "cache-control-missing": (_url, headers) => {
    if (hasHeader(headers, "cache-control") || hasHeader(headers, "pragma"))
      return null;
    return "Neither 'Cache-Control' nor 'Pragma' headers are present.";
  },

  "nel-missing": (_url, headers) => {
    if (hasHeader(headers, "nel") || hasHeader(headers, "report-to"))
      return null;
    return "Neither NEL (Network Error Logging) nor Report-To headers are present.";
  },

  "document-policy-missing": (_url, headers) => {
    if (!hasHeader(headers, "document-policy")) {
      return "Document-Policy header not set.";
    }
    return null;
  },

  "origin-agent-cluster": (_url, headers) => {
    if (!hasHeader(headers, "origin-agent-cluster")) {
      return "Origin-Agent-Cluster header not set (helps isolate origins).";
    }
    return null;
  },

  "report-to-header-missing": (_url, headers) => {
    if (hasHeader(headers, "report-to")) return null;
    return "Report-To header not present.";
  },

  "nel-header-missing": (_url, headers) => {
    if (hasHeader(headers, "nel")) return null;
    return "NEL (Network Error Logging) header not present.";
  },

  // ── CORS ──────────────────────────────────────────────────────────────────

  "cors-wildcard": (_url, headers) => {
    const acao = h(headers, "access-control-allow-origin");
    return acao === "*" ? "Access-Control-Allow-Origin is set to '*'." : null;
  },

  "cors-credentials-wildcard": (_url, headers) => {
    const acao = h(headers, "access-control-allow-origin");
    const acac = h(headers, "access-control-allow-credentials");
    if (acao === "*" && acac?.toLowerCase() === "true") {
      return "Access-Control-Allow-Origin: * combined with Access-Control-Allow-Credentials: true";
    }
    return null;
  },

  "cors-origin-reflection": (_url, headers) => {
    const acao = h(headers, "access-control-allow-origin");
    if (!acao || acao === "*" || acao === "null") return null;
    const acac = h(headers, "access-control-allow-credentials");
    if (acac?.toLowerCase() === "true" && acao.startsWith("http")) {
      return `ACAO set to '${acao}' with credentials. Verify origin is validated against an allowlist.`;
    }
    return null;
  },

  "cors-null-origin-allowed": (_url, headers) => {
    const acao = h(headers, "access-control-allow-origin");
    if (!acao || acao.trim() !== "null") return null;
    return "Access-Control-Allow-Origin allows 'null' origin, exploitable via sandboxed iframes.";
  },

  "access-control-expose": (_url, headers) => {
    const aeh = h(headers, "access-control-expose-headers");
    if (!aeh) return null;
    const sensitive = ["authorization", "set-cookie", "x-csrf-token"];
    const exposed = sensitive.filter((s) => aeh.toLowerCase().includes(s));
    return exposed.length > 0
      ? `Sensitive headers exposed via CORS: ${exposed.join(", ")}`
      : null;
  },

  "access-control-expose-broad": (_url, headers) => {
    const v = h(headers, "access-control-expose-headers");
    if (!v) return null;
    const exposed = v.split(",").map((s) => s.trim().toLowerCase());
    if (exposed.length < 5) return null;
    return `Access-Control-Expose-Headers exposes ${exposed.length} headers: ${exposed.join(", ")}.`;
  },

  "access-control-max-age-long": (_url, headers) => {
    const v = h(headers, "access-control-max-age");
    if (!v) return null;
    const seconds = parseInt(v, 10);
    if (isNaN(seconds) || seconds < 86400) return null;
    return `Access-Control-Max-Age set to ${seconds}s (${Math.round(seconds / 3600)}h). Preflight results cached excessively.`;
  },

  // ── CSP ───────────────────────────────────────────────────────────────────

  "csp-report-only": (_url, headers) => {
    const reportOnly = hasHeader(
      headers,
      "content-security-policy-report-only",
    );
    const enforcing = hasHeader(headers, "content-security-policy");
    if (reportOnly && !enforcing)
      return "CSP-Report-Only is set but no enforcing CSP header exists.";
    return null;
  },

  "csp-frame-ancestors": (_url, headers) => {
    const csp = h(headers, "content-security-policy");
    if (!csp) return null;
    if (csp.includes("frame-ancestors")) return null;
    const xfo = h(headers, "x-frame-options");
    if (xfo) return null;
    return "CSP exists but lacks frame-ancestors directive and X-Frame-Options is not set.";
  },

  "csp-form-action-missing": (_url, headers) => {
    const csp = h(headers, "content-security-policy");
    if (!csp) return null;
    if (csp.includes("form-action")) return null;
    return "CSP exists but no form-action directive.";
  },

  "csp-base-uri-missing": (_url, headers) => {
    const csp = h(headers, "content-security-policy");
    if (!csp) return null;
    if (csp.includes("base-uri")) return null;
    return "CSP exists but no base-uri directive.";
  },

  "csp-object-src-missing": (_url, headers) => {
    const csp = h(headers, "content-security-policy");
    if (!csp) return null;
    if (csp.includes("object-src")) return null;
    if (/default-src\s+'none'/.test(csp)) return null;
    return "CSP exists but no object-src directive.";
  },

  "csp-no-upgrade-insecure": (_url, headers) => {
    const csp = h(headers, "content-security-policy");
    if (!csp) return null;
    if (csp.includes("upgrade-insecure-requests")) return null;
    return "CSP does not include 'upgrade-insecure-requests' directive.";
  },

  "csp-no-default-src": (_url, headers) => {
    const csp = h(headers, "content-security-policy");
    if (!csp) return null;
    if (csp.includes("default-src")) return null;
    return "CSP has no default-src fallback directive. Undeclared resource types are unrestricted.";
  },

  "csp-report-uri-deprecated": (_url, headers) => {
    const csp = h(headers, "content-security-policy");
    if (!csp) return null;
    if (!csp.includes("report-uri")) return null;
    if (csp.includes("report-to")) return null;
    return "CSP uses deprecated 'report-uri' directive without modern 'report-to'.";
  },

  "csp-unsafe-hashes": (_url, headers) => {
    const csp = h(headers, "content-security-policy");
    if (!csp) return null;
    if (/'unsafe-hashes'/.test(csp)) {
      return "CSP uses 'unsafe-hashes' which allows inline event handlers.";
    }
    return null;
  },

  "csp-unsafe-inline-script": (_url, headers, body) => {
    const csp = h(headers, "content-security-policy");
    if (!csp) return null;
    const scriptSrc = csp.match(/script-src[^;]*/i)?.[0] || "";
    if (!scriptSrc.includes("'unsafe-inline'")) return null;
    if (
      scriptSrc.includes("'nonce-") ||
      scriptSrc.includes("'sha256-") ||
      scriptSrc.includes("'strict-dynamic'")
    )
      return null;
    const isFramework =
      body.includes("/_next/") ||
      body.includes("__NEXT_DATA__") ||
      body.includes("__nuxt") ||
      body.includes("/_nuxt/") ||
      /ng-version/i.test(body);
    if (isFramework) return null;
    return "CSP script-src allows 'unsafe-inline' without nonce/hash, negating XSS protection.";
  },

  "csp-unsafe-eval-detected": (_url, headers, body) => {
    const csp = h(headers, "content-security-policy");
    if (!csp) return null;
    if (!csp.includes("'unsafe-eval'")) return null;
    const isFramework =
      body.includes("/_next/") ||
      body.includes("__NEXT_DATA__") ||
      body.includes("__nuxt") ||
      body.includes("/_nuxt/") ||
      /ng-version/i.test(body);
    if (isFramework) return null;
    return "CSP allows 'unsafe-eval', permitting eval(), Function(), and setTimeout with strings.";
  },

  "csp-wildcard-source": (_url, headers) => {
    const csp = h(headers, "content-security-policy");
    if (!csp) return null;
    const parts = csp.split(";").map((s) => s.trim());
    for (const p of parts) {
      const hasRealWildcard = /(?:^|\s)\*(?:\s|$)/.test(p);
      if (
        hasRealWildcard &&
        !p.includes("img-src") &&
        !p.includes("media-src")
      ) {
        return `CSP uses wildcard source: '${p}'.`;
      }
    }
    return null;
  },

  "csp-data-uri-allowed": (_url, headers) => {
    const csp = h(headers, "content-security-policy");
    if (!csp) return null;
    const scriptSrc = csp.match(/script-src[^;]*/i)?.[0] || "";
    if (!scriptSrc.includes("data:")) return null;
    return "CSP script-src allows data: URIs, enabling XSS via data:text/html payloads.";
  },

  "csp-unsafe-eval-non-framework": (_url, headers, body) => {
    const csp = h(headers, "content-security-policy");
    if (!csp || !csp.includes("'unsafe-eval'")) return null;
    const isFramework =
      body.includes("/_next/") ||
      body.includes("__NEXT_DATA__") ||
      body.includes("__nuxt") ||
      body.includes("ng-version");
    if (isFramework) return null;
    return "CSP contains 'unsafe-eval' but no framework indicators detected.";
  },

  "csp-framework-required": (_url, headers, body) => {
    const csp = h(headers, "content-security-policy");
    if (!csp) return null;

    const isNextJs = body.includes("__NEXT_DATA__") || body.includes("/_next/");
    const isNuxt = body.includes("__nuxt") || body.includes("/_nuxt/");
    const isAngular = /ng-version/i.test(body);

    if (!isNextJs && !isNuxt && !isAngular) return null;

    const framework = isNextJs ? "Next.js" : isNuxt ? "Nuxt.js" : "Angular";
    const frameworkDirectives: string[] = [];

    if (isNextJs) {
      const styleSrc = csp.match(/style-src[^;]*/i)?.[0] || "";
      if (styleSrc.includes("'unsafe-inline'"))
        frameworkDirectives.push(
          "style-src 'unsafe-inline' (required by Next.js styled-jsx)",
        );
      const scriptSrc = csp.match(/script-src[^;]*/i)?.[0] || "";
      if (scriptSrc.includes("'unsafe-inline'"))
        frameworkDirectives.push(
          "script-src 'unsafe-inline' (consider using nonces instead)",
        );
    }

    if (isNuxt) {
      if (csp.includes("'unsafe-inline'"))
        frameworkDirectives.push(
          "unsafe-inline (required by Nuxt/Vue for styles)",
        );
      if (csp.includes("'unsafe-eval'"))
        frameworkDirectives.push("unsafe-eval (used by Vue template compiler)");
    }

    if (isAngular && csp.includes("'unsafe-eval'")) {
      frameworkDirectives.push(
        "unsafe-eval (may be required by Angular JIT compiler)",
      );
    }

    return frameworkDirectives.length > 0
      ? `${framework} detected. Framework-required CSP directives: ${frameworkDirectives.join("; ")}`
      : null;
  },

  "weak-csp-directives": (_url, headers, body) => {
    const csp = h(headers, "content-security-policy");
    if (!csp) return null;

    const isFramework =
      body.includes("__NEXT_DATA__") ||
      body.includes("/_next/") ||
      body.includes("__nuxt") ||
      body.includes("/_nuxt/") ||
      /ng-version/i.test(body);

    const issues: string[] = [];

    if (!isFramework) {
      if (
        csp.includes("'unsafe-inline'") &&
        !csp.includes("'nonce-") &&
        !csp.includes("'strict-dynamic'")
      ) {
        issues.push("unsafe-inline without nonce");
      }
      if (csp.includes("'unsafe-eval'")) {
        issues.push("unsafe-eval");
      }
    }

    if (csp.includes("data:")) {
      const scriptSrc = csp.match(/script-src[^;]*/i)?.[0] || "";
      if (scriptSrc.includes("data:")) issues.push("data: in script-src");
    }
    const defaultSrc = csp.match(/default-src[^;]*/i)?.[0] || "";
    const scriptSrc = csp.match(/script-src[^;]*/i)?.[0] || "";
    if (/(?:^|\s)\*(?:\s|;|$)/.test(defaultSrc))
      issues.push("wildcard in default-src");
    if (/(?:^|\s)\*(?:\s|;|$)/.test(scriptSrc))
      issues.push("wildcard in script-src");

    return issues.length > 0
      ? `Weak CSP directives: ${issues.join(", ")}`
      : null;
  },

  // ── Referrer / Permissions / Cross-origin ────────────────────────────────

  "referrer-policy-unsafe": (_url, headers) => {
    const rp = h(headers, "referrer-policy");
    if (!rp) return null;
    if (
      ["unsafe-url", "no-referrer-when-downgrade"].includes(
        rp.toLowerCase().trim(),
      )
    ) {
      return `Referrer-Policy '${rp}' leaks full URL including paths and query parameters.`;
    }
    return null;
  },

  "excessive-permissions": (_url, headers) => {
    const pp = h(headers, "permissions-policy") || h(headers, "feature-policy");
    if (!pp) return null;
    const dangerous = [
      "camera=*",
      "microphone=*",
      "geolocation=*",
      "payment=*",
      "usb=*",
      'camera ("*")',
      'microphone ("*")',
      'geolocation ("*")',
    ];
    const found: string[] = [];
    for (const d of dangerous) {
      if (pp.includes(d)) found.push(d);
    }
    return found.length > 0
      ? `Overly permissive Permissions-Policy: ${found.join(", ")}`
      : null;
  },

  "feature-policy-deprecated": (_url, headers) => {
    if (!hasHeader(headers, "feature-policy")) return null;
    if (hasHeader(headers, "permissions-policy")) return null;
    return "Feature-Policy header is set but not Permissions-Policy. Feature-Policy is deprecated; use Permissions-Policy instead.";
  },

  "x-xss-protection-disabled": (_url, headers) => {
    const v = h(headers, "x-xss-protection");
    if (!v) return null;
    if (v.trim() === "0") {
      return "X-XSS-Protection explicitly disabled (set to 0). While this header is deprecated, value 0 in older browsers disables built-in XSS filtering.";
    }
    return null;
  },

  "nosniff-incorrect": (_url, headers) => {
    const xcto = h(headers, "x-content-type-options");
    if (!xcto) return null;
    if (xcto.toLowerCase().trim() === "nosniff") return null;
    return `X-Content-Type-Options has unexpected value: '${xcto}'. Expected 'nosniff'.`;
  },

  // ── HSTS analysis ────────────────────────────────────────────────────────

  "hsts-no-preload": (_url, headers) => {
    const hsts = h(headers, "strict-transport-security");
    if (!hsts) return null;
    if (hsts.includes("preload")) return null;
    const issues: string[] = [];
    if (!hsts.includes("preload")) issues.push("missing preload");
    if (!hsts.includes("includeSubDomains"))
      issues.push("missing includeSubDomains");
    const maxAgeMatch = hsts.match(/max-age=(\d+)/);
    if (maxAgeMatch && parseInt(maxAgeMatch[1]) < 31536000)
      issues.push(`max-age too low (${maxAgeMatch[1]}, need 31536000+)`);
    return issues.length > 0
      ? `HSTS present but: ${issues.join(", ")}. Current: ${hsts}`
      : null;
  },

  // ── Server identity / version ────────────────────────────────────────────

  "server-header-disclosure": (_url, headers) => {
    const server = h(headers, "server");
    const powered = h(headers, "x-powered-by");
    const via = h(headers, "x-aspnet-version");
    const found: string[] = [];
    if (server && server !== "cloudflare" && server !== "Vercel")
      found.push(`Server: ${server}`);
    if (powered) found.push(`X-Powered-By: ${powered}`);
    if (via) found.push(`X-AspNet-Version: ${via}`);
    return found.length > 0
      ? `Technology disclosed: ${found.join(", ")}`
      : null;
  },

  "server-version-detailed": (_url, headers) => {
    const sv = h(headers, "server");
    if (!sv) return null;
    if (/\d+\.\d+/.test(sv)) {
      return `Server header reveals detailed version: '${sv}'.`;
    }
    return null;
  },

  "x-powered-by-exposed": (_url, headers) => {
    if (!hasHeader(headers, "x-powered-by")) return null;
    return `X-Powered-By header exposes: '${h(headers, "x-powered-by")}'.`;
  },

  "x-aspnet-version-exposed": (_url, headers) => {
    if (!hasHeader(headers, "x-aspnet-version")) return null;
    return `X-AspNet-Version exposed: '${h(headers, "x-aspnet-version")}'.`;
  },

  "x-aspnetmvc-version-exposed": (_url, headers) => {
    if (!hasHeader(headers, "x-aspnetmvc-version")) return null;
    return `X-AspNetMvc-Version exposed: '${h(headers, "x-aspnetmvc-version")}'.`;
  },

  "via-header-exposed": (_url, headers) => {
    if (!hasHeader(headers, "via")) return null;
    return `Via header reveals proxy chain: '${h(headers, "via")}'.`;
  },

  "x-runtime-exposed": (_url, headers) => {
    if (!hasHeader(headers, "x-runtime")) return null;
    return `X-Runtime header exposes request processing time: ${h(headers, "x-runtime")}ms.`;
  },

  "x-request-id-exposed": (_url, headers) => {
    if (!hasHeader(headers, "x-request-id")) return null;
    return "X-Request-Id header is exposed to clients.";
  },

  "x-backend-server-exposed": (_url, headers) => {
    for (const name of [
      "x-backend-server",
      "x-served-by",
      "x-server",
      "x-host",
    ]) {
      if (hasHeader(headers, name))
        return `Header '${name}' exposes backend server info: '${h(headers, name)}'.`;
    }
    return null;
  },

  "age-header-reveals-cdn": (_url, headers) => {
    if (!hasHeader(headers, "age")) return null;
    const age = parseInt(h(headers, "age") || "0", 10);
    if (age < 1) return null;
    return `Age header (${age}s) reveals CDN caching behavior.`;
  },

  "x-debug-header-exposed": (_url, headers) => {
    for (const name of [
      "x-debug",
      "x-debug-token",
      "x-debug-token-link",
      "x-debug-info",
    ]) {
      if (hasHeader(headers, name))
        return `Debug header '${name}' found in production response.`;
    }
    return null;
  },

  "x-amz-request-id": (_url, headers) => {
    if (
      hasHeader(headers, "x-amz-request-id") ||
      hasHeader(headers, "x-amz-id-2")
    ) {
      return "AWS request ID headers exposed - reveals AWS infrastructure.";
    }
    return null;
  },

  "cf-ray-header": (_url, headers) => {
    if (hasHeader(headers, "cf-ray")) {
      return "Cloudflare CF-Ray header present - reveals CDN usage.";
    }
    return null;
  },

  "x-vercel-id": (_url, headers) => {
    if (hasHeader(headers, "x-vercel-id")) {
      return "Vercel deployment ID exposed.";
    }
    return null;
  },

  "x-cache-header": (_url, headers) => {
    const xCache = h(headers, "x-cache");
    if (xCache && /hit|miss/i.test(xCache)) {
      return `X-Cache header reveals caching behavior: ${xCache}.`;
    }
    return null;
  },

  "etag-inode": (_url, headers) => {
    const etag = h(headers, "etag");
    if (etag && /^["']?[0-9a-f]+-[0-9a-f]+-[0-9a-f]+["']?$/i.test(etag)) {
      return "ETag appears to contain inode information - filesystem disclosure.";
    }
    return null;
  },

  "etag-inode-leak": (_url, headers) => {
    const etag = h(headers, "etag");
    if (!etag) return null;
    if (/^"?[0-9a-f]+-[0-9a-f]+-[0-9a-f]+"?$/i.test(etag)) {
      return `ETag '${etag}' uses inode-size-timestamp format, leaking filesystem info.`;
    }
    return null;
  },

  "server-timing-exposure": (_url, headers) => {
    const st = h(headers, "server-timing");
    if (!st) return null;
    if (/dur=\d|;desc=/i.test(st))
      return `Server-Timing header exposes performance details: ${st.slice(0, 100)}`;
    return null;
  },

  "timing-allow-origin-wide": (_url, headers) => {
    const tao = h(headers, "timing-allow-origin");
    if (!tao || tao !== "*") return null;
    return "Timing-Allow-Origin is set to '*', allowing any origin to read Resource Timing API data.";
  },

  "timing-allow-wildcard": (_url, headers) => {
    const v = h(headers, "timing-allow-origin");
    if (!v || v.trim() !== "*") return null;
    return "Timing-Allow-Origin is set to wildcard (*).";
  },

  "date-time-skew": (_url, headers) => {
    const serverDate = h(headers, "date");
    if (!serverDate) return null;
    const serverTime = new Date(serverDate).getTime();
    const now = Date.now();
    const skew = Math.abs(serverTime - now);
    if (skew > 300000) {
      return "Server date significantly differs from client time - potential NTP issues.";
    }
    return null;
  },

  "x-dns-prefetch-control-off": (_url, headers) => {
    const v = h(headers, "x-dns-prefetch-control");
    if (v && v.toLowerCase() === "off") {
      return "X-DNS-Prefetch-Control is off - may impact performance.";
    }
    return null;
  },

  // ── Cache + transport ────────────────────────────────────────────────────

  "cache-control-public-sensitive": (_url, headers, body) => {
    const cc = h(headers, "cache-control");
    if (!cc || !cc.includes("public")) return null;
    const hasForm = /<form[^>]*method\s*=\s*["']?post/i.test(body);
    const hasPasswd = /<input[^>]*type\s*=\s*["']?password/i.test(body);
    if (!hasForm && !hasPasswd) return null;
    return "Cache-Control: public set on page containing sensitive forms.";
  },

  // ── Clickjacking / framing ───────────────────────────────────────────────

  "clickjacking-frameable": (_url, headers) => {
    const xfo = h(headers, "x-frame-options");
    const csp = h(headers, "content-security-policy");
    if (xfo) return null;
    if (csp && csp.includes("frame-ancestors")) return null;
    return "No framing protection detected (no X-Frame-Options, no CSP frame-ancestors).";
  },

  // ── Deprecated TLS ────────────────────────────────────────────────────────

  "deprecated-tls": (url) => {
    return url.startsWith("http://") ? `URL uses HTTP: ${url}` : null;
  },

  // ── Mixed content + form over HTTP ───────────────────────────────────────

  "mixed-content": (url, _headers, body) => {
    if (!url.startsWith("https://")) return null;
    const httpRefs =
      body.match(
        /(?:src|href|action)=["']http:\/\/(?!localhost)[^"']+["']/gi,
      ) || [];
    if (httpRefs.length === 0) return null;
    const samples = httpRefs
      .slice(0, 3)
      .map((r) =>
        r.replace(/^(?:src|href|action)=["']/i, "").replace(/["']$/, ""),
      );
    return `Found ${httpRefs.length} HTTP resource(s) on HTTPS page:\n${samples.join("\n")}${httpRefs.length > 3 ? `\n...and ${httpRefs.length - 3} more` : ""}`;
  },

  "form-action-http": (url, _headers, body) => {
    if (!url.startsWith("https://")) return null;
    const httpForms =
      body.match(/<form[^>]*action=["']http:\/\/[^"']+["'][^>]*>/gi) || [];
    return httpForms.length > 0
      ? `Found ${httpForms.length} form(s) submitting over HTTP.`
      : null;
  },

  "mixed-content-form-action": (url, _headers, body) => {
    if (!url.startsWith("https://")) return null;
    if (/<form[^>]*action\s*=\s*["']http:\/\//i.test(body)) {
      return "HTTPS page contains form submitting to HTTP endpoint.";
    }
    return null;
  },

  // ── SRI ──────────────────────────────────────────────────────────────────

  "sri-missing": (_url, _headers, body) => {
    const externalScripts =
      body.match(/<script[^>]+src=["']https?:\/\/[^"']+["'][^>]*>/gi) || [];
    const noSRI = externalScripts.filter(
      (t) => !t.toLowerCase().includes("integrity="),
    );
    if (noSRI.length === 0) return null;
    const samples = noSRI.slice(0, 3).map((t) => {
      const srcMatch = t.match(/src=["'](https?:\/\/[^"']+)["']/i);
      return srcMatch ? srcMatch[1] : t.slice(0, 80);
    });
    return `Found ${noSRI.length} external script(s) without integrity:\n${samples.join("\n")}${noSRI.length > 3 ? `\n...and ${noSRI.length - 3} more` : ""}`;
  },

  "sri-stylesheet-missing": (_url, _headers, body) => {
    const extStyles =
      body.match(
        /<link[^>]+rel=["']stylesheet["'][^>]+href=["']https?:\/\/[^"']+["'][^>]*>/gi,
      ) || [];
    const noSRI = extStyles.filter(
      (t) => !t.toLowerCase().includes("integrity="),
    );
    return noSRI.length > 0
      ? `Found ${noSRI.length} external stylesheet(s) without integrity attribute.`
      : null;
  },

  "external-script-no-sri": (_url, _headers, body) => {
    const scripts =
      body.match(/<script[^>]*src\s*=\s*["'][^"']*["'][^>]*>/gi) || [];
    let missing = 0;
    for (const s of scripts) {
      if (/src\s*=\s*["']https?:\/\//i.test(s) && !s.includes("integrity"))
        missing++;
    }
    if (missing < 1) return null;
    return `${missing} external script(s) loaded without Subresource Integrity (SRI) hash.`;
  },

  "sri-link-stylesheet-missing": (_url, _headers, body) => {
    const links =
      body.match(/<link[^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi) || [];
    let missing = 0;
    for (const l of links) {
      if (/href\s*=\s*["']https?:\/\//i.test(l) && !l.includes("integrity"))
        missing++;
    }
    if (missing < 1) return null;
    return `${missing} external stylesheet(s) loaded without SRI integrity hash.`;
  },

  // ── Cookies (header-level access for Set-Cookie via Headers.getSetCookie) ─

  "cookie-security": (_url, headers) => {
    const setCookies = (() => {
      if (
        typeof (headers as unknown as { getSetCookie?: () => string[] })
          .getSetCookie === "function"
      ) {
        return (
          headers as unknown as { getSetCookie: () => string[] }
        ).getSetCookie();
      }
      const all: string[] = [];
      headers.forEach((value, key) => {
        if (key.toLowerCase() === "set-cookie") all.push(value);
      });
      return all;
    })();
    if (setCookies.length === 0) return null;
    const issues: string[] = [];
    for (const cookie of setCookies) {
      const lower = cookie.toLowerCase();
      const name = cookie.split("=")[0]?.trim();
      if (!lower.includes("httponly") && !name?.startsWith("__Host-"))
        issues.push(`${name} missing HttpOnly`);
      if (!lower.includes("secure")) issues.push(`${name} missing Secure`);
      if (!lower.includes("samesite")) issues.push(`${name} missing SameSite`);
    }
    return issues.length > 0 ? issues.slice(0, 5).join("; ") : null;
  },

  // ── Clear-Site-Data on logout pages ──────────────────────────────────────

  "clear-site-data-missing": (_url, headers, body) => {
    const isLogout = /logout|sign.?out|log.?out/i.test(body);
    if (!isLogout) return null;
    if (hasHeader(headers, "clear-site-data")) return null;
    return "Logout page detected without Clear-Site-Data header.";
  },
};
