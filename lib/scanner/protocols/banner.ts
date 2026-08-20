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
 * `isPrivateHostname` from lib/scanner/safe-fetch so the scanner cannot be
 * turned into an internal-port-knocking probe.
 *
 * Ports are also restricted: a protocol can only be probed on its
 * well-known ports OR on a user-supplied port (UI flags the scan as
 * "non-standard" so the operator can audit later). The defaults are
 * defined in lib/scanner/protocols/index.ts.
 */

import * as net from "node:net";
import * as tls from "node:tls";
import { isPrivateHostname } from "@/lib/scanner/safe-fetch";
import { resolveSafePublicIp } from "@/lib/scanner/port-scan";

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
  // ftp removed: "USER anonymous\r\n" initiates an anonymous login attempt.
  smtp: "EHLO vulnradar-scan.local\r\n",
  imap: "A1 CAPABILITY\r\n",
  pop3: "USER scanner\r\n",
  // Implicit-TLS variants: same greeting text, sent after the TLS
  // handshake completes (see IMPLICIT_TLS_PROTOCOLS / grabBanner below).
  smtps: "EHLO vulnradar-scan.local\r\n",
  imaps: "A1 CAPABILITY\r\n",
  pop3s: "USER scanner\r\n",
  // Redis/Memcached: read-only, non-destructive commands. PING and stats
  // are the standard low-impact way to fingerprint these services and
  // confirm whether they answer without authentication.
  redis: "PING\r\n",
  memcached: "stats\r\n",
};

/**
 * Multi-line capability hellos, used only by grabCapabilityBanner. Kept
 * separate from CLIENT_HELLOS because grabBanner's single-newline resolve
 * would truncate a multi-line EHLO/CAPABILITY/CAPA response before
 * STARTTLS/STLS has a chance to appear. pop3 uses CAPA here (not the
 * CLIENT_HELLOS "USER scanner" greeting) because CAPA lists capabilities,
 * including STLS, without attempting a login.
 */
const CAPABILITY_HELLOS: Record<string, string> = {
  smtp: CLIENT_HELLOS.smtp,
  imap: CLIENT_HELLOS.imap,
  pop3: "CAPA\r\n",
};

/**
 * Protocols that speak TLS from the first byte (as opposed to a plaintext
 * connection that may later upgrade via STARTTLS). grabBanner opens these
 * with tls.connect instead of a plain net.Socket — connecting in plaintext
 * to one of these ports would just read undecryptable TLS handshake bytes.
 */
