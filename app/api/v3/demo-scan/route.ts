import { NextRequest, NextResponse } from "next/server";
import {
  PAGE_CHECKS_INCOMPLETE,
  dedupeScanFindings,
  noPageChecks,
  runSyncChecksYielding,
} from "@/lib/scanner/engine";
import {
  BOT_CHALLENGE_INCOMPLETE,
  detectBotChallenge,
} from "@/lib/scanner/bot-challenge";
import { startAsyncPhase } from "@/lib/scanner/async-phase";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";
import { APP_NAME, SEVERITY_PRIORITY } from "@/lib/config/constants";
import { summarizeFindings } from "@/lib/scanner/severity-summary";
import { getSettings } from "@/lib/config/runtime-config";
import { checkRateLimit } from "@/lib/rate-limiting/rate-limit";
import { getClientIp, rateLimitIpKey } from "@/lib/api/request-utils";
import { checkAccessRules } from "@/lib/scanner/access-rules";
import { safeFetch } from "@/lib/scanner/safe-fetch";
import { redactSensitiveResponseHeaders } from "@/lib/scanner/response-headers";
import {
  autoDiscoverSubdomains,
  readSubdomains,
} from "@/lib/scanner/subdomain-auto";
import { scanningPausedResponse } from "@/lib/admin/service-state";

function _isValidUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function safeReadBody(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const chunks: string[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        const overshoot = totalBytes - maxBytes;
        const trimmed = value.slice(0, value.byteLength - overshoot);
        if (trimmed.byteLength > 0)
          chunks.push(decoder.decode(trimmed, { stream: false }));
        break;
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } catch {
    /* return what we have */
  } finally {
    try {
      reader.cancel();
    } catch {
      /* ignore */
    }
  }
  return chunks.join("");
}

