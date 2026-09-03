// ════════════════════════════════════════════════════════════════════════════
// CURATED PORT / SERVICE SWEEP
//
// An opt-in, ownership-gated TCP-connect sweep across a curated set of
// well-known service ports (COMMON_PORTS below). For each open port the scan
// records the port, the service usually found there, and any banner the
// service volunteered on connect. Nessus/Qualys/Intruder do a port + service
// sweep as a matter of course; this is VulnRadar's equivalent.
//
// ── Why this is gated the way it is ─────────────────────────────────────────
// Port-scanning arbitrary hosts from a shared server turns that server into a
// scan source, which is abuse. So this only ever runs when:
//   1. the caller opted in (a scan-form toggle, off by default), AND
//   2. the caller has proven ownership of the target domain -- the SAME
//      verified-domain gate the active probes use (isUrlOwnedByUser, enforced
//      in app/api/v3/scan/route.ts and .../scan/crawl/route.ts). An unverified
//      domain gets the same 403 (DOMAIN_NOT_VERIFIED) active probing returns.
//
// ── Safety inside scanPorts (defence in depth) ──────────────────────────────
// Even for an owned domain, scanPorts refuses to touch anything internal:
//   - the hostname is rejected outright if isPrivateHostname flags it
//     (localhost, *.local/*.internal/*.lan, or a private IP literal),
//   - the hostname is resolved and EVERY resolved address is checked with
//     isPrivateIP -- if any is private/loopback/link-local/metadata, the whole
//     sweep is abandoned (so a domain that resolves to 127.0.0.1 or
//     169.254.169.254 can never be scanned),
//   - the sockets connect to the validated resolved IP directly, not by
//     re-resolving the hostname, which closes the DNS-rebinding window between
//     the check and the connect.
// This reuses lib/scanner/safe-fetch's isPrivateHostname / isPrivateIP, the
// same primitives the banner grab and validateScanTarget are built on.
//
// ── Bounds (never a full 65535 sweep) ───────────────────────────────────────
// A full sweep is slow, noisy, and abuse-heavy from a shared host. This scans
// a curated ~130-port set with hard bounds: capped concurrency, a short
// per-port connect timeout, and an overall wall-clock deadline. It is
// best-effort and never throws -- a failure or timeout just yields fewer (or
// no) open ports, never a failed scan. A larger/configurable range is a
// possible follow-up, deliberately not built here.
// ════════════════════════════════════════════════════════════════════════════

import * as net from "node:net";
import { lookup } from "node:dns/promises";
import { CONFIG_PORT_SCAN_CACHE_TTL_MS } from "@/lib/config/config-values";
import { isPrivateHostname, isPrivateIP } from "./safe-fetch";
import { generateId } from "./_helpers";
import type { Vulnerability } from "./types";

/** One open port found by the sweep. `state` is always "open" -- closed and
 *  filtered ports are simply omitted, never listed. `banner` is present only
 *  when the service sent bytes on connect (SSH/FTP/SMTP/etc. do; a bare HTTP
 *  server does not). */
export interface OpenPort {
  port: number;
  /** The service usually found on this port (from COMMON_PORTS). */
  service: string;
  state: "open";
  /** First bytes the service volunteered on connect, truncated. */
  banner?: string;
}

/** One curated port that was probed and came back closed/filtered (a
 *  definitive "no answer"), rendered in the panel's collapsed "closed" section
 *  the same way subdomain discovery lists unreachable hosts. Ports that were
 *  never reached before the sweep's deadline are simply omitted, so
 *  `open.length + closed.length` can be less than `portsScanned`. */
export interface ClosedPort {
  port: number;
  /** The service usually found on this port (from COMMON_PORTS). */
  service: string;
}

/** Structured result of a sweep, stored in result_meta.portScan and rendered
 *  by the "Open ports" panel. `open` may be empty (checked, nothing open),
 *  which is itself a useful, definitive result. */
