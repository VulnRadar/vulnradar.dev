/**
 * Single-URL scan execution: the background job body for POST
 * /api/v3/scan.
 *
 * Split out of app/api/v3/scan/route.ts because a Next.js route file may
 * only export the handful of names Next recognizes (GET, POST, etc.) —
 * anything else fails the route's generated type check. Living here also
 * means the tests exercise the exact function the route dispatches
 * fire-and-forget, instead of racing a detached promise.
 */

import { runSyncChecks } from "./engine";
import { runAsyncChecksDetailed, type AsyncCheckResult } from "./async-checks";
import {
  createProgressTracker,
  startWatchdog,
  finalizeScanSuccess,
  finalizeScanFailure,
  markScanRunning,
  ScanCancelledError,
} from "./scan-jobs";
import pool from "@/lib/database/db";
import type { Category, Severity, Vulnerability } from "./types";
import { APP_NAME, SEVERITY_LEVELS } from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import { getProtocolFromUrl, getProtocolFindings } from "./protocols";
import { runWebSocketChecks } from "./protocols/websocket";
import { runFtpChecks } from "./protocols/ftp";
import {
  grabBanner,
  grabCapabilityBanner,
  bannerVersion,
  assessSshBanner,
  detectStartTls,
  isRedisPingUnauthenticated,
  isMemcachedStatsUnauthenticated,
  probeMongoUnauthenticated,
  validateBannerTarget,
  type MongoAuthProbeResult,
  type BannerResult,
} from "./protocols/banner";
import { safeFetch } from "./safe-fetch";
import { redactSensitiveResponseHeaders } from "./response-headers";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import { scanCompleteEmail, criticalFindingsEmail } from "@/lib/email/email";
import { getDangerScore, getEngineConfidence } from "./safety-rating";
import { generateId } from "./_helpers";
import { enrichFindingsWithExploitIntel } from "./cve-enrichment";
import { deliverWebhook } from "@/lib/webhooks/delivery";
import { checkForNewCriticalOrHighFindings } from "./regression-alert";

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const MAX_BODY_SIZE = 1 * 1024 * 1024; // 1 MB max response body

export const SUPPORTED_PROTOCOLS = [
  "http:",
  "https:",
  "ws:",
  "wss:",
  "ftp:",
  "ftps:",
  "ssh:",
  "sftp:",
  "smtp:",
  "smtps:",
  "imap:",
  "imaps:",
  "pop3:",
  "pop3s:",
  "mongodb:",
];

export const SERVICE_PROBE_PORTS: Record<string, number> = {
  ssh: 22,
  sftp: 22,
  smtp: 587,
  smtps: 465,
  imap: 143,
  imaps: 993,
  pop3: 110,
  pop3s: 995,
  ftp: 21,
  ftps: 990,
  mongodb: 27017,
  redis: 6379,
  elasticsearch: 9200,
  memcached: 11211,
};

export const VALID_SERVICE_PROBES = new Set(Object.keys(SERVICE_PROBE_PORTS));

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (/^[a-z]+:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function isRawIpv4(input: string): boolean {
  return /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)(?::\d+)?(?:\/.*)?$/.test(
    input.trim(),
  );
}

export function isValidUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return SUPPORTED_PROTOCOLS.includes(url.protocol);
  } catch {
    return false;
  }
}

export type ProtocolType =
  | "http"
  | "websocket"
  | "ftp"
  | "ssh"
  | "smtp"
  | "imap"
  | "pop3"
  | "mongodb"
  | "other";

export function getProtocolType(url: string): ProtocolType {
  const protocol = getProtocolFromUrl(url);
  if (protocol === "ws" || protocol === "wss") return "websocket";
  if (protocol === "ftp" || protocol === "ftps") return "ftp";
  if (protocol === "ssh" || protocol === "sftp") return "ssh";
  if (protocol === "smtp" || protocol === "smtps") return "smtp";
  if (protocol === "imap" || protocol === "imaps") return "imap";
  if (protocol === "pop3" || protocol === "pop3s") return "pop3";
  if (protocol === "mongodb") return "mongodb";
  if (protocol === "https" || protocol === "http") return "http";
  return "other";
}

/**
 * Safely read response body with a size limit and a hard timeout.
 *
 * safeFetch clears its internal abort controller as soon as headers arrive,
 * leaving body reads unprotected. A server that sends headers immediately but
 * streams the body forever (or never closes it) would otherwise hang the route
 * handler indefinitely. The timeout calls reader.cancel(), which causes the
 * pending reader.read() to reject with an AbortError caught below.
 */
async function safeReadBody(
  response: Response,
  maxBytes: number,
  timeoutMs = 10_000,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder("utf-8", { fatal: false });
  const chunks: string[] = [];
  let totalBytes = 0;

  const cancelTimer = setTimeout(() => {
    reader.cancel().catch(() => {});
  }, timeoutMs);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        // Decode the partial chunk up to the limit
        const overshoot = totalBytes - maxBytes;
        const trimmed = value.slice(0, value.byteLength - overshoot);
        if (trimmed.byteLength > 0) {
          chunks.push(decoder.decode(trimmed, { stream: false }));
        }
        break;
      }

      chunks.push(decoder.decode(value, { stream: true }));
    }
  } catch {
    // Stream error or reader.cancel() from the timeout: return what we have
  } finally {
    clearTimeout(cancelTimer);
    try {
      reader.cancel();
    } catch {
      /* ignore */
    }
  }

  return chunks.join("");
}

