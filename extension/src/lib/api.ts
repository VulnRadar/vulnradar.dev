// Typed fetch wrapper for the VulnRadar REST API. Centralises:
//   - Bearer-token authentication
//   - Timeout (default 30s)
//   - JSON body serialization
//   - Rate-limit header capture (X-RateLimit-*) for UI display
//   - Error normalization (ApiError → thrown Error with .status + .body)
//
// All API calls go to VULNRADAR.apiHost (e.g. https://sandbox.vulnradar.dev/api/v3).
// The service worker is the only place that imports this module for
// network calls; the popup/options import the higher-level `auth.ts`
// and `scan.ts` instead.

import { VULNRADAR } from "./constants";
import type {
  ApiError,
  ScanHistoryRow,
  ScanRequest,
  ScanResult,
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

function combineSignals(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(VULNRADAR.apiTimeoutMs);
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
): Promise<FetchResult<T>> {
  const url = `${VULNRADAR.apiHost}${path}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  // credentials: "omit" ensures the extension never sends session cookies.
  // Auth is purely API-key Bearer; cookies from a logged-in VulnRadar
  // session must not silently authenticate extension requests.
  const init: RequestInit = { method, headers, signal: combineSignals(signal), credentials: "omit" };
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

export const api = {
  me: (apiKey: string) =>
    call<import("./types").AuthMe>("GET", "/api/v3/auth/me", undefined, apiKey),

  scan: (apiKey: string, body: ScanRequest) =>
    call<ScanResult>("POST", "/api/v3/scan", body, apiKey),

  scanCrawl: (
    apiKey: string,
    body: ScanRequest & { readonly urls?: readonly string[] },
  ) => call<ScanResult>("POST", "/api/v3/scan/crawl", body, apiKey),

  history: (apiKey: string) =>
    call<{ readonly scans: readonly ScanHistoryRow[] }>(
      "GET",
      "/api/v3/history",
      undefined,
      apiKey,
    ),

  historyDetail: (apiKey: string, id: number) =>
    call<ScanResult>("GET", `/api/v3/history/${id}`, undefined, apiKey),
};
