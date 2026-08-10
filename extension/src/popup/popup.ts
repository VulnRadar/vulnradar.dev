// Popup entry. State machine + lit-html renderer.
//
// Critical: triggerScan() does NOT call shouldAutoScanPolicy().
// Manual scans via the popup must always run regardless of autoScan setting.
// Only the background auto-scan pipeline checks that policy.

import { html, render, type TemplateResult } from "lit-html";
import browser from "webextension-polyfill";
import { get, loadAll, onChanged } from "../lib/storage";
import type { LastScanCompletion } from "../lib/storage";
import { refreshMe } from "../lib/auth";
import { getHistory, refreshHistoryFromServer } from "../lib/scan";
import type { ScanOutcome } from "../lib/scan";
import { applyTheme } from "../lib/theme";
import { VULNRADAR } from "../lib/constants";
import { sendTabMessage, TabMessageTimeoutError } from "../lib/messaging";
import {
  formatCount,
  formatDuration,
  formatRelative,
  severityHex,
} from "../lib/format";
import { ConnectPill } from "./components/connect-pill";
import { ScanButton } from "./components/scan-button";
import { DEFAULT_SETTINGS } from "../lib/types";
import type {
  AuthMe,
  RateLimitInfo,
  ScanHistoryRow,
  ScanMode,
  ScanResult,
  Severity,
  Settings,
} from "../lib/types";

const root = document.getElementById("app")!;

// Same "is this actually a scannable page" test used throughout the
// background/content script (service-worker.ts's handleScanUrl/
// handleReputationScan, detector.ts's reportPage) - chrome://, the web
// store, file://, etc. all fail this and have no content script for the
// "Show site alert" button below to message anyway.
function isHttpUrl(url: string | null): boolean {
  return !!url && /^https?:/i.test(url);
}

interface State {
  url: string | null;
  me: AuthMe | null;
  connectionFailed: boolean;
  isScanning: boolean;
  result: ScanResult | null;
  resultIsStale: boolean;
  error: string | null;
  mode: ScanMode;
  history: readonly ScanHistoryRow[];
  settings: Settings;
  rateLimitInfo: RateLimitInfo | null;
  copyConfirm: boolean;
}

const state: State = {
  url: null,
  me: null,
  connectionFailed: false,
  isScanning: false,
  result: null,
  resultIsStale: false,
  error: null,
  mode: "quick",
  history: [],
  settings: DEFAULT_SETTINGS,
  rateLimitInfo: null,
  copyConfirm: false,
};

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => {
    renderQueued = false;
    render(App(), root);
  });
}

// ---- Render ----

function App(): TemplateResult {
  const hostname = (() => {
    try {
      return state.url ? new URL(state.url).hostname : null;
    } catch {
      return null;
    }
  })();

  const siteHistory = hostname
    ? state.history.filter((r) => {
        try {
          return new URL(r.url).hostname === hostname;
        } catch {
          return false;
        }
      })
    : [];
  const otherHistory = state.history.filter((r) => !siteHistory.includes(r));

  return html`
    ${ConnectPill({
      me: state.me,
      connectionFailed: state.connectionFailed,
      onOpenOptions: openOptions,
    })}
    ${RateLimitBar()}
    ${ScanButton({
      url: state.url,
      isScanning: state.isScanning,
      isAuthed: !!state.me,
      mode: state.mode,
      families: state.settings.families,
      onScan: triggerScan,
      onModeChange: setMode,
      onCopyUrl: copyUrl,
    })}
    ${state.result ? ResultPanel(state.result, state.resultIsStale) : null}
    ${
      state.error
        ? html`
            <div class="error-banner">
              <span>&#9888;</span>
              <span>${state.error}</span>
            </div>
          `
        : null
    }
    ${
      siteHistory.length > 0
        ? html`
            <div class="section">
              <div class="section-header">
                <div class="section-title">This site</div>
              </div>
              <div class="history">
                ${siteHistory.slice(0, 5).map((row) => HistoryRow(row))}
              </div>
            </div>
          `
        : null
    }
    ${
      otherHistory.length > 0
        ? html`
            <div class="section">
              <div class="section-header">
                <div class="section-title">Recent scans</div>
              </div>
              <div class="history">
                ${otherHistory.slice(0, 5).map((row) => HistoryRow(row))}
              </div>
            </div>
          `
        : null
    }
    <div class="popup-footer">
      <span>v${VULNRADAR.version}</span>
      <div class="footer-actions">
        ${
          isHttpUrl(state.url)
            ? html`
                <button class="footer-settings" @click=${showSiteAlertAgain}>
                  Show site alert
                </button>
              `
            : null
        }
        <button class="footer-settings" @click=${openOptions}>Settings</button>
      </div>
    </div>
  `;
}