export interface PortScanResult {
  /** The hostname that was swept, lowercased. */
  host: string;
  /** ISO-8601 timestamp of when the sweep ran. */
  scannedAt: string;
  /** How many curated ports were probed (the size of COMMON_PORTS). */
  portsScanned: number;
  /** Open ports, ascending by port number. */
  open: OpenPort[];
  /** Ports that answered "closed/filtered" (definitively not open), ascending
   *  by port number. Optional so a scan persisted before this field existed
   *  reads back without it and the panel just omits the closed section. */
  closed?: ClosedPort[];
}

// ── Curated common-ports table ──────────────────────────────────────────────
// Roughly the top well-known service ports across web, mail, file transfer,
// remote access, databases, RPC, directory, message queues, and
// infrastructure/orchestration. Ordered by port for readability; the sweep
// order does not matter. Deliberately NOT the full 1-65535 range -- see the
// header comment.
const COMMON_PORTS: ReadonlyMap<number, string> = new Map<number, string>([
  [20, "FTP data"],
  [21, "FTP"],
  [22, "SSH"],
  [23, "Telnet"],
  [25, "SMTP"],
  [37, "Time"],
  [53, "DNS"],
  [69, "TFTP"],
  [79, "Finger"],
  [80, "HTTP"],
  [88, "Kerberos"],
  [110, "POP3"],
  [111, "rpcbind"],
  [113, "ident"],
  [119, "NNTP"],
  [123, "NTP"],
  [135, "MSRPC"],
  [137, "NetBIOS name"],
  [138, "NetBIOS datagram"],
  [139, "NetBIOS session"],
  [143, "IMAP"],
  [161, "SNMP"],
  [162, "SNMP trap"],
  [179, "BGP"],
  [389, "LDAP"],
  [443, "HTTPS"],
  [445, "SMB"],
  [465, "SMTPS"],
  [500, "IKE/IPsec"],
  [512, "rexec"],
  [513, "rlogin"],
  [514, "rsh/syslog"],
  [515, "LPD printer"],
  [520, "RIP"],
  [523, "IBM DB2"],
  [548, "AFP"],
  [554, "RTSP"],
  [587, "SMTP submission"],
  [593, "MSRPC HTTP"],
  [623, "IPMI"],
  [631, "IPP/CUPS"],
  [636, "LDAPS"],
  [873, "rsync"],
  [989, "FTPS data"],
  [990, "FTPS"],
  [993, "IMAPS"],
  [995, "POP3S"],
  [1080, "SOCKS proxy"],
  [1194, "OpenVPN"],
  [1352, "Lotus Notes"],
  [1433, "MSSQL"],
  [1434, "MSSQL monitor"],
  [1521, "Oracle DB"],
  [1723, "PPTP"],
  [1883, "MQTT"],
  [2049, "NFS"],
  [2082, "cPanel"],
  [2083, "cPanel SSL"],
  [2181, "ZooKeeper"],
  [2375, "Docker API"],
  [2376, "Docker API TLS"],
  [2377, "Docker Swarm"],
  [2379, "etcd client"],
  [2380, "etcd peer"],
  [2483, "Oracle DB"],
  [2484, "Oracle DB SSL"],
  [2525, "SMTP alt"],
  [3000, "Dev/Grafana"],
  [3128, "Squid proxy"],
  [3260, "iSCSI"],
  [3306, "MySQL"],
  [3389, "RDP"],
  [3690, "Subversion"],
  [4040, "dev server"],
  [4200, "Angular dev"],
  [4222, "NATS"],
  [4443, "HTTPS alt"],
  [4444, "alt/metasploit"],
  [4786, "Cisco Smart Install"],
  [5000, "dev/UPnP"],
  [5001, "dev alt"],
  [5060, "SIP"],
  [5061, "SIP TLS"],
  [5173, "Vite dev"],
  [5222, "XMPP client"],
  [5432, "PostgreSQL"],
  [5433, "PostgreSQL alt"],
  [5601, "Kibana"],
  [5672, "AMQP/RabbitMQ"],
  [5900, "VNC"],
  [5901, "VNC :1"],
  [5902, "VNC :2"],
  [5984, "CouchDB"],
  [5985, "WinRM HTTP"],
  [5986, "WinRM HTTPS"],
  [6000, "X11"],
  [6001, "X11 :1"],
  [6379, "Redis"],
  [6380, "Redis alt"],
  [6443, "Kubernetes API"],
  [6543, "PgBouncer"],
  [6666, "IRC"],
  [6667, "IRC"],
  [7000, "Cassandra"],
  [7001, "Cassandra/WebLogic"],
  [7077, "Spark"],
  [7199, "Cassandra JMX"],
  [7473, "Neo4j HTTPS"],
  [7474, "Neo4j HTTP"],
  [7687, "Neo4j Bolt"],
  [8000, "HTTP alt"],
  [8008, "HTTP alt"],
  [8009, "AJP"],
  [8025, "SMTP dev/MailHog"],
  [8080, "HTTP proxy/alt"],
  [8081, "HTTP alt"],
  [8086, "InfluxDB"],
  [8088, "HTTP alt"],
  [8123, "ClickHouse HTTP"],
  [8161, "ActiveMQ console"],
  [8200, "Vault"],
  [8443, "HTTPS alt"],
  [8500, "Consul"],
  [8529, "ArangoDB"],
  [8686, "JMX"],
  [8880, "HTTP alt"],
  [8888, "HTTP alt/Jupyter"],
  [9000, "PHP-FPM/Portainer"],
  [9042, "Cassandra CQL"],
  [9090, "Prometheus"],
  [9092, "Kafka"],
  [9200, "Elasticsearch"],
  [9300, "Elasticsearch transport"],
  [9418, "Git"],
  [9443, "HTTPS alt"],
  [9600, "Logstash"],
  [10000, "Webmin"],
  [10250, "kubelet"],
  [11211, "Memcached"],
  [15672, "RabbitMQ mgmt"],
  [27017, "MongoDB"],
  [27018, "MongoDB shard"],
  [27019, "MongoDB config"],
  [50000, "Jenkins agent/DB2"],
  [61616, "ActiveMQ"],
]);