/**
 * Shared "banner discloses version" finding, used for both the direct
 * ssh://smtp://etc. scan branch and the opt-in service-probe loop below.
 * `idPrefix`/`title` are passed in so each call site keeps the exact
 * finding ID it already produced before this was factored out — IDs are
 * derived deterministically from checkId + URL (see generateId), so
 * changing the prefix would change the ID for an existing finding type
 * and break diffing between a user's older and newer scans of the same
 * target.
 */
function buildVersionDisclosureFinding(
  idPrefix: string,
  title: string,
  banner: BannerResult,
  normalizedUrl: string,
): Vulnerability | null {
  const version = bannerVersion(banner.banner);
  if (!version) return null;
  return {
    id: generateId(idPrefix, normalizedUrl),
    title,
    description: "Banner reveals software version to anyone who connects.",
    severity: "info",
    category: "configuration",
    evidence: banner.banner.slice(0, 256),
    riskImpact:
      "Version disclosure helps attackers match known CVEs to your service.",
    explanation:
      "Most daemons emit a version string on connect. Suppress with `DebianBanner no`, `Banner /etc/issue.net`, or the equivalent directive for your software.",
    fixSteps: [
      "Set the server banner to a generic string.",
      "Restrict the service to authenticated internal users where possible.",
    ],
    codeExamples: [],
  };
}

/**
 * SSH-specific findings built from the raw identification banner: protocol-1
 * support (deprecated) and a coarse, best-effort match against known
 * OpenSSH CVE ranges. See assessSshBanner's docstring for why the
 * version-range match is a lead to verify, not a confirmed vulnerability.
 */
function buildSshFindings(
  banner: BannerResult,
  normalizedUrl: string,
  targetLabel: string,
): Vulnerability[] {
  const findings: Vulnerability[] = [];
  const assessment = assessSshBanner(banner.banner);

  if (assessment.supportsProtocol1) {
    findings.push({
      id: generateId(`ssh-protocol1-${targetLabel}`, normalizedUrl),
      title: "SSH Protocol 1 Supported",
      description: `The SSH server on ${targetLabel} advertises support for the deprecated SSH protocol 1.`,
      severity: "high",
      category: "configuration",
      evidence: banner.banner.slice(0, 256),
      riskImpact:
        "SSH-1 has known cryptographic weaknesses (e.g. CRC32 attacks, weak MACs) and is unmaintained.",
      explanation:
        'The banner\'s protocol-version field starts with "1.", meaning the server will negotiate SSH-1 with clients that request it.',
      fixSteps: [
        "Disable SSH protocol 1 support (e.g. `Protocol 2` in sshd_config).",
        "Restart sshd and re-scan to confirm.",
      ],
      codeExamples: [],
    });
  }

  if (assessment.knownVulnerable && assessment.vulnNote) {
    findings.push({
      id: generateId(`ssh-known-vulnerable-${targetLabel}`, normalizedUrl),
      title: "SSH Banner Matches a Known-Vulnerable Version Range",
      description: assessment.vulnNote,
      severity: "medium",
      category: "configuration",
      evidence: banner.banner.slice(0, 256),
      riskImpact:
        "Older OpenSSH releases carry publicly documented CVEs, some remotely exploitable.",
      explanation:
        "Inferred from the version string in the SSH banner alone. Distributions like Debian and Ubuntu backport security fixes without changing the reported version, so treat this as a lead to verify, not a confirmed vulnerability.",
      fixSteps: [
        "Confirm the actual patch level with your package manager (e.g. `apt changelog openssh-server`).",
        "Upgrade OpenSSH if it is genuinely out of date.",
      ],
      codeExamples: [],
    });
  }

  return findings;
}

/**
 * STARTTLS findings for plaintext SMTP/IMAP/POP3. Only meaningful for the
 * plaintext port — smtps/imaps/pop3s are already encrypted from connect,
 * so callers should not run this against those.
 */
function buildStartTlsFindings(
  service: "smtp" | "imap" | "pop3",
  banner: BannerResult,
  normalizedUrl: string,
  targetLabel: string,
): Vulnerability[] {
  const assessment = detectStartTls(service, banner.banner);
  const label = service.toUpperCase();

  if (!assessment.offered) {
    return [
      {
        id: generateId(`${service}-no-starttls-${targetLabel}`, normalizedUrl),
        title: `${label} Does Not Offer STARTTLS`,
        description: `The ${label} server on ${targetLabel} did not advertise STARTTLS in its capability response.`,
        severity: "high",
        category: "configuration",
        evidence: banner.banner.slice(0, 256),
        riskImpact:
          "Without STARTTLS there is no path to encrypt the session; any authentication attempted over this connection travels in plaintext.",
        explanation:
          "STARTTLS lets a plaintext-port connection upgrade to TLS mid-session. Its absence from the capability list means the server never offers that upgrade.",
        fixSteps: [
          `Enable STARTTLS support for ${label}.`,
          `Alternatively, require the encrypted variant (${service}s) and disable the plaintext port.`,
        ],
        codeExamples: [],
      },
    ];
  }

  if (assessment.plaintextAuthAllowed) {
    return [
      {
        id: generateId(
          `${service}-plaintext-auth-allowed-${targetLabel}`,
          normalizedUrl,
        ),
        title: `${label} May Allow Authentication Before STARTTLS`,
        description:
          "STARTTLS is offered, but the capability response suggests the server does not require it before authentication.",
        severity: "medium",
        category: "configuration",
        evidence: banner.banner.slice(0, 256),
        riskImpact:
          "A client (or an attacker downgrading the connection) can authenticate before encryption is negotiated, exposing credentials.",
        explanation:
          service === "imap"
            ? "IMAP servers hardened against this advertise LOGINDISABLED until STARTTLS completes; that flag is absent here."
            : service === "pop3"
              ? "The CAPA response lists USER, meaning plaintext USER/PASS login is accepted regardless of STLS."
              : "The EHLO response lists AUTH mechanisms before STARTTLS has been negotiated.",
        fixSteps: [
          "Require STARTTLS before allowing authentication (disable plaintext AUTH/LOGIN/USER until TLS is active).",
        ],
        codeExamples: [],
      },
    ];
  }

  return [];
}

