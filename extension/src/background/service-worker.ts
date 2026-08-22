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
//       The popup relays manual scans through here rather than calling
//       runScanSafe() itself: the popup document is torn down the instant
//       it loses focus (very easy while waiting on a multi-minute scan),
//       which would kill an in-flight await in the popup's own context.
//       This context persists independent of the popup, so the scan
//       survives that. handleScanUrl() also mirrors its progress/outcome
//       into storage (scanInProgress / lastScanCompletion) so a popup that
//       reopens after being closed mid-scan can recover accurate state.
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
//     { kind: "reputation:scan",        url: string }
//     { kind: "reputation:mute-site",   pattern: string }
//     { kind: "reputation:mute-global"  }
//     { kind: "reputation:snooze-site", host: string }
//   From popup (relayed to the active tab's content script, not handled
//   here - see detector.ts's onMessage listener):
//     { kind: "reputation:show-again"   }

import browser from "webextension-polyfill";
import type Browser from "webextension-polyfill";
import { api, VulnRadarApiError } from "../lib/api";
import {
  clear as clearAuth,
  pasteKey as authPasteKey,
  refreshMe,
} from "../lib/auth";
import { get, getApiKey, loadAll, saveAll, set } from "../lib/storage";
import {
  canAutoScanNow,
  noteAutoScanRan,
  refreshHistoryFromServer,
  runScanSafe,
  shouldAutoScanPolicy,
} from "../lib/scan";
import type { ScanOutcome } from "../lib/scan";
import {
  addMutePattern,
  cacheReputation,
  cacheReputationFromScan,
  canCheckReputationNow,
  canShowPopupForUrl,
  checkReputation,
  getCachedReputation,
  noteReputationChecked,
  noteReputationShown,
  shouldShowReputationCard,
  snoozeHost,
  willAutoScanHandleSilently,
} from "../lib/reputation";
import { clearBadge, setBadgeForResult, setBadgeForScore } from "../lib/badge";
import { VULNRADAR } from "../lib/constants";
import { DEFAULT_SETTINGS } from "../lib/types";
import type {
  ReputationResponse,
  ScanResult,
  Settings,
  Vulnerability,
} from "../lib/types";

// ---- Lifecycle ----

browser.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    // First install: open the dedicated onboarding page (welcome.html), which
    // walks through creating an account, generating an API key, and pasting it
    // in -- a friendlier first run than dropping straight into the full options
    // page. Its buttons hand off to openOptionsPage() once the user is ready.
    // Falls back to the options page if the welcome tab can't be created.
    try {
      await browser.tabs.create({
        url: browser.runtime.getURL("welcome.html"),
      });
    } catch {
      await browser.runtime.openOptionsPage();
    }
  }
  // Wipe any extension-wide default badge left over from before every
  // badge write was made tab-scoped (see lib/badge.ts) - that global value
  // persists in the browser itself across service worker restarts/updates
  // and would otherwise keep bleeding into any tab that hasn't had its own
  // tab-scoped badge set yet.
  clearBadge();
  // Set up context menu on install/update. removeAll() first: on every
  // "update" (extension version bump, or a dev reload of the unpacked
  // extension) the item registered by the previous run is still there,
  // and create() with a duplicate id rejects with "Cannot create item
  // with duplicate id vulnradar-scan-link" - previously unhandled here,
  // so every update/reload logged an unhandled promise rejection and
  // silently failed to (re-)register the menu item.
  try {
    await browser.contextMenus.removeAll();
  } catch {
    /* noop */
  }
  try {
    await browser.contextMenus.create({
      id: "vulnradar-scan-link",
      title: "Scan this link with VulnRadar",
      contexts: ["link"],
    });
  } catch {
    /* noop */
  }
});

browser.runtime.onStartup.addListener(() => {
  void refreshMe().catch(() => {});
});

// Kick off on first SW load (covers Firefox / dev mode)
void refreshMe().catch(() => {});

// ---- Context menu ----

// Was bare runAndBadge() -- only stamped the toolbar badge, with no other
// feedback: no on-page "Scanning..." indicator, no desktop notification,
// nothing. A scan can legitimately take up to 300s, so a click that
// produces no visible response for that long reads as broken. Every other
// scan trigger (auto-scan, the on-page card's "Scan now") already goes
// through runScanAndNotify() for exactly this reason; this one had
// silently never been upgraded to match when it was added.
browser.contextMenus.onClicked.addListener((info, tab) => {
  const url = info.linkUrl;
  if (!url || !/^https?:/i.test(url)) return;
  void (async () => {
    const storage = await loadAll();
    if (!storage.auth) return;
    await runScanAndNotify(url, storage.settings, tab?.id);
  })();
});

