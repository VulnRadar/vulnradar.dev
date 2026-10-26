// Background service worker (MV3). Single onMessage listener routes all
// messages from the popup, options page, and content script. Also runs
// the auto-scan pipeline on page load, tab focus, and URL change events.
//
// Tab URL reliability: content-script messages carry the tab URL in
// sender.tab.url — that is the only reliable cross-browser source of
// "which tab triggered this". We never re-query the active tab for
// auto-scan; we use sender.tab directly.
//
// Who may send what is decided in lib/message-guard.ts, before any handler
// runs: the first two kinds below only from this extension's own pages, the
// rest only from the content script in a tab.
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
//     { kind: "report:export", id: number, format, host }
//   The popup and options pages read and write auth, history and settings
//   through lib/ modules and chrome.storage directly; nothing sends them here.
//   From content script:
//     { kind: "page:loaded",  url: string, title: string }
//       Only the sender's tab is used; the fields are ignored.
//     { kind: "reputation:scan" }
//       Scans the address this worker recorded when it offered the scan in
//       that tab (lib/offered-scan.ts), never one the page sends.
//     { kind: "reputation:mute-site",   pattern: string }
//     { kind: "reputation:mute-global"  }
//     { kind: "reputation:snooze-site", host: string }
//   From popup (relayed to the active tab's content script, not handled
//   here - see detector.ts's onMessage listener):
//     { kind: "reputation:show-again"   }