/** Shared shape for the "found valid credentials aren't required" family
 *  of findings (MongoDB, Redis, Elasticsearch, Memcached). */
function buildUnauthenticatedAccessFinding(params: {
  idPrefix: string;
  serviceLabel: string;
  targetLabel: string;
  normalizedUrl: string;
  description: string;
  evidence: string;
  riskImpact: string;
  explanation: string;
  fixSteps: string[];
}): Vulnerability {
  return {
    id: generateId(params.idPrefix, params.normalizedUrl),
    title: `${params.serviceLabel} Allows Unauthenticated Access`,
    description: params.description,
    severity: "critical",
    category: "configuration",
    evidence: params.evidence.slice(0, 500),
    riskImpact: params.riskImpact,
    explanation: params.explanation,
    fixSteps: params.fixSteps,
    codeExamples: [],
  };
}

function buildAuthRequiredFinding(params: {
  idPrefix: string;
  serviceLabel: string;
  targetLabel: string;
  normalizedUrl: string;
  evidence: string;
}): Vulnerability {
  return {
    id: generateId(params.idPrefix, params.normalizedUrl),
    title: `${params.serviceLabel} Requires Authentication`,
    description: `The ${params.serviceLabel} service on ${params.targetLabel} rejected an unauthenticated request.`,
    severity: "info",
    category: "configuration",
    evidence: params.evidence.slice(0, 500),
    riskImpact: "None — this is the expected, secure configuration.",
    explanation: `${params.serviceLabel} responded, but declined to run the diagnostic command without credentials.`,
    fixSteps: [],
    codeExamples: [],
  };
}

function buildMongoAuthFindings(
  result: MongoAuthProbeResult,
  normalizedUrl: string,
  targetLabel: string,
): Vulnerability[] {
  if (result.unauthenticatedAccess === true) {
    return [
      buildUnauthenticatedAccessFinding({
        idPrefix: `mongodb-unauthenticated-${targetLabel}`,
        serviceLabel: "MongoDB",
        targetLabel,
        normalizedUrl,
        description: `The MongoDB service on ${targetLabel} accepted an administrative command (listDatabases) with no credentials.`,
        evidence: result.detail,
        riskImpact:
          "Anyone who can reach this port can read, and in most default configurations write or delete, every database on the server.",
        explanation:
          "MongoDB ships with authentication disabled by default. Without `security.authorization: enabled` and a bound user, any client that can open a TCP connection has full administrative access.",
        fixSteps: [
          "Enable authentication (`security.authorization: enabled` in mongod.conf).",
          "Create a dedicated user with least-privilege roles.",
          "Bind to a private interface or firewall the port from the public internet.",
        ],
      }),
    ];
  }
  if (result.unauthenticatedAccess === false) {
    return [
      buildAuthRequiredFinding({
        idPrefix: `mongodb-auth-required-${targetLabel}`,
        serviceLabel: "MongoDB",
        targetLabel,
        normalizedUrl,
        evidence: result.detail,
      }),
    ];
  }
  return [];
}

export interface ElasticsearchProbeResult {
  reachable: boolean;
  unauthenticatedAccess: boolean;
  detail: string;
}

/**
 * Elasticsearch's root endpoint (`GET /`) returns cluster metadata
 * (cluster_name, version, the "You Know, for Search" tagline) with no
 * authentication whenever security features aren't enabled — the
 * long-standing default. A 401/403 means auth is required; anything else
 * (connection refused, non-JSON body) is treated as inconclusive.
 * Reuses safeFetch/safeReadBody (already imported for the main HTTP scan
 * path) rather than a raw socket, since this is a plain HTTP request; and
 * validateBannerTarget for the same private-host/well-known-port gating
 * every other probe in this file goes through.
 */
async function probeElasticsearchUnauthenticated(
  hostname: string,
  port: number,
): Promise<ElasticsearchProbeResult | null> {
  const safetyError = validateBannerTarget("elasticsearch", hostname, port);
  if (safetyError) return null;

  const url = hostname.includes(":")
    ? `http://[${hostname}]:${port}/`
    : `http://${hostname}:${port}/`;

  try {
    const res = await safeFetch(url, {
      method: "GET",
      headers: { "User-Agent": `${APP_NAME}/1.0 (Security Scanner)` },
      signal: AbortSignal.timeout(5000),
    });
    const body = await safeReadBody(res, 8192, 5000);
    const unauthenticatedAccess =
      res.status === 200 && /"cluster_name"|"tagline"/.test(body);
    return {
      reachable: true,
      unauthenticatedAccess,
      detail: unauthenticatedAccess
        ? `GET / returned HTTP ${res.status} with cluster info exposed, no authentication required.`
        : `GET / returned HTTP ${res.status}${
            res.status === 401 || res.status === 403
              ? " (authentication required)"
              : ""
          }.`,
    };
  } catch {
    return null;
  }
}