function RateLimitBar(): TemplateResult {
  const rl = state.rateLimitInfo;
  if (!rl || !state.me) return html``;

  // Elite / unlimited: limit stored as a large sentinel or -1
  if (rl.limit < 0 || rl.limit >= 99999) {
    return html`
      <div class="rate-limit rate-limit-unlimited">
        <span class="rate-unlimited-icon">&#8734;</span>
        <span class="rate-unlimited-label">Unlimited scans</span>
      </div>
    `;
  }

  const used = rl.limit - rl.remaining;
  const pct = rl.limit > 0 ? Math.round((used / rl.limit) * 100) : 0;
  const fillClass = pct >= 90 ? "danger" : pct >= 70 ? "warn" : "";
  return html`
    <div class="rate-limit">
      <div class="rate-limit-row">
        <span class="label">${rl.remaining} remaining</span>
        <span>${used} / ${rl.limit} today</span>
      </div>
      <div class="rate-bar-track">
        <div class="rate-bar-fill ${fillClass}" style="width:${pct}%"></div>
      </div>
    </div>
  `;
}

function ResultPanel(r: ScanResult, isStale: boolean): TemplateResult {
  const score = r.dangerScore ?? 0;
  const scoreColor =
    score >= 8
      ? "#ef4444"
      : score >= 5
        ? "#f97316"
        : score >= 3
          ? "#eab308"
          : score >= 1
            ? "#3b82f6"
            : "#22c55e";
  const riskLabel =
    score >= 8
      ? "High risk"
      : score >= 5
        ? "Elevated"
        : score >= 3
          ? "Moderate"
          : score >= 1
            ? "Low risk"
            : "Clean";

  const severities = [
    "critical",
    "high",
    "medium",
    "low",
    "info",
  ] as Severity[];

  return html`
    <div class="result" style="border-left: 3px solid ${scoreColor}">
      <div class="result-top">
        <div class="result-score-wrap">
          <span class="score-num" style="color: ${scoreColor}">${score}</span>
          <div class="score-labels">
            <span class="score-risk" style="color: ${scoreColor}"
              >${riskLabel}</span
            >
            <span class="score-sub">out of 10</span>
          </div>
        </div>
        <div class="result-info">
          <div class="result-badges">
            ${severities.map((s) => {
              const n = r.summary[s];
              return n > 0
                ? html`<span class="badge ${s}">${n}&thinsp;${s}</span>`
                : null;
            })}
            ${r.summary.total === 0 ? html`<span class="badge clean">Clean</span>` : null}
          </div>
          <div class="result-sub-row">
            <span class="result-timing"
              >${formatRelative(r.scannedAt)} &middot;
              ${formatDuration(r.duration)}</span
            >
            ${isStale ? html`<span class="stale-chip">cached</span>` : null}
          </div>
        </div>
        <button
          class="copy-report"
          @click=${copyReport}
          title="Copy findings to clipboard"
        >
          ${state.copyConfirm ? "Copied!" : "Copy"}
        </button>
      </div>
      ${
        r.findings.length > 0
          ? html`
              <div class="findings">
                ${r.findings.slice(0, 20).map(
                  (v) => html`
                    <div
                      class="finding"
                      style="border-left: 3px solid ${severityHex(v.severity)}"
                    >
                      <div class="finding-header">
                        <span
                          class="badge ${v.severity}"
                          style="font-size:9px;padding:1px 5px;flex-shrink:0"
                          >${v.severity}</span
                        >
                        <span class="finding-title">${v.title}</span>
                      </div>
                      ${v.description ? html`<div class="finding-desc">${v.description}</div>` : null}
                    </div>
                  `,
                )}
                ${
                  r.findings.length > 20
                    ? html`
                        <div class="findings-more">
                          +${r.findings.length - 20} more findings in dashboard
                        </div>
                      `
                    : null
                }
              </div>
            `
          : html`<div class="no-findings">No vulnerabilities detected.</div>`
      }
      <div class="result-footer">
        <span
          >${formatCount(r.findings.length)} findings &middot;
          ${formatDuration(r.duration)}</span
        >
        <a
          href="#"
          @click=${(e: Event) => {
            e.preventDefault();
            openHistoryDetail(r.scanHistoryId ?? 0);
          }}
        >
          Full report &rarr;
        </a>
      </div>
    </div>
  `;
}