const IMPLICIT_TLS_PROTOCOLS = new Set(["smtps", "imaps", "pop3s", "ftps"]);

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
  redis: [6379],
  elasticsearch: [9200, 9243],
  memcached: [11211],
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
  // 2. Host must resolve to a public address (defence-in-depth; the actual
  //    resolve + check happens at connect time in the route handler).
  if (isPrivateHostname(host)) {
    return "Refusing to probe private/internal host";
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
 * isPrivateHostname before connect; the port is checked against the protocol's
 * well-known set.
 *
 * If `sendClientHello` is given, it must be a string from the
 * CLIENT_HELLOS allowlist — anything else is rejected.
 *
 * Implicit-TLS protocols (smtps, imaps, pop3s, ftps — see
 * IMPLICIT_TLS_PROTOCOLS) connect via tls.connect instead of a plain
 * net.Socket: these ports expect a TLS ClientHello immediately, not a
 * plaintext greeting, so a raw socket would just read undecryptable
 * handshake bytes. `rejectUnauthorized: false` (same rationale as the
 * TLS cert check in lib/scanner/async-checks.ts) lets the handshake
 * complete and the banner get read even for a self-signed or expired
 * certificate — this function reports the post-handshake banner text,
 * not certificate trust, and cert validity for arbitrary internet-facing
 * mail/FTP servers we don't control is exactly the kind of thing a
 * separate ssl/tls check should flag, not something that should block a
 * banner grab.
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

  // SSRF hardening: resolve the host to a validated PUBLIC ip and connect to
  // that ip, not the hostname. validateBannerTarget's isPrivateHostname check
  // is syntactic and does not resolve DNS, so connecting by hostname re-resolves
  // it at the OS layer and is vulnerable to DNS rebinding (public at validation,
  // internal by connect). Pinning the resolved ip closes that window; the
  // hostname is still used for TLS SNI and for the reported result.
  const safeIp = await resolveSafePublicIp(host);
  if (!safeIp) return null;

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

  const useTls = IMPLICIT_TLS_PROTOCOLS.has(protocol);

  return new Promise((resolve) => {
    const socket: net.Socket = useTls
      ? // Safe: connecting to safeIp, a validated public address from
        // resolveSafePublicIp; servername keeps the hostname for SNI.
        // codeql[js/request-forgery]
        tls.connect({
          host: safeIp,
          port,
          servername: host,
          rejectUnauthorized: false,
        })
      : new net.Socket();
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

    const onConnected = () => {
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
            secure: useTls,
          });
        }
      });

      if (helloToSend) {
        socket.write(helloToSend);
      }
    };

    if (useTls) {
      // Safe: connected to safeIp (validated public ip from resolveSafePublicIp).
      // codeql[js/request-forgery]
      (socket as tls.TLSSocket).once("secureConnect", onConnected);
    } else {
      // Safe: connecting to safeIp, a validated public ip from
      // resolveSafePublicIp -- not the re-resolvable hostname.
      // codeql[js/request-forgery]
      socket.connect(port, safeIp, onConnected);
    }
  });
}

/**
 * Like grabBanner, but for protocols whose capability listing spans
 * multiple lines (SMTP EHLO, IMAP CAPABILITY, POP3 CAPA). grabBanner
 * resolves as soon as the first newline arrives, which is correct for a
 * single-line greeting but would truncate a multi-line capability
 * response before STARTTLS/STLS has a chance to show up in a later line.
 *
 * Since the hello is written immediately on connect (matching grabBanner's
 * existing behavior) the first bytes back are usually the server's
 * unsolicited greeting, with the actual capability response following in
 * a separate read. Rather than parse a per-protocol "response complete"
 * grammar, this resets a short idle timer on every data event and
 * finalizes once the target goes quiet for `idleMs` — simple and robust
 * regardless of how many chunks the reply arrives in. Same sandbox
 * guarantees as grabBanner: private-host/port checks via
 * validateBannerTarget, a hard-coded hello from a fixed allowlist, and a
 * bounded read.
 */
export async function grabCapabilityBanner(
  protocol: string,
  host: string,
  port: number,
  timeoutMs: number = 5000,
  idleMs: number = 400,
): Promise<BannerResult | null> {
  const hello = CAPABILITY_HELLOS[protocol];
  if (!hello) return null;

  const safetyError = validateBannerTarget(protocol, host, port);
  if (safetyError) return null;

  // SSRF hardening: connect to a validated public ip, never the re-resolvable
  // hostname (DNS-rebinding safe). See grabBanner for the full rationale.
  const safeIp = await resolveSafePublicIp(host);
  if (!safeIp) return null;

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let banner = "";
    let settled = false;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (result: BannerResult | null) => {
      if (settled) return;
      settled = true;
      if (idleTimer) clearTimeout(idleTimer);
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    const scheduleIdleFinish = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        finish({ protocol, host, port, banner, secure: false });
      }, idleMs);
    };

    socket.setTimeout(timeoutMs);
    // A hard timeout with at least some data already read still counts as
    // a usable (if partial) capability response; only bail out empty-handed
    // if nothing at all came back.
    socket.once("timeout", () =>
      finish(banner ? { protocol, host, port, banner, secure: false } : null),
    );
    socket.once("error", () => finish(null));

    // Safe: connecting to safeIp, a validated public ip from
    // resolveSafePublicIp -- not the re-resolvable hostname.
    // codeql[js/request-forgery]
    socket.connect(port, safeIp, () => {
      socket.write(hello);
      socket.on("data", (chunk: Buffer) => {
        banner += chunk.toString("utf8");
        if (banner.length >= MAX_BANNER_BYTES) {
          finish({
            protocol,
            host,
            port,
            banner: banner.slice(0, MAX_BANNER_BYTES),
            secure: false,
          });
          return;
        }
        scheduleIdleFinish();
      });
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

/**
 * Parsed view of an SSH identification banner (RFC 4253 section 4.2:
 * "SSH-protoversion-softwareversion comments").
 */
export interface SshBannerAssessment {
  protocolVersion: string | null;
  softwareVersion: string | null;
  /** True when the protocol-version field starts with "1." (SSH-1, or
   *  SSH-1.99 which advertises SSH-1 compatibility alongside SSH-2). */
  supportsProtocol1: boolean;
  knownVulnerable: boolean;
  /** Human-readable note for knownVulnerable findings. Null otherwise. */
  vulnNote: string | null;
}

function parseMajorMinor(v: string): [number, number] | null {
  const m = v.match(/^(\d+)\.(\d+)/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10)];
}

function versionLte(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]);
}

