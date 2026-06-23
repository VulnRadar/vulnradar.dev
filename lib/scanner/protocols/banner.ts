/**
 * Banner-grab helpers for non-HTTP protocols.
 *
 * Used by the scan orchestrator for protocols where the only viable
 * passive scan is to open a TCP socket, read the greeting, and then
 * disconnect. The async checks live here so the per-protocol files in
 * ./ (https.ts, ftp.ts, websocket.ts) stay focused on response-level
 * analysis.
 */

import * as net from "node:net";

export interface BannerResult {
  protocol: string;
  host: string;
  port: number;
  banner: string;
  secure: boolean;
}

export async function grabBanner(
  protocol: string,
  host: string,
  port: number,
  timeoutMs: number = 5000,
  sendClientHello: string | null = null,
): Promise<BannerResult | null> {
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
        // Most banners end with \r\n or \n.
        if (/\r?\n/.test(banner) && banner.length > 0) {
          finish({
            protocol,
            host,
            port,
            banner: banner.slice(0, 4096),
            secure: false,
          });
        }
      });

      if (sendClientHello) {
        socket.write(sendClientHello);
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