export interface ExecuteScanParams {
  scanId: number;
  url: string;
  normalizedUrl: string;
  protocolType: ProtocolType;
  isRawIpTarget: boolean;
  selectedScanners: string[] | null;
  requestedProbes: Array<{ service: string; port: number }>;
  authedUserId: number;
  categoriesTotal: number;
  /**
   * Skip the routine "scan complete" email even though the critical/high
   * findings alert still fires normally. Set by the scheduled-scans worker
   * (lib/scanner/scheduled-scans-worker.ts): a manual scan is a one-off
   * action a user just took and expects confirmation of, but an hourly or
   * 6-hourly *automatic* schedule sending the same "nothing changed" email
   * every run would spam the inbox for no signal. The critical/high alert
   * (already gated by the user's own email_regression_alert preference)
   * is the "only notify me when something's actually wrong" path this
   * flag preserves -- see the notification-noise reasoning in that
   * module's docstring. Defaults to false so every existing caller
   * (app/api/v3/scan/route.ts) keeps its current behavior unchanged.
   */
  silenceRoutineEmail?: boolean;
}

/**
 * Run the actual scan and persist every stage of it to `scan_history`.
 *
 * Called fire-and-forget from POST /api/v3/scan, detached from that
 * request's lifecycle: safe specifically because VulnRadar runs as one
 * persistent Node process (not serverless functions), so there is no risk
 * of this being killed once the HTTP response has been sent, the way there
 * would be on Vercel-style deployments.
 */
