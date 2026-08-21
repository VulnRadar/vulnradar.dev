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
import { classifyRedirect } from "./scan-target-classify";
import { readSslGrade } from "./ssl-grade";
import { readThreatIntel } from "./reputation-lookup";
import { readDnsRecords } from "./dns-records";
import { readSubdomains, autoDiscoverSubdomains } from "./subdomain-auto";
import {
  createProgressTracker,
  startWatchdog,
  finalizeScanSuccess,
  finalizeScanFailure,
  markScanRunning,
  ScanCancelledError,
  getCancelSignal,
} from "./scan-jobs";
import pool from "@/lib/database/db";
import type { Category, Severity, Vulnerability } from "./types";
import { APP_NAME, SEVERITY_LEVELS } from "@/lib/config/constants";
import { getSettings } from "@/lib/config/runtime-config";
import { getProtocolFromUrl, getProtocolFindings } from "./protocols";
import { runWebSocketChecks } from "./protocols/websocket";
import { runFtpChecks } from "./protocols/ftp";
import {
  grabBanner,
  grabCapabilityBanner,
  probeMongoUnauthenticated,
} from "./protocols/banner";
import {
  buildMongoAuthFindings,
  buildVersionDisclosureFinding,
  buildStartTlsFindings,
  buildSshFindings,
} from "./protocol-findings";
import { safeFetch } from "./safe-fetch";
import { redactSensitiveResponseHeaders } from "./response-headers";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import { scanCompleteEmail, criticalFindingsEmail } from "@/lib/email/email";
import {
  getDangerScore,
  getEngineConfidence,
  getSafetyRating,
  type SafetyRating,
} from "./safety-rating";
import { checkSourceMapSourcesExposed } from "./checks/content";
import { getCheckDef, buildVulnerabilityFromEvidence } from "./registry";
import { enrichFindingsWithExploitIntel } from "./cve-enrichment";
import { applyAdaptiveConfidence } from "./adaptive-confidence";
import { attachCvssScores } from "./cvss";
import { deliverWebhook } from "@/lib/webhooks/delivery";
import { checkForNewCriticalOrHighFindings } from "./regression-alert";
import {
  captureAndStoreScreenshot,
  shouldCaptureScreenshot,
  type ScanScreenshotRef,
} from "./page-screenshot";
import {
  scanPorts,
  buildRiskyPortFindings,
  type PortScanResult,
} from "./port-scan";
import {
  analyzeSoftwareInventory,
  type SoftwareInventoryResult,
} from "./software-inventory";

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

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

