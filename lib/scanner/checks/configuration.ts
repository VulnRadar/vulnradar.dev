/**
 * Configuration detectors.
 *
 * Detectors that look for server-/infrastructure-level config exposure:
 * debug indicators, source map leaks, response-timing telemetry, ETags,
 * server identity headers, etc.
 */

import { getHeader, hasHeader, type EvidenceFn as DetectFn } from "../_helpers";

const h = getHeader;

export const detectors: Record<string, DetectFn> = {
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

  "cache-control-missing": (_url, headers) => {
    if (hasHeader(headers, "cache-control") || hasHeader(headers, "pragma"))
      return null;
    return "Neither 'Cache-Control' nor 'Pragma' headers are present.";
  },

  "cache-control-public-sensitive": (_url, headers, body) => {
    const cc = h(headers, "cache-control");
    if (!cc || !cc.includes("public")) return null;
    const hasForm = /<form[^>]*method\s*=\s*["']?post/i.test(body);
    const hasPasswd = /<input[^>]*type\s*=\s*["']?password/i.test(body);
    if (!hasForm && !hasPasswd) return null;
    return "Cache-Control: public set on page containing sensitive forms.";
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

  "server-version-detailed": (_url, headers) => {
    const sv = h(headers, "server");
    if (!sv) return null;
    if (/\d+\.\d+/.test(sv)) {
      return `Server header reveals detailed version: '${sv}'.`;
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

  "nel-header-missing": (_url, headers) => {
    if (hasHeader(headers, "nel")) return null;
    return "NEL (Network Error Logging) header not present.";
  },

  "report-to-header-missing": (_url, headers) => {
    if (hasHeader(headers, "report-to")) return null;
    return "Report-To header not present.";
  },

  "x-dns-prefetch-control-off": (_url, headers) => {
    const v = h(headers, "x-dns-prefetch-control");
    if (v && v.toLowerCase() === "off") {
      return "X-DNS-Prefetch-Control is off - may impact performance.";
    }
    return null;
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

  "clickjacking-frameable": (_url, headers) => {
    const xfo = h(headers, "x-frame-options");
    const csp = h(headers, "content-security-policy");
    if (xfo) return null;
    if (csp && csp.includes("frame-ancestors")) return null;
    return "No framing protection detected (no X-Frame-Options, no CSP frame-ancestors).";
  },
};
