// Background service worker (MV3). Single onMessage listener routes all
// messages from the popup, options page, and content script. Also runs
// the auto-scan pipeline on page load, tab focus, and URL change events.
//
// Tab URL reliability: content-script messages carry the tab URL in
// sender.tab.url — that is the only reliable cross-browser source of
// "which tab triggered this". We never re-query the active tab for
// auto-scan; we use sender.tab directly.
//
// Message kinds:
//   From popup / options:
//     { kind: "scan:url",      url: string, mode?: "quick"|"deep" }
//     { kind: "history:list"  }
//     { kind: "history:detail", id: number }
//     { kind: "auth:status"   }
//     { kind: "auth:paste",   apiKey: string }
//     { kind: "auth:clear"    }
//     { kind: "settings:get"  }
//     { kind: "settings:set", patch: Partial<Settings> }
//     { kind: "tab:url"       } → { url: string | null }
//   From content script:
//     { kind: "page:loaded",  url: string, title: string }

import browser from "webextension-polyfill";
import { api, VulnRadarApiError } from "../lib/api";
import {
  clear as clearAuth,
  pasteKey as authPasteKey,
  refreshMe,
} from "../lib/auth";
import { get, getApiKey, loadAll, saveAll } from "../lib/storage";
import {
  canAutoScanNow,
  noteAutoScanRan,
  refreshHistoryFromServer,
  runScanSafe,
  shouldAutoScanPolicy,
} from "../lib/scan";
import { VULNRADAR } from "../lib/constants";
import type { ScanResult, Settings, Vulnerability } from "../lib/types";

// ---- Lifecycle ----

browser.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await browser.runtime.openOptionsPage();
  }
  // Set up context menu on install/update
  browser.contextMenus.create({
    id: "vulnradar-scan-link",
    title: "Scan this link with VulnRadar",
    contexts: ["link"],
  });
});

browser.runtime.onStartup.addListener(() => {
  void refreshMe().catch(() => {});
});

// Kick off on first SW load (covers Firefox / dev mode)
void refreshMe().catch(() => {});

// ---- Context menu ----

browser.contextMenus.onClicked.addListener((info) => {
  const url = info.linkUrl;
  if (!url || !/^https?:/i.test(url)) return;
  void (async () => {
    const storage = await loadAll();
    if (!storage.auth) return;
    await runAndBadge(url, storage.settings);
  })();
});

// ---- Notification click → open history ----

browser.notifications.onClicked.addListener((_notifId) => {
  void (async () => {
    const cache = await get("historyCache");
    const latest = cache?.[0];
    if (latest && latest.id > 0) {
      await browser.tabs.create({
        url: `${VULNRADAR.apiHost}/history/${latest.id}`,
      });
    } else {
      await browser.tabs.create({ url: `${VULNRADAR.apiHost}/dashboard` });
    }
  })();
});

// ---- Single message router ----

browser.runtime.onMessage.addListener(
  (
    msg: unknown,
    sender: browser.Runtime.MessageSender,
    sendResponse: (r: unknown) => void,
  ) => {
    const m = msg as { kind: string } & Record<string, unknown>;
    let promise: Promise<unknown>;

    switch (m.kind) {
      case "scan:url":
        promise = handleScanUrl(
          m.url as string,
          m.mode as "quick" | "deep" | undefined,
        );
        break;
      case "history:list":
        promise = refreshHistoryFromServer();
        break;
      case "history:detail":
        promise = handleHistoryDetail(m.id as number);
        break;
      case "auth:status":
        promise = refreshMe();
        break;
      case "auth:paste":
        promise = authPasteKey(m.apiKey as string);
        break;
      case "auth:clear":
        promise = clearAuth();
        break;
      case "settings:get":
        promise = handleSettingsGet();
        break;
      case "settings:set":
        promise = handleSettingsSet(m.patch as Partial<Settings>);
        break;
      case "tab:url":
        promise = handleTabUrl();
        break;
      case "page:loaded":
        // Auto-scan pipeline: use sender.tab.url (reliable cross-browser)
        promise = maybeAutoScanFromSender(sender).catch(() => {});
        break;
      default:
        return undefined;
    }

    promise.then(sendResponse).catch(() => sendResponse(undefined));
    return true; // keep message channel open for async response
  },
);