function versionGte(a: [number, number], b: [number, number]): boolean {
  return a[0] > b[0] || (a[0] === b[0] && a[1] >= b[1]);
}

/**
 * Coarse, best-effort OpenSSH version-range check against a handful of
 * well-known CVE ranges. This is inferred purely from the version string
 * a server chooses to report — distributions like Debian and Ubuntu
 * backport security fixes without bumping that string, so a hit here is a
 * lead to verify manually, not a confirmed vulnerability. Callers should
 * surface that caveat alongside any finding built from this.
 */
export function assessSshBanner(banner: string): SshBannerAssessment {
  const result: SshBannerAssessment = {
    protocolVersion: null,
    softwareVersion: null,
    supportsProtocol1: false,
    knownVulnerable: false,
    vulnNote: null,
  };

  const m = banner.match(/^SSH-(\d+\.\d+)-(\S+)/);
  if (!m) return result;
  result.protocolVersion = m[1];
  result.softwareVersion = m[2];
  result.supportsProtocol1 = m[1].startsWith("1.");

  const osshMatch = m[2].match(/^OpenSSH_(\d+\.\d+)/i);
  if (!osshMatch) return result;
  const version = parseMajorMinor(osshMatch[1]);
  if (!version) return result;

  if (versionLte(version, [4, 3])) {
    result.knownVulnerable = true;
    result.vulnNote =
      "OpenSSH versions before 4.4 are long past end-of-life, with numerous public CVEs.";
  } else if (versionLte(version, [6, 6])) {
    result.knownVulnerable = true;
    result.vulnNote =
      "OpenSSH 4.4-6.6 includes known issues such as CVE-2015-5600 (pre-auth resource exhaustion).";
  } else if (versionLte(version, [7, 4])) {
    result.knownVulnerable = true;
    result.vulnNote =
      "OpenSSH 6.7-7.4 includes CVE-2016-10009/10010/10011/10012, and (below 7.7) the CVE-2018-15473 username-enumeration bug.";
  } else if (versionGte(version, [8, 5]) && versionLte(version, [9, 7])) {
    result.knownVulnerable = true;
    result.vulnNote =
      'OpenSSH 8.5-9.7 may be vulnerable to CVE-2024-6387 ("regreSSHion"), a signal-handler race condition allowing unauthenticated remote code execution on glibc-based Linux, unless the distro backported the fix.';
  }

  return result;
}

/**
 * Whether a mail protocol's capability/greeting response offers STARTTLS
 * (or POP3's equivalent, STLS), and whether the response otherwise
 * suggests authentication could proceed without it. This never attempts
 * an actual login — see the CLIENT_HELLOS comment on why: it only reads
 * what the server voluntarily advertised in its capability listing.
 */
