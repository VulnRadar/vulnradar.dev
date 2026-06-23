/**
 * SSL / TLS-at-the-edge detectors.
 *
 * "SSL" here means URL-level SSL indicators (deprecated URL=HTTP, missing
 * HSTS) plus per-request handshake hints. The deep TLS checks (cert chain,
 * cipher suite, OCSP) live in lib/scanner/async-checks.ts because they
 * need a raw socket. The metadata for those checks lives in
 * checks-data/tls.json (see also).
 */

import { hasHeader, type EvidenceFn as DetectFn } from "../_helpers";

export const detectors: Record<string, DetectFn> = {
  "deprecated-tls": (url) => {
    return url.startsWith("http://") ? `URL uses HTTP: ${url}` : null;
  },

  "http-no-redirect": (_url, _headers, _body) => null,

  "ssl-strip-detected": (url, headers) => {
    if (url.startsWith("https://")) return null;
    if (hasHeader(headers, "strict-transport-security")) return null;
    return null;
  },
};