/**
 * How many ports one sweep probes. Exported so a doc page can state the real
 * number instead of restating a literal: /docs used to advertise "6 service
 * probes" from a per-service `probes` array that was removed when the sweep
 * was consolidated behind the single `portScan` boolean.
 */
export const COMMON_PORT_COUNT = COMMON_PORTS.size;

// Bounds. Worst case (all curated ports filtered/silent) is
// ceil(ports/concurrency) waves * connectTimeoutMs, kept comfortably under
// overallDeadlineMs. The whole sweep runs concurrently with the rest of the
// scan and is awaited (bounded) before result_meta is assembled.
//
// All five are admin-editable (PORT_SCAN_* in the registry's Scanning group)
// and resolved once per sweep, then threaded down into probePort rather than
// read as module constants: 1500 ms is aggressive for a distant target, and 24
// simultaneous connects is what an IDS flags as a sweep, so a self-hoster
// scanning their own estate through a firewall they do not control needs to be
// able to slow it down without editing this file (AUDIT-014#magic-12).
interface PortScanTuning {
  concurrency: number;
  connectTimeoutMs: number;
  bannerReadWindowMs: number;
  overallDeadlineMs: number;
  maxBannerBytes: number;
}

async function resolvePortScanTuning(): Promise<PortScanTuning> {
  // Imported lazily, not at the top of the file, and deliberately so. The
  // settings resolver opens the Postgres pool at module load, and this module
  // also exports resolveSafePublicIp, the internal-range guard that
  // lib/scanner/protocols/banner.ts (and anything else doing a raw socket
  // connect) depends on. A static import here would make every one of those
  // callers drag a database connection into their module graph just to reuse
  // an SSRF check that does no I/O of its own. The dynamic import is resolved
  // once and cached by the module system, so the sweep pays nothing per call.
  const { getSettings } = await import("@/lib/config/runtime-config");
  const s = await getSettings([
    "PORT_SCAN_CONCURRENCY",
    "PORT_SCAN_CONNECT_TIMEOUT_MS",
    "PORT_SCAN_BANNER_READ_WINDOW_MS",
    "PORT_SCAN_OVERALL_DEADLINE_MS",
    "PORT_SCAN_MAX_BANNER_BYTES",
  ] as const);
  return {
    concurrency: Number(s.PORT_SCAN_CONCURRENCY),
    connectTimeoutMs: Number(s.PORT_SCAN_CONNECT_TIMEOUT_MS),
    bannerReadWindowMs: Number(s.PORT_SCAN_BANNER_READ_WINDOW_MS),
    overallDeadlineMs: Number(s.PORT_SCAN_OVERALL_DEADLINE_MS),
    maxBannerBytes: Number(s.PORT_SCAN_MAX_BANNER_BYTES),
  };
}

