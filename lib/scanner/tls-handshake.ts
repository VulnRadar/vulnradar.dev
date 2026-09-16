/**
 * One modern TLS handshake per host, read by every check that needs one.
 *
 * checkTLSCert, checkTlsCertChainCompleteness, checkOcspStapling and
 * checkTlsHandshakeDetails each used to open their own connection, and each
 * resolved and validated the target first, so the TLS branch of every scan
 * made four handshakes and four DNS lookups to read one certificate. Behind a
 * CDN those connections can land on different edges serving different
 * certificates, and four checks could then describe four different chains in
 * the same report. They run concurrently in one Promise.allSettled, so this
 * keeps one in-flight read per host and port and hands the same answer to
 * all of them. It is dropped as soon as it settles, so nothing is cached
 * across scans.
 *
 * checkLegacyTlsProtocolAccepted still opens its own connection: it offers
 * only TLS 1.0 and 1.1, so it cannot share a handshake a modern client made.
 *
 * SSRF hardening: the connection is pinned to the public IP
 * validateScanTarget resolved, keeping the hostname only for SNI and
 * certificate checks. Connecting by hostname would re-resolve DNS at the OS
 * layer, which is rebinding-vulnerable (public when the scan route validated
 * it, internal by the time this detached check runs).
 */

import * as tls from "tls";
import { validateScanTarget } from "./safe-fetch";

export interface TlsHandshake {
  /** Whether the chain verified. The connection never enforces it. */
  authorized: boolean;
  authorizationError: Error | null;
  /** getPeerCertificate(true): the leaf, with the served chain behind it. */
  cert: tls.DetailedPeerCertificate | null;
  protocol: string | null;
  cipher: tls.CipherNameAndProtocol | null;
  ephemeral: { type?: string; name?: string; size?: number } | null;
  /** Whether the server stapled a non-empty OCSP response. */
  stapled: boolean;
}

const HANDSHAKE_TIMEOUT_MS = 5000;

const inFlight = new Map<string, Promise<TlsHandshake | null>>();

/**
 * The handshake facts for `hostname:port`, or null when the target is not a
 * safe public address or no handshake completed (refused, reset, timed out).
 */
export function readTlsHandshake(
  hostname: string,
  url: string,
  port: number = 443,
): Promise<TlsHandshake | null> {
  const key = `${hostname.toLowerCase()}:${port}`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const run = handshake(hostname, url, port).finally(() =>
    inFlight.delete(key),
  );
  inFlight.set(key, run);
  return run;
}

async function handshake(
  hostname: string,
  url: string,
  port: number,
): Promise<TlsHandshake | null> {
  const safety = await validateScanTarget(url);
  if (!safety.safe || !safety.resolvedIp) return null;
  const safeIp = safety.resolvedIp;

  return new Promise((resolve) => {
    let socket: tls.TLSSocket | null = null;
    let stapled = false;
    let settled = false;
    const finish = (result: TlsHandshake | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket?.destroy();
      resolve(result);
    };

    // Outer safety net: a peer that never finishes the handshake must not
    // hold the branch open or leak a file descriptor per scan.
    const timeout = setTimeout(() => finish(null), HANDSHAKE_TIMEOUT_MS);

    try {
      socket = tls.connect(
        {
          host: safeIp,
          port,
          servername: hostname,
          // rejectUnauthorized: false lets the handshake complete for an
          // expired, self-signed or mismatched certificate so it can be
          // inspected; `authorized` is read by hand instead.
          // codeql[js/disabling-certificate-validation]
          rejectUnauthorized: false,
          requestOCSP: true,
          timeout: HANDSHAKE_TIMEOUT_MS - 500,
        },
        () => {
          try {
            const s = socket!;
            finish({
              authorized: s.authorized,
              authorizationError: s.authorizationError ?? null,
              cert: s.getPeerCertificate(true) ?? null,
              protocol: s.getProtocol?.() ?? null,
              cipher: s.getCipher?.() ?? null,
              ephemeral:
                (s.getEphemeralKeyInfo?.() as TlsHandshake["ephemeral"]) ??
                null,
              stapled,
            });
          } catch {
            finish(null);
          }
        },
      );
      // Fires during the handshake, before the connect callback, when the
      // server includes a stapled response (RFC 6066 status_request).
      socket.on("OCSPResponse", (response: Buffer | null) => {
        stapled = Boolean(response && response.length > 0);
      });
      // With rejectUnauthorized: false this only fires for real network
      // errors, never for a certificate that fails verification.
      socket.on("error", () => finish(null));
      socket.on("timeout", () => finish(null));
    } catch {
      finish(null);
    }
  });
}