export async function executeScan(params: ExecuteScanParams): Promise<void> {
  const {
    scanId,
    url,
    normalizedUrl,
    protocolType,
    isRawIpTarget,
    selectedScanners,
    requestedProbes,
    authedUserId,
    categoriesTotal,
    silenceRoutineEmail = false,
  } = params;

  const startTime = Date.now();
  const scanTimeoutSeconds = await getSetting("SCAN_TIMEOUT_SECONDS");
  const watchdog = startWatchdog(
    scanId,
    scanTimeoutSeconds * 1000,
    `Scan exceeded the ${scanTimeoutSeconds}s time limit.`,
  );
  const { onProgress, setTotal } = createProgressTracker(scanId);
  setTotal(categoriesTotal);

  try {
    await markScanRunning(scanId);

    let response: Response | null = null;
    let responseBody = "";
    let headers = new Headers();
    let protocolSpecificFindings: Vulnerability[] = [];

    // Get protocol-specific findings first (only meaningful when URL scheme
    // is non-HTTP). For plain https/http inputs, this is a no-op.
    protocolSpecificFindings = getProtocolFindings(normalizedUrl);

    // Handle different protocol types
    if (protocolType === "websocket") {
      // For WebSocket URLs, convert to HTTP(S) for initial check
      try {
        // Parse WebSocket URL
        const wsUrl = new URL(normalizedUrl);
        if (wsUrl.protocol !== "ws:" && wsUrl.protocol !== "wss:") {
          throw new Error("Invalid WebSocket protocol");
        }

        // Construct HTTP(S) URL from components (not string replacement)
        const protocol = wsUrl.protocol === "wss:" ? "https:" : "http:";
        const safeUrl = new URL(
          `${protocol}//${wsUrl.host}${wsUrl.pathname}${wsUrl.search}`,
        );

        // Validate the constructed URL
        if (safeUrl.protocol !== "http:" && safeUrl.protocol !== "https:") {
          throw new Error("Invalid protocol");
        }

        // Use safeFetch which validates the URL internally to prevent SSRF
        response = await safeFetch(safeUrl.href, {
          method: "GET",
          headers: { "User-Agent": `${APP_NAME}/1.0 (Security Scanner)` },
          redirect: "follow",
          signal: AbortSignal.timeout(15000),
        });
        responseBody = await safeReadBody(response, MAX_BODY_SIZE);
        headers = response.headers;
      } catch {
        // WebSocket endpoint may not respond to HTTP - that's ok
      }

      // Add WebSocket-specific security checks
      protocolSpecificFindings.push(
        ...runWebSocketChecks(normalizedUrl, headers),
      );
    } else if (protocolType === "ftp") {
      // FTP protocol checks - limited to protocol-level security
      protocolSpecificFindings.push(...runFtpChecks(normalizedUrl));
    } else if (
      protocolType === "ssh" ||
      protocolType === "smtp" ||
      protocolType === "imap" ||
      protocolType === "pop3" ||
      protocolType === "mongodb"
    ) {
      // Banner-grab protocols — open a TCP socket, read the greeting,
      // and feed it into the protocol-specific findings already produced
      // by getProtocolFindings(). SMTP/IMAP/POP3 use the multi-line
      // capability grab so STARTTLS can be detected; MongoDB uses the
      // wire-protocol auth probe instead of a plaintext banner read since
      // its "banner" is binary BSON, not text.
      try {
        const parsed = new URL(normalizedUrl);
        const port = parsed.port
          ? parseInt(parsed.port, 10)
          : protocolType === "ssh"
            ? 22
            : protocolType === "smtp"
              ? 587
              : protocolType === "imap"
                ? 143
                : protocolType === "pop3"
                  ? 110
                  : 27017;

        if (protocolType === "mongodb") {
          const mongoResult = await probeMongoUnauthenticated(
            parsed.hostname,
            port,
          );
          if (mongoResult) {
            protocolSpecificFindings.push(
              ...buildMongoAuthFindings(
                mongoResult,
                normalizedUrl,
                parsed.hostname,
              ),
            );
          }
        } else if (
          protocolType === "smtp" ||
          protocolType === "imap" ||
          protocolType === "pop3"
        ) {
          const banner = await grabCapabilityBanner(
            protocolType,
            parsed.hostname,
            port,
          );
          if (banner) {
            const versionFinding = buildVersionDisclosureFinding(
              `banner-version-${protocolType}`,
              `${protocolType.toUpperCase()} service discloses version`,
              banner,
              normalizedUrl,
            );
            if (versionFinding) protocolSpecificFindings.push(versionFinding);
            protocolSpecificFindings.push(
              ...buildStartTlsFindings(
                protocolType,
                banner,
                normalizedUrl,
                parsed.hostname,
              ),
            );
          }
        } else {
          // ssh
          const banner = await grabBanner(protocolType, parsed.hostname, port);
          if (banner) {
            const versionFinding = buildVersionDisclosureFinding(
              `banner-version-${protocolType}`,
              `${protocolType.toUpperCase()} service discloses version`,
              banner,
              normalizedUrl,
            );
            if (versionFinding) protocolSpecificFindings.push(versionFinding);
            protocolSpecificFindings.push(
              ...buildSshFindings(banner, normalizedUrl, parsed.hostname),
            );
          }
        }
      } catch {
        // Banner grab failed — that's OK, the protocol-level findings
        // already cover the high-severity issues.
      }
    } else {
      // Raw IP targets: skip HTTP fetch (no hostname context for headers /
      // cookies / content). Probes run via the hostname extraction below;
      // DNS + email checks still run through runAsyncChecks via the IP.
      if (isRawIpTarget) {
        // Mark the scan as probe-only by leaving response/headers empty.
      } else {
        // Standard HTTP/HTTPS fetch
        try {
          // Validate URL before fetch to prevent SSRF
          const urlObj = new URL(normalizedUrl);
          if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
            throw new Error("Invalid protocol");
          }

          // Use safeFetch which validates the URL internally to prevent SSRF
          response = await safeFetch(urlObj.href, {
            method: "GET",
            headers: {
              "User-Agent": `${APP_NAME}/1.0 (Security Scanner)`,
            },
            redirect: "follow",
            signal: AbortSignal.timeout(15000),
          });
          responseBody = await safeReadBody(response, MAX_BODY_SIZE);

          headers = response.headers;
        } catch (fetchError) {
          const message =
            fetchError instanceof Error ? fetchError.message : "Unknown error";
          throw new Error(
            `Could not reach the target URL: ${message}. The site may be down, blocking automated requests, or not publicly accessible.`,
          );
        }
      }
    }

    // Service probes (opt-in via ?probes=ssh,smtp,...). Each probe opens a
    // TCP socket (or, for Elasticsearch, an HTTP GET) to the hostname on
    // its well-known port and reports reachability, version, and — for
    // MongoDB/Redis/Elasticsearch/Memcached — whether the service accepts
    // unauthenticated commands. Independent of the URL scheme, so users
    // can ask "does github.com also run SSH?" without constructing
    // ssh://github.com. Probes run in parallel via Promise.allSettled;
    // each is fully independent so one hanging/failing probe never blocks
    // or drops the others.
    if (requestedProbes.length > 0) {
      let hostname: string | null = null;
      try {
        hostname = new URL(normalizedUrl).hostname;
      } catch {
        /* ignore */
      }
      if (hostname) {
        const host = hostname;
        const outcomes = await Promise.allSettled(
          requestedProbes.map(async (probe) => {
            if (probe.service === "mongodb") {
              const result = await probeMongoUnauthenticated(host, probe.port);
              return result ? { kind: "mongo" as const, probe, result } : null;
            }
            if (probe.service === "elasticsearch") {
              const result = await probeElasticsearchUnauthenticated(
                host,
                probe.port,
              );
              return result
                ? { kind: "elasticsearch" as const, probe, result }
                : null;
            }
            const banner =
              probe.service === "smtp" ||
              probe.service === "imap" ||
              probe.service === "pop3"
                ? await grabCapabilityBanner(probe.service, host, probe.port)
                : await grabBanner(probe.service, host, probe.port);
            return banner
              ? { kind: "banner" as const, probe, result: banner }
              : null;
          }),
        );

        for (const outcome of outcomes) {
          if (outcome.status !== "fulfilled" || !outcome.value) continue;
          const value = outcome.value;
          const probe = value.probe;
          const serviceLabel = probe.service.toUpperCase();

          if (value.kind === "mongo") {
            protocolSpecificFindings.push(
              ...buildMongoAuthFindings(value.result, normalizedUrl, host),
            );
            continue;
          }

          if (value.kind === "elasticsearch") {
            const result = value.result;
            protocolSpecificFindings.push({
              id: generateId(
                `probe-elasticsearch-reachable-${probe.port}`,
                normalizedUrl,
              ),
              title: `ELASTICSEARCH service reachable on port ${probe.port}`,
              description: `An Elasticsearch service responded to an HTTP probe on port ${probe.port}.`,
              severity: "info",
              category: "configuration",
              evidence: result.detail,
              riskImpact:
                "Publicly reachable services expand your attack surface. Restrict via firewall or bind to a private interface.",
              explanation: `The scanner was able to reach ${host}:${probe.port} over HTTP.`,
              fixSteps: [
                "Restrict access via firewall (allow-list known IPs only).",
                "Bind the service to a private interface if it is only needed internally.",
              ],
              codeExamples: [],
            });
            if (result.unauthenticatedAccess) {
              protocolSpecificFindings.push(
                buildUnauthenticatedAccessFinding({
                  idPrefix: `elasticsearch-unauthenticated-${probe.port}`,
                  serviceLabel: "Elasticsearch",
                  targetLabel: host,
                  normalizedUrl,
                  description: `The Elasticsearch service on ${host} returned cluster info over HTTP with no credentials.`,
                  evidence: result.detail,
                  riskImpact:
                    "Anyone who can reach this port can read, and depending on configuration write or delete, every index on the cluster.",
                  explanation:
                    "Elasticsearch has no authentication enabled by default unless X-Pack security (or an equivalent security plugin) is turned on. An open, unauthenticated cluster is one of the most common causes of large-scale data leaks.",
                  fixSteps: [
                    "Enable X-Pack security (`xpack.security.enabled: true`) or an equivalent security plugin.",
                    "Require TLS and authentication on the HTTP layer.",
                    "Bind to a private interface or firewall the port from the public internet.",
                  ],
                }),
              );
            } else {
              protocolSpecificFindings.push(
                buildAuthRequiredFinding({
                  idPrefix: `elasticsearch-auth-required-${probe.port}`,
                  serviceLabel: "Elasticsearch",
                  targetLabel: host,
                  normalizedUrl,
                  evidence: result.detail,
                }),
              );
            }
            continue;
          }

          // value.kind === "banner"
          const banner = value.result;
          protocolSpecificFindings.push({
            id: generateId(
              `probe-${probe.service}-reachable-${probe.port}`,
              normalizedUrl,
            ),
            title: `${serviceLabel} service reachable on port ${banner.port}`,
            description: `A ${serviceLabel} service responded to a TCP probe on port ${banner.port}.`,
            severity: "info",
            category: "configuration",
            evidence: banner.banner.slice(0, 256) || "(no banner)",
            riskImpact:
              "Publicly reachable services expand your attack surface. Restrict via firewall or bind to a private interface.",
            explanation: `The scanner was able to connect to ${host}:${banner.port} and read a banner. This confirms the service is exposed to the public internet.`,
            fixSteps: [
              "Restrict access via firewall (allow-list known IPs only).",
              "Bind the service to 127.0.0.1 or a private interface if it is only needed internally.",
            ],
            codeExamples: [],
          });

          const versionFinding = buildVersionDisclosureFinding(
            `probe-${probe.service}-version-${probe.port}`,
            `${serviceLabel} banner discloses version`,
            banner,
            normalizedUrl,
          );
          if (versionFinding) protocolSpecificFindings.push(versionFinding);

          if (probe.service === "redis") {
            if (isRedisPingUnauthenticated(banner.banner)) {
              protocolSpecificFindings.push(
                buildUnauthenticatedAccessFinding({
                  idPrefix: `redis-unauthenticated-${probe.port}`,
                  serviceLabel: "Redis",
                  targetLabel: host,
                  normalizedUrl,
                  description: `The Redis service on ${host} answered PING with no credentials.`,
                  evidence: banner.banner,
                  riskImpact:
                    "Anyone who can reach this port can read and write every key, and in many configurations run administrative commands (CONFIG SET, FLUSHALL) or chain them into remote code execution via known Redis exploitation techniques.",
                  explanation:
                    "Redis has no authentication by default (`requirepass` unset). Answering PING with +PONG before any AUTH confirms the server accepts commands from anyone who can connect.",
                  fixSteps: [
                    "Set `requirepass` (or use Redis 6+ ACLs) and require AUTH.",
                    "Bind to a private interface (`bind 127.0.0.1`) or firewall the port from the public internet.",
                    "Disable or rename dangerous commands (CONFIG, FLUSHALL, DEBUG) via `rename-command`.",
                  ],
                }),
              );
            } else {
              protocolSpecificFindings.push(
                buildAuthRequiredFinding({
                  idPrefix: `redis-auth-required-${probe.port}`,
                  serviceLabel: "Redis",
                  targetLabel: host,
                  normalizedUrl,
                  evidence: banner.banner,
                }),
              );
            }
          } else if (probe.service === "memcached") {
            if (isMemcachedStatsUnauthenticated(banner.banner)) {
              protocolSpecificFindings.push(
                buildUnauthenticatedAccessFinding({
                  idPrefix: `memcached-unauthenticated-${probe.port}`,
                  serviceLabel: "Memcached",
                  targetLabel: host,
                  normalizedUrl,
                  description: `The Memcached service on ${host} answered the stats command with no credentials.`,
                  evidence: banner.banner,
                  riskImpact:
                    "Cached data (often including session tokens or query results) is readable and writable by anyone who can reach this port, and the service can be abused as a UDP reflection/amplification vector for DDoS.",
                  explanation:
                    "Classic Memcached's ASCII protocol has no built-in authentication. Any TCP client that can connect can run any command, including reading and overwriting cached values.",
                  fixSteps: [
                    "Bind to a private interface (`-l 127.0.0.1`) or firewall the port from the public internet.",
                    "Disable the UDP listener (`-U 0`) if it is not needed.",
                    "Use SASL authentication (binary protocol) if the service must be reachable beyond localhost.",
                  ],
                }),
              );
            }
          } else if (probe.service === "ssh" || probe.service === "sftp") {
            protocolSpecificFindings.push(
              ...buildSshFindings(banner, normalizedUrl, host),
            );
          } else if (
            probe.service === "smtp" ||
            probe.service === "imap" ||
            probe.service === "pop3"
          ) {
            protocolSpecificFindings.push(
              ...buildStartTlsFindings(
                probe.service,
                banner,
                normalizedUrl,
                host,
              ),
            );
          }
        }
      }
    }

    // Capture response headers as a plain object for evidence.
    // scanner: redact Set-Cookie / Cookie / Authorization etc. before
    // persisting.
    const capturedHeaders: Record<string, string> = {};
    headers.forEach((value, key) => {
      capturedHeaders[key] = value;
    });
    const redactedHeaders = redactSensitiveResponseHeaders(capturedHeaders);

    // Start async checks immediately (DNS, TLS, live-fetch) while running sync
    // checks. Each branch inside runAsyncChecksDetailed already races its own
    // 12s ceiling, so this outer 15s race is a safety net rather than the
    // primary mechanism; when it does fire, incomplete[] below lists every
    // branch as not completed rather than silently returning no findings.
    const asyncPromise = runAsyncChecksDetailed(
      normalizedUrl,
      selectedScanners,
      onProgress,
    );
    // Both onProgress and runSyncChecks below can throw synchronously
    // (cancellation), which would abandon asyncPromise before the
    // Promise.race further down ever attaches a handler to it. A bare
    // catch here only prevents that from surfacing as an unhandled
    // rejection; it does not consume the value Promise.race reads later,
    // since a promise can have more than one handler attached to it.
    asyncPromise.catch(() => {});
    let asyncTimedOut = false;
    const asyncTimeout = new Promise<AsyncCheckResult>((resolve) =>
      setTimeout(() => {
        asyncTimedOut = true;
        resolve({ findings: [], incomplete: ["dns", "tls", "live-fetch"] });
      }, 15000),
    );

    // Run synchronous body/header checks and the parsed-page checks through
    // the shared engine, which builds the page context once, applies
    // deduplication, and reports how many checks actually ran. Raw IP
    // targets get no sync checks: those are HTTP-context-only.
    const bodyForChecks =
      responseBody.length > 1_000_000
        ? responseBody.slice(0, 1_000_000)
        : responseBody;
    const syncResult = isRawIpTarget
      ? {
          findings: [] as Vulnerability[],
          checksRun: 0,
          checksSkipped: 0,
          deduped: 0,
        }
      : runSyncChecks(
          normalizedUrl,
          headers,
          bodyForChecks,
          selectedScanners as Category[] | null,
          onProgress,
        );

    // Await async checks (already running in parallel with sync)
    let asyncResult: AsyncCheckResult = { findings: [], incomplete: [] };
    try {
      asyncResult = await Promise.race([asyncPromise, asyncTimeout]);
    } catch {
      /* non-fatal */
    }

    let findings = [
      ...protocolSpecificFindings,
      ...syncResult.findings,
      ...asyncResult.findings,
    ];

    // Sort findings by severity
    findings.sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    );

    // Post-processing enrichment: attach CISA KEV / FIRST.org EPSS
    // exploit-likelihood intel to any finding that names a CVE in its own
    // text. Fail-open (see cve-enrichment.ts) — a network hiccup or a
    // self-hosted instance with no outbound internet never fails the scan,
    // it just means findings come back without this annotation.
    findings = await enrichFindingsWithExploitIntel(findings);

    const duration = Date.now() - startTime;

    const summary = {
      critical: findings.filter((f) => f.severity === SEVERITY_LEVELS.CRITICAL)
        .length,
      high: findings.filter((f) => f.severity === SEVERITY_LEVELS.HIGH).length,
      medium: findings.filter((f) => f.severity === SEVERITY_LEVELS.MEDIUM)
        .length,
      low: findings.filter((f) => f.severity === SEVERITY_LEVELS.LOW).length,
      info: findings.filter((f) => f.severity === SEVERITY_LEVELS.INFO).length,
      total: findings.length,
    };

    const dangerScore = getDangerScore(findings);
    const incomplete = asyncResult.incomplete;
    const engineConfidence = getEngineConfidence(
      findings,
      asyncTimedOut || incomplete.length > 0,
    );

    const scannedAt = new Date().toISOString();

    const applied = await finalizeScanSuccess(scanId, {
      summary,
      findings,
      duration,
      scannedAt,
      responseHeaders: redactedHeaders,
      resultMeta: {
        checksRun: syncResult.checksRun,
        dangerScore,
        engineConfidence,
        ...(incomplete.length > 0 ? { incomplete } : {}),
      },
    });

    // Row already reached a terminal state (watchdog timeout or
    // cancellation raced this completion). Don't fire notifications or
    // webhooks for a result nobody will see.
    if (!applied) return;

    // Send email notifications (non-blocking)
    pool
      .query("SELECT email FROM users WHERE id = $1", [authedUserId])
      .then(async ({ rows }) => {
        if (rows.length === 0) return;
        const userEmail = rows[0].email;

        // Send scan complete notification. Suppressed for a routine
        // scheduled-scan run (see ExecuteScanParams.silenceRoutineEmail) --
        // the critical/high findings alert right below still fires either
        // way, so a schedule that actually finds something new still
        // notifies.
        if (!silenceRoutineEmail) {
          const scanEmail = scanCompleteEmail(
            normalizedUrl,
            summary,
            duration,
            scanId,
          );
          await sendNotificationEmail({
            userId: authedUserId,
            userEmail,
            type: "scan_complete",
            emailContent: scanEmail,
          }).catch((error) => {
            console.error(
              `[${APP_NAME}] Failed to send scan complete email:`,
              error instanceof Error ? error.message : error,
            );
          });
        }

        // Send critical/high regression alert only when the diff against
        // the previous scan of this URL turns up a genuinely NEW
        // critical/high finding (see lib/scanner/regression-alert.ts) --
        // not merely whether this scan's summary has any critical/high
        // count at all. Without this, a persistent finding on a schedule
        // that reruns hourly would re-alert on every single run.
        try {
          const regressionCheck = await checkForNewCriticalOrHighFindings({
            userId: authedUserId,
            url: normalizedUrl,
            scanId,
            currentFindings: findings,
          });
          if (regressionCheck.hasNewCriticalOrHigh) {
            const criticalEmail = criticalFindingsEmail(
              normalizedUrl,
              regressionCheck.newFindings,
              regressionCheck.outstandingFindings,
              scanId,
            );
            await sendNotificationEmail({
              userId: authedUserId,
              userEmail,
              type: "severity_alerts",
              emailContent: criticalEmail,
            });
          }
        } catch (error) {
          console.error(
            `[${APP_NAME}] Failed to send critical findings email:`,
            error instanceof Error ? error.message : error,
          );
        }
      })
      .catch((error) => {
        console.error(
          `[${APP_NAME}] Failed to fetch user email for notifications:`,
          error instanceof Error ? error.message : error,
        );
      });

    // Fire webhooks for all scans (non-blocking)
    pool
      .query(
        "SELECT id, url, type, secret FROM webhooks WHERE user_id = $1 AND active = true",
        [authedUserId],
      )
      .then(({ rows }) => {
        for (const {
          id: webhookId,
          url: webhookUrl,
          type: webhookType,
          secret: webhookSecret,
        } of rows) {
          let body: string;
          const scanData = {
            normalizedUrl,
            summary,
            findings_count: summary.total,
            duration,
            scanned_at: scannedAt,
          };

          if (webhookType === "discord") {
            // Discord embed format
            const severityColor =
              summary.critical > 0
                ? 0xef4444
                : summary.high > 0
                  ? 0xf97316
                  : summary.medium > 0
                    ? 0xeab308
                    : 0x22c55e;
            body = JSON.stringify({
              embeds: [
                {
                  title: `${APP_NAME} Scan Complete`,
                  description: `Scan finished for **${url}**`,
                  color: severityColor,
                  fields: [
                    {
                      name: "Critical",
                      value: String(summary.critical),
                      inline: true,
                    },
                    {
                      name: "High",
                      value: String(summary.high),
                      inline: true,
                    },
                    {
                      name: "Medium",
                      value: String(summary.medium),
                      inline: true,
                    },
                    { name: "Low", value: String(summary.low), inline: true },
                    {
                      name: "Info",
                      value: String(summary.info),
                      inline: true,
                    },
                    {
                      name: "Total Issues",
                      value: String(summary.total),
                      inline: true,
                    },
                    {
                      name: "Duration",
                      value: `${(duration / 1000).toFixed(1)}s`,
                      inline: true,
                    },
                  ],
                  footer: { text: `${APP_NAME} Security Scanner` },
                  timestamp: scannedAt,
                },
              ],
            });
          } else if (webhookType === "slack") {
            // Slack Block Kit format
            body = JSON.stringify({
              blocks: [
                {
                  type: "header",
                  text: {
                    type: "plain_text",
                    text: `${APP_NAME} Scan Complete`,
                  },
                },
                {
                  type: "section",
                  text: { type: "mrkdwn", text: `*URL:* ${url}` },
                },
                {
                  type: "section",
                  fields: [
                    {
                      type: "mrkdwn",
                      text: `*Critical:* ${summary.critical}`,
                    },
                    { type: "mrkdwn", text: `*High:* ${summary.high}` },
                    { type: "mrkdwn", text: `*Medium:* ${summary.medium}` },
                    { type: "mrkdwn", text: `*Low:* ${summary.low}` },
                    { type: "mrkdwn", text: `*Total:* ${summary.total}` },
                    {
                      type: "mrkdwn",
                      text: `*Duration:* ${(duration / 1000).toFixed(1)}s`,
                    },
                  ],
                },
                {
                  type: "context",
                  elements: [
                    {
                      type: "mrkdwn",
                      text: `Sent by ${APP_NAME} Security Scanner`,
                    },
                  ],
                },
              ],
            });
          } else {
            // Generic JSON
            body = JSON.stringify({
              event: "scan.completed",
              data: scanData,
            });
          }

          // Signed (HMAC-SHA256 of `body` via the webhook's own secret, sent
          // as X-VulnRadar-Signature: sha256=<hex>), logged to
          // webhook_deliveries, and retried once on failure -- see
          // lib/webhooks/delivery.ts. That module re-validates the URL via
          // safeFetch's own SSRF check before every attempt (registration
          // and edit time aren't the only chance DNS / routing has to
          // change), so no separate validateScanTarget call is needed here.
          deliverWebhook(
            {
              id: webhookId,
              userId: authedUserId,
              url: webhookUrl,
              type: webhookType,
              secret: webhookSecret ?? null,
            },
            "scan.completed",
            body,
          ).catch((err) => {
            console.error(`[${APP_NAME}] Webhook delivery failed`, {
              type: webhookType,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
      })
      .catch(() => {});
  } catch (error) {
    if (error instanceof ScanCancelledError) {
      await finalizeScanFailure(scanId, "Cancelled");
    } else {
      const message =
        error instanceof Error
          ? error.message
          : "An unexpected error occurred during the scan.";
      console.error(`[${APP_NAME}] Background scan failed:`, message);
      await finalizeScanFailure(scanId, message);
    }
  } finally {
    clearTimeout(watchdog);
  }
}
