/**
 * Opt-in service probes (?probes=ssh,smtp,imap,pop3,ftp,mongodb,...).
 *
 * Each probe opens a TCP socket (or, for Elasticsearch, an HTTP GET) to a
 * hostname on a well-known port and reports reachability, version, and --
 * for MongoDB/Redis/Elasticsearch/Memcached -- whether the service accepts
 * unauthenticated commands. Factored out of execute-scan.ts so the
 * single-URL scan (lib/scanner/execute-scan.ts) and the crawl scan
 * (lib/scanner/execute-crawl-scan.ts) run probes through the exact same
 * code path -- previously only the single-URL path had it, so a deep/crawl
 * scan with probes selected produced nothing.
 *
 * Probes run in parallel via Promise.allSettled; each is fully independent
 * so one hanging/failing probe never blocks or drops the others. Every
 * probe the caller explicitly selected yields exactly one finding: the real
 * finding when the port is reachable, or a visible info-severity "not
 * reachable" line when it is not (the norm for a normal website that only
 * exposes 80/443), so a closed port reads as "checked, nothing there"
 * instead of silence.
 */

import { APP_NAME } from "@/lib/config/constants";
import type { Vulnerability } from "./types";
import { generateId } from "./_helpers";
import { safeFetch } from "./safe-fetch";
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

/**
 * Safely read a response body with a size limit and a hard timeout. A local
 * copy of execute-scan.ts's helper (also duplicated in execute-crawl-scan.ts)
 * so this module has no import cycle back into the scan orchestrators.
 * Only used by probeElasticsearchUnauthenticated below.
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
 * ssh://smtp://etc. scan branch (in execute-scan.ts) and the opt-in
 * service-probe loop below. `idPrefix`/`title` are passed in so each call
 * site keeps the exact finding ID it already produced before this was
 * factored out -- IDs are derived deterministically from checkId + URL (see
 * generateId), so changing the prefix would change the ID for an existing
 * finding type and break diffing between a user's older and newer scans of
 * the same target.
 */