import browser from "webextension-polyfill";
import type Browser from "webextension-polyfill";
import { fetchReport, VulnRadarApiError } from "../lib/api";
import { refreshMe } from "../lib/auth";
import { get, getApiKey, loadAll, patchSettings, set } from "../lib/storage";
import {
  canAutoScanNow,
  claimAutoScan,
  noteAutoScanRan,
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
import { getOfferedScan, recordOfferedScan } from "../lib/offered-scan";
import { validateMessage } from "../lib/message-guard";
import type { GuardContext, SenderTab } from "../lib/message-guard";
import { lookupUrl, withoutFragment } from "../lib/lookup-url";
import { clearBadge, setBadgeForResult, setBadgeForScore } from "../lib/badge";
import { meetsThreshold } from "../lib/format";
import { VULNRADAR } from "../lib/constants";
import { DEFAULT_SETTINGS } from "../lib/types";
import type {
  ReportFormat,
  ReputationResponse,
  ScanMode,
  ScanResult,
  Settings,
  Vulnerability,
} from "../lib/types";

const NOT_SCANNABLE =
  "Only websites (http or https addresses) can be scanned, not browser or extension pages.";

// Firefox for Android has no contextMenus or notifications API at all, and an
// unguarded `browser.notifications.onClicked` at the top level throws while
// this script loads, which takes every other listener below down with it. The
// polyfill's types say both always exist, so they are widened here once and
// every use goes through these two names.
const contextMenus = browser.contextMenus as
  typeof browser.contextMenus | undefined;
const notifications = browser.notifications as
  typeof browser.notifications | undefined;

function guardContext(): GuardContext {
  return {
    extensionBase: browser.runtime.getURL(""),
    extensionId: browser.runtime.id,
  };
}

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
    await contextMenus?.removeAll();
  } catch {
    /* noop */
  }
  try {
    await contextMenus?.create({
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
  void clearStaleScanInProgress();
});

/**
 * A `scanInProgress` record can only outlive this context if this context
 * died before its `finally` ran, so anything found at startup is by
 * definition dead: no scan is running in a worker that has just booted.
 * Clearing it here is the cheapest catch-all for the browser-restart and
 * extension-reload cases; the popup has its own deadline for the rest.
 */
async function clearStaleScanInProgress(): Promise<void> {
  try {
    if ((await get("scanInProgress")) !== null) {
      await set("scanInProgress", null);
    }
  } catch {
    /* storage unavailable: the popup's own deadline still recovers */
  }
}

// Kick off on first SW load (covers Firefox / dev mode)
void refreshMe().catch(() => {});
void clearStaleScanInProgress();

// ---- Context menu ----

// Was bare runAndBadge() -- only stamped the toolbar badge, with no other
// feedback: no on-page "Scanning..." indicator, no desktop notification,
// nothing. A scan can legitimately take up to 300s, so a click that
// produces no visible response for that long reads as broken. Every other
// scan trigger (auto-scan, the on-page card's "Scan now") already goes
// through runScanAndNotify() for exactly this reason; this one had
// silently never been upgraded to match when it was added.
contextMenus?.onClicked.addListener((info, tab) => {
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

notifications?.onClicked.addListener((_notifId) => {
  void (async () => {
    // Settings > Notifications > "Open dashboard on click". Was previously
    // unconditional -- the setting existed (default true) but nothing ever
    // read it, so clicking a notification always opened a tab regardless
    // of this toggle.
    const settings = (await get("settings")) ?? DEFAULT_SETTINGS;
    if (!settings.openDashboardOnNotify) return;
    const cache = await get("historyCache");
    const latest = cache?.[0];
    if (latest && latest.id) {
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
    const m = validateMessage(msg, sender, guardContext());
    if (!m) {
      // A kind nobody handles, a sender that may not send it, or a field that
      // is not what it should be. This is the only onMessage listener in the
      // background context, so nothing else is waiting on it: answer rather
      // than return without a response, which would leave the caller's
      // sendMessage promise pending until the channel closes.
      sendResponse(undefined);
      return true;
    }
    let promise: Promise<unknown>;

    switch (m.kind) {
      case "scan:url":
        promise = handleScanUrl(m.url, m.mode);
        break;
      case "report:export":
        promise = handleReportExport(m.id, m.format, m.host);
        break;
      case "page:loaded":
        // Auto-scan pipeline: use the sender's tab (reliable cross-browser).
        // Runs alongside the site-alert reputation check below - the two
        // are independent features (auto-scan can be off while alerts
        // stay on, and vice versa).
        promise = Promise.all([
          maybeAutoScanFromTab(m.tab).catch(() => {}),
          maybeShowReputationFromTab(m.tab).catch(() => {}),
        ]).then(() => undefined);
        break;
      case "reputation:scan":
        promise = handleReputationScan(m.tab);
        break;
      case "reputation:mute-site":
        promise = handleMuteSite(m.pattern);
        break;
      case "reputation:mute-global":
        promise = handleMuteGlobal();
        break;
      case "reputation:snooze-site":
        promise = handleSnoozeSite(m.host);
        break;
    }

    promise.then(sendResponse).catch(() => sendResponse(undefined));
    return true; // keep message channel open for async response
  },
);

// ---- Auto-scan: page load (content script message) ----

async function maybeAutoScanFromTab(tab: SenderTab): Promise<void> {
  // The sender's tab URL is the definitive URL of the tab that loaded the
  // page. Never re-query the active tab -- it may have changed by the time
  // the async handler runs, which is exactly the Firefox bug we're fixing.
  if (!/^https?:/i.test(tab.url)) return;

  const storage = await loadAll();
  if (!storage.auth) return;
  if (storage.settings.autoScan !== "onPageLoad") return;

  await maybeAutoScanUrl(tab.url, storage.settings, tab.id, tab.incognito);
}

// ---- Site alerts: reputation popup on page load ----
//
// Independent of the autoScan setting - shows a small on-page card via
// the content script, either summarizing a known host's last scan or
// offering to scan an unknown one. See lib/reputation.ts for the
// throttle/mute/policy helpers this composes.

async function maybeShowReputationFromTab(tab: SenderTab): Promise<void> {
  // A private window is not looked up at all: the whole point of one is that
  // the sites in it are not reported anywhere.
  if (tab.incognito) return;

  // Origin and path of a public host, or nothing. This is the only address
  // that goes into the lookup, the caches and the card from here on; the tab's
  // own URL (with its query string, which may be a reset or login link) is
  // used only for the local auto-scan policy check below. localhost, a router
  // page or an intranet host return null here, so no request is made for them
  // and no "scan this site?" card appears on them.
  const lookup = lookupUrl(tab.url);
  if (!lookup) return;
  const host = new URL(lookup).hostname;
  // Only the live app instance itself is excluded from the reputation
  // popup (not the wider EXCLUDED_HOSTS list used below for auto-scan) -
  // the public marketing domain (vulnradar.dev / www) is an ordinary
  // website that can have its own genuine, already-scanned reputation
  // record worth showing, same as any other host a user visits.
  if (host === new URL(VULNRADAR.apiHost).hostname) return;

  const storage = await loadAll();
  if (!storage.auth) return;
  if (!(await canShowPopupForUrl(lookup, storage.settings))) return;

  let rep: ReputationResponse | null;
  if (await canCheckReputationNow(host)) {
    // The exact page, not just its host: the endpoint prefers a record for
    // this specific page and only falls back to the host, which is what
    // stops one scanned repo standing in for the whole of github.com.
    rep = await checkReputation(storage.auth.apiKey, host, lookup);
    // Only consume the throttle window / update the cache once a check
    // actually completed. If checkReputation() failed (network error,
    // non-2xx, bad auth), marking the host "checked" here would silence
    // the popup for this host for the full throttle window on every
    // future visit too, for as long as whatever's causing the failure
    // keeps failing - the popup would then never come back, not just skip
    // once. Let a genuine failure retry on the very next visit instead.
    if (!rep) return;
    await noteReputationChecked(host);
    await cacheReputation(host, rep, Date.now(), lookup);
  } else {
    // Throttled: a fresh network check would spam the endpoint on every
    // reload/renavigation within the window, but returning here with
    // nothing sent to the tab reads as "the card (and the toolbar badge)
    // just stopped working" to a user with no idea a throttle exists.
    // Fall back to the last-known result for this host instead of going
    // silent - only skip entirely if we've never learned anything about
    // it yet.
    rep = await getCachedReputation(host, lookup);
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
    setBadgeForScore(rep.dangerScore ?? 0, tab.id);
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
      notifyTab(tab.id, { kind: "reputation:known", data: rep, host });
      await noteReputationShown(host, rep);
    }
  } else if (
    storage.settings.showScanPrompts &&
    !willAutoScanHandleSilently(tab.url, storage.settings) &&
    (await shouldShowReputationCard(host, rep))
  ) {
    // Recorded before the card is told to appear, so a click that arrives the
    // instant it renders already finds the offer it is redeeming.
    await recordOfferedScan(tab.id, host, lookup);
    notifyTab(tab.id, {
      kind: "reputation:unknown",
      data: rep,
      url: lookup,
      host,
    });
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
    await maybeAutoScanUrl(
      tab.url,
      storage.settings,
      tabId,
      tab.incognito === true,
    );
  } catch {
    // tab may not exist anymore
  }
});

// ---- Auto-scan: URL change (onUrlChange mode) ----

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url) return; // only fire when the URL itself changes
  const storage = await loadAll();
  if (!storage.auth || storage.settings.autoScan !== "onUrlChange") return;
  if (!/^https?:/i.test(changeInfo.url)) return;
  await maybeAutoScanUrl(
    changeInfo.url,
    storage.settings,
    tabId,
    tab.incognito === true,
  );
});

// Derived from the configured instance rather than listed literally: a build
// repointed at a self-hosted instance used to auto-scan its own dashboard and
// still skip vulnradar.dev, which is exactly backwards. The sandbox entry is
// kept for the hosted build, where it is a real second deployment.
const EXCLUDED_HOSTS = (() => {
  const hosts = new Set(["sandbox.vulnradar.dev"]);
  try {
    const hostname = new URL(VULNRADAR.apiHost).hostname;
    hosts.add(hostname);
    hosts.add(
      hostname.startsWith("www.") ? hostname.slice(4) : `www.${hostname}`,
    );
  } catch {
    /* a malformed apiHost just means no exclusions beyond the sandbox */
  }
  return [...hosts];
})();

async function maybeAutoScanUrl(
  url: string,
  settings: Settings,
  tabId?: number,
  incognito = false,
): Promise<void> {
  // Same rule as Site Alerts: a private window is never scanned unattended.
  if (incognito) return;

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return;
  }
  // Never auto-scan the VulnRadar platform itself.
  if (EXCLUDED_HOSTS.includes(host)) return;

  const reason = shouldAutoScanPolicy(url, settings);
  if (reason !== null) {
    if (tabId !== undefined) {
      notifyTab(tabId, { kind: "scan:skipped", reason });
    }
    return;
  }

  // Claimed synchronously, before the first await below: page:loaded for every
  // tab of a restored session arrives in the same tick, and the storage-backed
  // check cannot tell them apart until the first one has written. See the
  // comment on the auto-scan throttle in lib/scan.ts.
  const claim = claimAutoScan(host, settings);
  if (!claim) return;
  try {
    if (!(await canAutoScanNow(host, settings))) {
      claim.release();
      return;
    }
    await noteAutoScanRan(host);
  } catch (err) {
    claim.release();
    throw err;
  }

  // The fragment never reaches a server and an OAuth redirect puts the access
  // token in it, so the scan is started without it.
  await runScanAndNotify(withoutFragment(url), settings, tabId, {
    unattended: true,
  });
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
  options: { readonly unattended?: boolean } = {},
): Promise<ScanOutcome> {
  if (tabId !== undefined) {
    notifyTab(tabId, { kind: "scan:started" });
  }

  const outcome = await runScanSafe({
    url,
    settings,
    ...(options.unattended ? { unattended: true } : {}),
  });
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

async function handleScanUrl(url: string, mode?: ScanMode): Promise<unknown> {
  if (!url || !/^https?:/i.test(url)) {
    return { ok: false, error: NOT_SCANNABLE };
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
 * The answer to a "reputation:scan" the background declined to act on, as
 * opposed to a scan that ran and failed (those reach the card as scan:error
 * from runScanAndNotify). Nothing was started, so no lifecycle message will
 * follow, and the card would otherwise sit on "Scanning" for good.
 */
interface RefusedScan {
  readonly ok: false;
  readonly refused: true;
  readonly error: string;
}

const cardScansInFlight = new Set<number>();

/**
 * "Scan now" from the on-page site-alert card. Unlike auto-scan this is
 * an explicit user click, so it skips shouldAutoScanPolicy() and the
 * auto-scan throttle entirely (same principle as the popup's manual scan
 * button) but still drives the same tab lifecycle messages, badge, and
 * desktop notification as an auto-scan would.
 *
 * What is scanned is the address this worker recorded when it offered the
 * scan in this tab, never one the page-side card sends: the click message
 * carries no address at all. The offer must still be live, the tab must still
 * be on the host it was offered for, and a tab can have one card scan running
 * at a time.
 */
async function handleReputationScan(
  tab: SenderTab,
): Promise<ScanOutcome | RefusedScan> {
  if (cardScansInFlight.has(tab.id)) {
    return refusedScan("A scan for this tab is already running.");
  }
  cardScansInFlight.add(tab.id);
  try {
    const offer = await getOfferedScan(tab.id);
    const current = lookupUrl(tab.url);
    const currentHost = current ? new URL(current).hostname : null;
    if (!offer || currentHost !== offer.host) {
      return refusedScan(
        "That offer has expired. Reload the page to try again.",
      );
    }
    const storage = await loadAll();
    return await runScanAndNotify(offer.url, storage.settings, tab.id);
  } finally {
    cardScansInFlight.delete(tab.id);
  }
}

function refusedScan(error: string): RefusedScan {
  return { ok: false, refused: true, error };
}

async function handleMuteSite(pattern: string): Promise<{ ok: boolean }> {
  const result = await addMutePattern(pattern);
  return { ok: result === "added" || result === "exists" };
}

/**
 * Turns both Site Alerts switches off. A read-modify-write of the settings key
 * alone (patchSettings), not a rebuild of the whole storage snapshot: that
 * rewrote auth, the history cache and the last auto-scan time from a copy read
 * moments earlier, so a click on "Turn off" landing while a key refresh or a
 * scan was saving could put the older values back.
 */
async function handleMuteGlobal(): Promise<{ ok: true }> {
  await patchSettings({ showScanResults: false, showScanPrompts: false });
  return { ok: true };
}

async function handleSnoozeSite(host: string): Promise<{ ok: true }> {
  await snoozeHost(host);
  return { ok: true };
}

/** How long to keep a report's blob URL alive waiting on the browser's
 *  save dialog before giving up and revoking it (5 minutes). */
const REPORT_DOWNLOAD_SETTLE_MS = 5 * 60 * 1000;

/**
 * Download a generated report for one scan. Runs HERE rather than in the
 * popup because the popup is torn down the moment it loses focus, which the
 * browser's own save dialog does.
 *
 * The payload goes to browser.downloads as a data: URL, NOT a blob URL.
 * URL.createObjectURL is [Exposed=(Window,DedicatedWorker,SharedWorker)] and
 * is not defined in a service worker at all, so on Chrome, Edge and Brave
 * (manifest/chrome.json runs background.js as a service_worker) every export
 * threw "URL.createObjectURL is not a function", the catch below turned it
 * into a returned error, and the popup printed that string in its export
 * banner. Every PDF, SARIF, Markdown and JSON export was broken for every
 * Chrome user. Firefox was fine, because manifest/firefox.json uses a
 * background page, which has the DOM. tsconfig.json lists both "DOM" and
 * "WebWorker" in `lib` for the whole source tree, so it type-checked.
 *
 * A data: URL needs no lifetime management, which also removes the
 * revoke-after-settle dance this function used to need.
 */
/** The file extension each report format is saved with. SARIF was being
 *  written as .json, which is valid but stops GitHub code scanning and most
 *  SARIF viewers recognising the file. */
const REPORT_EXTENSIONS: Record<ReportFormat, string> = {
  md: "md",
  pdf: "pdf",
  sarif: "sarif",
  json: "json",
};

/**
 * Report bytes as a data: URL that browser.downloads can take.
 *
 * Chunked rather than `String.fromCharCode(...bytes)`: spreading a whole PDF
 * into an argument list overflows the call stack somewhere around a hundred
 * thousand bytes, and a report with a screenshot in it is comfortably larger
 * than that.
 */
function bytesToDataUrl(bytes: ArrayBuffer, contentType: string): string {
  const view = new Uint8Array(bytes);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < view.length; i += CHUNK) {
    binary += String.fromCharCode(...view.subarray(i, i + CHUNK));
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}

async function handleReportExport(
  id: number,
  format: ReportFormat,
  host: string,
): Promise<{ ok: true } | { error: string }> {
  const apiKey = await getApiKey();
  if (!apiKey) return { error: "Not connected" };

  try {
    const { bytes, contentType } = await fetchReport(apiKey, id, format);

    const safeHost = (host || "scan").replace(/[^a-zA-Z0-9._-]/g, "-");
    const filename = `vulnradar-${safeHost}-${id}.${REPORT_EXTENSIONS[format]}`;

    const downloadId = await browser.downloads.download({
      url: bytesToDataUrl(bytes, contentType),
      filename,
      saveAs: true,
    });

    // Hold the object URL alive until the download is no longer in
    // progress, then revoke it so the blob can be collected.
    await new Promise<void>((resolve) => {
      const done = (delta: Browser.Downloads.OnChangedDownloadDeltaType) => {
        if (delta.id !== downloadId) return;
        if (delta.state?.current === "in_progress") return;
        browser.downloads.onChanged.removeListener(done);
        resolve();
      };
      browser.downloads.onChanged.addListener(done);
      // Backstop: if the user leaves the save dialog open (or the browser
      // never reports a terminal state), don't hang this handler forever.
      setTimeout(() => {
        browser.downloads.onChanged.removeListener(done);
        resolve();
      }, REPORT_DOWNLOAD_SETTLE_MS);
    });

    return { ok: true };
  } catch (err) {
    if (err instanceof VulnRadarApiError) {
      return { error: err.body.error || `API error ${err.status}` };
    }
    return { error: err instanceof Error ? err.message : String(err) };
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
  // The threshold rule lives in lib/format.ts. This used to re-declare its own
  // severity rank map here, so the same rule existed twice and a change to one
  // copy would never reach the other.
  return findings.some((f) =>
    meetsThreshold(f.severity, settings.notifyThreshold),
  );
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

  // Absent on Firefox for Android, and a browser or OS with notifications
  // switched off can reject the call. Neither should cost the scan its badge
  // or its sound, which follow below.
  try {
    await notifications?.create("vulnradar-scan", {
      type: "basic",
      iconUrl: browser.runtime.getURL("icons/icon-128.png"),
      title: `VulnRadar: ${head}`,
      message: body,
    });
  } catch {
    /* no desktop notification here; the badge still shows the result */
  }

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