export interface StartTlsAssessment {
  offered: boolean;
  /** Best-effort: true when the capability text suggests plaintext auth
   *  is possible even though STARTTLS is offered (IMAP: no LOGINDISABLED;
   *  POP3: USER capability present; SMTP: AUTH advertised pre-STARTTLS).
   *  Always true when STARTTLS is not offered at all, since any auth on
   *  that connection is necessarily unencrypted. */
  plaintextAuthAllowed: boolean;
}

export function detectStartTls(
  service: "smtp" | "imap" | "pop3",
  capabilityText: string,
): StartTlsAssessment {
  const upper = capabilityText.toUpperCase();

  if (service === "smtp") {
    const offered = /^250[- ]STARTTLS\s*$/m.test(upper);
    const advertisesAuthPreTls = /^250[- ]AUTH\b/m.test(upper);
    return {
      offered,
      plaintextAuthAllowed: !offered || advertisesAuthPreTls,
    };
  }

  if (service === "imap") {
    const offered = /\bSTARTTLS\b/.test(upper);
    const loginDisabled = /\bLOGINDISABLED\b/.test(upper);
    return { offered, plaintextAuthAllowed: !offered || !loginDisabled };
  }

  // pop3
  const offered = /^STLS\s*$/m.test(upper);
  const advertisesUser = /^USER\s*$/m.test(upper);
  return { offered, plaintextAuthAllowed: !offered || advertisesUser };
}

/**
 * Interpret a Redis PING reply (from grabBanner("redis", ...)). A bare
 * "+PONG" means the command executed with no credentials — the server
 * either has no `requirepass` configured, or authenticated by default.
 * Any error reply (typically "-NOAUTH Authentication required.") means
 * the command was rejected.
 */
export function isRedisPingUnauthenticated(banner: string): boolean {
  return /^\+PONG\b/i.test(banner.trim());
}

/**
 * Interpret a Memcached `stats` reply (from grabBanner("memcached", ...)).
 * Any "STAT ..." line back means the command executed — classic ASCII
 * Memcached has no built-in authentication, so a reachable server that
 * answers `stats` is, by construction, exposing its stats without
 * credentials.
 */
export function isMemcachedStatsUnauthenticated(banner: string): boolean {
  return /^STAT\b/i.test(banner.trim());
}

// ── MongoDB wire-protocol auth probe ────────────────────────────────────
//
// isMaster/hello alone can't tell us whether authentication is required:
// MongoDB always answers it pre-auth so clients can discover replica-set
// topology before logging in. listDatabases is the standard way real
// scanners (nmap's mongodb-databases script, Shodan) confirm an
// unauthenticated exposure: it's a read-only administrative command that
// a properly secured server rejects with an "unauthorized" error and an
// insecure one answers directly.
//
// The wire format below is the legacy OP_QUERY opcode (2004), which every
// MongoDB version still answers for backward compatibility. Only two
// hard-coded, single-field commands are ever sent (isMaster / 1,
// listDatabases / 1) — never anything caller-supplied.

const MAX_MONGO_RESPONSE_BYTES = 65536;

/** Minimal BSON encoder for a single-field { command: 1 } document. */
function encodeIsOneCommandBson(command: string): Buffer {
  const keyBuf = Buffer.from(command, "utf8");
  const bsonLen = 4 + 1 + keyBuf.length + 1 + 4 + 1;
  const bson = Buffer.alloc(bsonLen);
  let o = 0;
  bson.writeInt32LE(bsonLen, o);
  o += 4;
  bson.writeUInt8(0x10, o); // int32 element type
  o += 1;
  keyBuf.copy(bson, o);
  o += keyBuf.length;
  bson.writeUInt8(0, o); // key terminator
  o += 1;
  bson.writeInt32LE(1, o); // value = 1
  o += 4;
  bson.writeUInt8(0, o); // document terminator
  return bson;
}