function HistoryRow(row: ScanHistoryRow): TemplateResult {
  const critical = row.summary.critical + row.summary.high;
  return html`
    <div
      class="history-item"
      title=${row.url}
      @click=${() => openHistoryDetail(row.id)}
    >
      <span
        class="badge ${critical > 0 ? "high" : row.summary.medium > 0 ? "medium" : "low"}"
        style="font-size:9px;padding:1px 6px"
      >
        ${row.findings_count}
      </span>
      <span class="url">${truncateHostPath(row.url)}</span>
      <span class="when">${formatRelative(row.scanned_at)}</span>
    </div>
  `;
}

function truncateHostPath(url: string, max = 40): string {
  try {
    const u = new URL(url);
    const s = u.hostname + u.pathname;
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  } catch {
    return url.slice(0, max);
  }
}

// ---- Actions ----

function setMode(m: ScanMode) {
  state.mode = m;
  scheduleRender();
}

/**
 * Re-opens the on-page site-alert card (reputation-card.ts) for the
 * active tab, for a card the user dismissed or that auto-dismissed while
 * they weren't looking. The toolbar icon click itself never reaches this
 * script - default_popup is set in the manifest, so browser.action.
 * onClicked never fires - this has to be a button inside the popup UI
 * that messages the content script directly.
 */
async function showSiteAlertAgain() {
  try {
    // Same tab-query pattern used in init() below - lastFocusedWindow:
    // true (not currentWindow: true) is required for this to work in
    // Firefox, where the background page has windowId = -1 (not in any
    // window), so currentWindow: true would return an empty array there.
    const [tab] = await browser.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (tab?.id === undefined) return;
    await sendTabMessage(
      tab.id,
      { kind: "reputation:show-again" },
      VULNRADAR.tabMessageTimeoutMs,
    );
    // The whole point of this button is "put the alert back on the page I'm
    // looking at" - leaving the popup open on top of it defeats that, same
    // as openOptions() below closing itself after handing off to a new tab.
    window.close();
  } catch (err) {
    if (err instanceof TabMessageTimeoutError) {
      // A content script WAS registered for this tab, but it's gone quiet -
      // a long-backgrounded tab in Firefox specifically (see messaging.ts).
      // Worth telling the user, since the alternative is a click that does
      // nothing with zero feedback, which reads as the popup being frozen.
      state.error = "This tab isn't responding. Try reloading it.";
      scheduleRender();
      return;
    }
    // No content script on this tab (chrome://, the web store, a page
    // that hasn't finished loading yet, etc.) - silent no-op, not an
    // error surfaced to the user.
  }
}

async function openOptions() {
  await browser.runtime.openOptionsPage();
  window.close();
}

async function copyUrl() {
  if (!state.url) return;
  try {
    await navigator.clipboard.writeText(state.url);
  } catch {
    /* noop */
  }
}

async function copyReport() {
  const r = state.result;
  if (!r) return;
  const lines = [
    `VulnRadar Scan: ${r.url}`,
    `Scanned: ${new Date(r.scannedAt).toLocaleString()}`,
    `Danger score: ${r.dangerScore ?? 0}/10`,
    `Findings: ${r.findings.length}`,
    "",
    ...r.findings.map((f) => `[${f.severity.toUpperCase()}] ${f.title}`),
  ];
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    state.copyConfirm = true;
    scheduleRender();
    setTimeout(() => {
      state.copyConfirm = false;
      scheduleRender();
    }, 1500);
  } catch {
    /* noop */
  }
}

async function triggerScan() {
  // No shouldAutoScanPolicy() check here — manual scans always proceed.
  if (state.isScanning || !state.url || !state.me) return;
  state.isScanning = true;
  state.error = null;
  state.result = null;
  scheduleRender();

  // Relayed through the background instead of calling runScanSafe() here
  // directly: this popup document is torn down the instant it loses focus
  // (trivially easy to do while waiting several seconds/minutes on a scan),
  // which would kill this await mid-flight even though the request keeps
  // running server-side and lands in history regardless. The background
  // service worker persists independent of the popup, so relaying through
  // it means the scan survives the popup closing. If the popup itself gets
  // torn down before this resolves, init() reconciles with whatever the
  // background recorded in storage on next open (see below).
  let outcome: ScanOutcome;
  try {
    outcome = (await browser.runtime.sendMessage({
      kind: "scan:url",
      url: state.url,
      mode: state.mode,
    })) as ScanOutcome;
  } catch (err) {
    state.isScanning = false;
    state.error = err instanceof Error ? err.message : "Scan failed";
    scheduleRender();
    return;
  }

  state.isScanning = false;
  if (outcome.ok) {
    state.result = outcome.result;
    state.resultIsStale = false;
    // runScan() already wrote the new row to local cache; read from there.
    state.history = await getHistory();
    // Refresh rate limit info from storage (updated as a side effect of runScan)
    state.rateLimitInfo = await get("rateLimitInfo");
  } else {
    state.error = outcome.error ?? "Scan failed";
  }
  scheduleRender();
}