export async function POST(request: NextRequest) {
  try {
    // PAUSE_SCANNING (and MAINTENANCE_MODE, which implies it). This route is
    // unauthenticated and IP-limited only, so it is the highest-volume way
    // into the scanner and the one a pause most needs to close.
    const paused = await scanningPausedResponse();
    if (paused) return paused;

    // getSettings' return type widens to a union across every key requested
    // (not narrowed per-key), so pin these to their known registry types
    // (bool, int, int) explicitly rather than fighting the generic -- same
    // pattern as lib/rate-limiting/daily-limits.ts's getDailyLimit().
    const rawSettings = await getSettings([
      "FEATURE_DEMO_MODE",
      "DEMO_SCAN_LIMIT",
      "DEMO_WINDOW_HOURS",
      "SCAN_FETCH_TIMEOUT_MS",
      "SCAN_ASYNC_CHECKS_TIMEOUT_MS",
      "SCAN_RESPONSE_BODY_MAX_BYTES",
    ] as const);
    const FEATURE_DEMO_MODE = Boolean(rawSettings.FEATURE_DEMO_MODE);
    const DEMO_SCAN_LIMIT = Number(rawSettings.DEMO_SCAN_LIMIT);
    const DEMO_WINDOW_HOURS = Number(rawSettings.DEMO_WINDOW_HOURS);
    const MAX_BODY_SIZE = Number(rawSettings.SCAN_RESPONSE_BODY_MAX_BYTES);
    const fetchTimeoutMs = Number(rawSettings.SCAN_FETCH_TIMEOUT_MS);
    const asyncChecksTimeoutMs = Number(
      rawSettings.SCAN_ASYNC_CHECKS_TIMEOUT_MS,
    );
    if (!FEATURE_DEMO_MODE) {
      return NextResponse.json(
        { error: "Demo scanning is disabled on this deployment." },
        { status: 403 },
      );
    }
    const demoScanWindowSeconds = 60 * 60 * DEMO_WINDOW_HOURS;

    // IP-based rate limiting via database
    const ip = await getClientIp();
    const rateLimitKey = `demo_scan:${rateLimitIpKey(ip)}`;
    const rateCheck = await checkRateLimit({
      key: rateLimitKey,
      maxAttempts: DEMO_SCAN_LIMIT,
      windowSeconds: demoScanWindowSeconds,
    });

    if (!rateCheck.allowed) {
      const hours = Math.ceil(rateCheck.retryAfterSeconds / 3600);
      return NextResponse.json(
        {
          error: `Demo limit reached (${DEMO_SCAN_LIMIT} scans per ${DEMO_WINDOW_HOURS} hours). Try again in ~${hours} hour${hours !== 1 ? "s" : ""}, or create a free account for unlimited scans.`,
          remaining: 0,
          limit: DEMO_SCAN_LIMIT,
        },
        { status: 429 },
      );
    }

    const body = await request.json();
    const { url } = body;

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    let urlObj: URL;
    try {
      urlObj = new URL(url);
    } catch {
      return NextResponse.json({ error: "Invalid URL." }, { status: 400 });
    }

    if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
      return NextResponse.json(
        { error: "Only http and https URLs are allowed." },
        { status: 400 },
      );
    }

    // Check access rules (blacklist/whitelist)
    const accessCheck = await checkAccessRules(urlObj.href);
    if (!accessCheck.allowed) {
      return NextResponse.json(
        {
          error: "This target cannot be scanned.",
          details:
            "This domain or IP address has been restricted from scanning for security, privacy, or compliance reasons. Access controls are enforced to protect sensitive infrastructure and user data. If you believe this is an error, please contact support.",
          statusCode: "BLOCKED",
        },
        { status: 403 },
      );
    }

    const startTime = Date.now();

    let response: Response;
    try {
      // URL and protocol were validated above; urlObj.href is normalized.

      // Use safeFetch which validates the URL internally to prevent SSRF
      // Pass the original hostname as the only allowed hostname to prevent redirect-based SSRF
      response = await safeFetch(
        urlObj.href,
        {
          method: "GET",
          headers: {
            "User-Agent": `${APP_NAME}/1.0 (Security Scanner - Demo)`,
          },
          redirect: "follow",
          signal: AbortSignal.timeout(fetchTimeoutMs),
        },
        [urlObj.hostname],
      );
    } catch (fetchError) {
      const message =
        fetchError instanceof Error ? fetchError.message : "Unknown error";
      return NextResponse.json(
        { error: `Could not reach the target URL: ${message}.` },
        { status: 422 },
      );
    }

    const responseBody = await safeReadBody(response, MAX_BODY_SIZE);
    const headers = response.headers;

    // Capture response headers as a plain object for evidence. Redacted the
    // same way every stored scan's are (lib/scanner/response-headers.ts): the
    // demo was the one scan path that echoed a target's Set-Cookie,
    // Authorization and WWW-Authenticate back verbatim, and it is the only
    // one an anonymous caller can reach. The findings are computed from the
    // real `headers` above, not from this copy, so nothing a check reads
    // changes.
    const capturedHeaders: Record<string, string> = {};
    headers.forEach((value, key) => {
      capturedHeaders[key] = value;
    });
    const reportedHeaders = redactSensitiveResponseHeaders(capturedHeaders);

    // A bot challenge in place of the page (lib/scanner/bot-challenge.ts):
    // nothing read from it describes the site, so the page checks are skipped
    // and the page is named as not checked, as in every other scan path.
    const botChallenge = detectBotChallenge(
      response.status,
      headers,
      responseBody,
    );
    const asyncScope = botChallenge ? "network" : "all";

    // Capped at the SAME resolved setting the body was READ with, rather
    // than at a second hardcoded literal. This used to re-cap at 1,000,000
    // bytes: both settings ship a 1 MiB default and both describe themselves
    // as "bytes read from the response body BEFORE body-based checks run",
    // so the literal was a redundant second ceiling sitting 48 KB under the
    // shipped default and ignoring the setting outright. Raising the setting
    // to 5 MB read 5 MB off the wire and threw 4 MB away before any check
    // saw it.
    const bodyForChecks =
      responseBody.length > MAX_BODY_SIZE
        ? responseBody.slice(0, MAX_BODY_SIZE)
        : responseBody;
    // The same engine every other scan runs. This loop used to call the
    // legacy detectors directly, so the demo on the landing page skipped
    // every parsed-page check, the prose view that keeps a page about a
    // vulnerability from scoring as having one, the check that judges the
    // page the redirect landed on, and deduplication: a visitor trying the
    // product saw a different, noisier verdict than the one an account gets
    // for the same URL.
    const syncResult = botChallenge
      ? noPageChecks()
      : await runSyncChecksYielding(
          url,
          headers,
          bodyForChecks,
          null,
          undefined,
          response.url && response.url !== url ? response.url : undefined,
        );
    const syncFindings: Vulnerability[] = syncResult.findings;

    // Read cached subdomains only. cacheOnly is essential here: the demo is
    // anonymous, so it must never trigger the live passive-source + DNS
    // brute-force engine against an arbitrary domain (outbound
    // enumeration/amplification from the shared server IP) or hold the request
    // open on a live sweep. A demo of a host that has been scanned before
    // (e.g. this deployment's own origin) shows its cached subdomains; an
    // uncached host simply shows none.
    const subdomainPromise = autoDiscoverSubdomains(url, {
      cacheOnly: true,
    }).catch(() => {});

    // What the report has to admit it did not manage to run. The phase
    // reports every planned branch as not completed when its ceiling wins or
    // it fails, so an async layer that never answered is not shown to an
    // anonymous visitor as DNS, TLS and the exposed-file probes all clean. It
    // also aborts the losing side, so the live-fetch battery does not keep
    // running against the caller's chosen target once nobody is waiting.
    const asyncResult = await startAsyncPhase({
      url,
      scanners: undefined,
      scope: asyncScope,
      checksTimeoutMs: asyncChecksTimeoutMs,
    });
    const asyncFindings: Vulnerability[] = asyncResult.findings;
    const incomplete: string[] = [...asyncResult.incomplete];

    // Let discovery finish (bounded by its own internal timeout) and read the
    // cached snapshot it recorded, if any.
    await subdomainPromise;
    let subdomains: ReturnType<typeof readSubdomains>;
    try {
      subdomains = readSubdomains(urlObj.hostname);
    } catch {
      subdomains = undefined;
    }

    if (syncResult.checksErrored > 0) incomplete.push(PAGE_CHECKS_INCOMPLETE);
    if (botChallenge) incomplete.push(BOT_CHALLENGE_INCOMPLETE);

    const findings = dedupeScanFindings([...syncFindings, ...asyncFindings]);
    findings.sort(
      (a, b) => SEVERITY_PRIORITY[b.severity] - SEVERITY_PRIORITY[a.severity],
    );

    const duration = Date.now() - startTime;
    const summary = summarizeFindings(findings);

    const result: ScanResult = {
      url,
      scannedAt: new Date().toISOString(),
      duration,
      findings,
      summary,
      responseHeaders: reportedHeaders,
      // Only present when something really did not run, so an ordinary demo
      // is not littered with an empty field.
      ...(incomplete.length > 0 ? { incomplete } : {}),
      ...(subdomains ? { subdomains } : {}),
    };

    return NextResponse.json({
      ...result,
      remaining: rateCheck.remaining,
      limit: DEMO_SCAN_LIMIT,
    });
  } catch {
    return NextResponse.json(
      { error: "An unexpected error occurred." },
      { status: 500 },
    );
  }
}
