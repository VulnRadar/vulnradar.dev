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

// ── One handshake, several certificate and negotiation checks ───────────
//
// checkTLSCert (async-checks.ts) already opens a socket and reads validity,
// self-signing, chain and key size off it. These are the properties it does
// not look at, and they all come from the SAME handshake, so the whole group
// below costs one extra connection rather than one per check.

/** DER encodings of the signature-algorithm OIDs that are no longer safe. */
const WEAK_SIGNATURE_OIDS: [string, string][] = [
  ["06092a864886f70d010105", "sha1WithRSAEncryption"],
  ["06092a864886f70d010104", "md5WithRSAEncryption"],
  ["06092a864886f70d010102", "md2WithRSAEncryption"],
  ["06072a8648ce3d0401", "ecdsa-with-SHA1"],
  ["06072a8648ce380403", "dsa-with-SHA1"],
];

/**
 * The canonical DER encoding of the TLS Feature extension (RFC 7633,
 * OID 1.3.6.1.5.5.7.1.24) whose value is the single feature status_request:
 * OID, OCTET STRING of length 5, SEQUENCE { INTEGER 5 }. Matching the whole
 * run rather than the OID alone keeps this from firing on a TLS Feature
 * extension that requests something else.
 */
const MUST_STAPLE_DER = "06082b0601050507011804053003020105";

/** OID 1.3.6.1.4.1.11129.2.4.2: the embedded SCT list extension. */
const SCT_LIST_OID_DER = "060a2b06010401d679020402";

interface InspectablePeerCert {
  subject?: Record<string, string>;
  issuer?: Record<string, string>;
  issuerCertificate?: InspectablePeerCert;
  subjectaltname?: string;
  serialNumber?: string;
  valid_from?: string;
  valid_to?: string;
  raw?: Buffer;
}

function certContains(cert: InspectablePeerCert, hex: string): boolean {
  if (!cert.raw || !Buffer.isBuffer(cert.raw)) return false;
  return cert.raw.indexOf(Buffer.from(hex, "hex")) !== -1;
}

/** The leaf plus every intermediate, stopping before a self-signed root. */
function chainWithoutRoot(leaf: InspectablePeerCert): InspectablePeerCert[] {
  const out: InspectablePeerCert[] = [];
  let node: InspectablePeerCert | undefined = leaf;
  for (let depth = 0; node && depth < 8; depth++) {
    const next: InspectablePeerCert | undefined = node.issuerCertificate;
    // Node terminates a peer-sent chain with a self-referential node; a root
    // is trusted by identity, so its own SHA-1 self-signature is not a defect.
    if (next === node) break;
    out.push(node);
    if (!next || !next.valid_to) break;
    node = next;
  }
  return out;
}

function certLabel(cert: InspectablePeerCert, fallback: string): string {
  return cert.subject?.CN ?? cert.issuer?.CN ?? fallback;
}

interface HandshakeFacts {
  authorized: boolean;
  cert: InspectablePeerCert;
  cipher: { name?: string; standardName?: string; version?: string } | null;
  ephemeral: { type?: string; name?: string; size?: number } | null;
  protocol: string | null;
  stapled: boolean;
}