// ---- Scan keep-alive alarm ----
//
// lib/scan.ts's withScanKeepAlive() schedules a repeating "vulnradar-scan-
// keepalive" alarm for the duration of any in-flight scan request, purely
// so Chrome sees ongoing extension activity and doesn't suspend this
// service worker mid-scan (see that function's comment for why). There is
// nothing to do when it fires - the firing itself is the point - but a
// registered listener avoids an "unchecked" warning and documents intent.

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "vulnradar-scan-keepalive") return;
});

// ---- Notification click → open history ----

browser.notifications.onClicked.addListener((_notifId) => {
  void (async () => {
    // Settings > Notifications > "Open dashboard on click". Was previously
    // unconditional -- the setting existed (default true) but nothing ever
    // read it, so clicking a notification always opened a tab regardless
    // of this toggle.
    const settings = (await get("settings")) ?? DEFAULT_SETTINGS;
    if (!settings.openDashboardOnNotify) return;
    const cache = await get("historyCache");
    const latest = cache?.[0];
    if (latest && latest.id > 0) {
      await browser.tabs.create({
        url: `${VULNRADAR.apiHost}/history?scan=${latest.id}`,
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
    sender: Browser.Runtime.MessageSender,
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
        // Auto-scan pipeline: use sender.tab.url (reliable cross-browser).
        // Runs alongside the site-alert reputation check below - the two
        // are independent features (auto-scan can be off while alerts
        // stay on, and vice versa).
        promise = Promise.all([
          maybeAutoScanFromSender(sender).catch(() => {}),
          maybeShowReputationFromSender(sender).catch(() => {}),
        ]).then(() => undefined);
        break;
      case "reputation:scan":
        promise = handleReputationScan(m.url as string, sender.tab?.id);
        break;
      case "reputation:mute-site":
        promise = handleMuteSite(m.pattern as string);
        break;
      case "reputation:mute-global":
        promise = handleMuteGlobal();
        break;
      case "reputation:snooze-site":
        promise = handleSnoozeSite(m.host as string);
        break;
      default:
        // This is the only onMessage listener in the background context, so
        // nothing else is waiting to handle an unknown kind. Answer it rather
        // than returning without a response, which would leave the caller's
        // sendMessage promise pending until the channel closes.
        sendResponse(undefined);
        return true;
    }

    promise.then(sendResponse).catch(() => sendResponse(undefined));
    return true; // keep message channel open for async response
  },
);

// ---- Auto-scan: page load (content script message) ----

async function maybeAutoScanFromSender(
  sender: Browser.Runtime.MessageSender,
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

// ---- Site alerts: reputation popup on page load ----
//
// Independent of the autoScan setting - shows a small on-page card via
// the content script, either summarizing a known host's last scan or
// offering to scan an unknown one. See lib/reputation.ts for the
// throttle/mute/policy helpers this composes.

async function maybeShowReputationFromSender(
  sender: Browser.Runtime.MessageSender,
): Promise<void> {
  const url = sender.tab?.url;
  const tabId = sender.tab?.id;
  if (!url || !/^https?:/i.test(url) || tabId === undefined) return;

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return;
  }
  // Only the live app instance itself is excluded from the reputation
  // popup (not the wider EXCLUDED_HOSTS list used below for auto-scan) -
  // the public marketing domain (vulnradar.dev / www) is an ordinary
  // website that can have its own genuine, already-scanned reputation
  // record worth showing, same as any other host a user visits.
  if (host === new URL(VULNRADAR.apiHost).hostname) return;

  const storage = await loadAll();
  if (!storage.auth) return;
  if (!(await canShowPopupForUrl(url, storage.settings))) return;

  let rep: ReputationResponse | null;
  if (await canCheckReputationNow(host)) {
    rep = await checkReputation(storage.auth.apiKey, host);
    // Only consume the throttle window / update the cache once a check
    // actually completed. If checkReputation() failed (network error,
    // non-2xx, bad auth), marking the host "checked" here would silence
    // the popup for this host for the full throttle window on every
    // future visit too, for as long as whatever's causing the failure
    // keeps failing - the popup would then never come back, not just skip
    // once. Let a genuine failure retry on the very next visit instead.
    if (!rep) return;
    await noteReputationChecked(host);
    await cacheReputation(host, rep);
  } else {
    // Throttled: a fresh network check would spam the endpoint on every
    // reload/renavigation within the window, but returning here with
    // nothing sent to the tab reads as "the card (and the toolbar badge)
    // just stopped working" to a user with no idea a throttle exists.
    // Fall back to the last-known result for this host instead of going
    // silent - only skip entirely if we've never learned anything about
    // it yet.
    rep = await getCachedReputation(host);
    if (!rep) return;
  }

  if (rep.known) {
    // Keep the toolbar badge accurate even when the user never triggers a
    // scan themselves - it should reflect the last known danger score for
    // the host they're currently looking at, same as after a manual scan.
    // tabId keeps this scoped to the tab that's actually showing this
    // host, so it never bleeds into whatever tab the user switches to
    // next. Reachable from both the fresh-check and throttled/cached
    // branches above, so the badge stays in sync on every visit, not just
    // the first one every throttle window. Unconditional on purpose: the
    // toolbar badge is a separate surface from the on-page card below, not
    // gated by showScanResults/showScanPrompts.
    setBadgeForScore(rep.dangerScore ?? 0, tabId);
    // Pass the raw tab hostname (not rep.host) as the mute key. The API
    // normalizes to the root domain internally (e.g. app.example.com ->
    // example.com) for its own lookup, but canShowPopupForUrl/
    // canCheckReputationNow above were checked against the raw hostname -
    // muting has to write back to that same key or a later visit to this
    // exact host would pass the pre-check again and re-show the card.
    //
    // canShowPopupForUrl already let this request through as long as
    // EITHER granular setting was on (it can't know in advance which of
    // the two this host will need) -- the specific check for the "known"
    // half happens here, now that we actually know which card applies.
    // Automatic version of the card's manual "Snooze 24h" action: the same
    // result for the same host doesn't re-show every reload/tab switch/
    // re-visit, but the suppression window elapsing or a genuinely new
    // scan result still does. See shouldShowReputationCard's own comment
    // for why this is separate from canShowPopupForUrl's mute/snooze
    // checks above (those run before the result is known; this runs
    // after, and covers the unknown-card branch below too).
    if (
      storage.settings.showScanResults &&
      (await shouldShowReputationCard(host, rep))
    ) {
      notifyTab(tabId, { kind: "reputation:known", data: rep, host });
      await noteReputationShown(host, rep);
    }
  } else if (
    storage.settings.showScanPrompts &&
    !willAutoScanHandleSilently(url, storage.settings) &&
    (await shouldShowReputationCard(host, rep))
  ) {
    notifyTab(tabId, { kind: "reputation:unknown", data: rep, url, host });
    await noteReputationShown(host, rep);
  }
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

const EXCLUDED_HOSTS = [
  "sandbox.vulnradar.dev",
  "vulnradar.dev",
  "www.vulnradar.dev",
];

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

  await runScanAndNotify(url, settings, tabId);
}

/**
 * Refreshes the local reputation cache with a scan's own result, so a page
 * reload right after scanning doesn't fall back to whatever stale "not
 * scanned"/older result was cached before this scan ran (see
 * cacheReputationFromScan's doc comment in lib/reputation.ts). Shared by
 * every scan-completion path: auto-scan, the site-alert card's "Scan now",
 * and the popup's manual scan button. Best-effort - an unparsable URL or a
 * storage write failure should never fail the scan it's piggybacking on.
 */
async function cacheReputationFromResult(
  url: string,
  result: ScanResult,
): Promise<void> {
  try {
    const host = new URL(url).hostname;
    await cacheReputationFromScan(host, result);
  } catch (err) {
    console.error("[vulnradar] Failed to update reputation cache:", err);
  }
}

/**
 * Runs a scan and drives the tab lifecycle messages + badge + desktop
 * notification around it - the part every scan trigger (auto-scan and the
 * on-page "Scan now" button) shares once it has decided the scan should
 * happen. Callers are responsible for their own policy/throttle checks
 * first; this always runs.
 */
async function runScanAndNotify(
  url: string,
  settings: Settings,
  tabId?: number,
): Promise<ScanOutcome> {
  if (tabId !== undefined) {
    notifyTab(tabId, { kind: "scan:started" });
  }

  const outcome = await runScanSafe({ url, settings });
  if (outcome.ok) {
    if (tabId !== undefined) {
      notifyTab(tabId, { kind: "scan:complete", result: outcome.result });
    }
    await cacheReputationFromResult(url, outcome.result);
    await runAndBadge(url, settings, outcome.result, tabId);
    if (shouldNotify(outcome.result, settings)) {
      await sendScanNotification(url, outcome.result, settings, tabId);
    }
  } else {
    if (tabId !== undefined) {
      notifyTab(tabId, { kind: "scan:error", error: outcome.error });
    }
    clearBadge(tabId);
  }
  return outcome;
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
  const effectiveMode = mode ?? storage.settings.scanMode;
  // Persisted so a popup that gets torn down mid-scan (losing focus kills
  // the popup document immediately, but this background context keeps
  // running) can tell on reopen that a scan for this tab's URL is still
  // in flight, instead of showing stale/idle state.
  await set("scanInProgress", {
    url,
    mode: effectiveMode,
    startedAt: Date.now(),
  });
  try {
    // Only include `mode` when the caller set one. Under
    // exactOptionalPropertyTypes an explicit `mode: undefined` is not the same
    // as an absent key, and runScanSafe falls back to the configured default
    // when the key is absent.
    const outcome = await runScanSafe({
      url,
      settings: storage.settings,
      ...(mode ? { mode } : {}),
    });
    // Written here (not by the caller) so a reopened popup can recover
    // exactly what happened even if the popup that requested this scan was
    // closed before the sendMessage response ever reached it.
    await set("lastScanCompletion", {
      url,
      finishedAt: Date.now(),
      outcome: outcome.ok
        ? { ok: true, result: outcome.result }
        : { ok: false, error: outcome.error },
    });
    if (outcome.ok) {
      await set("lastResult", outcome.result);
      await cacheReputationFromResult(url, outcome.result);
    }
    return outcome;
  } finally {
    await set("scanInProgress", null);
  }
}

/**
 * "Scan now" from the on-page site-alert card. Unlike auto-scan this is
 * an explicit user click, so it skips shouldAutoScanPolicy() and the
 * auto-scan throttle entirely (same principle as the popup's manual scan
 * button) but still drives the same tab lifecycle messages, badge, and
 * desktop notification as an auto-scan would.
 */
async function handleReputationScan(
  url: string,
  tabId?: number,
): Promise<ScanOutcome> {
  if (!url || !/^https?:/i.test(url)) {
    return { ok: false, error: "Not a scannable URL" };
  }
  const storage = await loadAll();
  return runScanAndNotify(url, storage.settings, tabId);
}

async function handleMuteSite(pattern: string): Promise<{ ok: true }> {
  await addMutePattern(pattern);
  return { ok: true };
}

async function handleMuteGlobal(): Promise<{ ok: true }> {
  const storage = await loadAll();
  await saveAll({
    ...storage,
    settings: {
      ...storage.settings,
      showScanResults: false,
      showScanPrompts: false,
    },
  });
  return { ok: true };
}

async function handleSnoozeSite(host: string): Promise<{ ok: true }> {
  await snoozeHost(host);
  return { ok: true };
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
      lastFocusedWindow: true, // currentWindow: true fails in Firefox background pages (windowId = -1)
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
  result: ScanResult | undefined,
  tabId?: number,
): Promise<void> {
  if (!result) {
    const outcome = await runScanSafe({ url, settings });
    if (!outcome.ok) {
      clearBadge(tabId);
      return;
    }
    result = outcome.result;
  }
  setBadgeForResult(result, tabId);
}

function shouldNotify(result: ScanResult, settings: Settings): boolean {
  const findings: readonly Vulnerability[] = result.findings;
  if (findings.length === 0) return false;
  if (settings.notifyThreshold === "off") return false;
  if (settings.notifyThreshold === "all") return true;
  const rank: Record<string, number> = {
    info: 0,
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };
  for (const f of findings) {
    if (rank[f.severity] >= rank[settings.notifyThreshold]) return true;
  }
  return false;
}

async function sendScanNotification(
  url: string,
  result: ScanResult,
  settings: Settings,
  tabId?: number,
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

  // A real MV3 service worker (Chrome) has no DOM, so there is nowhere here
  // to host an <audio> element or drive a Web Audio graph directly. Chrome's
  // own answer to that is the chrome.offscreen API, but it has no Firefox
  // equivalent, and this extension ships both targets from one codebase --
  // so instead the tone is generated in the tab that triggered the scan, the
  // same way scan:started/scan:complete/etc. already reach it (see
  // notifyTab below and the "notify:sound" handler in content/detector.ts).
  // Best-effort: skipped if we don't know which tab to target, and a
  // missing/unloaded content script or the browser's autoplay policy
  // silently swallow it on the other end -- neither is worth surfacing.
  if (settings.notifySound && tabId !== undefined) {
    notifyTab(tabId, { kind: "notify:sound" });
  }
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
    | { kind: "scan:error"; error: string }
    | { kind: "reputation:known"; data: ReputationResponse; host: string }
    | {
        kind: "reputation:unknown";
        data: ReputationResponse;
        url: string;
        host: string;
      }
    | { kind: "notify:sound" },
): void {
  browser.tabs.sendMessage(tabId, payload).catch(() => {
    // Content script may not be loaded yet; safe to ignore.
  });
}
