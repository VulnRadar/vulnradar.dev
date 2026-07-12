// Background service worker (MV3). Routes messages from the popup,
// options page, and content script. Triggers scans, manages auth,
// fires the auto-scan pipeline.
//
// Message envelope (typed; consumer code narrows the union):
//   From popup / options:
//     { kind: "scan:current", tabId?: number }
//     { kind: "scan:url",     url: string }
//     { kind: "history:list"  }
//     { kind: "history:detail", id: number }
//     { kind: "auth:status"   }
//     { kind: "auth:paste",    apiKey: string }
//     { kind: "auth:clear"     }
//     { kind: "settings:get"   }
//     { kind: "settings:set",   patch: Partial<Settings> }
//     { kind: "tab:url"        } -> returns { url: string | null }
//
//   From content script:
//     { kind: "page:loaded",   url: string, title: string }

import browser from "webextension-polyfill";
import { api, VulnRadarApiError } from "../lib/api";
import { clear as clearAuth, pasteKey as authPasteKey, refreshMe } from "../lib/auth";
import { loadAll, saveAll } from "../lib/storage";
import {
  canAutoScanNow,
  noteAutoScanRan,
  refreshHistoryFromServer,
  runScanSafe,
  shouldAutoScan,
} from "../lib/scan";
import { VULNRADAR } from "../lib/constants";
import {
  ALL_SEVERITIES,
  type ScanResult,
  type Settings,
  type Vulnerability,
} from "../lib/types";

interface ScanCurrentMsg {
  readonly kind: "scan:current";
  readonly tabId?: number;
}
interface ScanUrlMsg {
  readonly kind: "scan:url";
  readonly url: string;
}
interface HistoryListMsg {
  readonly kind: "history:list";
}
interface HistoryDetailMsg {
  readonly kind: "history:detail";
  readonly id: number;
}
interface AuthStatusMsg {
  readonly kind: "auth:status";
}
interface AuthPasteMsg {
  readonly kind: "auth:paste";
  readonly apiKey: string;
}
interface AuthClearMsg {
  readonly kind: "auth:clear";
}
interface SettingsGetMsg {
  readonly kind: "settings:get";
}
interface SettingsSetMsg {
  readonly kind: "settings:set";
  readonly patch: Partial<Settings>;
}
interface TabUrlMsg {
  readonly kind: "tab:url";
}

type IncomingMessage =
  | ScanCurrentMsg
  | ScanUrlMsg
  | HistoryListMsg
  | HistoryDetailMsg
  | AuthStatusMsg
  | AuthPasteMsg
  | AuthClearMsg
  | SettingsGetMsg
  | SettingsSetMsg
  | TabUrlMsg;

interface ScanOutcomeMsg {
  readonly ok: boolean;
  readonly url?: string;
  readonly summary?: import("../lib/types").ScanSummary;
  readonly findingsCount?: number;
  readonly error?: string;
  readonly requiresAuth?: boolean;
  readonly retryAfterMs?: number;
  readonly reason?: string;
  readonly scannedAt?: string;
  readonly duration?: number;
}

interface PageLoadedMsg {
  readonly kind: "page:loaded";
  readonly url: string;
  readonly title: string;
}

// ---- Lifecycle ----

browser.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await browser.runtime.openOptionsPage();
  }
});

browser.runtime.onStartup.addListener(() => {
  void refreshMe().catch(() => {});
});

// Also kick off on first SW load (covers Firefox / dev mode)
void refreshMe().catch(() => {});

// ---- Message router ----

browser.runtime.onMessage.addListener((msg) => {
  const m = msg as IncomingMessage;
  switch (m.kind) {
    case "scan:current":
      return handleScanCurrent(m.tabId);
    case "scan:url":
      return handleScanUrl(m.url);
    case "history:list":
      return refreshHistoryFromServer();
    case "history:detail":
      return handleHistoryDetail(m.id);
    case "auth:status":
      return refreshMe();
    case "auth:paste":
      return authPasteKey(m.apiKey);
    case "auth:clear":
      return clearAuth();
    case "settings:get":
      return handleSettingsGet();
    case "settings:set":
      return handleSettingsSet(m.patch);
    case "tab:url":
      return handleTabUrl();
  }
  return undefined;
});

async function handleScanCurrent(
  tabId?: number,
): Promise<ScanOutcomeMsg> {
  let url: string | null = null;
  try {
    if (tabId !== undefined) {
      const tab = await browser.tabs.get(tabId);
      url = tab?.url ?? null;
    } else {
      const [active] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      url = active?.url ?? null;
    }
  } catch {
    return { ok: false, error: "Cannot read active tab" };
  }
  if (!url) return { ok: false, error: "No active tab URL" };
  if (!/^https?:/i.test(url)) {
    return { ok: false, error: `Skipped (${new URL(url).protocol} not scannable)` };
  }
  const storage = await loadAll();
  return runScanSafe({ url, settings: storage.settings });
}

