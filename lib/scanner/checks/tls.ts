/**
 * TLS / deep certificate checks.
 *
 * Most TLS checks run from lib/scanner/async-checks.ts (checkTLSCert and
 * related probes) because they need a raw TLS socket to inspect the
 * certificate chain, cipher suites, and protocol negotiation. The JSON
 * entries in checks-data/tls.json document what those async probes check
 * for; the inline `detectors` placeholders below exist only so the
 * registry's coverage test can map every JSON id to a known name — see
 * registry.test.ts's ASYNC_ONLY_CATEGORIES, which exempts `tls` (along
 * with `dns`/`email`) from needing a real synchronous detector at all.
 *
 * NOTE: this module is NOT registered in registry.ts BUNDLES — TLS is
 * async-only. Do not import the `detectors` placeholders below from the
 * synchronous scan orchestrator.
 *
 * The three functions below (checkHttpUpgradeToHttps,
 * checkTlsCertChainCompleteness, checkOcspStapling) ARE real,
 * self-contained live-connection probes — raw HTTP / raw TLS socket work,
 * following the exact same conventions as async-checks.ts's checkTLSCert
 * (rejectUnauthorized: false + manual `authorized` inspection, a hard
 * setTimeout safety net, socket destroyed on every exit path). They are
 * written here, rather than in async-checks.ts, because this module owns
 * the `tls` category; async-checks.ts's buildBranches imports and runs
 * them alongside checkTLSCert whenever the "tls" category itself (not
 * just "ssl") is in scope for the scan.
 */

import * as http from "http";
import * as tls from "tls";
import { generateId, type EvidenceFn as DetectFn } from "../_helpers";
import type { Vulnerability, Severity } from "../types";
import { validateScanTarget } from "../safe-fetch";
import { APP_NAME, APP_URL } from "@/lib/config/constants";

const USER_AGENT = `Mozilla/5.0 (compatible; ${APP_NAME}/1.0; +${APP_URL})`;

function makeTlsVuln(
  checkId: string,
  url: string,
  title: string,
  severity: Severity,
  description: string,
  evidence: string,
  riskImpact: string,
  explanation: string,
  fixSteps: string[],
  confidence = 80,
): Vulnerability {
  return {
    id: generateId(checkId, url),
    title,
    severity,
    category: "tls",
    description,
    evidence,
    riskImpact,
    explanation,
    fixSteps,
    codeExamples: [],
    references: [],
    confidence,
    detectionMethod: "Live TLS/HTTP probe",
  };
}

// ── HTTP → HTTPS redirect verification ──────────────────────────────────

/**
 * For an http:// target, opens a raw HTTP connection (Node's http module
 * never auto-follows redirects, unlike safeFetch's internal redirect loop,
 * which always resolves the fully-followed terminal response and loses
 * the first hop) and inspects ONLY the first response.
 *
 * Distinguishes "correctly upgrades to HTTPS" (a 3xx whose Location is
 * https://) from "serves content directly on :80" (a 2xx) or "redirects,
 * but not to HTTPS" (a 3xx to another http:// URL). A connection refused /
 * timed out on :80 is not flagged — no listener on :80 at all is the best
 * case, not a downgrade risk.
 *
 * Read-only: a single GET, response body discarded unread, no follow-up
 * request. SSRF-guarded the same way safeFetch is: validateScanTarget
 * resolves and validates the hostname, and the request is sent to the
 * resolved IP with the real hostname preserved in the Host header.
 */