/** Syntactic hostname guard, matching validateBannerTarget's first check:
 *  no control chars, no path, bounded length. */
function isSyntacticallyValidHost(host: string): boolean {
  return (
    !!host &&
    host.length <= 253 &&
    /^[a-z0-9.\-:[\]]+$/i.test(host) &&
    !host.includes("/")
  );
}

/**
 * Resolve `host` to a single validated PUBLIC IP to connect to, or null when
 * the target is unsafe or unresolvable. This is the internal-range gate: a
 * private hostname is refused outright, and a hostname that resolves to ANY
 * private/loopback/link-local/metadata address is abandoned entirely (not just
 * skipped for that one address), so an owned domain pointed at an internal IP
 * can never be swept. Connecting to the returned IP directly closes the DNS
 * rebinding window between this check and the connect.
 */
export async function resolveSafePublicIp(
  host: string,
): Promise<string | null> {
  if (!isSyntacticallyValidHost(host)) return null;
  if (isPrivateHostname(host)) return null;

  // IP literal: validated directly, no DNS.
  if (net.isIP(host) !== 0) {
    return isPrivateIP(host) ? null : host;
  }

  let addresses: Array<{ address: string }>; // dns.lookup all:true shape
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    return null;
  }
  if (addresses.length === 0) return null;
  // Fail closed: if ANY resolved address is internal, refuse the whole sweep.
  if (addresses.some((a) => isPrivateIP(a.address))) return null;
  return addresses[0].address;
}

/**
 * TCP-connect to one port on an already-validated public IP. Resolves an
 * OpenPort when the connection is accepted (optionally with a banner), the
 * literal "closed" when the port definitively refused or timed out, or null
 * when the sweep was aborted (deadline or cancellation) so the port's state is
 * indeterminate and it is counted as neither open nor closed. Purely passive:
 * it never writes a byte to the target, it only reads whatever the service
 * volunteers on connect. Never throws.
 */
function probePort(
  ip: string,
  port: number,
  service: string,
  signal: AbortSignal,
  tuning: PortScanTuning,
): Promise<OpenPort | "closed" | null> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(null);
      return;
    }

    const socket = new net.Socket();
    let settled = false;
    let banner = "";
    let bannerTimer: ReturnType<typeof setTimeout> | null = null;

    const onAbort = () => finish(false);

    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      if (bannerTimer) clearTimeout(bannerTimer);
      signal.removeEventListener("abort", onAbort);
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      if (!open) {
        // A definitive refusal/timeout means closed/filtered; an abort
        // (deadline or cancellation) leaves the state unknown, so report
        // null rather than mislabelling an unprobed port as closed.
        resolve(signal.aborted ? null : "closed");
        return;
      }
      const trimmed = banner.slice(0, tuning.maxBannerBytes).replace(/\0/g, "");
      resolve({
        port,
        service,
        state: "open",
        ...(trimmed.trim() ? { banner: trimmed } : {}),
      });
    };

    signal.addEventListener("abort", onAbort, { once: true });

    // Inactivity timeout covers the connect phase (a filtered port never
    // answers). Shorter than the deadline, so the sweep stays bounded even if
    // every port is silent.
    socket.setTimeout(tuning.connectTimeoutMs);
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));

    // Safe: `ip` came from resolveSafePublicIp, which rejected every private/
    // internal address, and we connect to that exact IP rather than
    // re-resolving the hostname.
    // codeql[js/request-forgery]
    socket.connect(port, ip, () => {
      // Connection accepted => the port is open regardless of whether a banner
      // follows. Give the service a brief window to speak first.
      bannerTimer = setTimeout(() => finish(true), tuning.bannerReadWindowMs);
      socket.on("data", (chunk: Buffer) => {
        banner += chunk.toString("utf8");
        if (banner.length >= tuning.maxBannerBytes) finish(true);
      });
    });
  });
}