export function buildVersionDisclosureFinding(
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
export function buildSshFindings(
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
 * plaintext port -- smtps/imaps/pop3s are already encrypted from connect,
 * so callers should not run this against those.
 */
export function buildStartTlsFindings(
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
    riskImpact: "None. This is the expected, secure configuration.",
    explanation: `${params.serviceLabel} responded, but declined to run the diagnostic command without credentials.`,
    fixSteps: [],
    codeExamples: [],
  };
}

export function buildMongoAuthFindings(
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

/**
 * The visible "you selected this probe, here is the result" line for a probe
 * whose port could not be reached. Emitting one info finding per unreachable
 * probe is the whole point of the secondary fix: a normal website exposes
 * only 80/443, so most selected probes come back closed/filtered, and
 * silence there is indistinguishable from a broken feature.
 */
function buildProbeUnreachableFinding(
  probe: { service: string; port: number },
  host: string,
  normalizedUrl: string,
): Vulnerability {
  const serviceLabel = probe.service.toUpperCase();
  return {
    id: generateId(
      `probe-${probe.service}-unreachable-${probe.port}`,
      normalizedUrl,
    ),
    title: `No ${serviceLabel} service reachable on port ${probe.port}`,
    description: `The scanner could not open a connection to a ${serviceLabel} service on ${host}:${probe.port}. The port is most likely closed, filtered, or running no service.`,
    severity: "info",
    category: "configuration",
    evidence: `No response from ${host}:${probe.port}.`,
    riskImpact:
      "None. A port that does not accept connections is not an exposure on its own.",
    explanation: `You asked the scanner to probe ${probe.service} on port ${probe.port}. This is the expected result for a host that only exposes its web ports, and confirms the probe ran.`,
    fixSteps: [],
    codeExamples: [],
  };
}

export interface ElasticsearchProbeResult {
  reachable: boolean;
  unauthenticatedAccess: boolean;
  detail: string;
}

/**
 * Elasticsearch's root endpoint (`GET /`) returns cluster metadata
 * (cluster_name, version, the "You Know, for Search" tagline) with no
 * authentication whenever security features aren't enabled -- the
 * long-standing default. A 401/403 means auth is required; anything else
 * (connection refused, non-JSON body) is treated as inconclusive.
 * Reuses safeFetch/safeReadBody (a plain HTTP request, not a raw socket) and
 * validateBannerTarget for the same private-host/well-known-port gating
 * every other probe goes through.
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

type ProbeTarget = { service: string; port: number };

type ProbeValue =
  | { kind: "mongo"; result: MongoAuthProbeResult }
  | { kind: "elasticsearch"; result: ElasticsearchProbeResult }
  | { kind: "banner"; result: BannerResult };

type ProbeOutcome = { probe: ProbeTarget; value: ProbeValue | null };

/**
 * Run every requested service probe against `host` and return the findings.
 * `normalizedUrl` is used only to derive deterministic finding IDs (see
 * generateId) and human-readable text, so the same probe against the same
 * target keeps the same finding ID across scans.
 *
 * The reachable-port case is byte-for-byte what execute-scan.ts produced
 * before this was extracted; the only added behavior is one info finding per
 * unreachable probe (see buildProbeUnreachableFinding).
 */
export async function runServiceProbes(
  host: string,
  normalizedUrl: string,
  requestedProbes: ProbeTarget[],
  signal: AbortSignal,
): Promise<Vulnerability[]> {
  const findings: Vulnerability[] = [];
  if (requestedProbes.length === 0 || signal.aborted) return findings;

  const outcomes = await Promise.allSettled(
    requestedProbes.map(async (probe): Promise<ProbeOutcome> => {
      try {
        if (probe.service === "mongodb") {
          const result = await probeMongoUnauthenticated(host, probe.port);
          return {
            probe,
            value: result ? { kind: "mongo", result } : null,
          };
        }
        if (probe.service === "elasticsearch") {
          const result = await probeElasticsearchUnauthenticated(
            host,
            probe.port,
          );
          return {
            probe,
            value: result ? { kind: "elasticsearch", result } : null,
          };
        }
        const banner =
          probe.service === "smtp" ||
          probe.service === "imap" ||
          probe.service === "pop3"
            ? await grabCapabilityBanner(probe.service, host, probe.port)
            : await grabBanner(probe.service, host, probe.port);
        return {
          probe,
          value: banner ? { kind: "banner", result: banner } : null,
        };
      } catch {
        return { probe, value: null };
      }
    }),
  );

  for (const outcome of outcomes) {
    if (outcome.status !== "fulfilled") continue;
    const { probe, value } = outcome.value;

    // Visibility: a probe the user explicitly selected that could not be
    // reached still produces exactly one (info) finding, so a closed or
    // filtered port reads as "checked, nothing there" rather than silence.
    if (!value) {
      findings.push(buildProbeUnreachableFinding(probe, host, normalizedUrl));
      continue;
    }

    const serviceLabel = probe.service.toUpperCase();

    if (value.kind === "mongo") {
      findings.push(
        ...buildMongoAuthFindings(value.result, normalizedUrl, host),
      );
      continue;
    }

    if (value.kind === "elasticsearch") {
      const result = value.result;
      findings.push({
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
        findings.push(
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
        findings.push(
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
    findings.push({
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
    if (versionFinding) findings.push(versionFinding);

    if (probe.service === "redis") {
      if (isRedisPingUnauthenticated(banner.banner)) {
        findings.push(
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
        findings.push(
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
        findings.push(
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
      findings.push(...buildSshFindings(banner, normalizedUrl, host));
    } else if (
      probe.service === "smtp" ||
      probe.service === "imap" ||
      probe.service === "pop3"
    ) {
      findings.push(
        ...buildStartTlsFindings(probe.service, banner, normalizedUrl, host),
      );
    }
  }

  return findings;
}