function inspectHandshake(
  hostname: string,
  url: string,
  facts: HandshakeFacts,
): Vulnerability[] {
  const findings: Vulnerability[] = [];
  const { cert } = facts;
  if (!facts.authorized || !cert || !cert.subject) return findings;

  // ── Signature algorithm across the served chain ──────────────────────
  for (const node of chainWithoutRoot(cert)) {
    const weak = WEAK_SIGNATURE_OIDS.find(([hex]) => certContains(node, hex));
    if (!weak) continue;
    findings.push(
      makeTlsVuln(
        "tls-cert-signature-algorithm-weak",
        url,
        "Certificate Signed With a Broken Hash Algorithm",
        "high",
        `A certificate in the chain served by ${hostname} is signed with ${weak[1]}, an algorithm whose collision resistance is broken.`,
        `Certificate for ${certLabel(node, hostname)} carries the ${weak[1]} signature algorithm OID.`,
        "A signature over a broken hash can be transferred to a different certificate the attacker constructs, because they can produce a second input with the same digest. A forged certificate that carries a real CA's signature defeats the entire trust chain, and every client that still accepts the algorithm accepts the forgery.",
        "SHA-1 has been rejected by public CAs for TLS since 2016 and by browsers since 2017, so a chain still carrying it is either a private CA, a very old certificate, or an intermediate that was never rotated. MD5 and MD2 are older still. Note that a root certificate's own self-signature is not included here: a root is trusted by identity rather than by its signature.",
        [
          "Reissue the certificate from a CA that signs with SHA-256 or better, and install the full modern chain.",
          "If this is a private CA, re-sign the intermediate and leaf with SHA-256 and redistribute the root.",
          `Verify with: openssl s_client -connect ${hostname}:443 -showcerts < /dev/null | openssl x509 -noout -text | grep -i "signature algorithm"`,
        ],
        85,
      ),
    );
    break;
  }

  // ── Validity window ──────────────────────────────────────────────────
  const from = cert.valid_from ? Date.parse(cert.valid_from) : NaN;
  const to = cert.valid_to ? Date.parse(cert.valid_to) : NaN;
  if (Number.isFinite(from) && Number.isFinite(to)) {
    const days = Math.round((to - from) / 86_400_000);
    if (days > 398) {
      findings.push(
        makeTlsVuln(
          "tls-cert-validity-period-excessive",
          url,
          "Certificate Validity Period Exceeds 398 Days",
          "low",
          `The leaf certificate for ${hostname} is valid for ${days} days, beyond the 398-day maximum the CA/Browser Forum Baseline Requirements have imposed on publicly trusted certificates since September 2020.`,
          `Certificate valid from ${cert.valid_from} to ${cert.valid_to} (${days} days).`,
          "A long validity window is a long exposure window. If the private key is compromised, the certificate stays valid until it expires unless revocation actually reaches clients, and revocation checking is soft-failed by most browsers. It also means the certificate outlives changes to key size, signature algorithm and CA policy that would otherwise be picked up at renewal.",
          "Public CAs cannot issue certificates longer than 398 days, so a longer one is normally a private or internal CA, an appliance's self-installed certificate, or a certificate issued before the limit took effect. Short lifetimes are also what make automated renewal a requirement rather than an option, which is the real benefit.",
          [
            "Reissue with a validity period of 398 days or less, ideally 90.",
            "Automate renewal (ACME, or the platform's managed certificate) so a short lifetime is not operational work.",
            `Verify with: openssl s_client -connect ${hostname}:443 < /dev/null | openssl x509 -noout -dates`,
          ],
          80,
        ),
      );
    }
    if (from > Date.now()) {
      findings.push(
        makeTlsVuln(
          "tls-cert-not-yet-valid",
          url,
          "Certificate Is Not Yet Valid",
          "high",
          `The certificate served by ${hostname} has a notBefore date in the future, so it is not yet valid.`,
          `Certificate notBefore is ${cert.valid_from}, which is later than the time of this scan.`,
          "Clients whose clock is correct reject the certificate outright with a validity error, so the site is unreachable over HTTPS for them. Users who are trained to click through that warning learn to ignore exactly the interstitial that protects them from a real interception.",
          "This is nearly always a clock problem rather than a certificate problem: either the issuing system's clock was ahead, or the server's clock is behind, which makes a perfectly good certificate look premature. Checking the server's own time against NTP is the first step.",
          [
            "Check the server's system clock and confirm NTP is running and synchronised.",
            "If the clock is right, reissue the certificate: its notBefore was set in the future at issuance.",
            `Verify with: openssl s_client -connect ${hostname}:443 < /dev/null | openssl x509 -noout -dates; date -u`,
          ],
          85,
        ),
      );
    }
  }

  // ── Subject Alternative Name breadth ─────────────────────────────────
  const sanEntries = (cert.subjectaltname ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (sanEntries.length > 50) {
    findings.push(
      makeTlsVuln(
        "tls-cert-san-count-excessive",
        url,
        "Certificate Covers an Unusually Large Number of Names",
        "info",
        `The certificate served by ${hostname} lists ${sanEntries.length} Subject Alternative Names.`,
        `Certificate SAN list contains ${sanEntries.length} entries, beginning: ${sanEntries.slice(0, 5).join(", ")}.`,
        "One private key protects every name on the certificate, so a compromise of this key affects all of them at once, and a revocation forced by any one of them takes all of them offline together. Where the names belong to different customers or business units, the SAN list also discloses who else is hosted alongside this site.",
        "Large SAN lists are normal on shared hosting and on some CDN configurations, where one certificate fronts many tenants, so this is informational rather than a defect. It is worth knowing because it describes a shared fate: the operational blast radius of a key rotation or an emergency revocation is every name in the list.",
        [
          "Confirm the shared certificate is intentional rather than an artifact of how certificates are provisioned.",
          "Where names belong to separate trust domains, issue per-domain certificates so a compromise or revocation is contained.",
          `Verify with: openssl s_client -connect ${hostname}:443 < /dev/null | openssl x509 -noout -text | grep -A1 "Subject Alternative Name"`,
        ],
        70,
      ),
    );
  }

  // ── Serial-number entropy ────────────────────────────────────────────
  const serial = (cert.serialNumber ?? "").replace(/[^0-9a-fA-F]/g, "");
  if (serial.length > 0 && serial.length < 16) {
    findings.push(
      makeTlsVuln(
        "tls-cert-serial-low-entropy",
        url,
        "Certificate Serial Number Has Too Little Entropy",
        "low",
        `The certificate for ${hostname} has a ${serial.length * 4}-bit serial number, below the 64 bits of CSPRNG output the CA/Browser Forum Baseline Requirements have required since 2016.`,
        `Certificate serial number is ${serial} (${serial.length} hex digits).`,
        "Serial-number entropy is what stops a chosen-prefix collision attack against the certificate's signature: without it, an attacker who can predict the serial can prepare a colliding certificate in advance. It is the mitigation that made SHA-1 issuance survivable for as long as it did, and the same reasoning applies to any hash whose margin later narrows.",
        "A short serial usually means a private CA or an appliance generating certificates with a counter rather than a random source. Public CAs have been required to use at least 64 bits of CSPRNG output since Ballot 164, and a well-known 2019 incident forced the mass revocation of millions of certificates issued with 63.",
        [
          "If this is a private CA, configure it to generate serial numbers from at least 64 bits of CSPRNG output.",
          "Reissue certificates that were generated with counter-based serials.",
          `Verify with: openssl s_client -connect ${hostname}:443 < /dev/null | openssl x509 -noout -serial`,
        ],
        75,
      ),
    );
  }

  // ── Certificate Transparency ─────────────────────────────────────────
  if (cert.raw && !certContains(cert, SCT_LIST_OID_DER)) {
    findings.push(
      makeTlsVuln(
        "tls-cert-no-embedded-sct",
        url,
        "Certificate Carries No Embedded Certificate Transparency SCTs",
        "info",
        `The certificate for ${hostname} contains no embedded Signed Certificate Timestamp list extension.`,
        `Certificate for ${certLabel(cert, hostname)} does not carry the SCT list extension (OID 1.3.6.1.4.1.11129.2.4.2).`,
        "Without Certificate Transparency, a certificate misissued for this domain does not appear in a public log, so neither you nor a CT monitor can see it. CT is the mechanism that turns a silent misissuance into a detectable one, and monitoring only works for certificates that are actually logged.",
        "SCTs can also be delivered in the TLS handshake extension or in a stapled OCSP response rather than embedded in the certificate, so absence of the embedded extension does not prove the certificate is unlogged. It does mean the most common and most portable delivery method is not in use, which usually indicates a private CA or an internal certificate authority that does not log at all. Where that is the case, set up CT monitoring for your domains regardless, since it catches misissuance by any public CA.",
        [
          "For a publicly trusted certificate, ask the CA to embed SCTs; every major public CA does this by default.",
          "Subscribe to a Certificate Transparency monitor for your domains so any certificate issued for them raises an alert.",
          "Publish a CAA record so only the CAs you intend can issue for the domain in the first place.",
          `Verify with: openssl s_client -connect ${hostname}:443 < /dev/null | openssl x509 -noout -text | grep -i "CT Precertificate SCTs"`,
        ],
        65,
      ),
    );
  }

  // ── OCSP Must-Staple declared but not honoured ───────────────────────
  if (certContains(cert, MUST_STAPLE_DER) && !facts.stapled) {
    findings.push(
      makeTlsVuln(
        "tls-must-staple-not-stapled",
        url,
        "Certificate Requires OCSP Stapling but None Was Stapled",
        "high",
        `The certificate for ${hostname} carries the RFC 7633 TLS Feature extension requesting status_request (OCSP Must-Staple), but the handshake returned no stapled OCSP response.`,
        `Certificate declares the must-staple TLS Feature extension; the handshake completed with no OCSPResponse.`,
        "A client that enforces must-staple treats a handshake with no stapled response as a hard failure and refuses the connection. That is a self-inflicted outage for those clients, and it happens intermittently, because a server usually stops stapling when its OCSP fetch fails rather than at deploy time, which makes it very hard to diagnose from the server side.",
        "Must-staple is a promise the certificate makes on the server's behalf: every handshake will carry a fresh, CA-signed revocation status. It is a strong control, since it closes the soft-fail gap that makes revocation ineffective, but it only works if stapling is configured, working, and monitored. A certificate with the extension and a server without working stapling is the worst of both.",
        [
          "Enable OCSP stapling on the TLS terminator (ssl_stapling on plus ssl_stapling_verify on in Nginx, SSLUseStapling On in Apache).",
          "Make sure the server can reach the CA's OCSP responder outbound, and that it has a resolver configured; a blocked responder is the usual cause of stapling silently stopping.",
          "Monitor for a stapled response in production rather than only at deploy time.",
          `Verify with: openssl s_client -connect ${hostname}:443 -status < /dev/null 2>&1 | grep -A2 "OCSP Response Status"`,
        ],
        85,
      ),
    );
  }

  // ── Negotiated cipher suite ──────────────────────────────────────────
  const cipherName = facts.cipher?.standardName ?? facts.cipher?.name ?? "";
  const protocol = facts.protocol ?? facts.cipher?.version ?? "";
  if (cipherName && protocol !== "TLSv1.3") {
    if (
      /^TLS_RSA_WITH/i.test(cipherName) ||
      /^(?:AES|DES|RC4|SEED|CAMELLIA)\d*-/i.test(cipherName)
    ) {
      findings.push(
        makeTlsVuln(
          "tls-cipher-no-forward-secrecy",
          url,
          "Negotiated Cipher Suite Has No Forward Secrecy",
          "medium",
          `${hostname} negotiated ${cipherName}, a static-RSA key-exchange suite that provides no forward secrecy.`,
          `Handshake negotiated cipher ${cipherName} over ${protocol || "an unreported protocol version"}.`,
          "With static RSA key exchange the session key is encrypted directly to the certificate's public key, so anyone who records the traffic today and obtains the private key later, through a compromise, a subpoena, or a bug like Heartbleed, can decrypt every recorded session retroactively. Forward secrecy removes that possibility by making each session's key ephemeral.",
          "This reports what the server actually chose when a modern client offered it a normal cipher list, not merely what it supports, so it means the ephemeral suites were either not offered by the server or not preferred over the static one. TLS 1.3 removes static RSA entirely, which is why this only applies below 1.3.",
          [
            "Restrict the server's cipher list to ECDHE and DHE suites so no static-RSA suite can be selected.",
            "Enable TLS 1.3, where every suite provides forward secrecy by construction.",
            `Verify with: openssl s_client -connect ${hostname}:443 < /dev/null 2>&1 | grep -E "Cipher|Protocol"`,
          ],
          85,
        ),
      );
    } else if (
      /_CBC_|-CBC(?:$|-)|-SHA$/i.test(cipherName) &&
      !/GCM|CHACHA20|CCM/i.test(cipherName)
    ) {
      findings.push(
        makeTlsVuln(
          "tls-cipher-cbc-mode",
          url,
          "Negotiated Cipher Suite Uses CBC Mode",
          "low",
          `${hostname} negotiated ${cipherName}, a CBC-mode suite with a MAC-then-encrypt construction, rather than an AEAD suite.`,
          `Handshake negotiated cipher ${cipherName} over ${protocol || "an unreported protocol version"}.`,
          "CBC suites in TLS use MAC-then-encrypt, which has produced a long series of padding-oracle attacks (BEAST, Lucky 13, and the various POODLE and Zombie POODLE variants). Each one has a mitigation, but the mitigations are implementation-specific and easy to lose across a library upgrade, whereas AEAD suites remove the class of problem.",
          "Reported as Low because a current TLS library with the standard mitigations is not practically exploitable here. It is a signal about the configuration rather than an immediate break: a server that still prefers CBC over AES-GCM is running an old cipher ordering, and the rest of that configuration is usually the same age.",
          [
            "Prefer AEAD suites (AES-GCM, ChaCha20-Poly1305) and drop CBC suites from the cipher list.",
            "Enable TLS 1.3, which offers only AEAD suites.",
            `Verify with: openssl s_client -connect ${hostname}:443 < /dev/null 2>&1 | grep Cipher`,
          ],
          80,
        ),
      );
    }
  }

  // ── Ephemeral key strength ───────────────────────────────────────────
  const eph = facts.ephemeral;
  if (eph && typeof eph.size === "number" && eph.size > 0) {
    const weakDh = eph.type === "DH" && eph.size < 2048;
    const weakEcdh = eph.type === "ECDH" && eph.size < 224;
    if (weakDh || weakEcdh) {
      findings.push(
        makeTlsVuln(
          "tls-ephemeral-key-weak",
          url,
          "Weak Ephemeral Key Exchange Parameters",
          "medium",
          `${hostname} completed the key exchange with a ${eph.size}-bit ${eph.type} ${eph.name ? `(${eph.name}) ` : ""}ephemeral key.`,
          `Handshake ephemeral key: type ${eph.type}, ${eph.name ? `curve/group ${eph.name}, ` : ""}size ${eph.size} bits.`,
          "The ephemeral key is what forward secrecy actually rests on: it is the value an attacker has to break to recover a recorded session. A group below 2048 bits for finite-field Diffie-Hellman is within reach of precomputation attacks against a common group (the Logjam result), and once that precomputation is done every session using the same group is cheap to break.",
          "Servers end up here by keeping a 1024-bit dhparam file that was generated years ago, or by leaving the library default in place. The fix is to prefer elliptic-curve key exchange, where a 256-bit curve gives far more security than a 2048-bit finite field, and to generate a fresh 2048-bit or larger group if finite-field DH has to remain available.",
          [
            "Prefer ECDHE with P-256 or X25519 and remove finite-field DHE suites where they are not needed.",
            "If DHE must stay, generate a fresh group of at least 2048 bits and point the server at it.",
            `Verify with: openssl s_client -connect ${hostname}:443 < /dev/null 2>&1 | grep -i "server temp key"`,
          ],
          85,
        ),
      );
    }
  }

  return findings;
}

/**
 * Opens one TLS connection and derives every certificate and negotiation
 * finding that can be read off a single handshake. Same connection pattern
 * as checkTlsCertChainCompleteness above: SSRF-pinned to a validated public
 * IP with the hostname preserved for SNI, rejectUnauthorized false so the
 * handshake always completes, `authorized` inspected by hand, and a hard
 * timeout so a stalled peer cannot hold the branch open.
 */
export async function checkTlsHandshakeDetails(
  hostname: string,
  url: string,
  port: number = 443,
): Promise<Vulnerability[]> {
  const safety = await validateScanTarget(url);
  if (!safety.safe || !safety.resolvedIp) return [];
  const safeIp = safety.resolvedIp;

  return new Promise((resolve) => {
    let socket: tls.TLSSocket | null = null;
    let stapled = false;
    let settled = false;
    const finish = (findings: Vulnerability[]) => {
      if (settled) return;
      settled = true;
      resolve(findings);
    };

    const timeout = setTimeout(() => {
      socket?.destroy();
      finish([]);
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
          let findings: Vulnerability[] = [];
          try {
            const cert = socket!.getPeerCertificate(
              true,
            ) as unknown as InspectablePeerCert;
            findings = inspectHandshake(hostname, url, {
              authorized: socket!.authorized,
              cert,
              cipher: socket!.getCipher?.() ?? null,
              ephemeral: socket!.getEphemeralKeyInfo?.() ?? null,
              protocol: socket!.getProtocol?.() ?? null,
              stapled,
            });
          } catch {
            /* inspection failed; report nothing rather than guessing */
          }
          socket!.destroy();
          clearTimeout(timeout);
          finish(findings);
        },
      );

      socket.on("OCSPResponse", (response: Buffer | null) => {
        stapled = Boolean(response && response.length > 0);
      });
      socket.on("error", () => {
        clearTimeout(timeout);
        finish([]);
      });
      socket.on("timeout", () => {
        socket!.destroy();
        clearTimeout(timeout);
        finish([]);
      });
    } catch {
      clearTimeout(timeout);
      finish([]);
    }
  });
}