/**
 * Sweep the curated COMMON_PORTS on `host`, best-effort and bounded. Returns
 * null when the target is unsafe/unresolvable (nothing was scanned), or a
 * PortScanResult (with a possibly-empty `open` list) when the sweep ran. Never
 * throws. `signal` cancels the sweep (a cancelled scan abandons it).
 *
 * The ownership gate that authorizes this at all lives in the scan routes; by
 * the time this runs the caller has proven domain ownership. The checks here
 * are the internal-range/SSRF defence in depth that apply even to an owned
 * domain (see resolveSafePublicIp).
 */
export async function scanPorts(
  host: string,
  signal: AbortSignal,
): Promise<PortScanResult | null> {
  const cleanHost = host.trim().toLowerCase();
  if (!cleanHost || signal.aborted) return null;

  const targetIp = await resolveSafePublicIp(cleanHost);
  if (!targetIp || signal.aborted) return null;

  // Resolved once for the whole sweep, not per port: every probe in one sweep
  // must agree on the bounds, and re-resolving 130 times would be pointless
  // churn against the settings cache.
  const tuning = await resolvePortScanTuning();

  // Hard overall deadline: an internal controller aborts every in-flight and
  // pending probe once the wall-clock budget is spent. Combined with the
  // caller's signal so a cancelled scan also stops the sweep at once.
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(
    () => deadlineController.abort(),
    tuning.overallDeadlineMs,
  );
  const relayAbort = () => deadlineController.abort();
  signal.addEventListener("abort", relayAbort, { once: true });
  const effectiveSignal = deadlineController.signal;

  const ports = [...COMMON_PORTS.keys()];
  const open: OpenPort[] = [];
  const closed: ClosedPort[] = [];
  let next = 0;

  const worker = async (): Promise<void> => {
    while (!effectiveSignal.aborted) {
      const i = next++;
      if (i >= ports.length) return;
      const port = ports[i];
      const service = COMMON_PORTS.get(port) ?? "unknown";
      const result = await probePort(
        targetIp,
        port,
        service,
        effectiveSignal,
        tuning,
      );
      if (result === "closed") {
        closed.push({ port, service });
      } else if (result) {
        open.push(result);
      }
    }
  };

  try {
    await Promise.all(
      Array.from({ length: Math.min(tuning.concurrency, ports.length) }, () =>
        worker(),
      ),
    );
  } catch {
    // Never propagate: best-effort. Return whatever was gathered so far.
  } finally {
    clearTimeout(deadlineTimer);
    signal.removeEventListener("abort", relayAbort);
  }

  open.sort((a, b) => a.port - b.port);
  closed.sort((a, b) => a.port - b.port);
  return {
    host: cleanHost,
    scannedAt: new Date().toISOString(),
    portsScanned: ports.length,
    open,
    closed,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// PER-HOST SIDE CHANNEL (short TTL)
//
// Mirrors lib/scanner/dns-records.ts's recordsStore. The owner-only port
// refresh route (app/api/v3/history/[id]/ports) checks this before re-running
// the sweep so repeat refreshes of the same host within the window reuse the
// last result instead of re-scanning -- a curated port sweep is far heavier
// than a DNS resolve, so this matters more here. Keyed by hostname; reads peek
// (don't delete) and entries are pruned by TTL on write, so the map can never
// grow unbounded.
// ════════════════════════════════════════════════════════════════════════════

const PORT_SCAN_TTL_MS = CONFIG_PORT_SCAN_CACHE_TTL_MS;
const portScanStore = new Map<string, { result: PortScanResult; at: number }>();

function prunePortScanStore(now: number): void {
  for (const [key, entry] of portScanStore) {
    if (now - entry.at > PORT_SCAN_TTL_MS) portScanStore.delete(key);
  }
}

/** Stash a freshly captured port sweep for `hostname`. */
export function recordPortScan(hostname: string, result: PortScanResult): void {
  const now = Date.now();
  prunePortScanStore(now);
  portScanStore.set(hostname.toLowerCase(), { result, at: now });
}

/** Read back the sweep recorded for `hostname`, or undefined if none/stale. */
export function readPortScan(hostname: string): PortScanResult | undefined {
  const entry = portScanStore.get(hostname.toLowerCase());
  if (!entry) return undefined;
  if (Date.now() - entry.at > PORT_SCAN_TTL_MS) {
    portScanStore.delete(hostname.toLowerCase());
    return undefined;
  }
  return entry.result;
}

// ── Findings for notably risky open ports ───────────────────────────────────
// The structured `open` list above is the primary output. On top of it we emit
// a small number of Vulnerability findings for open ports that are notably
// dangerous to expose to the public internet -- databases, remote-access
// services, and unauthenticated control planes -- in the standard finding
// shape (configuration category, deterministic id). This is
// deliberately narrow so a normal host never floods the results: a bare web
// host has 80/443 open, none of which are in this set.

interface RiskyPort {
  label: string;
  severity: Vulnerability["severity"];
  /** Why exposing this to the internet is dangerous. */
  risk: string;
}

const RISKY_PORTS: ReadonlyMap<number, RiskyPort> = new Map<number, RiskyPort>([
  [
    23,
    {
      label: "Telnet",
      severity: "high",
      risk: "Telnet transmits credentials and every keystroke in cleartext; anyone on the path can read the session.",
    },
  ],
  [
    3389,
    {
      label: "RDP",
      severity: "high",
      risk: "Remote Desktop exposed to the internet is a primary target for brute-force and pre-auth RCE campaigns (e.g. BlueKeep).",
    },
  ],
  [
    445,
    {
      label: "SMB",
      severity: "high",
      risk: "SMB on the public internet is a top ransomware and worm entry point (EternalBlue and successors).",
    },
  ],
  [
    139,
    {
      label: "NetBIOS",
      severity: "medium",
      risk: "NetBIOS session service leaks host and share information and is commonly paired with SMB attacks.",
    },
  ],
  [
    135,
    {
      label: "MSRPC",
      severity: "medium",
      risk: "The Windows RPC endpoint mapper exposes callable services and is a frequent lateral-movement vector.",
    },
  ],
  [
    5900,
    {
      label: "VNC",
      severity: "high",
      risk: "VNC often ships with weak or no authentication and hands an attacker the full desktop.",
    },
  ],
  [
    5901,
    {
      label: "VNC",
      severity: "high",
      risk: "VNC often ships with weak or no authentication and hands an attacker the full desktop.",
    },
  ],
  [
    3306,
    {
      label: "MySQL",
      severity: "high",
      risk: "A database directly reachable from the internet exposes every row to brute-force and known-CVE attacks.",
    },
  ],
  [
    5432,
    {
      label: "PostgreSQL",
      severity: "high",
      risk: "A database directly reachable from the internet exposes every row to brute-force and known-CVE attacks.",
    },
  ],
  [
    1433,
    {
      label: "MSSQL",
      severity: "high",
      risk: "A database directly reachable from the internet exposes every row to brute-force and known-CVE attacks.",
    },
  ],
  [
    1521,
    {
      label: "Oracle DB",
      severity: "high",
      risk: "A database directly reachable from the internet exposes every row to brute-force and known-CVE attacks.",
    },
  ],
  [
    6379,
    {
      label: "Redis",
      severity: "high",
      risk: "Redis has no authentication by default; an exposed instance is routinely used to read data or gain RCE.",
    },
  ],
  [
    27017,
    {
      label: "MongoDB",
      severity: "high",
      risk: "Unauthenticated MongoDB exposure is one of the most common causes of mass data leaks.",
    },
  ],
  [
    27018,
    {
      label: "MongoDB",
      severity: "high",
      risk: "Unauthenticated MongoDB exposure is one of the most common causes of mass data leaks.",
    },
  ],
  [
    9200,
    {
      label: "Elasticsearch",
      severity: "high",
      risk: "Elasticsearch has no authentication by default; an open cluster exposes every index.",
    },
  ],
  [
    11211,
    {
      label: "Memcached",
      severity: "medium",
      risk: "Memcached has no authentication and doubles as a UDP amplification vector for DDoS.",
    },
  ],
  [
    5984,
    {
      label: "CouchDB",
      severity: "high",
      risk: "An exposed CouchDB has been exploited for data theft and remote code execution via admin-party defaults.",
    },
  ],
  [
    2375,
    {
      label: "Docker API",
      severity: "high",
      risk: "The unauthenticated Docker API grants full control of the host: an attacker can start a privileged container and take over the machine.",
    },
  ],
  [
    10250,
    {
      label: "kubelet",
      severity: "high",
      risk: "An exposed kubelet API can allow command execution inside cluster workloads.",
    },
  ],
  [
    6443,
    {
      label: "Kubernetes API",
      severity: "medium",
      risk: "The Kubernetes API server should not be publicly reachable; it is a high-value target for cluster takeover.",
    },
  ],
  [
    2379,
    {
      label: "etcd",
      severity: "high",
      risk: "etcd stores the entire cluster state (including secrets); an exposed instance leaks and lets an attacker rewrite it.",
    },
  ],
  [
    161,
    {
      label: "SNMP",
      severity: "medium",
      risk: "SNMP with default community strings leaks detailed device and network information.",
    },
  ],
  [
    623,
    {
      label: "IPMI",
      severity: "high",
      risk: "IPMI/BMC interfaces have well-known authentication bypasses granting out-of-band control of the server.",
    },
  ],
  [
    512,
    {
      label: "rexec",
      severity: "high",
      risk: "The r-services transmit credentials in cleartext and trust host-based auth that is trivial to spoof.",
    },
  ],
  [
    513,
    {
      label: "rlogin",
      severity: "high",
      risk: "The r-services transmit credentials in cleartext and trust host-based auth that is trivial to spoof.",
    },
  ],
]);

/**
 * Build one finding per open port that is notably risky to expose (see
 * RISKY_PORTS). Uses the standard configuration-category, deterministic-id
 * finding shape. Returns an empty array when no risky port is
 * open, which is the common case for a normal web host.
 */
export function buildRiskyPortFindings(
  host: string,
  normalizedUrl: string,
  open: readonly OpenPort[],
): Vulnerability[] {
  const findings: Vulnerability[] = [];
  for (const entry of open) {
    const risky = RISKY_PORTS.get(entry.port);
    if (!risky) continue;
    findings.push({
      id: generateId(`open-port-${entry.port}`, normalizedUrl),
      title: `${risky.label} exposed on port ${entry.port}`,
      description: `A ${risky.label} service on ${host} is reachable on port ${entry.port} from the public internet.`,
      severity: risky.severity,
      category: "configuration",
      evidence: entry.banner
        ? `${host}:${entry.port} open. Banner: ${entry.banner.slice(0, 200)}`
        : `${host}:${entry.port} accepted a TCP connection.`,
      riskImpact: risky.risk,
      explanation: `The curated port sweep opened a TCP connection to ${host}:${entry.port}, which typically runs ${risky.label}. Confirm the service requires authentication and restrict it to trusted networks.`,
      fixSteps: [
        "Firewall the port so only known IP ranges can reach it, or bind the service to a private interface.",
        "Require strong authentication and, where the protocol supports it, TLS.",
        "If the service does not need to be internet-facing, close the port entirely.",
      ],
      codeExamples: [],
    });
  }
  return findings;
}