export interface ExecuteScanParams {
  scanId: number;
  url: string;
  normalizedUrl: string;
  protocolType: ProtocolType;
  isRawIpTarget: boolean;
  selectedScanners: string[] | null;
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
  /**
   * Opt-in: capture one above-the-fold screenshot of the scanned page
   * through BrowserBase (lib/scanner/page-screenshot.ts). Off by default --
   * a screenshot spins up a real, metered headless-browser session, so it
   * only runs when the user turned it on in the scan form. Best-effort and
   * bounded: a failed or skipped capture (BrowserBase not configured, meter
   * exhausted, timeout) never slows or fails the scan, it just means the
   * result carries no screenshot reference.
   */
  captureScreenshot?: boolean;
  /**
   * Opt-in: sweep a curated set of common service ports on the target host
   * (lib/scanner/port-scan.ts). Off by default. Port-scanning from a shared
   * server is abuse, so the scan routes only ever set this true after the
   * caller has proven verified domain ownership -- the SAME gate active
   * probing uses. Best-effort and bounded (capped concurrency, short per-port
   * timeout, overall wall-clock deadline) and runs concurrently with the rest
   * of the scan, so it never fails or unduly slows it; scanPorts also refuses
   * any private/internal resolved address as defence in depth.
   */
  portScan?: boolean;
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
    authedUserId,
    categoriesTotal,
    silenceRoutineEmail = false,
    captureScreenshot = false,
    portScan = false,
  } = params;

  const startTime = Date.now();
  const {
    SCAN_TIMEOUT_SECONDS: scanTimeoutSeconds,
    SCANNER_MAX_RESPONSE_BODY_BYTES: MAX_BODY_SIZE,
  } = await getSettings([
    "SCAN_TIMEOUT_SECONDS",
    "SCANNER_MAX_RESPONSE_BODY_BYTES",
  ] as const);
  const watchdog = startWatchdog(
    scanId,
    scanTimeoutSeconds * 1000,
    `Scan exceeded the ${scanTimeoutSeconds}s time limit.`,
  );
  const { onProgress, setTotal } = createProgressTracker(scanId);
  setTotal(categoriesTotal);
  const cancelSignal = getCancelSignal(scanId);

  try {
    await markScanRunning(scanId);

    // Opt-in page screenshot: kicked off here so the (expensive, metered)
    // BrowserBase capture runs concurrently with the rest of the scan, then
    // awaited (bounded) just before result_meta is assembled. Best-effort
    // and self-gated inside captureAndStoreScreenshot (config, plan/meter,
    // concurrency, timeout), so it can never fail or stall the scan. Only
    // for real HTTP web hosts -- a raw IP or non-HTTP protocol has no page
    // to render. Uses cancelSignal so a cancelled scan abandons the capture.
    const screenshotPromise: Promise<ScanScreenshotRef | null> =
      shouldCaptureScreenshot({
        optedIn: captureScreenshot,
        protocolType,
        isRawIpTarget,
      })
        ? captureAndStoreScreenshot(scanId, normalizedUrl, {
            userId: authedUserId,
            signal: cancelSignal,
          })
        : Promise.resolve(null);
    screenshotPromise.catch(() => {});

    // Opt-in curated port/service sweep, kicked off here so it runs
    // concurrently with the rest of the scan, then awaited (bounded) before
    // findings are assembled. Only reaches here after the route enforced
    // verified domain ownership; scanPorts is best-effort, never throws, and
    // refuses any target that resolves to a private/internal address (see
    // lib/scanner/port-scan.ts). Uses cancelSignal so a cancelled scan
    // abandons the sweep.
    let portScanHost: string | null = null;
    try {
      portScanHost = new URL(normalizedUrl).hostname;
    } catch {
      /* malformed URL: no host to sweep */
    }
    const portScanPromise: Promise<PortScanResult | null> =
      portScan && portScanHost
        ? scanPorts(portScanHost, cancelSignal)
        : Promise.resolve(null);
    portScanPromise.catch(() => {});

    let response: Response | null = null;
    let responseBody = "";
    let headers = new Headers();
    let protocolSpecificFindings: Vulnerability[] = [];
    // Set below, only when safeFetch actually followed a same-host redirect
    // away from normalizedUrl (e.g. https://host/ -> https://host/landing).
    // Passed to finalizeScanSuccess so scan_history.url reflects the page
    // that was really scanned, not just the URL the scan was requested
    // with -- everything else in this function (finding ids, DNS/email
    // checks, etc.) intentionally keeps using normalizedUrl as-is.
    let finalScanUrl: string | undefined;

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

          // safeFetch already restricts any redirect it follows to the same
          // (registered) host -- see its own comment -- so this is never a
          // different site, only a different path/query on the one we were
          // asked to scan.
          if (response.url && response.url !== urlObj.href) {
            finalScanUrl = response.url;
          }
        } catch (fetchError) {
          const message =
            fetchError instanceof Error ? fetchError.message : "Unknown error";
          throw new Error(
            `Could not reach the target URL: ${message}. The site may be down, blocking automated requests, or not publicly accessible.`,
          );
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

    // Automatic subdomain discovery: kicked off here so it runs concurrently
    // with the rest of the scan, then awaited (bounded) just before
    // result_meta is assembled. Best-effort and time-bounded inside
    // autoDiscoverSubdomains, so it can never fail or stall the scan. Only for
    // real web hosts -- raw IPs and non-HTTP protocols have no registrable
    // domain to enumerate. Reuses the manual flow's per-domain cache, so a
    // repeat scan of the same domain is an instant cache hit.
    const autoSubdomainsPromise =
      protocolType === "http" && !isRawIpTarget
        ? autoDiscoverSubdomains(normalizedUrl, { signal: cancelSignal })
        : Promise.resolve();
    autoSubdomainsPromise.catch(() => {});

    // Start async checks immediately (DNS, TLS, live-fetch) while running sync
    // checks. Each branch inside runAsyncChecksDetailed already races its own
    // 12s ceiling, so this outer 15s race is a safety net rather than the
    // primary mechanism; when it does fire, incomplete[] below lists every
    // branch as not completed rather than silently returning no findings.
    const asyncPromise = runAsyncChecksDetailed(
      normalizedUrl,
      selectedScanners,
      onProgress,
      cancelSignal,
    );
    // Both onProgress and runSyncChecks below can throw synchronously
    // (cancellation), which would abandon asyncPromise before the
    // Promise.race further down ever attaches a handler to it. A bare
    // catch here only prevents that from surfacing as an unhandled
    // rejection; it does not consume the value Promise.race reads later,
    // since a promise can have more than one handler attached to it.
    asyncPromise.catch(() => {});
    let asyncTimedOut = false;
    // Hold the timer handle so it can be cleared once the race settles. Without
    // clearing, a scan that wins the race via asyncPromise (async checks
    // completed) but then spends real time on the port sweep + software/CVE
    // lookups below still has this 15s timer pending -- it fires late and flips
    // asyncTimedOut to true on an already-complete scan, understating engine
    // confidence (94 instead of 97) and leaking the timer/closure.
    let asyncTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const asyncTimeout = new Promise<AsyncCheckResult>((resolve) => {
      asyncTimeoutHandle = setTimeout(() => {
        asyncTimedOut = true;
        resolve({ findings: [], incomplete: ["dns", "tls", "live-fetch"] });
      }, 15000);
    });

    // Run synchronous body/header checks and the parsed-page checks through
    // the shared engine, which builds the page context once, applies
    // deduplication, and reports how many checks actually ran. Raw IP
    // targets get no sync checks: those are HTTP-context-only.
    const bodyForChecks =
      responseBody.length > 1_000_000
        ? responseBody.slice(0, 1_000_000)
        : responseBody;

    // General software inventory + version-to-CVE correlation, built from the
    // response the scan already has (headers + body) -- no extra fetch. Kicked
    // off here so the (bounded, capped) external CVE lookups run concurrently
    // with the sync/async checks, then awaited before findings are assembled.
    // Best-effort and non-throwing (see lib/scanner/software-inventory.ts): a
    // network hiccup or a self-hosted instance with no outbound internet just
    // means no inventory panel and no software CVE findings. Raw-IP targets
    // skip the HTTP fetch, so there is nothing to fingerprint for them.
    const softwareInventoryPromise: Promise<SoftwareInventoryResult | null> =
      isRawIpTarget
        ? Promise.resolve(null)
        : analyzeSoftwareInventory(
            normalizedUrl,
            headers,
            bodyForChecks,
            cancelSignal,
          );
    softwareInventoryPromise.catch(() => {});

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

    // Real detection for sourcemap-sourcescontent-exposed (content.ts's
    // synchronous detector map only carries a permanent-null stub for this
    // id -- see that stub's own comment). checkSourceMapSourcesExposed is a
    // follow-up fetch of the .map file the page already referenced, so it
    // has to run against the already-fetched body, unlike async-checks.ts's
    // independent DNS/TLS/live-fetch branches -- fired here, in parallel
    // with runSyncChecks/asyncPromise, rather than blocking on either.
    // Bounded by its own internal 6s AbortSignal timeout and never rejects
    // (catches every failure internally and resolves null), so a plain
    // await below is already safe -- no extra outer race needed.
    const sourceMapPromise = isRawIpTarget
      ? Promise.resolve(null)
      : checkSourceMapSourcesExposed(normalizedUrl, headers, bodyForChecks);

    // Await async checks (already running in parallel with sync)
    let asyncResult: AsyncCheckResult = { findings: [], incomplete: [] };
    try {
      asyncResult = await Promise.race([asyncPromise, asyncTimeout]);
    } catch {
      /* non-fatal */
    } finally {
      // Race settled: cancel the timeout so it can't fire late and wrongly mark
      // an already-complete scan as timed out.
      if (asyncTimeoutHandle) clearTimeout(asyncTimeoutHandle);
    }

    let sourceMapFinding: Vulnerability | null = null;
    try {
      const evidence = await sourceMapPromise;
      const def = evidence
        ? getCheckDef("sourcemap-sourcescontent-exposed")
        : null;
      if (evidence && def) {
        sourceMapFinding = buildVulnerabilityFromEvidence(
          def,
          normalizedUrl,
          evidence,
        );
      }
    } catch {
      /* non-fatal -- same fail-open posture as every other check here */
    }

    // Curated port sweep result, captured concurrently above. scanPorts never
    // rejects, so this await just settles the bounded sweep. null when the
    // caller did not opt in, the target was unsafe/unresolvable, or the sweep
    // was cancelled. Its open ports become both the structured result_meta
    // panel (below) and a small number of findings for notably risky ports.
    let portScanResult: PortScanResult | null = null;
    try {
      portScanResult = await portScanPromise;
    } catch {
      /* never: scanPorts swallows its own errors */
    }
    const riskyPortFindings =
      portScanResult && portScanHost
        ? buildRiskyPortFindings(
            portScanHost,
            normalizedUrl,
            portScanResult.open,
          )
        : [];

    // Software inventory result, correlated concurrently above. Never rejects
    // (analyzeSoftwareInventory swallows its own errors and resolves null), so
    // this await just settles the bounded correlation. Its aggregated
    // per-software CVE findings join the finding set BEFORE the exploit-intel
    // pass below, so they pick up CISA KEV / FIRST.org EPSS from their own
    // CVE-naming text for free; its full structured inventory goes to
    // result_meta.
    let softwareInventory: SoftwareInventoryResult | null = null;
    try {
      softwareInventory = await softwareInventoryPromise;
    } catch {
      /* never: analyzeSoftwareInventory swallows its own errors */
    }

    let findings = [
      ...protocolSpecificFindings,
      ...syncResult.findings,
      ...asyncResult.findings,
      ...(sourceMapFinding ? [sourceMapFinding] : []),
      ...riskyPortFindings,
      ...(softwareInventory?.findings ?? []),
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

    // Adaptive confidence: discounts a finding's confidence when its check
    // has a real, statistically meaningful false-positive rate from user
    // feedback (see adaptive-confidence.ts). Fail-open, same as the pass
    // above -- never fails the scan.
    findings = await applyAdaptiveConfidence(findings);

    // Safety-net pass: every finding in the response carries a CVSS 3.1
    // vector/score regardless of which check constructed it (see
    // lib/scanner/cvss.ts's own header comment for why this runs once here
    // rather than being threaded through every Vulnerability literal).
    findings = attachCvssScores(findings);

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

    // SSL/TLS letter grade, computed inside checkTLSCert during the TLS branch
    // and left in a per-host side channel (lib/scanner/ssl-grade.ts). Absent
    // for HTTP-only or unreachable targets, so it is only stored when present
    // -- a missing grade must never render as "F".
    let sslGrade: string | undefined;
    try {
      sslGrade = readSslGrade(new URL(normalizedUrl).hostname);
    } catch {
      /* malformed URL: no grade */
    }

    // Full structured DNS record set, resolved in the DNS branch and left in
    // the same per-host side channel (lib/scanner/dns-records.ts). Absent for
    // raw-IP or unreachable targets, so only stored when present -- exactly
    // like sslGrade above.
    let dnsRecords: ReturnType<typeof readDnsRecords>;
    try {
      dnsRecords = readDnsRecords(new URL(normalizedUrl).hostname);
    } catch {
      /* malformed URL: no records */
    }

    // Multi-source threat-intel summary, aggregated during the reputation
    // branch and left in the same per-host side channel
    // (lib/scanner/reputation-lookup.ts). Absent when no source produced a
    // verdict (raw IP with Web Risk unconfigured) or the branch timed out, so
    // only stored when present -- exactly like sslGrade / dnsRecords above.
    let threatIntel: ReturnType<typeof readThreatIntel>;
    try {
      threatIntel = readThreatIntel(new URL(normalizedUrl).hostname);
    } catch {
      /* malformed URL: no summary */
    }

    // Auto-discovered subdomains, captured concurrently above and left in the
    // per-host side channel (lib/scanner/subdomain-auto.ts). autoDiscover
    // never rejects, so this await is safe; it just ensures we read the
    // channel after the bounded discovery has settled. Absent when discovery
    // timed out or found nothing, so the panel simply does not render and the
    // owner keeps the manual "Discover" button.
    try {
      await autoSubdomainsPromise;
    } catch {
      /* never: autoDiscoverSubdomains swallows its own errors */
    }
    let subdomains: ReturnType<typeof readSubdomains>;
    try {
      subdomains = readSubdomains(new URL(normalizedUrl).hostname);
    } catch {
      /* malformed URL: no subdomains */
    }

    // Opt-in page screenshot reference, captured concurrently above. The
    // promise never rejects (captureAndStoreScreenshot swallows every
    // failure and resolves null), so this await just settles the bounded
    // capture before result_meta is written. null when the user did not opt
    // in, BrowserBase is unconfigured, the meter was exhausted, or capture
    // failed -- only the tiny reference is stored, never the image bytes.
    let screenshot: ScanScreenshotRef | null = null;
    try {
      screenshot = await screenshotPromise;
    } catch {
      /* never: captureAndStoreScreenshot swallows its own errors */
    }

    // Measure duration HERE -- after the screenshot await -- not right after the
    // checks finish. The scan isn't marked complete until this point, so this is
    // the wall-clock the user actually waits on the loading page. Computing it
    // earlier reported only the checks time (e.g. 1.8s) while the user waited
    // for the metered screenshot capture too (e.g. 11s), so the stored duration
    // and the loading page disagreed.
    const duration = Date.now() - startTime;

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
        ...(sslGrade ? { sslGrade } : {}),
        ...(dnsRecords ? { dnsRecords } : {}),
        ...(subdomains ? { subdomains } : {}),
        ...(screenshot ? { screenshot } : {}),
        ...(portScanResult ? { portScan: portScanResult } : {}),
        ...(threatIntel ? { threatIntel } : {}),
        ...(softwareInventory?.inventory
          ? { softwareInventory: softwareInventory.inventory }
          : {}),
        ...(incomplete.length > 0 ? { incomplete } : {}),
        // If the fetch followed a redirect to a different page (e.g. an
        // auth-gated page bouncing to /login), record what happened so the UI
        // can warn "this scan is of the page it landed on, not the one you
        // asked for". finalScanUrl is only set when it actually differed.
        ...(() => {
          const redirect = finalScanUrl
            ? classifyRedirect(normalizedUrl, finalScanUrl)
            : null;
          return redirect ? { redirect } : {};
        })(),
      },
      finalUrl: finalScanUrl,
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

    // Fire webhooks for all scans (non-blocking). Includes both the scan
    // owner's own webhooks AND any webhook assigned to the team this scan
    // belongs to -- team-assigned webhooks were previously never delivered
    // (the query filtered on user_id only), so a webhook shared to a team fired
    // only for its creator's scans, never a teammate's. The subquery resolves
    // the scan's team_id (NULL for a personal scan, so the team clause matches
    // nothing there); DISTINCT-by-row means a webhook matching both clauses
    // still fires once.
    pool
      .query(
        `SELECT id, url, type, secret FROM webhooks
         WHERE active = true
           AND (
             user_id = $1
             OR team_id = (SELECT team_id FROM scan_history WHERE id = $2)
           )`,
        [authedUserId, scanId],
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
            // Discord embed format. Color follows the same canonical
            // safe/caution/unsafe tier every other surface uses (the
            // public host page, history, the extension) instead of a
            // raw severity-count threshold -- a raw "critical > 0 or
            // high > 0" check can't tell an exploitable finding from a
            // pure hardening one (e.g. a lone "Missing HSTS"), so it
            // colored the embed red/orange for scans the canonical
            // scorer calls safe.
            const VERDICT_COLOR: Record<SafetyRating, number> = {
              safe: 0x22c55e,
              caution: 0xeab308,
              unsafe: 0xef4444,
            };
            const severityColor = VERDICT_COLOR[getSafetyRating(findings)];
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