async function handleScanUrl(url: string): Promise<ScanOutcomeMsg> {
  if (!/^https?:/i.test(url)) {
    return { ok: false, error: `Skipped (${new URL(url).protocol} not scannable)` };
  }
  const storage = await loadAll();
  return runScanSafe({ url, settings: storage.settings });
}

async function handleHistoryDetail(
  id: number,
): Promise<ScanResult | { error: string }> {
  const auth = await refreshMe();
  if (!auth) return { error: "Not connected" };
  const raw = await browser.storage.local.get("auth");
  const apiKey = (raw as { apiKey?: string } | undefined)?.apiKey;
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

// ---- Auto-scan pipeline (content script -> background) ----

browser.runtime.onMessage.addListener((msg) => {
  if (
    msg &&
    typeof msg === "object" &&
    (msg as { kind?: string }).kind === "page:loaded"
  ) {
    void maybeAutoScan(msg as PageLoadedMsg).catch(() => {});
  }
  return undefined;
});

async function maybeAutoScan(_msg: PageLoadedMsg): Promise<void> {
  const storage = await loadAll();
  if (!storage.auth) return;
  const tab = await handleTabUrl();
  if (!tab.url) return;
  if (!/^https?:/i.test(tab.url)) return;

  const reason = shouldAutoScan(tab.url, storage.settings);
  if (reason !== null) {
    notifyContentScript(tab.url, { kind: "scan:skipped", reason });
    return;
  }
  if (!(await canAutoScanNow(tab.url))) return;
  await noteAutoScanRan();

  const outcome = await runScanSafe({ url: tab.url, settings: storage.settings });
  if (outcome.ok) {
    notifyContentScript(tab.url, {
      kind: "scan:complete",
      result: outcome.result,
    });
    if (shouldNotify(outcome.result, storage.settings)) {
      await sendScanNotification(tab.url, outcome.result);
    }
  } else if (outcome.requiresAuth) {
    notifyContentScript(tab.url, {
      kind: "scan:error",
      error: outcome.error,
    });
  }
}

function shouldNotify(
  result: ScanResult,
  settings: Settings,
): boolean {
  const findings: readonly Vulnerability[] = result.findings;
  if (findings.length === 0) return false;
  if (settings.notifyThreshold === "off") return false;
  if (settings.notifyThreshold === "all") return true;
  const order: Record<string, number> = {
    info: 0,
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };
  for (const f of findings) {
    if (order[f.severity] >= order[settings.notifyThreshold]) {
      return true;
    }
  }
  return false;
}

async function sendScanNotification(
  url: string,
  result: ScanResult,
): Promise<void> {
  const findings: readonly Vulnerability[] = result.findings;
  const high = findings.filter(
    (f) => f.severity === "critical" || f.severity === "high",
  );
  const head = `${high.length > 0 ? high.length : findings.length} finding${
    findings.length === 1 ? "" : "s"
  } on ${shortHost(url)}`;
  const body =
    findings.length === 0
      ? "No issues found"
      : findings.length === 1
        ? findings[0]!.title
        : `${findings[0]!.title} +${findings.length - 1} more`;

  await browser.notifications.create("vulnradar-scan", {
    type: "basic",
    iconUrl: browser.runtime.getURL("icons/icon-128.png"),
    title: `VulnRadar \u2014 ${head}`,
    message: body,
  });
  if (true /* settings.openDashboardOnNotify */) {
    browser.action.setBadgeText({
      text: String(findings.length || ""),
    });
    browser.action.setBadgeBackgroundColor({ color: "#ef4444" });
  }
}

function shortHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

type ContentScriptMsg =
  | { readonly kind: "scan:complete"; readonly result: ScanResult }
  | { readonly kind: "scan:skipped"; readonly reason: string }
  | { readonly kind: "scan:error"; readonly error: string };

async function notifyContentScript(
  url: string,
  payload: ContentScriptMsg,
): Promise<void> {
  try {
    const tabs = await browser.tabs.query({
      url: [matchUrlPattern(url)],
    });
    for (const t of tabs) {
      if (t.id !== undefined) {
        await browser.tabs.sendMessage(t.id, payload);
      }
    }
  } catch {
    // tabs.sendMessage rejects if content script hasn't loaded yet.
  }
}

function matchUrlPattern(url: string): string {
  return `${url.split("/").slice(0, 3).join("/")}/*`;
}
