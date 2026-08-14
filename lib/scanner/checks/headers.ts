/**
 * HTTP header detectors.
 *
 * Each detector receives (url, headers, body) and returns either null
 * (no finding) or a string of evidence. The registry wires metadata
 * (title, severity, fix steps) from ./checks-data/headers.json.
 */

import {
  getHeader,
  hasHeader,
  extractScriptContents,
  type EvidenceFn as DetectFn,
} from "../_helpers";
import { SRI_EXEMPT_HOSTS } from "./client-side";

const h = getHeader;

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export const detectors: Record<string, DetectFn> = {
  // ── Security header presence ────────────────────────────────────────────────

  "hsts-missing": (url, headers) => {
    if (!url.startsWith("https://")) return null;
    if (hasHeader(headers, "strict-transport-security")) return null;
    return "Header 'Strict-Transport-Security' is not present in the response.";
  },

  "csp-missing": (_url, headers) => {
    const ct = h(headers, "content-type") || "";
    if (!ct.includes("text/html")) return null;
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

  "xpcdp-missing": (_url, headers) => {
    const v = h(headers, "x-permitted-cross-domain-policies");
    if (v && v.toLowerCase().trim() === "none") return null;
    if (!v) {
      return "Header 'X-Permitted-Cross-Domain-Policies' is not present in the response.";
    }
    return `X-Permitted-Cross-Domain-Policies is '${v}', not 'none'.`;
  },

  "origin-agent-cluster-missing": (_url, headers) => {
    if (hasHeader(headers, "origin-agent-cluster")) return null;
    return "Header 'Origin-Agent-Cluster' is not present in the response.";
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

  "corp-missing": (_url, _headers) => {
    // Exact duplicate of cross-origin-resource-policy-report-only-missing
    // (same header, same condition — CORP has no separate Report-Only
    // variant, so both ids were really checking the one real header).
    // Disabled to avoid double-firing the same evidence.
    // ref: AUDIT-008#scanner-05
    return null;
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

  "cache-control-missing": (url, headers) => {
    if (hasHeader(headers, "cache-control") || hasHeader(headers, "pragma"))
      return null;
    // Only actionable when the page could plausibly hold something worth
    // not caching -- an ordinary static page with nothing sensitive on it
    // (the vast majority of default-config Nginx/static hosts) has no
    // caching-related exposure just because the header is absent. Mirrors
    // cache-control-no-store-missing's sensitive-path gate.
    if (!isSensitivePath(url)) return null;
    return "Neither 'Cache-Control' nor 'Pragma' headers are present.";
  },

  "nel-header-missing": (_url, _headers) => {
    // NEL is an optional browser reporting API, not a security requirement.
    // Its absence is not a vulnerability.
    return null;
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
      return `ACAO reflects '${acao}' with credentials allowed. Unverified from a single response: confirm the server validates Origin against an allowlist rather than blindly reflecting it.`;
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

  "csp-frame-ancestors": (_url, _headers) => {
    // Every condition under which this fired (CSP present, no frame-ancestors,
    // no X-Frame-Options) is a strict subset of clickjack-missing's firing
    // condition (no X-Frame-Options and no CSP frame-ancestors, regardless of
    // whether CSP is present at all) — so this always double-counted the same
    // "site has zero clickjacking protection" evidence as a second finding.
    // Its metadata also didn't describe this condition; it described a
    // different, unrelated "header present but no JS fallback" scenario that
    // belongs to frame-busting-header-only. Disabled in favor of
    // clickjack-missing. ref: AUDIT-008#scanner-05
    return null;
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
    const directives = csp
      .split(";")
      .map((d) => d.trim())
      .filter((d) => d.includes("'unsafe-eval'"))
      .map((d) => d.split(/\s+/)[0]);
    return `CSP allows 'unsafe-eval' in: ${directives.join(", ")} — permits eval(), Function(), and setTimeout with strings.`;
  },

  "csp-allows-http-sources": (_url, headers) => {
    const csp = h(headers, "content-security-policy");
    if (!csp) return null;
    const scriptSrc = csp.match(/script-src[^;]*/i)?.[0] || "";
    const defaultSrc = csp.match(/default-src[^;]*/i)?.[0] || "";
    const effective = scriptSrc || defaultSrc;
    if (!effective) return null;
    if (!/(?:^|\s)http:\/\//i.test(effective)) return null;
    const directive = scriptSrc ? "script-src" : "default-src";
    return `CSP ${directive} allows http:// sources — scripts can be loaded over unencrypted HTTP, enabling MITM injection.`;
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
    const scriptSrc = csp.match(/script-src[^;]*/i)?.[0] || "";

    if (!isFramework) {
      // Scoped to script-src, not the whole header: an ordinary
      // style-src 'self' 'unsafe-inline' (this project's own csp-missing
      // example recommends exactly that) is not a script-injection risk
      // and must not be flagged as "weak".
      if (
        scriptSrc.includes("'unsafe-inline'") &&
        !scriptSrc.includes("'nonce-") &&
        !scriptSrc.includes("'strict-dynamic'")
      ) {
        issues.push("unsafe-inline without nonce");
      }
      if (csp.includes("'unsafe-eval'")) {
        issues.push("unsafe-eval");
      }
    }

    if (scriptSrc.includes("data:")) issues.push("data: in script-src");
    const defaultSrc = csp.match(/default-src[^;]*/i)?.[0] || "";
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

  "excessive-permissions": (_url, _headers) => {
    // Exact duplicate of the five permissions-policy-{camera,microphone,
    // geolocation,payment,usb}-blocked checks below (all via
    // ppAllowsFeature) -- this list only ever covered those same five
    // features, so a single misconfigured header fired both this and the
    // per-feature check for the identical evidence. Disabled in favor of
    // the more specific per-feature checks.
    return null;
  },

  "feature-policy-deprecated": (_url, headers) => {
    if (!hasHeader(headers, "feature-policy")) return null;
    if (hasHeader(headers, "permissions-policy")) return null;
    return "Feature-Policy header is set but not Permissions-Policy. Feature-Policy is deprecated; use Permissions-Policy instead.";
  },

  "x-xss-protection-disabled": (_url, _headers) => {
    // X-XSS-Protection: 0 is the value OWASP's Secure Headers Project and
    // Mozilla's HTTP Observatory recommend. The legacy XSS Auditor/filter
    // this header controls was found to introduce its own exploitable XSS
    // and info-disclosure bugs and has been removed from every modern
    // browser (Chrome dropped it in Chrome 78); Helmet.js has sent
    // X-XSS-Protection: 0 by default since v4. Flagging '0' would push
    // sites toward re-enabling a filter that's actively worse than off.
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
    const issues: string[] = [];
    if (!hsts.includes("preload")) issues.push("missing preload");
    // includeSubDomains has its own dedicated check
    // (strict-transport-security-include-subdomains) — don't double-report it
    // here too. ref: AUDIT-008#scanner-05
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

  "x-request-id-exposed": (_url, _headers) => {
    // X-Request-Id is standard distributed tracing infrastructure (used by
    // nginx, Heroku, AWS API Gateway, etc.). It is intentionally client-visible
    // for support/debugging purposes and is not a security vulnerability.
    return null;
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

  "age-header-reveals-cdn": (_url, _headers) => {
    // The Age header is defined in RFC 7234 and is a standard part of HTTP
    // caching. Its presence simply indicates the response was served from a
    // cache, which is expected behavior and not a security vulnerability.
    return null;
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

  "x-amz-request-id": (_url, _headers) => {
    // X-Amz-Request-Id/X-Amz-Id-2 are standard AWS infrastructure headers
    // added automatically by ALB, API Gateway, S3, and CloudFront -- the
    // same class of unavoidable, standard header as CF-Ray, X-Vercel-Id,
    // and X-Cache below. Not a vulnerability.
    return null;
  },

  "cf-ray-header": (_url, _headers) => {
    // CF-Ray is a standard Cloudflare header intentionally included in every
    // response. Its presence means the site uses Cloudflare — not a vulnerability.
    return null;
  },

  "x-vercel-id": (_url, _headers) => {
    // X-Vercel-Id is a standard Vercel deployment header included on every
    // Vercel-hosted response. Not a vulnerability.
    return null;
  },

  "x-cache-header": (_url, _headers) => {
    // X-Cache: HIT/MISS is standard CDN behavior and not a security vulnerability.
    return null;
  },

  "etag-inode": (_url, headers) => {
    const etag = h(headers, "etag");
    if (etag && /^["']?[0-9a-f]+-[0-9a-f]+-[0-9a-f]+["']?$/i.test(etag)) {
      return "ETag appears to contain inode information - filesystem disclosure.";
    }
    return null;
  },

  "etag-inode-leak": (_url, _headers) => {
    // Duplicate of etag-inode with the same pattern. Disabled to avoid double-firing.
    return null;
  },

  "server-timing-exposure": (_url, headers) => {
    const st = h(headers, "server-timing");
    if (!st) return null;
    // Only flag when timing metric names reveal sensitive internals (db queries,
    // auth, SQL). Generic timing like "cdn;dur=12" or "cache;dur=5" is standard
    // CDN instrumentation and not actionable.
    if (/\b(?:db|sql|query|auth|session|password|secret|token)\b/i.test(st)) {
      return `Server-Timing header reveals sensitive operation names: ${st.slice(0, 100)}`;
    }
    return null;
  },

  "timing-allow-origin-wide": (_url, headers) => {
    const tao = h(headers, "timing-allow-origin");
    if (!tao || tao !== "*") return null;
    return "Timing-Allow-Origin is set to '*', allowing any origin to read Resource Timing API data.";
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

  // ── Cache + transport ────────────────────────────────────────────────────

  "cache-control-public-sensitive": (url, headers, body) => {
    const cc = h(headers, "cache-control");
    if (!cc || !cc.includes("public")) return null;
    // /login, /signup, /register pages are pre-authentication by
    // definition -- the same static markup is served to every anonymous
    // visitor, so Cache-Control: public there isn't leaking user-specific
    // data even though the page happens to contain a password field.
    let path: string;
    try {
      path = new URL(url).pathname.toLowerCase();
    } catch {
      path = url.toLowerCase();
    }
    if (/\/(?:login|signin|signup|register)(?:\/|$)/.test(path)) return null;
    const hasPasswd = /<input[^>]*type\s*=\s*["']?password/i.test(body);
    if (hasPasswd) {
      return "Cache-Control: public set on page containing sensitive forms.";
    }
    // A bare POST form isn't sensitive on its own -- contact/newsletter/
    // search/comment forms are all POST and all completely public. Only
    // flag a POST form that also collects a genuinely sensitive field.
    const sensitiveFieldRe =
      /<input[^>]*(?:name|id)\s*=\s*["'][^"']*(?:card|ssn|cvv|account[-_]?number)[^"']*["']/i;
    const postForms =
      body.match(
        /<form\b[^>]*method\s*=\s*["']?post[^>]*>[\s\S]*?<\/form\s*>/gi,
      ) || [];
    const hasSensitiveForm = postForms.some((f) => sensitiveFieldRe.test(f));
    if (!hasSensitiveForm) return null;
    return "Cache-Control: public set on page containing sensitive forms.";
  },

  // ── Deprecated TLS ────────────────────────────────────────────────────────

  "deprecated-tls": (url) => {
    return url.startsWith("http://") ? `URL uses HTTP: ${url}` : null;
  },

  // ── Mixed content + form over HTTP ───────────────────────────────────────

  "mixed-content": (url, _headers, body) => {
    if (!url.startsWith("https://")) return null;
    // Only genuine subresource-loading tags trigger a browser mixed-content
    // warning or carry MITM risk. A plain <a href="http://..."> is regular
    // navigation, never fetched as a subresource -- it must not count here.
    // <form action=...> is covered separately by form-action-http.
    const srcRefs =
      body.match(
        /<(?:script|img|iframe|video|audio|source|object|embed)\b[^>]*\ssrc=["']http:\/\/(?!localhost)[^"']+["']/gi,
      ) || [];
    const stylesheetRefs = (body.match(/<link\b[^>]*>/gi) || []).filter(
      (t) =>
        /\brel=["']?stylesheet["']?/i.test(t) &&
        /\shref=["']http:\/\/(?!localhost)[^"']+["']/i.test(t),
    );
    const httpRefs = [...srcRefs, ...stylesheetRefs];
    if (httpRefs.length === 0) return null;
    const samples = httpRefs.slice(0, 3).map((r) => {
      const m = r.match(/\s(?:src|href)=["'](http:\/\/[^"']+)["']/i);
      return m ? m[1] : r.slice(0, 80);
    });
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

  // ── SRI ──────────────────────────────────────────────────────────────────

  "sri-missing": (_url, _headers, body) => {
    const externalScripts =
      body.match(/<script[^>]+src=["']https?:\/\/[^"']+["'][^>]*>/gi) || [];
    const noSRI = externalScripts.filter((t) => {
      if (t.toLowerCase().includes("integrity=")) return false;
      // Analytics/payment/CAPTCHA vendors serve these scripts mutable and
      // unversioned by design -- an integrity hash would break the next
      // time the vendor deploys, so their own docs tell you not to add one.
      const src = t.match(/src=["'](https?:\/\/[^"']+)["']/i)?.[1];
      const host = src ? hostnameOf(src) : null;
      return !host || !SRI_EXEMPT_HOSTS.has(host);
    });
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
    const noSRI = extStyles.filter((t) => {
      if (t.toLowerCase().includes("integrity=")) return false;
      // Google Fonts (and similar UA-negotiated stylesheet CDNs) serve
      // different CSS per requesting browser, so there is no single stable
      // hash to pin -- SRI is fundamentally incompatible, not just omitted.
      const href = t.match(/href=["'](https?:\/\/[^"']+)["']/i)?.[1];
      const host = href ? hostnameOf(href) : null;
      return !host || !SRI_EXEMPT_HOSTS.has(host);
    });
    return noSRI.length > 0
      ? `Found ${noSRI.length} external stylesheet(s) without integrity attribute.`
      : null;
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
      // Only flag cookies that plausibly carry session/auth state -- a
      // third-party analytics cookie (e.g. _ga, kndctr_*) missing these
      // attributes isn't a session-hijacking risk. Same sensitive-name
      // heuristic as cookies.ts's cookie-no-secure-prefix.
      const nameLower = name?.toLowerCase() ?? "";
      const isSensitive =
        nameLower.includes("session") ||
        nameLower.includes("token") ||
        nameLower.includes("auth") ||
        nameLower.includes("jwt");
      if (!isSensitive) continue;
      if (!lower.includes("httponly") && !name?.startsWith("__Host-"))
        issues.push(`${name} missing HttpOnly`);
      if (!lower.includes("secure")) issues.push(`${name} missing Secure`);
      if (!lower.includes("samesite")) issues.push(`${name} missing SameSite`);
    }
    return issues.length > 0 ? issues.slice(0, 5).join("; ") : null;
  },

  // ── Clear-Site-Data on logout pages ──────────────────────────────────────

  "clear-site-data-missing": (url, headers, _body) => {
    // Match the scanned page's own URL path, not body content: a check
    // meant to fire only when actually probing a logout endpoint used to
    // match any page whose body merely mentioned "logout" anywhere --
    // including an ordinary page's nav bar with a "Log out" link, which is
    // present on nearly every authenticated page of nearly every site.
    let path: string;
    try {
      path = new URL(url).pathname;
    } catch {
      path = url;
    }
    const isLogoutUrl = /\b(?:log|sign)[-_]?out\b/i.test(path);
    if (!isLogoutUrl) return null;
    if (hasHeader(headers, "clear-site-data")) return null;
    return "Logout page detected without Clear-Site-Data header.";
  },

  // ── Clickjacking / framing coverage ─────────────────────────────────────

  "frame-busting-header-only": (_url, headers) => {
    const xfo = h(headers, "x-frame-options");
    if (!xfo) return null;
    const csp = h(headers, "content-security-policy");
    if (csp && /frame-ancestors/i.test(csp)) return null;
    return "X-Frame-Options is set but CSP frame-ancestors directive is missing.";
  },

  "x-frame-options-invalid": (_url, headers) => {
    const xfo = h(headers, "x-frame-options");
    if (!xfo) return null;
    const valid = ["DENY", "SAMEORIGIN"];
    if (xfo.toUpperCase().startsWith("ALLOW-FROM ")) return null;
    if (valid.includes(xfo.toUpperCase().trim())) return null;
    // ALLOWALL has its own dedicated, higher-severity check (x-frame-options-allowall).
    // Don't double-fire the generic "invalid value" finding for the same header value.
    // ref: AUDIT-008#scanner-05
    if (xfo.toUpperCase().trim() === "ALLOWALL") return null;
    return `X-Frame-Options has invalid value: '${xfo}'. Expected DENY, SAMEORIGIN, or ALLOW-FROM <origin>.`;
  },

  "x-frame-options-allowall": (_url, headers) => {
    const xfo = h(headers, "x-frame-options");
    if (!xfo) return null;
    if (xfo.toUpperCase().trim() === "ALLOWALL") {
      return "X-Frame-Options: ALLOWALL explicitly disables framing protection.";
    }
    return null;
  },

  // ── CORS coverage ───────────────────────────────────────────────────────

  "cors-methods-too-permissive": (_url, headers) => {
    const acam = h(headers, "access-control-allow-methods");
    if (!acam) return null;
    if (acam.trim() === "*") {
      return "Access-Control-Allow-Methods is set to '*', allowing any method.";
    }
    return null;
  },

  "access-control-allow-headers-wildcard": (_url, headers) => {
    const acah = h(headers, "access-control-allow-headers");
    if (!acah) return null;
    if (acah.trim() === "*") {
      return "Access-Control-Allow-Headers is set to '*', allowing any header.";
    }
    return null;
  },

  // ── CSP coverage (additional directives) ─────────────────────────────────

  "csp-frame-ancestors-missing": (_url, headers) => {
    const csp = h(headers, "content-security-policy");
    if (!csp) return null;
    if (/frame-ancestors/i.test(csp)) return null;
    // X-Frame-Options already blocks framing on its own; don't claim
    // clickjacking protection is missing (and double-fire alongside
    // clickjack-missing) when XFO covers it.
    if (h(headers, "x-frame-options")) return null;
    return "CSP is present but lacks the frame-ancestors directive.";
  },

  "csp-frame-src-missing": (_url, headers, body) => {
    const csp = h(headers, "content-security-policy");
    // A <meta http-equiv="Content-Security-Policy"> is equally binding on
    // the browser, and a page can carry a frame-src there while the HTTP
    // header CSP omits it entirely (or vice versa) -- both are enforced,
    // so the directive is only truly missing when neither source sets it.
    const metaTag = body.match(
      /<meta\b[^>]*http-equiv=["']?content-security-policy["']?[^>]*>/i,
    )?.[0];
    const metaCsp = metaTag?.match(/content=["']([^"']*)["']/i)?.[1] ?? "";
    if (!csp && !metaCsp) return null;
    if (/frame-src/i.test(csp ?? "") || /frame-src/i.test(metaCsp)) return null;
    return "CSP lacks frame-src directive for iframe sources.";
  },

  "csp-object-src-unsafe": (_url, headers) => {
    const csp = h(headers, "content-security-policy");
    if (!csp) return null;
    const objectSrc = csp.match(/object-src[^;]*/i)?.[0] || "";
    if (!objectSrc) return null;
    const values = objectSrc.replace(/^object-src\s+/i, "").trim();
    if (values === "*" || /^(https?:|data:|\*)/i.test(values)) {
      return `CSP object-src is too permissive: '${values}'.`;
    }
    return null;
  },

  "csp-script-src-self-only": (_url, headers) => {
    const csp = h(headers, "content-security-policy");
    if (!csp) return null;
    const scriptSrc = csp.match(/script-src[^;]*/i)?.[0] || "";
    if (!scriptSrc) return null;
    const sources = scriptSrc.replace(/^script-src\s+/i, "").trim();
    if (sources === "'self'") {
      return "CSP script-src is restricted to 'self' only, which may break third-party integrations.";
    }
    return null;
  },

  "csp-incompatible-directives": (_url, headers) => {
    const csp = h(headers, "content-security-policy");
    if (!csp) return null;
    // Match each directive by its exact name (split on ';', compare the
    // first token), not a raw substring search -- "script-src" as a bare
    // substring also matches inside the unrelated CSP3 sub-directives
    // script-src-elem/script-src-attr, wrongly treating a scoped exception
    // there as a conflict with the real script-src directive.
    const directives = new Map<string, string>();
    for (const part of csp.split(";")) {
      const trimmed = part.trim();
      const name = trimmed.split(/\s+/)[0]?.toLowerCase();
      if (name) directives.set(name, trimmed);
    }
    const scriptSrc = directives.get("script-src") || "";
    const defaultSrc = directives.get("default-src") || "";
    const issues: string[] = [];
    if (scriptSrc.includes("'none'") && scriptSrc.includes("'unsafe-inline'")) {
      issues.push(
        "script-src 'none' combined with 'unsafe-inline' (none wins, but the conflict is suspicious)",
      );
    }
    if (scriptSrc.includes("'none'") && scriptSrc.includes("'unsafe-eval'")) {
      issues.push("script-src 'none' combined with 'unsafe-eval'");
    }
    if (defaultSrc.includes("'none'") && /\*\s*$/.test(scriptSrc)) {
      issues.push("default-src 'none' but script-src allows wildcard");
    }
    if (/\ballow-http\b/i.test(csp)) {
      issues.push("deprecated 'allow-http' directive is ignored");
    }
    if (/\breflected-xss\b/i.test(csp)) {
      issues.push("removed 'reflected-xss' directive is ignored");
    }
    return issues.length > 0
      ? `CSP contains unsupported or conflicting directives: ${issues.join("; ")}.`
      : null;
  },

  "csp-too-long": (_url, headers) => {
    const csp = h(headers, "content-security-policy");
    if (!csp) return null;
    if (csp.length > 4096) {
      return `CSP header is ${csp.length} characters long; browsers may silently drop policies > 4096 chars.`;
    }
    return null;
  },

  // ── Cache / Pragma / Expires ────────────────────────────────────────────

  "cache-control-no-store-missing": (url, headers) => {
    if (!isSensitivePath(url)) return null;
    const cc = h(headers, "cache-control");
    if (cc && cc.toLowerCase().includes("no-store")) return null;
    return "Sensitive page path detected but Cache-Control lacks 'no-store'.";
  },

  "pragma-no-cache-legacy": (_url, headers) => {
    const v = h(headers, "pragma");
    if (!v) return null;
    if (v.toLowerCase().includes("no-cache")) {
      return "Pragma: no-cache is set; this is a legacy HTTP/1.0 header and ignored by modern caches.";
    }
    return null;
  },

  "expires-past": (_url, headers) => {
    const v = h(headers, "expires");
    if (!v) return null;
    const ts = Date.parse(v);
    if (Number.isNaN(ts)) return null;
    // Some servers/CDNs deliberately set Expires to the exact response
    // time (often identical to their own Date header) as an HTTP/1.0-era
    // "don't cache this" idiom, equivalent to Cache-Control: no-store.
    // Comparing against Date.now() -- the scanner's own clock, always at
    // least a little later than when the response was generated -- flagged
    // that idiom on effectively every response using it. Compare against
    // the response's own Date header instead (falling back to Date.now()
    // when absent), and require Expires to be meaningfully, not just
    // momentarily, earlier so a genuinely stale hardcoded date is still
    // caught.
    const dateHeader = h(headers, "date");
    const dateTs = dateHeader ? Date.parse(dateHeader) : NaN;
    const referenceTs = Number.isNaN(dateTs) ? Date.now() : dateTs;
    const STALE_THRESHOLD_MS = 5 * 60 * 1000;
    if (ts < referenceTs - STALE_THRESHOLD_MS) {
      return `Expires header is set to a past date: ${v}.`;
    }
    return null;
  },

  // ── DNS / performance ────────────────────────────────────────────────────

  "dns-prefetch-on": (_url, headers) => {
    const v = h(headers, "x-dns-prefetch-control");
    if (v && v.toLowerCase().trim() === "on") {
      return "X-DNS-Prefetch-Control is set to 'on', exposing link patterns to DNS resolvers.";
    }
    return null;
  },

  // ── COEP / COOP / CORP coverage ─────────────────────────────────────────

  "coep-credentialless": (_url, headers) => {
    const v = h(headers, "cross-origin-embedder-policy");
    if (!v) return null;
    const lower = v.toLowerCase().trim();
    if (lower === "credentialless" || lower === "require-corp") return null;
    return `Cross-Origin-Embedder-Policy is '${v}', not 'credentialless' or 'require-corp'.`;
  },

  "cross-origin-resource-policy-report-only-missing": (_url, headers) => {
    // CORP does not have a Report-Only variant (that's a CSP concept).
    // Only fire if the actual Cross-Origin-Resource-Policy header is missing AND
    // the response carries resources that should be cross-origin-isolated.
    if (hasHeader(headers, "cross-origin-resource-policy")) return null;
    return "Cross-Origin-Resource-Policy header is not set.";
  },

  // ── Server-Timing coverage ──────────────────────────────────────────────

  "server-timing-sensitive-key-leak": (_url, _headers) => {
    // Duplicate of server-timing-exposure on the same header, and its keyword
    // list included "cache" — which matches the completely benign, extremely
    // common `cache;dur=12` / `edge;dur=4` CDN timing entries that
    // configuration.ts's server-timing-cache-timings already covers
    // correctly under its own (accurate) title. Disabled in favor of
    // server-timing-exposure, which uses a tighter, genuinely-sensitive
    // keyword list. ref: AUDIT-008#scanner-05
    return null;
  },

  // ── Referrer-Policy strict variants ─────────────────────────────────────

  "referrer-policy-no-referrer-strict-origin-when-cross-origin": (
    _url,
    headers,
  ) => {
    const v = h(headers, "referrer-policy");
    if (!v) return null;
    // "unsafe-url" and "no-referrer-when-downgrade" are already reported by
    // referrer-policy-unsafe (the full-URL-leak case). Only report the
    // remaining, less severe "weaker than recommended" values here so the
    // same header value doesn't produce two findings at two severities.
    // ref: AUDIT-008#scanner-05
    const weak = ["origin", "origin-when-cross-origin"];
    if (weak.includes(v.toLowerCase().trim())) {
      return `Referrer-Policy '${v}' is weaker than 'strict-origin-when-cross-origin'.`;
    }
    return null;
  },

  // ── HSTS coverage ──────────────────────────────────────────────────────

  "strict-transport-security-include-subdomains": (_url, headers) => {
    const v = h(headers, "strict-transport-security");
    if (!v) return null;
    if (/includeSubDomains/i.test(v)) return null;
    return "HSTS is set but does not include the includeSubDomains directive.";
  },

  // ── X-Content-Type-Options coverage ─────────────────────────────────────

  "x-content-type-options-not-nosniff": (_url, _headers) => {
    // Duplicate of nosniff-incorrect (identical "present but not nosniff"
    // condition on the same header). This id's JSON metadata also described
    // the unrelated "header missing" scenario (already covered by
    // xcto-missing), not what this detector actually checked. Disabled in
    // favor of nosniff-incorrect. ref: AUDIT-008#scanner-05
    return null;
  },

  // ── Cookie __Host- prefix attribute check ───────────────────────────────

  "cookie-host-prefix-attribute-mismatch": (_url, headers) => {
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
    for (const cookie of setCookies) {
      const name = cookie.split("=")[0]?.trim() ?? "";
      if (!name.startsWith("__Host-")) continue;
      const lower = cookie.toLowerCase();
      if (!lower.includes("secure")) {
        return `Cookie '${name}' uses __Host- prefix but is missing the Secure attribute.`;
      }
      if (!/(^|;)\s*path\s*=\s*\//i.test(cookie)) {
        return `Cookie '${name}' uses __Host- prefix but Path is not '/'.`;
      }
      if (/(^|;)\s*domain\s*=/i.test(cookie)) {
        return `Cookie '${name}' uses __Host- prefix but has a Domain attribute (not allowed).`;
      }
    }
    return null;
  },

  // ── Permissions-Policy feature coverage ─────────────────────────────────
  // Each detector fires if the Permissions-Policy header allows the named
  // feature (either explicitly with `*` or by not restricting it).

  "permissions-policy-geolocation-blocked": (_url, headers) => {
    return ppAllowsFeature(headers, "geolocation");
  },
  "permissions-policy-camera-blocked": (_url, headers) => {
    return ppAllowsFeature(headers, "camera");
  },
  "permissions-policy-microphone-blocked": (_url, headers) => {
    return ppAllowsFeature(headers, "microphone");
  },
  "permissions-policy-payment-blocked": (_url, headers) => {
    return ppAllowsFeature(headers, "payment");
  },
  "permissions-policy-usb-blocked": (_url, headers) => {
    return ppAllowsFeature(headers, "usb");
  },
  "permissions-policy-browsing-topics-blocked": (_url, headers) => {
    return ppAllowsFeature(headers, "browsing-topics");
  },
  "permissions-policy-bluetooth-blocked": (_url, headers) => {
    return ppAllowsFeature(headers, "bluetooth");
  },
  "permissions-policy-serial-blocked": (_url, headers) => {
    return ppAllowsFeature(headers, "serial");
  },
  "permissions-policy-screen-wake-lock-blocked": (_url, headers) => {
    return ppAllowsFeature(headers, "screen-wake-lock");
  },
  "permissions-policy-publickey-credentials-get-blocked": (_url, headers) => {
    return ppAllowsFeature(headers, "publickey-credentials-get");
  },
  "permissions-policy-unload-blocked": (_url, headers) => {
    return ppAllowsFeature(headers, "unload");
  },
  "permissions-policy-clipboard-read-blocked": (_url, headers) => {
    return ppAllowsFeature(headers, "clipboard-read");
  },
  "permissions-policy-clipboard-write-blocked": (_url, headers) => {
    return ppAllowsFeature(headers, "clipboard-write");
  },
  "permissions-policy-accelerometer-blocked": (_url, headers) => {
    return ppAllowsFeature(headers, "accelerometer");
  },
  "permissions-policy-gyroscope-blocked": (_url, headers) => {
    return ppAllowsFeature(headers, "gyroscope");
  },
  "permissions-policy-magnetometer-blocked": (_url, headers) => {
    return ppAllowsFeature(headers, "magnetometer");
  },
  "permissions-policy-ambient-light-sensor-blocked": (_url, headers) => {
    return ppAllowsFeature(headers, "ambient-light-sensor");
  },
  "permissions-policy-display-capture-blocked": (_url, headers) => {
    return ppAllowsFeature(headers, "display-capture");
  },
  "permissions-policy-fullscreen-blocked": (_url, headers) => {
    return ppAllowsFeature(headers, "fullscreen");
  },
  "permissions-policy-midi-blocked": (_url, headers) => {
    return ppAllowsFeature(headers, "midi");
  },
  "permissions-policy-picture-in-picture-blocked": (_url, headers) => {
    return ppAllowsFeature(headers, "picture-in-picture");
  },
  "permissions-policy-storage-access-blocked": (_url, headers) => {
    return ppAllowsFeature(headers, "storage-access");
  },
  "permissions-policy-window-management-blocked": (_url, headers) => {
    return ppAllowsFeature(headers, "window-management");
  },
  // ── Form / HTML element checks ──────────────────────────────────────────
  "form-no-action-https": (_url, _headers, _body) => {
    // Exact duplicate of form-action-http's condition (same <form
    // action="http://..."> match), minus the url.startsWith("https://")
    // gate -- so on the common case of scanning an HTTPS page, one
    // offending form fired both checks for the same evidence. Disabled in
    // favor of form-action-http, which correctly scopes to HTTPS pages
    // (the actually mixed-content-relevant scenario).
    return null;
  },
  "meta-redirect-no-url": (_url, _headers, body) => {
    if (!body) return null;
    const m = body.match(/<meta\s+http-equiv=["\']?refresh[^>]*>/i);
    if (!m) return null;
    const content = m[0].match(/content=["\']?([^"'>]*)["\']?/i)?.[1]?.trim();
    if (content === undefined) return null;
    // A plain interval-only content (e.g. content="30") with no url=
    // segment at all is the standard self-refresh idiom (auto-reloading
    // dashboards, queue/status pages) -- not a broken redirect. Only flag
    // when the content is empty, or a url= segment is present but its
    // target is empty.
    if (content === "") {
      return "<meta http-equiv=refresh> found with empty content (broken redirect).";
    }
    if (/;\s*url=\s*$/i.test(content)) {
      return "<meta http-equiv=refresh> found with empty URL target (broken redirect).";
    }
    return null;
  },
  "autocomplete-username": (_url, _headers, body) => {
    if (!body) return null;
    const forms = body.match(/<form\b[^>]*>[\s\S]*?<\/form\s*>/gi) || [];
    for (const form of forms) {
      // Only meaningful inside an actual login form: a username/email
      // input on its own (newsletter signup, contact form) has no
      // password manager autofill role to hint at.
      if (!/<input[^>]*type\s*=\s*["']?password/i.test(form)) continue;
      const userInput = form.match(
        /<input[^>]*(?:name|id)\s*=\s*["']?(?:username|user|login|email)[^>]*>/i,
      )?.[0];
      if (userInput && !/autocomplete\s*=\s*["']?username/i.test(userInput)) {
        return 'Login input found without autocomplete="username".';
      }
    }
    return null;
  },
  "image-protocol-relative": (_url, _headers, body) => {
    if (!body) return null;
    // Require the "src=" to be preceded by whitespace (a genuine attribute
    // boundary), not just present anywhere in the tag: the naive
    // `[^>]+src=` used to also match the trailing "src=" inside a lazy-load
    // attribute like data-src/data-original-src, so an <img> whose real
    // src is an HTTPS (or base64 placeholder) image but whose data-src
    // lazy-load attribute happened to be protocol-relative fired a false
    // positive on an attribute that was never actually rendered as the src.
    const m = body.match(/<img\b[^>]*\ssrc=["']?(\/\/[^/"'\s>][^"'\s>]*)/i);
    if (m) {
      return `Image uses protocol-relative URL (${m[1]}) which fails on http:// fallback.`;
    }
    return null;
  },
  "open-graph-image-not-https": (_url, _headers, body) => {
    if (!body) return null;
    const m = body.match(
      /<meta[^>]+property=["\']?og:image["\']?[^>]*content=["\']?http:\/\//i,
    );
    if (m)
      return "OG image is HTTP (will fail social previews on HTTPS sites).";
    return null;
  },
  "charset-meta-missing": (_url, headers, body) => {
    if (!body) return null;
    // Declaring charset via the Content-Type header (Express/Nginx defaults
    // both do this) is equally authoritative for the HTML5 encoding-sniffing
    // algorithm and defeats the same UTF-7/inherited-encoding attack -- it
    // doesn't require an inline <meta charset> tag as well.
    const ct = h(headers, "content-type") || "";
    if (/charset\s*=/i.test(ct)) return null;
    if (!/<meta[^>]+charset=/i.test(body)) {
      return "<meta charset> missing (XSS via UTF-7/inherited encoding risk).";
    }
    return null;
  },
  "doctype-missing": (_url, _headers, body) => {
    if (!body) return null;
    if (!/^\s*<!doctype\s+html/i.test(body)) {
      return "Missing <!DOCTYPE html> (triggers quirks mode).";
    }
    return null;
  },
  "inline-style-attr": (_url, _headers, body) => {
    if (!body) return null;
    if (/<[a-z][a-z0-9]*[^>]*\bstyle\s*=/i.test(body)) {
      const matches = body.match(/<[a-z][a-z0-9]*[^>]*\bstyle\s*=/gi) || [];
      if (matches.length >= 3) {
        return `${matches.length} elements have inline style= attributes (CSP hygiene).`;
      }
    }
    return null;
  },
  "target-blank-no-noopener": (_url, _headers, body) => {
    if (!body) return null;
    const links =
      body.match(/<a\b[^>]*target=["\']?_blank["\']?[^>]*>/gi) || [];
    // noreferrer implies noopener (severs window.opener too, plus omits the
    // Referer header) -- a link with rel="noreferrer" and no literal
    // "noopener" token is not vulnerable, so it must not be flagged.
    const noNoopener = links.filter(
      (t) => !/\brel\s*=\s*["\']?[^"']*\b(noopener|noreferrer)\b/i.test(t),
    );
    if (noNoopener.length > 0) {
      return `${noNoopener.length} target="_blank" link(s) lack rel="noopener"/"noreferrer" (reverse tabnabbing).`;
    }
    return null;
  },
  // ── COOP coverage ────────────────────────────────────────────────────────

  "coop-unsafe-none": (_url, headers) => {
    const v = h(headers, "cross-origin-opener-policy");
    if (!v) return null;
    if (v.toLowerCase().trim() === "unsafe-none") {
      return "Cross-Origin-Opener-Policy is explicitly set to 'unsafe-none', opting out of browsing-context isolation.";
    }
    return null;
  },

  "coop-report-only-without-enforcing": (_url, headers) => {
    const reportOnly = hasHeader(
      headers,
      "cross-origin-opener-policy-report-only",
    );
    const enforcing = hasHeader(headers, "cross-origin-opener-policy");
    if (reportOnly && !enforcing) {
      return "Cross-Origin-Opener-Policy-Report-Only is set but no enforcing Cross-Origin-Opener-Policy header exists.";
    }
    return null;
  },

  // ── Reporting API ────────────────────────────────────────────────────────

  "reporting-api-endpoints-missing": (_url, headers) => {
    const csp = h(headers, "content-security-policy");
    if (!csp) return null;
    if (!/report-to\s+\S+/i.test(csp)) return null;
    if (hasHeader(headers, "reporting-endpoints")) return null;
    return "CSP references a 'report-to' group but no Reporting-Endpoints header defines where that group delivers reports.";
  },

  // ── Private Network Access ──────────────────────────────────────────────

  "access-control-allow-private-network-wildcard": (_url, headers) => {
    const apn = h(headers, "access-control-allow-private-network");
    if (!apn || apn.toLowerCase().trim() !== "true") return null;
    const acao = h(headers, "access-control-allow-origin");
    if (acao !== "*") return null;
    return "Access-Control-Allow-Private-Network: true combined with Access-Control-Allow-Origin: * lets any public website's script pivot requests into the private network.";
  },

  // ── Permissions-Policy feature coverage (additional directives) ────────

  "permissions-policy-interest-cohort-blocked": (_url, headers) => {
    return ppAllowsFeature(headers, "interest-cohort");
  },
  "permissions-policy-attribution-reporting-blocked": (_url, headers) => {
    return ppAllowsFeature(headers, "attribution-reporting");
  },
  "permissions-policy-otp-credentials-blocked": (_url, headers) => {
    return ppAllowsFeature(headers, "otp-credentials");
  },

  "iframe-third-party-without-sandbox": (_url, _headers, body) => {
    if (!body) return null;
    let host = "";
    try {
      host = new URL(_url).host;
    } catch {
      return null;
    }
    const iframes = body.match(/<iframe\b[^>]*>/gi) || [];
    const thirdParty = iframes.filter(
      (t) =>
        /src=["\']?https?:\/\//i.test(t) &&
        !new RegExp(`^https?://${host}`, "i").test(
          t.match(/src=["\']?([^"']+)/i)?.[1] || "",
        ),
    );
    const noSandbox = thirdParty
      .filter((t) => !/\bsandbox\s*=/i.test(t))
      .filter(
        (t) => !isSandboxExemptEmbed(t.match(/src=["\']?([^"']+)/i)?.[1] || ""),
      );
    if (noSandbox.length > 0) {
      return `${noSandbox.length} third-party <iframe>(s) lack sandbox attribute.`;
    }
    return null;
  },

  // ── Origin-Agent-Cluster value validation ───────────────────────────────

  "origin-agent-cluster-invalid-value": (_url, headers) => {
    const v = h(headers, "origin-agent-cluster");
    if (!v) return null;
    const trimmed = v.trim();
    if (trimmed === "?0" || trimmed === "?1") return null;
    return `Origin-Agent-Cluster has invalid value '${v}'. Only '?1' and '?0' are recognized structured-header tokens; any other value is silently ignored by the browser.`;
  },

  // ── Cross-origin isolation (SharedArrayBuffer) ──────────────────────────

  "shared-array-buffer-not-isolated": (_url, headers, body) => {
    if (!body) return null;
    // Require an actual construction call, not a bare `SharedArrayBuffer`
    // token -- the latter also matches common `typeof SharedArrayBuffer !==
    // 'undefined'` feature-detection code that doesn't depend on isolation
    // actually being active.
    const scripts = extractScriptContents(body).join("\n");
    if (!/\bnew\s+SharedArrayBuffer\s*\(/.test(scripts)) return null;
    const coop = (h(headers, "cross-origin-opener-policy") || "")
      .toLowerCase()
      .trim();
    const coep = (h(headers, "cross-origin-embedder-policy") || "")
      .toLowerCase()
      .trim();
    const isolated =
      coop === "same-origin" &&
      (coep === "require-corp" || coep === "credentialless");
    if (isolated) return null;
    return `Inline script constructs a SharedArrayBuffer, but the response does not establish cross-origin isolation (Cross-Origin-Opener-Policy: '${coop || "(not set)"}', Cross-Origin-Embedder-Policy: '${coep || "(not set)"}'). Browsers only expose a working SharedArrayBuffer in a crossOriginIsolated context (COOP: same-origin plus COEP: require-corp or credentialless).`;
  },

  // ── Reporting API endpoint transport ────────────────────────────────────

  "reporting-endpoints-insecure-url": (_url, headers) => {
    const re = h(headers, "reporting-endpoints");
    if (!re) return null;
    const urls = re.match(/https?:\/\/[^"',\s]+/gi) || [];
    const insecure = urls.filter((u) => /^http:\/\//i.test(u));
    if (insecure.length === 0) return null;
    return `Reporting-Endpoints defines a plaintext HTTP endpoint: ${insecure.join(", ")}. Report bodies (violation details, URLs, user agent) travel unencrypted instead of over https://.`;
  },

  // ── CORS cache-key correctness ──────────────────────────────────────────

  "cors-reflected-origin-no-vary": (_url, headers) => {
    const acao = h(headers, "access-control-allow-origin");
    if (!acao) return null;
    const trimmed = acao.trim();
    if (trimmed === "*" || trimmed.toLowerCase() === "null") return null;
    if (!/^https?:\/\//i.test(trimmed)) return null;
    const cc = (h(headers, "cache-control") || "").toLowerCase();
    if (cc.includes("no-store") || cc.includes("private")) return null;
    const varyTokens = (h(headers, "vary") || "")
      .split(",")
      .map((t) => t.trim().toLowerCase());
    if (varyTokens.includes("origin") || varyTokens.includes("*")) return null;
    return `Access-Control-Allow-Origin reflects '${trimmed}' but the response has no 'Vary: Origin' header, so a shared cache keying on the URL alone could serve this origin-specific CORS response to a different origin.`;
  },

  // ── Cache-Control on credential-bearing JSON bodies ─────────────────────

  "cache-control-no-store-missing-tokens": (_url, headers, body) => {
    const ct = (h(headers, "content-type") || "").toLowerCase();
    if (!ct.includes("json")) return null;
    if (!body) return null;
    const cc = (h(headers, "cache-control") || "").toLowerCase();
    if (cc.includes("no-store")) return null;
    const KEY_RE =
      /"(access_token|refresh_token|id_token|auth_token|session_token|api_key|apikey|client_secret|ssn|password)"\s*:\s*"([^"]{6,})"/gi;
    const found = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = KEY_RE.exec(body)) !== null) {
      const key = m[1].toLowerCase();
      const value = m[2].toLowerCase();
      if (
        value.includes("example") ||
        value.includes("xxxx") ||
        value.includes("0000") ||
        value.includes("placeholder") ||
        value.includes("test_") ||
        value.includes("dummy") ||
        value.includes("your_")
      )
        continue;
      found.add(key);
    }
    if (found.size === 0) return null;
    return `JSON response body contains ${[...found].join(", ")} but Cache-Control is '${h(headers, "cache-control") || "(not set)"}', missing 'no-store'.`;
  },
};

/**
 * Path-segment-aware "is this a sensitive endpoint" check shared by
 * cache-control-missing and cache-control-no-store-missing. Segment-bounded
 * so public routes that merely contain these words as a substring --
 * /api/authors, /sessions/keynote-address, /accounting/reports -- don't
 * match "/api/auth", "/session", "/account" the way a plain .includes() did.
 */
function isSensitivePath(url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url;
  }
  const lower = path.toLowerCase();
  return (
    /(?:^|\/)(?:login|signin|signup|register|admin|session|account)(?:\/|$)/.test(
      lower,
    ) || /(?:^|\/)api\/auth(?:\/|$)/.test(lower)
  );
}

// Third-party iframes that are widely embedded, functionally required, and
// documented as needing to run unsandboxed (postMessage, same-origin
// storage, popups, the Presentation API) -- video players, payment element
// iframes, and CAPTCHA challenge frames all omit sandbox by design, not by
// oversight.
const IFRAME_SANDBOX_EXEMPT_HOSTS = new Set([
  "www.youtube.com",
  "youtube.com",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
  "player.vimeo.com",
  "js.stripe.com",
  "checkout.stripe.com",
  "www.paypal.com",
  "challenges.cloudflare.com",
]);

function isSandboxExemptEmbed(src: string): boolean {
  const host = hostnameOf(src);
  if (!host) return false;
  if (IFRAME_SANDBOX_EXEMPT_HOSTS.has(host)) return true;
  // google.com hosts both unsandboxable Maps/reCAPTCHA embeds and a huge
  // range of unrelated content, so the exemption is scoped to those specific
  // embed paths rather than the whole domain.
  const path = new URL(src).pathname.toLowerCase();
  return (
    (host === "www.google.com" || host === "google.com") &&
    (path.startsWith("/maps") || path.startsWith("/recaptcha"))
  );
}

/**
 * Helper for the `permissions-policy-*-blocked` detectors.
 * Returns an evidence string when the Permissions-Policy header allows
 * the named feature (either explicitly via `*` or by not restricting it
 * with a `feature=()` token). Returns null when the policy is absent or
 * the feature is properly restricted.
 */
function ppAllowsFeature(headers: Headers, feature: string): string | null {
  const pp = h(headers, "permissions-policy") || h(headers, "feature-policy");
  if (!pp) return null;
  // Look for `feature=` token and check its value. Without a value the
  // feature is unrestricted in the policy's syntax.
  const tokenRe = new RegExp(
    `(?:^|[,\\s])${feature}\\s*(=\\s*([^,\\s]+))?`,
    "i",
  );
  const match = pp.match(tokenRe);
  if (!match) {
    // Feature not mentioned at all — in modern Permissions-Policy that
    // means "allow" (consistent with the existing `excessive-permissions`
    // semantics and the JSON descriptions that say the feature "should
    // default to 'self'"). Don't fire on this in isolation to avoid noise
    // when the policy is otherwise tight.
    return null;
  }
  const value = (match[2] || "*").toLowerCase().trim();
  if (value === "*" || value === "src") {
    return `Permissions-Policy allows '${feature}=${value}'.`;
  }
  if (value === "self" || value === '("self")') return null;
  // feature=() or other restrictive token — fire only if it looks like
  // an explicit allow-list value.
  if (/^\(.*\)$/.test(value) && value !== "()" && !value.includes("'none'")) {
    return null;
  }
  return null;
}