/**
 * Opens a second connection that offers ONLY TLS 1.0 and 1.1. A completed
 * handshake proves the server still accepts a deprecated protocol version,
 * which the negotiated-version check cannot see: a server that prefers
 * TLS 1.3 with a modern client can still answer a legacy one.
 *
 * Asymmetric on purpose. A successful handshake is proof; a failure is not,
 * because this client's own OpenSSL build may refuse the legacy suites
 * regardless of what the server would have accepted. So a failure reports
 * nothing rather than "TLS 1.0 is disabled".
 */
export async function checkLegacyTlsProtocolAccepted(
  hostname: string,
  url: string,
  port: number = 443,
): Promise<Vulnerability[]> {
  const safety = await validateScanTarget(url);
  if (!safety.safe || !safety.resolvedIp) return [];
  const safeIp = safety.resolvedIp;

  return new Promise((resolve) => {
    let socket: tls.TLSSocket | null = null;
    let settled = false;
    const finish = (findings: Vulnerability[]) => {
      if (settled) return;
      settled = true;
      resolve(findings);
    };

    const timeout = setTimeout(() => {
      socket?.destroy();
      finish([]);
    }, 5000);

    try {
      socket = tls.connect(
        {
          host: safeIp,
          port,
          servername: hostname,
          minVersion: "TLSv1",
          maxVersion: "TLSv1.1",
          // OpenSSL 3 puts the suites TLS 1.0/1.1 need below the default
          // security level, so without this the client refuses before the
          // server ever gets a say.
          ciphers: "DEFAULT@SECLEVEL=0",
          // codeql[js/disabling-certificate-validation]
          rejectUnauthorized: false,
          timeout: 4500,
        },
        () => {
          const negotiated = socket!.getProtocol?.() ?? "TLSv1.x";
          socket!.destroy();
          clearTimeout(timeout);
          finish([
            makeTlsVuln(
              "tls-legacy-protocol-accepted",
              url,
              "Server Still Accepts TLS 1.0 or TLS 1.1",
              "medium",
              `${hostname} completed a handshake with a client that offered only TLS 1.0 and TLS 1.1, negotiating ${negotiated}.`,
              `A handshake restricted to TLSv1/TLSv1.1 succeeded against ${hostname}:${port}, negotiating ${negotiated}.`,
              "TLS 1.0 and 1.1 rely on constructions that are no longer considered sound: MAC-then-encrypt CBC modes, MD5 and SHA-1 in the PRF and in signatures, and no support for modern AEAD suites. A network attacker who can influence the client, or an old client that prefers the legacy version, is downgraded onto a protocol with known attacks against it, and PCI DSS has disallowed TLS 1.0 since 2018.",
              "This is deliberately one-directional evidence. A successful legacy handshake proves the server accepts the version. A failed one proves nothing, because the scanning client's own TLS library may refuse those suites regardless of the server, so this check never reports that legacy protocols are disabled, only that they are enabled.",
              [
                "Set the minimum protocol version to TLS 1.2 on every listener and load balancer in front of the site.",
                "Check the CDN or WAF separately: origin and edge often have independent protocol settings.",
                "Review client analytics before disabling, since a small number of very old clients will lose access.",
                `Verify with: openssl s_client -connect ${hostname}:443 -tls1_1 < /dev/null`,
              ],
              90,
            ),
          ]);
        },
      );

      socket.on("error", () => {
        clearTimeout(timeout);
        finish([]);
      });
      socket.on("timeout", () => {
        socket!.destroy();
        clearTimeout(timeout);
        finish([]);
      });
    } catch {
      clearTimeout(timeout);
      finish([]);
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
  "tls-cert-signature-algorithm-weak": () => null,
  "tls-cert-validity-period-excessive": () => null,
  "tls-cert-not-yet-valid": () => null,
  "tls-cert-san-count-excessive": () => null,
  "tls-cert-serial-low-entropy": () => null,
  "tls-cert-no-embedded-sct": () => null,
  "tls-must-staple-not-stapled": () => null,
  "tls-cipher-no-forward-secrecy": () => null,
  "tls-cipher-cbc-mode": () => null,
  "tls-ephemeral-key-weak": () => null,
  "tls-legacy-protocol-accepted": () => null,
};
