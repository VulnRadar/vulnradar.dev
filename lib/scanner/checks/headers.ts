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
  getEffectiveCsp,
  type EvidenceFn as DetectFn,
} from "../_helpers";
import { SRI_EXEMPT_HOSTS } from "./client-side";
import {
  anyOpenTags,
  hasTagWith,
  openingTagOf,
  tagElements,
  tagsWith,
} from "./_tag-scan";

const h = getHeader;

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Extract one CSP directive by EXACT name (the first token of a ';'-split
 * part), returning the full directive text (e.g. "script-src 'self' 'nonce-x'")
 * or "" when absent. A bare regex match on "script-src" up to the next ";"
 * also matches the
 * CSP3 sub-directives script-src-elem / script-src-attr (and likewise
 * style-src-elem/-attr), so when a scoped -elem/-attr exception appeared before
 * the real directive the checks read the wrong one -- a false positive or
 * negative depending on directive order. This selects the directive itself.
 */
function getCspDirective(csp: string, name: string): string {
  const target = name.toLowerCase();
  for (const part of csp.split(";")) {
    const trimmed = part.trim();
    if (trimmed.split(/\s+/)[0]?.toLowerCase() === target) return trimmed;
  }
  return "";
}

/**
 * Directives csp-wildcard-source leaves alone. Images and media from any
 * origin are an ordinary policy. The rest each have a check of their own:
 * script-src, style-src and default-src are page-csp-wildcard-host-source's,
 * object-src is csp-object-src-unsafe's and frame-ancestors is
 * page-csp-frame-ancestors-wildcard's.
 */
const WILDCARD_DIRECTIVES_ELSEWHERE = new Set([
  "img-src",
  "media-src",
  "script-src",
  "style-src",
  "default-src",
  "object-src",
  "frame-ancestors",
]);