// ---- Auto-scan: page load (content script message) ----

async function maybeAutoScanFromSender(
  sender: browser.Runtime.MessageSender,
): Promise<void> {
  // sender.tab.url is the definitive URL of the tab that loaded the page.
  // Never re-query the active tab — it may have changed by the time the
  // async handler runs, which is exactly the Firefox bug we're fixing.
  const url = sender.tab?.url;
  if (!url || !/^https?:/i.test(url)) return;

  const storage = await loadAll();
  if (!storage.auth) return;
  if (storage.settings.autoScan !== "onPageLoad") return;

  await maybeAutoScanUrl(url, storage.settings, sender.tab?.id);
}

// ---- Auto-scan: tab focus (onTabFocus mode) ----

browser.tabs.onActivated.addListener(async ({ tabId }) => {
  const storage = await loadAll();
  if (!storage.auth || storage.settings.autoScan !== "onTabFocus") return;
  try {
    const tab = await browser.tabs.get(tabId);
    if (!tab.url || !/^https?:/i.test(tab.url)) return;
    await maybeAutoScanUrl(tab.url, storage.settings, tabId);
  } catch {
    // tab may not exist anymore
  }
});

// ---- Auto-scan: URL change (onUrlChange mode) ----

browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return; // only fire when the URL itself changes
  const storage = await loadAll();
  if (!storage.auth || storage.settings.autoScan !== "onUrlChange") return;
  if (!/^https?:/i.test(changeInfo.url)) return;
  await maybeAutoScanUrl(changeInfo.url, storage.settings, tabId);
});

const EXCLUDED_HOSTS = ["sandbox.vulnradar.dev", "vulnradar.dev", "www.vulnradar.dev"];

async function maybeAutoScanUrl(
  url: string,
  settings: Settings,
  tabId?: number,
): Promise<void> {
  // Never auto-scan the VulnRadar platform itself.
  try {
    if (EXCLUDED_HOSTS.includes(new URL(url).hostname)) return;
  } catch {
    return;
  }

  const reason = shouldAutoScanPolicy(url, settings);
  if (reason !== null) {
    if (tabId !== undefined) {
      notifyTab(tabId, { kind: "scan:skipped", reason });
    }
    return;
  }
  if (!(await canAutoScanNow(url))) return;
  await noteAutoScanRan();

  if (tabId !== undefined) {
    notifyTab(tabId, { kind: "scan:started" });
  }

  const outcome = await runScanSafe({ url, settings });
  if (outcome.ok) {
    if (tabId !== undefined) {
      notifyTab(tabId, { kind: "scan:complete", result: outcome.result });
    }
    await runAndBadge(url, settings, outcome.result);
    if (shouldNotify(outcome.result, settings)) {
      await sendScanNotification(url, outcome.result);
    }
  } else {
    if (tabId !== undefined) {
      notifyTab(tabId, { kind: "scan:error", error: outcome.error });
    }
    clearBadge();
  }
}

// ---- Message handlers ----

async function handleScanUrl(
  url: string,
  mode?: "quick" | "deep",
): Promise<unknown> {
  if (!url || !/^https?:/i.test(url)) {
    return { ok: false, error: `Not a scannable URL` };
  }
  const storage = await loadAll();
  return runScanSafe({ url, settings: storage.settings, mode });
}

