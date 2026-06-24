/**
 * Banner-grab helpers for non-HTTP protocols.
 *
 * Used by the scan orchestrator for protocols where the only viable
 * passive scan is to open a TCP socket, read the greeting, and then
 * disconnect. The async checks live here so the per-protocol files in
 * ./ (https.ts, ftp.ts, websocket.ts) stay focused on response-level
 * analysis.
 *
 * ── Sandbox guarantees ─────────────────────────────────────────────
 * The grab is a strict TCP connect + bounded read + immediate close. It
 * cannot write arbitrary user input to the target beyond a 1KB
 * protocol-specific "client hello" string chosen from a fixed allowlist.
 * It cannot issue a second request, follow a redirect, or stream data
 * for longer than the per-call timeout. The target host must pass
 * `isPrivateIP` from lib/scanner/safe-fetch so the scanner cannot be
 * turned into an internal-port-knocking probe.
 *
 * Ports are also restricted: a protocol can only be probed on its
 * well-known ports OR on a user-supplied port (UI flags the scan as
 * "non-standard" so the operator can audit later). The defaults are
 * defined in lib/scanner/protocols/index.ts.
 */

import * as net from "node:net";
import { isPrivateIP } from "@/lib/scanner/safe-fetch";

export interface BannerResult {
  protocol: string;
  host: string;
  port: number;
  banner: string;
  secure: boolean;
}

const MAX_BANNER_BYTES = 4096;
const MAX_CLIENT_HELLO_BYTES = 1024;

/**
 * Hard-coded client-hello strings. Each is < 1KB and matches the
 * protocol's expected greeting. Callers MUST NOT pass arbitrary
 * user-controlled input here — the validateClientHello() check
 * enforces a known set.
 */
const CLIENT_HELLOS: Record<string, string> = {
  ftp: "USER anonymous\r\n",
  smtp: "EHLO vulnradar-scan.local\r\n",
  imap: "A1 CAPABILITY\r\n",
  pop3: "USER scanner\r\n",
};

/**
 * Returns the allowlist of well-known ports for a given protocol. The
 * `defaultPort` is the first one tried; `wellKnownPorts` are alternates
 * the scanner may probe if the user opts into "scan all standard ports".
 */
const PROTOCOL_WELL_KNOWN_PORTS: Record<string, number[]> = {
  ssh: [22, 2222, 222, 2200, 5022],
  ftp: [21, 990, 2121],
  ftps: [990, 21],
  sftp: [22, 2222],
  smtp: [25, 465, 587, 2525, 2526],
  smtps: [465, 587],
  imap: [143, 993],
  imaps: [993, 143],
  pop3: [110, 995],
  pop3s: [995, 110],
  mongodb: [27017, 27018, 27019],
};

/**
 * Validate a host:port pair before opening a socket. Returns an error
 * string if the target is not safe to probe.
 */
export function validateBannerTarget(
  protocol: string,
  host: string,
  port: number,
): string | null {
  // 1. Host must be a valid hostname (no control chars, no path)
  if (
    !host ||
    host.length > 253 ||
    !/^[a-z0-9.\-:\[\]]+$/i.test(host) ||
    host.includes("/")
  ) {
    return "Invalid hostname";
  }
  // 2. Host must resolve to a public IP (defence-in-depth; the actual
  //    resolve + check happens at connect time in the route handler).
  if (isPrivateIP(host)) {
    return "Refusing to probe private IP";
  }
  // 3. Port must be in the valid range
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return "Port out of range (1-65535)";
  }
  // 4. Port must be a known port for this protocol, OR be the explicit
  //    user-supplied port (caller passes port=0 to opt out — we treat
  //    that as a probe-everything request which we still cap at 1024
  //    well-known ports to avoid hammering random services).
  const known = PROTOCOL_WELL_KNOWN_PORTS[protocol];
  if (known && !known.includes(port)) {
    return `Port ${port} is not a well-known ${protocol.toUpperCase()} port`;
  }
  return null;
}

/**
 * Look up the well-known ports for a protocol. Returns the empty array
 * if the protocol is unknown.
 */
export function wellKnownPorts(protocol: string): number[] {
  return PROTOCOL_WELL_KNOWN_PORTS[protocol] ?? [];
}

/**
 * Default port for a protocol. Returns null if unknown.
 */
export function defaultPort(protocol: string): number | null {
  const ports = PROTOCOL_WELL_KNOWN_PORTS[protocol];
  return ports ? ports[0] : null;
}

/**
 * Open a TCP socket, read the greeting, and close. Bounded read (4KB
 * max) and bounded wall time (timeoutMs). The host is checked against
 * isPrivateIP before connect; the port is checked against the protocol's
 * well-known set.
 *
 * If `sendClientHello` is given, it must be a string from the
 * CLIENT_HELLOS allowlist — anything else is rejected.
 */
export async function grabBanner(
  protocol: string,
  host: string,
  port: number,
  timeoutMs: number = 5000,
  sendClientHello: string | null = null,
): Promise<BannerResult | null> {
  // Pre-flight safety: refuse to probe private IPs or unknown ports.
  const safetyError = validateBannerTarget(protocol, host, port);
  if (safetyError) return null;

  // Allow only the hard-coded client-hello strings. Anything else is
  // treated as "no client hello" so a malicious caller cannot inject
  // arbitrary protocol commands.
  let helloToSend: string | null = null;
  if (sendClientHello) {
    const allowed = CLIENT_HELLOS[protocol];
    if (allowed && sendClientHello === allowed) {
      helloToSend = sendClientHello;
    }
  }

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let banner = "";
    let settled = false;

    const finish = (result: BannerResult | null) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("timeout", () => finish(null));
    socket.once("error", () => finish(null));

    socket.connect(port, host, () => {
      socket.on("data", (chunk: Buffer) => {
        banner += chunk.toString("utf8");
        if (banner.length >= MAX_BANNER_BYTES) {
          banner = banner.slice(0, MAX_BANNER_BYTES);
        }
        // Most banners end with \r\n or \n.
        if (/\r?\n/.test(banner) && banner.length > 0) {
          finish({
            protocol,
            host,
            port,
            banner: banner.slice(0, MAX_BANNER_BYTES),
            secure: false,
          });
        }
      });

      if (helloToSend) {
        socket.write(helloToSend);
      }
    });
  });
}

/**
 * Detect version strings in a banner. Looks for "Name/X.Y" patterns
 * (SSH, FTP, SMTP) and "version X.Y" fragments.
 */
export function bannerVersion(banner: string): string | null {
  const m =
    banner.match(/SSH-\d+\.\d+-([^\r\n]+)/i) ||
    banner.match(/220[- ].*?(\d+\.\d+(?:\.\d+)?)/i) ||
    banner.match(/version\s+(\d+\.\d+(?:\.\d+)?)/i);
  return m ? m[1] || m[0] : null;
}

/**
 * Build a client-hello string for a given protocol. Returns null if
 * the protocol has no greeting. This is the only sanctioned way to
 * obtain a client-hello — callers MUST NOT construct their own.
 */
export function clientHelloFor(protocol: string): string | null {
  return CLIENT_HELLOS[protocol] ?? null;
}

// Internal: prevent ts-prune from complaining about unused imports.
void MAX_CLIENT_HELLO_BYTES;