export function checkHttpUpgradeToHttps(url: string): Promise<Vulnerability[]> {
  return new Promise((resolve) => {
    if (!url.startsWith("http://")) {
      resolve([]);
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      resolve([]);
      return;
    }

    void (async () => {
      let safety: Awaited<ReturnType<typeof validateScanTarget>>;
      try {
        safety = await validateScanTarget(url);
      } catch {
        resolve([]);
        return;
      }
      if (!safety.safe) {
        resolve([]);
        return;
      }

      const hostname = parsed.hostname;
      const port = parsed.port ? Number(parsed.port) : 80;
      const requestHost = safety.resolvedIp ?? hostname;
      const hostHeader = parsed.port ? `${hostname}:${parsed.port}` : hostname;
      const path = `${parsed.pathname}${parsed.search}`;

      let settled = false;
      const finish = (findings: Vulnerability[]) => {
        if (settled) return;
        settled = true;
        resolve(findings);
      };

      let req: http.ClientRequest;
      try {
        req = http.request(
          {
            host: requestHost,
            port,
            path,
            method: "GET",
            headers: { Host: hostHeader, "User-Agent": USER_AGENT },
            timeout: 5000,
          },
          (res) => {
            res.resume(); // discard the body -- only status/Location matter
            const status = res.statusCode ?? 0;
            const location = res.headers.location;

            if (status >= 300 && status < 400 && location) {
              let redirectsToHttps = false;
              try {
                redirectsToHttps = new URL(location, url).protocol === "https:";
              } catch {
                redirectsToHttps = false;
              }
              if (redirectsToHttps) {
                finish([]);
                return;
              }
              finish([
                makeTlsVuln(
                  "tls-http-no-https-upgrade",
                  url,
                  "Plain HTTP Does Not Redirect to HTTPS",
                  "medium",
                  "The plain-HTTP endpoint returns a redirect, but the redirect target is not HTTPS, so a client that only ever speaks HTTP is never moved onto an encrypted connection.",
                  `First hop: HTTP ${status} redirect to ${location} (not https://), with redirect-following disabled so only this first hop was inspected.`,
                  "A user, bookmark, or link that reaches this site over http:// stays on http:// through the redirect, remaining exposed to on-path tampering and credential/session interception for at least that hop.",
                  "A correctly configured site's :80 listener should do nothing except redirect every request straight to the https:// equivalent of the same URL.",
                  [
                    "Change the :80 listener to issue a 301 redirect to the https:// version of the same path.",
                    "Do not serve any application content on plain HTTP.",
                  ],
                  75,
                ),
              ]);
              return;
            }

            if (status >= 200 && status < 300) {
              finish([
                makeTlsVuln(
                  "tls-http-no-https-upgrade",
                  url,
                  "Plain HTTP Serves Content Without Upgrading to HTTPS",
                  "medium",
                  "The server answered a plain HTTP request on :80 with a normal response instead of redirecting to HTTPS.",
                  `First hop: HTTP ${status} with content served directly on :80; no redirect to https:// was issued (redirect-following was disabled, so this is the server's real first response, not a followed chain).`,
                  "Every request over plain HTTP is transmitted, and answered, in cleartext. Anyone on the network path between the client and this server can read or modify the traffic, and there is no server-side mechanism moving users onto an encrypted connection.",
                  "A correctly configured site's :80 listener should do nothing except redirect every request straight to the https:// equivalent of the same URL; it should never itself return application content.",
                  [
                    "Configure the :80 listener to issue a 301 redirect to https://, with no other content served on that port.",
                    "Enable HSTS on the HTTPS listener once the redirect is in place so returning clients skip the plaintext hop entirely.",
                  ],
                  80,
                ),
              ]);
              return;
            }

            finish([]);
          },
        );
      } catch {
        resolve([]);
        return;
      }

      req.on("error", () => finish([]));
      req.on("timeout", () => {
        req.destroy();
        finish([]);
      });
      req.end();
    })();
  });
}

// ── Certificate chain completeness ──────────────────────────────────────

interface ChainablePeerCert {
  subject?: Record<string, string>;
  issuer?: Record<string, string>;
  issuerCertificate?: ChainablePeerCert;
  valid_to?: string;
}

/**
 * Opens a raw TLS connection (same pattern as async-checks.ts's
 * checkTLSCert: rejectUnauthorized: false so the handshake always
 * completes, `socket.authorized` inspected manually) and checks whether
 * the server sent any certificate beyond the leaf.
 *
 * Only fires when verification succeeded (`authorized === true`) AND the
 * server's own handshake included no certificate beyond the leaf. An
 * unauthorized connection is already covered by checkTLSCert's own
 * self-signed / expired / incomplete-chain findings — piling this finding
 * on top of an already-broken chain would just be noise, so this check
 * deliberately only evaluates the "verification succeeded anyway" case:
 * Node (and most browsers, via a cached intermediate or AIA fetching)
 * still verified this cert, but a client that does neither — older mobile
 * OS TLS stacks, embedded devices, some non-browser HTTP clients — will
 * fail to build a trust path and reject the connection outright.
 */