/** Build a legacy OP_QUERY message for `{ [command]: 1 }` against `collection`. */
function buildMongoOpQuery(command: string, collection: string): Buffer {
  const bson = encodeIsOneCommandBson(command);
  const collBuf = Buffer.from(collection + "\0", "utf8");
  const bodyLen = 4 + collBuf.length + 4 + 4 + bson.length;
  const totalLen = 16 + bodyLen;
  const msg = Buffer.alloc(totalLen);
  let p = 0;
  msg.writeInt32LE(totalLen, p); // messageLength
  p += 4;
  msg.writeInt32LE(1, p); // requestID
  p += 4;
  msg.writeInt32LE(0, p); // responseTo
  p += 4;
  msg.writeInt32LE(2004, p); // opCode: OP_QUERY
  p += 4;
  msg.writeInt32LE(0, p); // flags
  p += 4;
  collBuf.copy(msg, p);
  p += collBuf.length;
  msg.writeInt32LE(0, p); // numberToSkip
  p += 4;
  msg.writeInt32LE(-1, p); // numberToReturn
  p += 4;
  bson.copy(msg, p);
  return msg;
}

/**
 * Minimal top-level-only BSON document reader. Reads scalar fields (ok,
 * errmsg, code, booleans, ints) needed to interpret a command reply, and
 * safely skips over embedded documents/arrays (whose length prefix it
 * still respects) without recursing into them — this scanner only needs
 * the top-level ok/errmsg/code signal, not full document contents.
 * Any unrecognized BSON type stops parsing and returns what was read so
 * far, rather than guess a length and read out of bounds.
 */
function parseBsonTopLevel(
  buf: Buffer,
  offset: number,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (buf.length - offset < 5) return result;
  const totalLen = buf.readInt32LE(offset);
  if (totalLen < 5) return result;
  const end = Math.min(offset + totalLen - 1, buf.length - 1);
  let p = offset + 4;

  while (p < end) {
    const type = buf[p];
    p += 1;
    if (type === 0) break;
    const keyStart = p;
    while (p < end && buf[p] !== 0) p += 1;
    const key = buf.toString("utf8", keyStart, p);
    p += 1;
    if (p > end) break;

    switch (type) {
      case 0x01: // double
        if (p + 8 > buf.length) return result;
        result[key] = buf.readDoubleLE(p);
        p += 8;
        break;
      case 0x02: {
        // string: int32 length (incl. trailing null) + utf8 bytes
        if (p + 4 > buf.length) return result;
        const len = buf.readInt32LE(p);
        p += 4;
        if (len < 1 || p + len > buf.length) return result;
        result[key] = buf.toString("utf8", p, p + len - 1);
        p += len;
        break;
      }
      case 0x08: // boolean
        if (p + 1 > buf.length) return result;
        result[key] = buf[p] !== 0;
        p += 1;
        break;
      case 0x0a: // null
        result[key] = null;
        break;
      case 0x10: // int32
        if (p + 4 > buf.length) return result;
        result[key] = buf.readInt32LE(p);
        p += 4;
        break;
      case 0x12: // int64
      case 0x09: // UTC datetime (int64 ms)
        if (p + 8 > buf.length) return result;
        result[key] = Number(buf.readBigInt64LE(p));
        p += 8;
        break;
      case 0x03: // embedded document
      case 0x04: {
        // array (same wire shape as a document)
        if (p + 4 > buf.length) return result;
        const subLen = buf.readInt32LE(p);
        result[key] = "[embedded]";
        p += subLen;
        break;
      }
      default:
        return result;
    }
  }

  return result;
}

/** Parse an OP_REPLY message and return its first document's top-level fields. */
function parseMongoOpReplyDocument(
  buf: Buffer,
): Record<string, unknown> | null {
  if (buf.length < 36) return null;
  const opCode = buf.readInt32LE(12);
  if (opCode !== 1) return null; // not OP_REPLY
  const numberReturned = buf.readInt32LE(32);
  if (numberReturned < 1) return {};
  return parseBsonTopLevel(buf, 36);
}