/**
 * Applies a background-recorded scan outcome to popup state. Shared by the
 * "still running, wait for it" and "already finished while we were closed"
 * reconciliation paths in init()/watchInProgressScan().
 */
function applyScanCompletion(completion: LastScanCompletion): void {
  if (completion.outcome.ok) {
    state.result = completion.outcome.result;
    state.resultIsStale = false;
  } else {
    state.error = completion.outcome.error;
  }
}

/**
 * Called when init() finds a scan already in flight for the current tab's
 * URL (started by a popup instance that has since been torn down). Watches
 * storage for the background clearing scanInProgress, then applies
 * whatever it finished with instead of leaving a spinner that would
 * otherwise never resolve on its own in this fresh popup instance.
 */
function watchInProgressScan(url: string): void {
  const unsubscribe = onChanged((changes) => {
    if (!("scanInProgress" in changes)) return;
    if (changes.scanInProgress.newValue != null) return; // still running
    unsubscribe();
    void (async () => {
      state.isScanning = false;
      const completion = await get("lastScanCompletion");
      // Only trust a completion that actually matches the scan we were
      // waiting on — guards against an unrelated scan for a different tab
      // finishing around the same time.
      if (completion && completion.url === url) {
        applyScanCompletion(completion);
        state.history = await getHistory();
        state.rateLimitInfo = await get("rateLimitInfo");
      }
      scheduleRender();
    })();
  });
}

async function openHistoryDetail(id: number) {
  if (id > 0) {
    await browser.tabs.create({
      url: `${VULNRADAR.apiHost}/history?scan=${id}`,
    });
  } else {
    await browser.tabs.create({ url: `${VULNRADAR.apiHost}/dashboard` });
  }
  window.close();
}

// ---- Init ----

async function init() {
  const storage = await loadAll();
  state.settings = storage.settings;
  // Popup's own toggle starts from the configured default rather than
  // always "quick" - a user who sets "Deep" as their default scan mode in
  // Options otherwise had no way to see that reflected here; the toggle
  // still lets them override it per scan same as before.
  state.mode = storage.settings.scanMode;
  state.rateLimitInfo = storage.rateLimitInfo ?? null;

  // Restore last scan result so user can see it immediately on reopen
  if (storage.lastResult) {
    state.result = storage.lastResult;
    state.resultIsStale = true;
  }

  // Apply theme before first render to prevent flash
  applyTheme(state.settings.theme);
  // Use attribute presence (not "true"/"false" string) for compact mode
  if (state.settings.compactMode) {
    document.documentElement.setAttribute("data-compact", "");
  } else {
    document.documentElement.removeAttribute("data-compact");
  }

  const authResult = await refreshMe();
  state.me = authResult.me;
  state.connectionFailed = authResult.connectionFailed;
  // Prefer local cache (no rate-limit cost). Fall back to a single server
  // fetch only when the cache is empty (e.g. fresh install or cleared storage).
  const cached = await getHistory();
  state.history = cached.length > 0 ? cached : await refreshHistoryFromServer();

  try {
    // Query directly from popup context — lastFocusedWindow: true is reliable
    // in both Chrome and Firefox. Sending tab:url to the background fails in
    // Firefox because the background page has windowId = -1 (not in any window)
    // so currentWindow: true returns an empty array.
    const [tab] = await browser.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    state.url = tab?.url ?? null;
  } catch {
    state.url = null;
  }

  // A manual scan for this tab may have been started by a popup instance
  // that has since been torn down — closing the popup (trivially easy
  // while a scan is running) kills its script context immediately, but
  // the background keeps the scan running to completion. Reconcile with
  // what the background recorded for *this* URL specifically: still
  // running, just finished, or nothing to do with this tab at all. The
  // URL match is required in every branch so an unrelated in-flight or
  // just-finished scan for some other tab never bleeds into this popup.
  const tabUrl = state.url;
  if (tabUrl && storage.scanInProgress?.url === tabUrl) {
    state.isScanning = true;
    state.mode = storage.scanInProgress.mode;
    watchInProgressScan(tabUrl);
  } else if (
    tabUrl &&
    storage.lastScanCompletion?.url === tabUrl &&
    Date.now() - storage.lastScanCompletion.finishedAt <
      VULNRADAR.recentScanCompletionWindowMs
  ) {
    applyScanCompletion(storage.lastScanCompletion);
  }

  scheduleRender();
}

init();
