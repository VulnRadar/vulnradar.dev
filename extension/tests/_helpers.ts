import { vi } from "vitest";

import { storageData } from "./_polyfill-fake";

/** A well-formed API key, as the extension's own pattern requires. */
export const API_KEY = `vr_live_${"a".repeat(64)}`;

export const ME = {
  userId: 1,
  email: "dev@example.com",
  name: null,
  plan: "free",
  role: "user",
  totpEnabled: false,
  twoFactorMethod: null,
  avatarUrl: null,
};

/** A finished scan, in the shape GET /scan/status returns under `result`. */
export function scanResult(url: string, withFinding = false) {
  return {
    url,
    scannedAt: "2026-10-26T12:00:00.000Z",
    duration: 1200,
    findings: withFinding
      ? [
          {
            id: "f1",
            title: "Missing Content-Security-Policy",
            severity: "high",
            category: "headers",
            description: "",
            evidence: "",
          },
        ]
      : [],
    summary: {
      critical: 0,
      high: withFinding ? 1 : 0,
      medium: 0,
      low: 0,
      info: 0,
      total: withFinding ? 1 : 0,
    },
    dangerScore: withFinding ? 6 : 0,
    verdict: withFinding ? "caution" : "safe",
    scanHistoryId: 5,
    scanPublicId: "a".repeat(32),
  };
}

export function seedAuth(): void {
  storageData.auth = { apiKey: API_KEY, me: ME };
}

export interface FetchCall {
  readonly url: URL;
  readonly method: string;
  readonly body: unknown;
}

/**
 * Replaces global fetch with a router over the endpoints the extension calls,
 * and records every request so a test can assert on what was sent. A scan
 * started with POST /scan completes on the first status poll, so no test waits
 * on the 3 second poll interval.
 */
export function installFetch(
  options: { reputation?: unknown; findings?: boolean } = {},
) {
  const calls: FetchCall[] = [];
  let lastScanned = "";
  const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "content-type": "application/json" },
      });

    if (url.pathname === "/api/v3/auth/me") return json(ME);
    if (url.pathname === "/api/v3/scan/reputation") {
      return json(
        options.reputation ?? {
          known: false,
          host: url.searchParams.get("host"),
          dangerScore: null,
          verdict: null,
          severityCounts: null,
          lastScannedAt: null,
          scanId: null,
          matchType: null,
          scannedUrl: null,
        },
      );
    }
    if (
      url.pathname === "/api/v3/scan" ||
      url.pathname === "/api/v3/scan/crawl"
    ) {
      lastScanned = (body as { url: string }).url;
      return json({ scanId: 5, status: "running" });
    }
    if (url.pathname.startsWith("/api/v3/scan/status/")) {
      return json({
        status: "completed",
        currentCategory: null,
        categoriesCompleted: 1,
        categoriesTotal: 1,
        elapsedMs: 10,
        result: scanResult(lastScanned, options.findings === true),
      });
    }
    return json({ error: `unrouted ${url.pathname}` }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return {
    calls,
    /** Requests to a path, in order. */
    to: (pathname: string) => calls.filter((c) => c.url.pathname === pathname),
    reputation: () =>
      calls.filter((c) => c.url.pathname === "/api/v3/scan/reputation"),
    scans: () =>
      calls.filter(
        (c) => c.method === "POST" && c.url.pathname === "/api/v3/scan",
      ),
  };
}

export const POPUP = {
  id: "support@vulnradar.dev",
  url: "moz-extension://test-uuid/popup.html",
};

export function contentSender(
  tabUrl: string,
  options: { tabId?: number; incognito?: boolean } = {},
) {
  return {
    id: "support@vulnradar.dev",
    url: tabUrl,
    tab: {
      id: options.tabId ?? 7,
      url: tabUrl,
      incognito: options.incognito ?? false,
    },
  };
}

type RouterListener = (
  msg: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => unknown;

/** Delivers one message to the router and resolves with what it answers. */
export function deliver(
  listener: RouterListener,
  message: unknown,
  sender: unknown,
): Promise<unknown> {
  return new Promise((resolve) => {
    listener(message, sender, resolve);
  });
}

/** Lets pending microtasks and zero-delay timers run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}