export async function checkTlsCertChainCompleteness(
  hostname: string,
  url: string,
  port: number = 443,
): Promise<Vulnerability[]> {
  // SSRF hardening: pin the connection to a validated public IP, keeping the
  // hostname for SNI. Connecting by hostname re-resolves DNS and is rebinding-
  // vulnerable (see checkTLSCert in async-checks.ts for the full rationale).
  const safety = await validateScanTarget(url);
  if (!safety.safe || !safety.resolvedIp) return [];
  const safeIp = safety.resolvedIp;

  return new Promise((resolve) => {
    const findings: Vulnerability[] = [];
    let socket: tls.TLSSocket | null = null;

    const timeout = setTimeout(() => {
      socket?.destroy();
      resolve(findings);
    }, 5000);

    try {
      socket = tls.connect(
        {
          host: safeIp,
          port,
          servername: hostname,
          // codeql[js/disabling-certificate-validation]
          rejectUnauthorized: false,
          timeout: 4500,
        },
        () => {
          try {
            const authorized = socket!.authorized;
            const cert = socket!.getPeerCertificate(
              true,
            ) as unknown as ChainablePeerCert;

            // An incomplete chain (leaf only, no intermediate) shows up as a
            // MISSING or EMPTY issuerCertificate. Node's getPeerCertificate(true)
            // terminates a peer-sent chain with a truthy but empty object (no
            // real fields like valid_to), so `!cert.issuerCertificate` alone is
            // never true in practice -- discriminate the empty end-of-chain
            // marker by the absence of valid_to, the same signal the sibling
            // chain walk in async-checks.ts uses. A self-referential leaf
            // (issuerCertificate === cert, Node's root marker) is a self-signed
            // cert reported by checkTLSCert, not a missing-intermediate case.
            if (
              authorized &&
              cert &&
              cert.subject &&
              cert.issuerCertificate !== cert &&
              (!cert.issuerCertificate || !cert.issuerCertificate.valid_to)
            ) {
              const subjectCN = cert.subject?.CN ?? hostname;
              findings.push(
                makeTlsVuln(
                  "tls-cert-chain-incomplete",
                  url,
                  "TLS Certificate Chain Missing Intermediate Certificate",
                  "medium",
                  "The server's TLS handshake sent only the leaf certificate, with no intermediate CA certificate in the chain, even though the connection still verified successfully.",
                  `Certificate for ${subjectCN} verified successfully, but the server sent no certificate beyond the leaf during the handshake.`,
                  "This connection succeeded because the client already had the missing intermediate cached or trusted, or fetched it via AIA. Clients that do neither, including many non-browser HTTP libraries, older mobile OS TLS stacks, and embedded devices, cannot build a trust path and will reject the connection.",
                  "TLS servers should send their full certificate chain (the leaf plus every intermediate CA up to, but not including, the root) on every handshake so any client can verify it without depending on a cached or separately fetched intermediate.",
                  [
                    "Configure the server to serve the full certificate chain (commonly the CA-provided 'fullchain.pem' or equivalent bundle), not just the leaf certificate.",
                    `Verify with: openssl s_client -connect ${hostname}:443 -showcerts, and confirm more than one certificate is returned.`,
                  ],
                  70,
                ),
              );
            }
          } catch {
            /* cert inspection failed */
          }
          socket!.destroy();
          clearTimeout(timeout);
          resolve(findings);
        },
      );

      socket.on("error", () => {
        clearTimeout(timeout);
        resolve(findings);
      });
      socket.on("timeout", () => {
        socket!.destroy();
        clearTimeout(timeout);
        resolve(findings);
      });
    } catch {
      clearTimeout(timeout);
      resolve(findings);
    }
  });
}

// ── OCSP stapling ────────────────────────────────────────────────────────

