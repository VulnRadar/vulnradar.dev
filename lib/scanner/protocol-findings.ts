/**
 * Vulnerability builders for the non-HTTP protocol scan branch in
 * execute-scan.ts (a URL whose scheme is ssh://, smtp://, imap://, pop3://,
 * or mongodb://). Each turns a raw banner/probe result from
 * ./protocols/banner into the Vulnerability findings that branch persists.
 *
 * Finding IDs are derived deterministically from a checkId prefix + URL (see
 * generateId), so the prefixes here MUST stay stable: changing one changes
 * the ID of an existing finding type and breaks diffing between a user's
 * older and newer scans of the same target.
 */

import type { Vulnerability } from "./types";
import { generateId } from "./_helpers";
import {
  bannerVersion,
  assessSshBanner,
  detectStartTls,
  type BannerResult,
  type MongoAuthProbeResult,
} from "./protocols/banner";

/**
 * Shared "banner discloses version" finding for the ssh://smtp://etc. scan
 * branch. `idPrefix`/`title` are passed in so each call site keeps the exact
 * finding ID it produces.
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

/** Shared shape for the "unauthenticated access" family of findings. */
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