async function handleHistoryDetail(
  id: number,
): Promise<ScanResult | { error: string }> {
  await refreshMe();
  const apiKey = await getApiKey();
  if (!apiKey) return { error: "Not connected" };
  try {
    const res = await api.historyDetail(apiKey, id);
    return res.body;
  } catch (err) {
    if (err instanceof VulnRadarApiError) {
      return { error: err.body.error || `API error ${err.status}` };
    }
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleSettingsGet(): Promise<{ settings: Settings }> {
  const storage = await loadAll();
  return { settings: storage.settings };
}

async function handleSettingsSet(
  patch: Partial<Settings>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const storage = await loadAll();
  const merged: Settings = {
    ...storage.settings,
    ...patch,
    families: { ...storage.settings.families, ...(patch.families ?? {}) },
    probes: deepMergeProbes(storage.settings.probes, patch.probes),
  };
  await saveAll({ ...storage, settings: merged });
  return { ok: true };
}

function deepMergeProbes(
  base: Readonly<Settings["probes"]>,
  patch: Readonly<Partial<Settings["probes"]>> | undefined,
): Settings["probes"] {
  if (!patch) return { ...base };
  const out: Record<string, { enabled: boolean; port: number }> = {};
  for (const [k, v] of Object.entries(base)) {
    out[k] = { ...v };
  }
  for (const [k, v] of Object.entries(patch)) {
    if (!v) continue;
    out[k] = { ...(out[k] ?? { enabled: false, port: 0 }), ...v };
  }
  return out as Settings["probes"];
}

async function handleTabUrl(): Promise<{ url: string | null }> {
  try {
    const [active] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    return { url: active?.url ?? null };
  } catch {
    return { url: null };
  }
}

// ---- Badge + notifications ----

async function runAndBadge(
  url: string,
  settings: Settings,
  result?: ScanResult,
): Promise<void> {
  if (!result) {
    const outcome = await runScanSafe({ url, settings });
    if (!outcome.ok) { clearBadge(); return; }
    result = outcome.result;
  }
  const score = result.dangerScore ?? 0;
  const color =
    score >= 8 ? "#ef4444" :
    score >= 5 ? "#f97316" :
    score >= 3 ? "#eab308" :
    "#22c55e";
  try {
    browser.action.setBadgeText({ text: score > 0 ? String(score) : "" });
    browser.action.setBadgeBackgroundColor({ color });
  } catch {
    // Firefox may not support action.setBadge* in all contexts
  }
}

function clearBadge(): void {
  try {
    browser.action.setBadgeText({ text: "" });
  } catch { /* noop */ }
}

function shouldNotify(result: ScanResult, settings: Settings): boolean {
  const findings: readonly Vulnerability[] = result.findings;
  if (findings.length === 0) return false;
  if (settings.notifyThreshold === "off") return false;
  if (settings.notifyThreshold === "all") return true;
  const rank: Record<string, number> = {
    info: 0, low: 1, medium: 2, high: 3, critical: 4,
  };
  for (const f of findings) {
    if (rank[f.severity] >= rank[settings.notifyThreshold]) return true;
  }
  return false;
}

async function sendScanNotification(
  url: string,
  result: ScanResult,
): Promise<void> {
  const findings = result.findings;
  const high = findings.filter(
    (f) => f.severity === "critical" || f.severity === "high",
  );
  const count = high.length > 0 ? high.length : findings.length;
  const head = `${count} finding${count === 1 ? "" : "s"} on ${shortHost(url)}`;
  const body =
    findings.length === 0
      ? "No issues found"
      : findings.length === 1
        ? findings[0]!.title
        : `${findings[0]!.title} +${findings.length - 1} more`;

  await browser.notifications.create("vulnradar-scan", {
    type: "basic",
    iconUrl: browser.runtime.getURL("icons/icon-128.png"),
    title: `VulnRadar: ${head}`,
    message: body,
  });
}

function shortHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function notifyTab(
  tabId: number,
  payload:
    | { kind: "scan:started" }
    | { kind: "scan:complete"; result: ScanResult }
    | { kind: "scan:skipped"; reason: string }
    | { kind: "scan:error"; error: string },
): void {
  browser.tabs.sendMessage(tabId, payload).catch(() => {
    // Content script may not be loaded yet; safe to ignore.
  });
}