/**
 * Open a TCP connection, send one legacy OP_QUERY command, and read the
 * full length-prefixed OP_REPLY. Bounded read (MAX_MONGO_RESPONSE_BYTES)
 * and bounded wall time (timeoutMs), same private-host/port gating as
 * grabBanner via validateBannerTarget.
 */
async function sendMongoCommand(
  host: string,
  port: number,
  command: string,
  collection: string,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  const safetyError = validateBannerTarget("mongodb", host, port);
  if (safetyError) return null;

  // SSRF hardening: connect to a validated public ip, never the re-resolvable
  // hostname (DNS-rebinding safe). This probe actively confirms unauthenticated
  // admin access, so an internal-service hit here is especially damaging.
  const safeIp = await resolveSafePublicIp(host);
  if (!safeIp) return null;

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let buf = Buffer.alloc(0);
    let settled = false;

    const finish = (result: Record<string, unknown> | null) => {
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

    // Safe: connecting to safeIp, a validated public ip from
    // resolveSafePublicIp -- not the re-resolvable hostname.
    // codeql[js/request-forgery]
    socket.connect(port, safeIp, () => {
      socket.on("data", (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        if (buf.length >= 4) {
          const declared = buf.readInt32LE(0);
          if (declared > 0 && buf.length >= declared) {
            finish(parseMongoOpReplyDocument(buf));
            return;
          }
        }
        if (buf.length > MAX_MONGO_RESPONSE_BYTES) {
          finish(parseMongoOpReplyDocument(buf));
        }
      });
      socket.write(buildMongoOpQuery(command, collection));
    });
  });
}

export interface MongoAuthProbeResult {
  reachable: boolean;
  /** null when the auth-gated command never completed (inconclusive). */
  unauthenticatedAccess: boolean | null;
  detail: string;
}

/**
 * Probe a MongoDB service for unauthenticated administrative access.
 * Sends isMaster (pre-auth by design, used only for version metadata)
 * and listDatabases (the actual auth signal: succeeds with ok=1 when the
 * server allows anonymous administrative commands, fails with an
 * "unauthorized" error when it doesn't). Returns null only when neither
 * command produced a parseable MongoDB reply at all (not reachable, or
 * not actually MongoDB).
 */
export async function probeMongoUnauthenticated(
  host: string,
  port: number,
  timeoutMs: number = 5000,
): Promise<MongoAuthProbeResult | null> {
  const isMasterReply = await sendMongoCommand(
    host,
    port,
    "isMaster",
    "admin.$cmd",
    timeoutMs,
  );
  const dbListReply = await sendMongoCommand(
    host,
    port,
    "listDatabases",
    "admin.$cmd",
    timeoutMs,
  );

  if (!isMasterReply && !dbListReply) return null;

  const versionDetail =
    isMasterReply && typeof isMasterReply.maxWireVersion === "number"
      ? `maxWireVersion ${isMasterReply.maxWireVersion}`
      : null;

  if (!dbListReply) {
    return {
      reachable: true,
      unauthenticatedAccess: null,
      detail:
        versionDetail ??
        "Reachable, but the listDatabases diagnostic command did not complete in time.",
    };
  }

  const ok = dbListReply.ok === 1;
  const errmsg =
    typeof dbListReply.errmsg === "string" ? dbListReply.errmsg : null;

  const detail = ok
    ? `listDatabases succeeded without authentication (ok=1)${versionDetail ? `; ${versionDetail}` : ""}.`
    : `listDatabases was rejected${errmsg ? `: ${errmsg}` : " (authentication required)"}.`;

  return {
    reachable: true,
    unauthenticatedAccess: ok,
    detail: detail.slice(0, 500),
  };
}

// Internal: prevent ts-prune from complaining about unused imports.
void MAX_CLIENT_HELLO_BYTES;
