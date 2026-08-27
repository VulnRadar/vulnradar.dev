// Typed fetch wrapper for the VulnRadar REST API. Centralises:
//   - Bearer-token authentication
//   - Timeout (default 30s)
//   - JSON body serialization
//   - Rate-limit header capture (X-RateLimit-*) for UI display
//   - Error normalization (ApiError → thrown Error with .status + .body)
//
// All API calls go to VULNRADAR.apiHost (e.g. https://vulnradar.dev/api/v3).
// The service worker is the only place that imports this module for
// network calls; the popup/options import the higher-level `auth.ts`
// and `scan.ts` instead.

import { VULNRADAR } from "./constants";
import type {
  ApiError,
  ReportFormat,
  ReputationResponse,
  ScanHistoryRow,
  ScanJobStarted,
  ScanRequest,
  ScanResult,
  ScanStatusResponse,
  VersionResponse,
} from "./types";

export interface FetchResult<T> {
  readonly ok: boolean;
  readonly status: number;
  readonly body: T;
  readonly rateLimit: {
    readonly limit: number | null;
    readonly remaining: number | null;
    readonly reset: number | null;
  };
}

export class VulnRadarApiError extends Error {
  readonly status: number;
  readonly body: ApiError;
  constructor(status: number, body: ApiError) {
    super(body.error || `API error ${status}`);
    this.name = "VulnRadarApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * True when the API rejected the request because the credential itself is
 * invalid or revoked (401/403) - a problem with the user's own setup.
 * Anything else that isn't a clean success - network error, timeout,
 * 5xx, or any other non-2xx status - is a connectivity/service problem,
 * not a bad key, and callers should treat it as such (e.g. "Failed to
 * connect" rather than "Not connected").
 */
export function isAuthRejection(err: unknown): boolean {
  return (
    err instanceof VulnRadarApiError &&
    (err.status === 401 || err.status === 403)
  );
}

function combineSignals(
  signal?: AbortSignal,
  timeoutMs: number = VULNRADAR.apiTimeoutMs,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function parseRateLimit(headers: Record<string, string>) {
  const num = (k: string) => {
    const v = headers[k.toLowerCase()];
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    limit: num("X-RateLimit-Limit"),
    remaining: num("X-RateLimit-Remaining"),
    reset: num("X-RateLimit-Reset"),
  };
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  apiKey?: string,
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<FetchResult<T>> {
  const url = `${VULNRADAR.apiHost}${path}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  // credentials: "omit" ensures the extension never sends session cookies.
  // Auth is purely API-key Bearer; cookies from a logged-in VulnRadar
  // session must not silently authenticate extension requests.
  const init: RequestInit = {
    method,
    headers,
    signal: combineSignals(signal, timeoutMs),
    credentials: "omit",
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url, init);

  const status = res.status;
  const text = await res.text();
  const json: unknown = text ? safeJson(text) : null;
  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    responseHeaders[k.toLowerCase()] = v;
  });
  const rateLimit = parseRateLimit(responseHeaders);

  if (!res.ok) {
    const errBody: ApiError =
      json && typeof json === "object"
        ? (json as ApiError)
        : { error: text || res.statusText };
    throw new VulnRadarApiError(status, errBody);
  }

  return {
    ok: true,
    status,
    body: json as T,
    rateLimit: {
      ...rateLimit,
      reset: rateLimit.reset ? new Date(rateLimit.reset).getTime() : null,
    },
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Fetch a generated report as raw bytes. Separate from call<T> above
 * because GET /api/v3/history/[id]/report answers with a FILE (a PDF, a
 * SARIF/JSON document, a Markdown document), not the JSON envelope every
 * other endpoint returns, so it must not be run through safeJson.
 *
 * Returns the bytes plus the content type, so the caller can hand them to
 * the browser's download machinery. Same Bearer-only auth and
 * credentials:"omit" rule as call<T>: a logged-in vulnradar.dev session
 * cookie must never silently authenticate an extension request.
 */
export async function fetchReport(
  apiKey: string,
  scanId: number,
  format: ReportFormat,
  timeoutMs: number = VULNRADAR.apiTimeoutMs,
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const url = `${VULNRADAR.apiHost}/api/v3/history/${scanId}/report?format=${encodeURIComponent(format)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: combineSignals(undefined, timeoutMs),
    credentials: "omit",
  });

  if (!res.ok) {
    // Error responses ARE json, so surface the server's message the same
    // way call<T> does rather than a bare status code.
    const text = await res.text().catch(() => "");
    const json = text ? safeJson(text) : null;
    const errBody: ApiError =
      json && typeof json === "object"
        ? (json as ApiError)
        : { error: text || res.statusText };
    throw new VulnRadarApiError(res.status, errBody);
  }

  return {
    bytes: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
  };
}

export const api = {
  me: (apiKey: string) =>
    call<import("./types").AuthMe>("GET", "/api/v3/auth/me", undefined, apiKey),

  // Public, unauthenticated -- no API key needed. Used to show the connected
  // VulnRadar instance's version in the options page, separate from the
  // extension's own version (read from the manifest).
  version: () => call<VersionResponse>("GET", "/api/version"),

  // Never returns a finished ScanResult -- like /api/v3/scan/crawl, the
  // server starts the scan in the background and responds immediately
  // with a job id. Callers must poll scanStatus() below.
  scan: (apiKey: string, body: ScanRequest) =>
    call<ScanJobStarted>(
      "POST",
      "/api/v3/scan",
      body,
      apiKey,
      undefined,
      VULNRADAR.apiTimeoutMs,
    ),

  // Never returns a finished ScanResult -- the server starts the crawl in
  // the background and responds immediately with a job id. Callers must
  // poll scanStatus() below until it reports "completed" or "failed".
  scanCrawl: (
    apiKey: string,
    body: ScanRequest & { readonly urls?: readonly string[] },
  ) =>
    call<ScanJobStarted>(
      "POST",
      "/api/v3/scan/crawl",
      body,
      apiKey,
      undefined,
      VULNRADAR.apiTimeoutMs,
    ),

  scanStatus: (apiKey: string, scanId: number) =>
    call<ScanStatusResponse>(
      "GET",
      `/api/v3/scan/status/${scanId}`,
      undefined,
      apiKey,
      undefined,
      VULNRADAR.apiTimeoutMs,
    ),

  history: (apiKey: string) =>
    call<{ readonly scans: readonly ScanHistoryRow[] }>(
      "GET",
      "/api/v3/history",
      undefined,
      apiKey,
    ),

  historyDetail: (apiKey: string, id: number) =>
    call<ScanResult>("GET", `/api/v3/history/${id}`, undefined, apiKey),

  reputation: (apiKey: string, host: string) =>
    call<ReputationResponse>(
      "GET",
      `/api/v3/scan/reputation?host=${encodeURIComponent(host)}`,
      undefined,
      apiKey,
    ),
};