/**
 * Opens a raw TLS connection with `requestOCSP: true` and listens for the
 * socket's 'OCSPResponse' event, which Node fires during the handshake
 * when the server included a stapled OCSP response (RFC 6066 status_
 * request extension). The listener is attached before the handshake
 * completes, so by the time the connect callback runs, `stapledResponsePresent`
 * already reflects whether stapling happened.
 *
 * Only evaluated once the certificate itself verifies successfully — an
 * already-broken cert is reported elsewhere (checkTLSCert), and OCSP
 * stapling status on top of a cert that doesn't validate at all isn't a
 * separate actionable finding.
 */
export async function checkOcspStapling(
  hostname: string,
  url: string,
  port: number = 443,
): Promise<Vulnerability[]> {
  // SSRF hardening: pin to a validated public IP, keep the hostname for SNI.
  // See checkTLSCert in async-checks.ts for the full rationale.
  const safety = await validateScanTarget(url);
  if (!safety.safe || !safety.resolvedIp) return [];
  const safeIp = safety.resolvedIp;

  return new Promise((resolve) => {
    const findings: Vulnerability[] = [];
    let socket: tls.TLSSocket | null = null;
    let stapledResponsePresent = false;

    const timeout = setTimeout(() => {
      socket?.destroy();
      resolve(findings);
    }, 5000);

    try {
      socket = tls.connect(
        {
          host: safeIp,
          port,
          servername: hostname,
          // codeql[js/disabling-certificate-validation]
          rejectUnauthorized: false,
          requestOCSP: true,
          timeout: 4500,
        },
        () => {
          try {
            const authorized = socket!.authorized;
            if (authorized && !stapledResponsePresent) {
              findings.push(
                makeTlsVuln(
                  "tls-ocsp-stapling-disabled",
                  url,
                  "OCSP Stapling Not Enabled",
                  "info",
                  "The server did not staple an OCSP response during the TLS handshake.",
                  `TLS handshake to ${hostname}:${port} completed with a valid, trusted certificate, but no stapled OCSP response was returned (no 'OCSPResponse' event during the handshake).`,
                  "Without OCSP stapling, clients that check revocation status must contact the CA's OCSP responder directly on every visit, adding latency and revealing the visitor's browsing activity to the CA. Some clients soft-fail this check entirely, silently accepting a revoked certificate rather than blocking on a failed OCSP lookup.",
                  "OCSP stapling lets the server attach a timestamped, CA-signed revocation status to the handshake itself (RFC 6066), so clients don't need a separate round trip to the CA to check revocation.",
                  [
                    "Enable OCSP stapling in the web server/TLS terminator (ssl_stapling on; in Nginx, SSLUseStapling On in Apache).",
                    `Verify with: openssl s_client -connect ${hostname}:443 -status < /dev/null 2>&1 | grep -A1 "OCSP Response"`,
                  ],
                  65,
                ),
              );
            }
          } catch {
            /* inspection failed */
          }
          socket!.destroy();
          clearTimeout(timeout);
          resolve(findings);
        },
      );

      socket.on("OCSPResponse", (response: Buffer | null) => {
        stapledResponsePresent = Boolean(response && response.length > 0);
      });
      socket.on("error", () => {
        clearTimeout(timeout);
        resolve(findings);
      });
      socket.on("timeout", () => {
        socket!.destroy();
        clearTimeout(timeout);
        resolve(findings);
      });
    } catch {
      clearTimeout(timeout);
      resolve(findings);
    }
  });
}

export const detectors: Record<string, DetectFn> = {
  "tls-certificate-expiry": () => null,
  "tls-protocol-version": () => null,
  "tls-cert-key-size-rsa": () => null,
  "tls-cert-key-size-ecdsa": () => null,
  "tls-cert-self-signed": () => null,
  "tls-tls-1-3-not-supported": () => null,
  "tls-cert-san-missing": () => null,
  "tls-cert-expired-ca-chain": () => null,
  "tls-http-no-https-upgrade": () => null,
  "tls-cert-chain-incomplete": () => null,
  "tls-ocsp-stapling-disabled": () => null,
};