export const detectors: Record<string, DetectFn> = {
  // ── Security header presence ────────────────────────────────────────────────

  "hsts-missing": (url, headers) => {
    if (!url.startsWith("https://")) return null;
    const hsts = h(headers, "strict-transport-security");
    if (!hsts) {
      return "Header 'Strict-Transport-Security' is not present in the response.";
    }
    // RFC 6797 section 6.1: a header without a valid max-age is ignored as a
    // whole, so "present" and "in effect" are different claims. max-age=abc
    // reported clean here while giving no protection at all.
    if (!/(?:^|;)\s*max-age\s*=\s*"?\d+"?\s*(?:;|$)/i.test(hsts)) {
      return `Header 'Strict-Transport-Security' is present but has no valid max-age, so browsers ignore it: '${hsts}'.`;
    }
    return null;
  },

  "csp-missing": (_url, headers, body) => {
    const ct = h(headers, "content-type") || "";
    if (!ct.includes("text/html")) return null;
    // A <meta http-equiv="Content-Security-Policy"> is equally binding on
    // the browser -- a site delivering CSP that way (GitHub Pages, S3
    // without a CloudFront function, several CMS security plugins) was
    // being reported as having no CSP at all.
    if (getEffectiveCsp(headers, body)) return null;
    return "Header 'Content-Security-Policy' is not present in the response.";
  },

  "clickjack-missing": (_url, headers) => {
    const xfo = h(headers, "x-frame-options");
    const csp = h(headers, "content-security-policy");
    if (xfo) return null;
    // Directive names are ASCII case-insensitive. csp-frame-ancestors-missing
    // matched it that way and this check did not, so the two disagreed about a
    // policy written as "Frame-Ancestors 'self'".
    if (csp && /frame-ancestors/i.test(csp)) return null;
    return "Neither 'X-Frame-Options' header nor CSP 'frame-ancestors' directive is set.";
  },

  "xcto-missing": (_url, headers) => {
    if (hasHeader(headers, "x-content-type-options")) return null;
    return "Header 'X-Content-Type-Options' is not present in the response.";
  },

  "xpcdp-missing": (_url, headers) => {
    // The header exists to restrict what a crossdomain.xml policy file may
    // authorise, and the only clients that ever read either one were Flash
    // and older Acrobat. Flash reached end of life in December 2020 and was
    // removed from every browser; absence of the header on a host that
    // serves no crossdomain.xml authorises nothing, so reporting it was one
    // more line of work with no reader left to protect.
    //
    // An explicitly permissive value is a different statement. Someone set
    // it, it is still served, and 'all' or 'master-only' is a standing
    // instruction that any policy file found there may be trusted.
    const v = h(headers, "x-permitted-cross-domain-policies");
    if (!v) return null;
    if (v.toLowerCase().trim() === "none") return null;
    return `X-Permitted-Cross-Domain-Policies is '${v}', not 'none'.`;
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

  "coep-missing": (_url, headers) => {
    if (hasHeader(headers, "cross-origin-embedder-policy")) return null;
    return "Header 'Cross-Origin-Embedder-Policy' is not present.";
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

  "csp-form-action-missing": (_url, headers, body) => {
    const csp = getEffectiveCsp(headers, body);
    if (!csp) return null;
    if (csp.includes("form-action")) return null;
    return "CSP exists but no form-action directive.";
  },

  "csp-base-uri-missing": (_url, headers, body) => {
    const csp = getEffectiveCsp(headers, body);
    if (!csp) return null;
    if (csp.includes("base-uri")) return null;
    return "CSP exists but no base-uri directive.";
  },

  "csp-object-src-missing": (_url, headers, body) => {
    const csp = getEffectiveCsp(headers, body);
    if (!csp) return null;
    if (csp.includes("object-src")) return null;
    if (/default-src\s+'none'/.test(csp)) return null;
    return "CSP exists but no object-src directive.";
  },

  "csp-no-upgrade-insecure": (_url, headers, body) => {
    const csp = getEffectiveCsp(headers, body);
    if (!csp) return null;
    if (csp.includes("upgrade-insecure-requests")) return null;
    return "CSP does not include 'upgrade-insecure-requests' directive.";
  },

  "csp-no-default-src": (_url, headers, body) => {
    const csp = getEffectiveCsp(headers, body);
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

  "csp-unsafe-hashes": (_url, headers, body) => {
    const csp = getEffectiveCsp(headers, body);
    if (!csp) return null;
    if (/'unsafe-hashes'/.test(csp)) {
      return "CSP uses 'unsafe-hashes' which allows inline event handlers.";
    }
    return null;
  },

  "csp-unsafe-inline-script": (_url, headers, body) => {
    const csp = getEffectiveCsp(headers, body);
    if (!csp) return null;
    const scriptSrc = getCspDirective(csp, "script-src");
    if (!scriptSrc.includes("'unsafe-inline'")) return null;
    if (
      scriptSrc.includes("'nonce-") ||
      /'sha(?:256|384|512)-/.test(scriptSrc) ||
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
    const csp = getEffectiveCsp(headers, body);
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

  "csp-allows-http-sources": (_url, headers, body) => {
    const csp = getEffectiveCsp(headers, body);
    if (!csp) return null;
    const scriptSrc = getCspDirective(csp, "script-src");
    const defaultSrc = getCspDirective(csp, "default-src");
    const effective = scriptSrc || defaultSrc;
    if (!effective) return null;
    if (!/(?:^|\s)http:\/\//i.test(effective)) return null;
    const directive = scriptSrc ? "script-src" : "default-src";
    return `CSP ${directive} allows http:// sources — scripts can be loaded over unencrypted HTTP, enabling MITM injection.`;
  },

  "csp-wildcard-source": (_url, headers, body) => {
    const csp = getEffectiveCsp(headers, body);
    if (!csp) return null;
    const parts = csp.split(";").map((s) => s.trim());
    const nameOf = (p: string) => p.split(/\s+/)[0]?.toLowerCase() ?? "";
    // A wildcard in script-src, style-src or default-src is reported by
    // page-csp-wildcard-host-source, which also catches *.example.com there.
    // The two shared a dedupe group, so `connect-src *; script-src *` came out
    // as one finding naming one directive and the other fix was lost. They
    // now cover different directives, and every offending one is listed.
    const wildcards = parts.filter(
      (p) =>
        !WILDCARD_DIRECTIVES_ELSEWHERE.has(nameOf(p)) &&
        /(?:^|\s)\*(?:\s|$)/.test(p),
    );
    if (wildcards.length > 0) {
      return `CSP uses a wildcard source: ${wildcards.map((p) => `'${p}'`).join(", ")}.`;
    }
    // A bare scheme source ("https:") allows every origin on that scheme,
    // which for scripts is a wildcard with extra steps: anyone can host a
    // script on an https origin. Scoped to the script directives, where it
    // matters; img-src https: is an ordinary, reasonable policy.
    for (const p of parts) {
      const name = nameOf(p);
      if (name !== "script-src" && name !== "default-src") continue;
      if (/(?:^|\s)https?:(?:\s|$)/i.test(p)) {
        return `CSP ${name} allows any origin on a scheme: '${p}'.`;
      }
    }
    return null;
  },

  "csp-data-uri-allowed": (_url, headers, body) => {
    const csp = getEffectiveCsp(headers, body);
    if (!csp) return null;
    const scriptSrc = getCspDirective(csp, "script-src");
    if (!scriptSrc.includes("data:")) return null;
    return "CSP script-src allows data: URIs, enabling XSS via data:text/html payloads.";
  },

  "csp-framework-required": (_url, headers, body) => {
    const csp = getEffectiveCsp(headers, body);
    if (!csp) return null;

    const isNextJs = body.includes("__NEXT_DATA__") || body.includes("/_next/");
    const isNuxt = body.includes("__nuxt") || body.includes("/_nuxt/");
    const isAngular = /ng-version/i.test(body);

    if (!isNextJs && !isNuxt && !isAngular) return null;

    const framework = isNextJs ? "Next.js" : isNuxt ? "Nuxt.js" : "Angular";
    const frameworkDirectives: string[] = [];

    if (isNextJs) {
      const styleSrc = getCspDirective(csp, "style-src");
      if (styleSrc.includes("'unsafe-inline'"))
        frameworkDirectives.push(
          "style-src 'unsafe-inline' (required by Next.js styled-jsx)",
        );
      const scriptSrc = getCspDirective(csp, "script-src");
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

  "feature-policy-deprecated": (_url, headers) => {
    if (!hasHeader(headers, "feature-policy")) return null;
    if (hasHeader(headers, "permissions-policy")) return null;
    return "Feature-Policy header is set but not Permissions-Policy. Feature-Policy is deprecated; use Permissions-Policy instead.";
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

  "etag-inode": (_url, headers) => {
    const etag = h(headers, "etag");
    if (etag && /^["']?[0-9a-f]+-[0-9a-f]+-[0-9a-f]+["']?$/i.test(etag)) {
      return "ETag appears to contain inode information - filesystem disclosure.";
    }
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
    // ReDoS-safe bounding: unbounded [^>] gaps inside tag patterns are capped
    // ([^>]* -> [^>]{0,2000}, [^>]+ -> [^>]{1,2000}) so a body of many unclosed
    // tags can't drive O(n^2) backtracking; 2000 preserves every real match.
    const hasPasswd = /<input[^>]{0,2000}type\s*=\s*["']?password/i.test(body);
    if (hasPasswd) {
      return "Cache-Control: public set on page containing sensitive forms.";
    }
    // A bare POST form isn't sensitive on its own -- contact/newsletter/
    // search/comment forms are all POST and all completely public. Only
    // flag a POST form that also collects a genuinely sensitive field.
    const sensitiveFieldRe =
      /<input[^>]{0,2000}(?:name|id)\s*=\s*["'][^"']*(?:card|ssn|cvv|account[-_]?number)[^"']*["']/i;
    const postForms = tagElements(body, "form").filter((f) =>
      /method\s*=\s*["']?post/i.test(openingTagOf(f)),
    );
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
        /<(?:script|img|iframe|video|audio|source|object|embed)\b[^>]{0,2000}\ssrc=["']http:\/\/(?!localhost)[^"']+["']/gi,
      ) || [];
    const stylesheetRefs = (body.match(/<link\b[^>]{0,2000}>/gi) || []).filter(
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
    const httpForms = tagsWith(body, "form", /action=["']http:\/\/[^"']+["']/i);
    return httpForms.length > 0
      ? `Found ${httpForms.length} form(s) submitting over HTTP.`
      : null;
  },

  // ── SRI ──────────────────────────────────────────────────────────────────

  "sri-missing": (_url, _headers, body) => {
    const externalScripts = tagsWith(
      body,
      "script",
      /src=["']https?:\/\/[^"']+["']/i,
    );
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
    const extStyles = tagsWith(
      body,
      "link",
      /rel=["']stylesheet["']/i,
      /href=["']https?:\/\/[^"']+["']/i,
    );
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

  // "frame-busting-header-only" removed: it fired when X-Frame-Options
  // protected the page, which csp-frame-ancestors-missing below rightly treats
  // as sufficient, and its fix was a JavaScript frame-buster, which a
  // sandboxed iframe disables.

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
    const csp = getEffectiveCsp(headers, body);
    if (!csp) return null;
    // frame-src falls back to child-src and then to default-src (CSP3,
    // "Get the effective directive for request"), so a policy with either of
    // those already governs iframe sources. Flagging it anyway told a site
    // with default-src 'self' that its frames were unrestricted.
    if (/(?:^|;)\s*(?:frame-src|child-src|default-src)\b/i.test(csp)) {
      return null;
    }
    return "CSP has no frame-src, child-src or default-src, so iframe sources are unrestricted.";
  },

  "csp-object-src-unsafe": (_url, headers, body) => {
    const csp = getEffectiveCsp(headers, body);
    if (!csp) return null;
    const objectSrc = getCspDirective(csp, "object-src");
    if (!objectSrc) return null;
    const values = objectSrc.replace(/^object-src\s+/i, "").trim();
    if (values === "*" || /^(https?:|data:|\*)/i.test(values)) {
      return `CSP object-src is too permissive: '${values}'.`;
    }
    return null;
  },

  "csp-script-src-self-only": (_url, headers, body) => {
    const csp = getEffectiveCsp(headers, body);
    if (!csp) return null;
    const scriptSrc = getCspDirective(csp, "script-src");
    if (!scriptSrc) return null;
    const sources = scriptSrc.replace(/^script-src\s+/i, "").trim();
    if (sources === "'self'") {
      return "CSP script-src is restricted to 'self' only, which may break third-party integrations.";
    }
    return null;
  },

  "csp-incompatible-directives": (_url, headers, body) => {
    const csp = getEffectiveCsp(headers, body);
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
    const issues: string[] = [];
    if (scriptSrc.includes("'none'") && scriptSrc.includes("'unsafe-inline'")) {
      issues.push(
        "script-src 'none' combined with 'unsafe-inline' (none wins, but the conflict is suspicious)",
      );
    }
    if (scriptSrc.includes("'none'") && scriptSrc.includes("'unsafe-eval'")) {
      issues.push("script-src 'none' combined with 'unsafe-eval'");
    }
    // Removed: `default-src 'none'` + a script-src ending in `*`.
    //
    // Two things were wrong with it. default-src is a fallback, not a
    // ceiling: CSP is specified so that a more permissive script-src
    // legitimately overrides it, so the pair is not a contradiction and
    // certainly not an "unsupported directive". And `/\*\s*$/` tests the
    // end of the directive string, so it also matched a tightly scoped
    // path wildcard (`script-src 'self' https://cdn.example.com/js/*`),
    // which is the opposite of a wildcard host. A genuinely wildcard
    // script-src is already reported by `page-csp-wildcard-host-source`.
    //
    // allow-http / reflected-xss are matched as directive NAMES, not as
    // substrings of the whole header: a host, a report endpoint path or a
    // nonce that happens to contain either word is not a directive.
    if (directives.has("allow-http")) {
      issues.push("deprecated 'allow-http' directive is ignored");
    }
    if (directives.has("reflected-xss")) {
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

  // Fires only for a document that actually depends on cross-origin
  // isolation. "unsafe-none" is the browser DEFAULT, so reporting it on its
  // own reported every site on the web that had no reason to want isolation,
  // and the remediation was actively wrong for most of them: require-corp
  // blocks every cross-origin resource that does not opt in with CORP, which
  // on a typical site means the fonts, the payment iframe and the analytics
  // beacon stop loading. Our own deployment is the worked example: it tried
  // credentialless, watched the BrowserBase live-view iframe break in
  // Firefox, and reverted (see middleware.ts).
  //
  // Constructing a SharedArrayBuffer is deliberately NOT the trigger here.
  // shared-array-buffer-not-isolated already owns that case and tests the
  // real condition, COOP and COEP together, so firing on it too would report
  // one problem twice. This check covers the other half: a script that reads
  // crossOriginIsolated or waits on Atomics is gating its own behaviour on an
  // isolation flag that a weak COEP guarantees will be false, so that branch
  // is dead code the author probably thinks is live.
  "coep-credentialless": (_url, headers, body) => {
    const v = h(headers, "cross-origin-embedder-policy");
    if (!v) return null;
    const lower = v.toLowerCase().trim();
    if (lower === "credentialless" || lower === "require-corp") return null;
    if (!body) return null;
    const scripts = extractScriptContents(body).join("\n");
    // Left to shared-array-buffer-not-isolated, which reports it better.
    if (/\bnew\s+SharedArrayBuffer\s*\(/.test(scripts)) return null;
    const relies =
      /\bcrossOriginIsolated\b/.test(scripts) ||
      /\bAtomics\s*\.\s*wait\s*\(/.test(scripts);
    if (!relies) return null;
    return `Cross-Origin-Embedder-Policy is '${v}', so window.crossOriginIsolated is permanently false, but an inline script branches on cross-origin isolation. Isolation needs COEP 'require-corp' or 'credentialless' together with COOP 'same-origin'.`;
  },

  "cross-origin-resource-policy-report-only-missing": (_url, headers) => {
    // CORP does not have a Report-Only variant (that's a CSP concept).
    // Only fire if the actual Cross-Origin-Resource-Policy header is missing AND
    // the response carries resources that should be cross-origin-isolated.
    if (hasHeader(headers, "cross-origin-resource-policy")) return null;
    return "Cross-Origin-Resource-Policy header is not set.";
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
  "meta-redirect-no-url": (_url, _headers, body) => {
    if (!body) return null;
    // Every refresh tag on the page is judged, not just the first. Reading
    // only the first match let the ordinary interval-only self-reload idiom
    // at the top of a page hide a genuinely broken redirect further down.
    const tags =
      body.match(/<meta\s+http-equiv=["']?refresh[^>]{0,2000}>/gi) || [];
    for (const tag of tags) {
      // The attribute value is read with the quote character it opened
      // with. The old pattern was `content=["']?([^"'>]*)`, which had two
      // defects, and both produced findings on working redirects:
      //
      //   content="0;url='https://example.com'"  ->  captured `0;url=`
      //     because the class stops at the inner single quote, so the
      //     "empty URL target" branch matched a redirect that has a target.
      //     Quoting the URL inside meta refresh is a long-standing idiom.
      //
      //   <meta http-equiv=refresh data-content="" content="5">  ->  the
      //     unanchored `content=` matched inside `data-content=` first and
      //     read the empty value of the wrong attribute.
      const attr = tag.match(
        /(?:^|[\s"'])content\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/i,
      );
      if (!attr) continue;
      const content = (attr[1] ?? attr[2] ?? attr[3] ?? "").trim();
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
    }
    return null;
  },
  "autocomplete-username": (_url, _headers, body) => {
    if (!body) return null;
    const forms = tagElements(body, "form");
    for (const form of forms) {
      // Only meaningful inside an actual login form: a username/email
      // input on its own (newsletter signup, contact form) has no
      // password manager autofill role to hint at.
      if (!hasTagWith(form, "input", /type\s*=\s*["']?password/i)) continue;
      const userInput = tagsWith(
        form,
        "input",
        /(?:name|id)\s*=\s*["']?(?:username|user|login|email)/i,
      )[0];
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
    const m = body.match(
      /<img\b[^>]{0,2000}\ssrc=["']?(\/\/[^/"'\s>][^"'\s>]*)/i,
    );
    if (m) {
      return `Image uses protocol-relative URL (${m[1]}) which fails on http:// fallback.`;
    }
    return null;
  },
  "open-graph-image-not-https": (_url, _headers, body) => {
    if (!body) return null;
    const m = hasTagWith(
      body,
      "meta",
      /property=["']?og:image["']?/i,
      /content=["']?http:\/\//i,
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
    if (!/<meta[^>]{1,2000}charset=/i.test(body)) {
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
    // `<[a-z][a-z0-9]*[^>]{0,2000}\bstyle\s*=` had the name run and the
    // bounded attribute run matching the same characters, so on markup where
    // the tag never closes every `<` paid the full 2000-character run and
    // back: linear, but with a 2000x constant that measured 1146 ms on 256 KB
    // and 5477 ms on a 1 MB body of `"<a"` repeated. Walk the tags once and
    // test the attribute against each tag's own text, which is also where an
    // attribute genuinely belongs.
    const matches = anyOpenTags(body).filter((t) => /\bstyle\s*=/i.test(t));
    if (matches.length >= 3) {
      return `${matches.length} elements have inline style= attributes (CSP hygiene).`;
    }
    return null;
  },
  "target-blank-no-noopener": (_url, _headers, body) => {
    if (!body) return null;
    const links = tagsWith(body, "a", /target=["']?_blank["']?/i);
    // noreferrer implies noopener (severs window.opener too, plus omits the
    // Referer header) -- a link with rel="noreferrer" and no literal
    // "noopener" token is not vulnerable, so it must not be flagged.
    const noNoopener = links.filter(
      (t) => !/\brel\s*=\s*["']?[^"']*\b(noopener|noreferrer)\b/i.test(t),
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
    let pageHost = "";
    try {
      pageHost = new URL(_url).host.toLowerCase();
    } catch {
      return null;
    }
    const iframes = body.match(/<iframe\b[^>]{0,2000}>/gi) || [];
    const noSandbox = iframes.filter((tag) => {
      const src = getTagSrc(tag);
      if (!src || !/^https?:\/\//i.test(src)) return false;
      // Compare parsed hosts instead of interpolating the scanned URL's host
      // into a regex. An IPv6 target's host is the literal "[::1]:8080", so
      // `^https?://[::1]:8080` compiled "[::1]" as a character class and the
      // same-origin test silently inverted: a self-hosted site's own frames
      // were reported as unsandboxed third-party embeds. A host carrying an
      // unbalanced bracket threw instead, and the throw is swallowed by
      // runSyncChecks, dropping the whole check. ref: AUDIT-012#inj-05
      let srcHost: string;
      try {
        srcHost = new URL(src, _url).host.toLowerCase();
      } catch {
        return false;
      }
      if (srcHost === pageHost) return false;
      if (/\bsandbox\s*=/i.test(tag)) return false;
      return !isSandboxExemptEmbed(src);
    });
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

/**
 * Read a tag's real `src` attribute value, quoted or not. Requiring the
 * attribute-name boundary (leading whitespace) keeps a lazy-load
 * `data-src=` from being mistaken for the src the browser actually loads,
 * and stopping an unquoted value at whitespace/`>` keeps the following
 * attributes out of the captured URL.
 */
function getTagSrc(tag: string): string | null {
  const m = tag.match(/\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
  if (!m) return null;
  const value = (m[1] ?? m[2] ?? m[3] ?? "").trim();
  return value || null;
}

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
 *
 * Returns an evidence string only when the policy hands the named feature to
 * *every* origin, which is the case where an embedded third party inherits
 * it. A site granting a feature to itself is not a finding, and a site that
 * did not mention the feature at all is judged by `excessive-permissions`,
 * not here.
 *
 * The two header syntaxes are not interchangeable and used to be conflated:
 *
 *   Permissions-Policy: camera=(), fullscreen=(self)     // `name=value`
 *   Feature-Policy:     camera 'none'; fullscreen 'self' // `name allowlist`
 *
 * The old single regex looked for `feature` followed by an OPTIONAL `=value`,
 * and treated a missing value as `*`. Under Feature-Policy there is never an
 * `=`, so every feature a legacy Feature-Policy header restricted was read as
 * `feature=*` and reported as allowed. `Feature-Policy: fullscreen 'self'`,
 * about as locked down as that header gets, produced a finding claiming it
 * allowed `fullscreen=*`.
 */
function ppAllowsFeature(headers: Headers, feature: string): string | null {
  const permissionsPolicy = h(headers, "permissions-policy");
  const featurePolicy = h(headers, "feature-policy");
  const header = permissionsPolicy || featurePolicy;
  if (!header) return null;

  // Entries are separated by ',' (Permissions-Policy) or ';' (Feature-Policy);
  // servers mix them. Neither separator is legal inside an allowlist, so
  // splitting on both is safe.
  const lowerFeature = feature.toLowerCase();
  for (const rawEntry of header.split(/[,;]/)) {
    const entry = rawEntry.trim();
    if (!entry.toLowerCase().startsWith(lowerFeature)) continue;
    const rest = entry.slice(feature.length);
    // Guard against a longer feature name that merely starts with this one.
    if (rest && !/^[\s=]/.test(rest)) continue;

    const allowlist = rest.replace(/^\s*=?\s*/, "").trim();
    // `feature=*` (Permissions-Policy) or `feature *` (Feature-Policy). A
    // parenthesised list is scanned for a bare `*` member; `(self)`,
    // `("https://x.example")`, `()` and `'none'` are all restrictive.
    const members = allowlist
      .replace(/^\(|\)$/g, "")
      .trim()
      .split(/\s+/);
    if (members.includes("*")) {
      return `Permissions-Policy allows '${feature}=*' (every origin, including any embedded third party).`;
    }
    return null;
  }
  // Feature not mentioned at all — in modern Permissions-Policy that
  // means "allow" (consistent with the existing `excessive-permissions`
  // semantics and the JSON descriptions that say the feature "should
  // default to 'self'"). Don't fire on this in isolation to avoid noise
  // when the policy is otherwise tight.
  return null;
}
