// Popup entry. Owns the state machine, wires the components, and
// handles the message-passing dance with the background service worker.
//
// State (kept in a single object so a single render() captures it all):
//   url       - current tab's URL (loaded on mount)
//   auth      - the me object from /me, or null
//   isScanning - scan in flight
//   result    - last successful scan
//   error     - last scan error string
//   skippedReason - if non-null, show "Skipped" banner instead of error/result
//   mode      - 'quick' | 'deep'
//   history   - last-N rows for the History list
//   settings  - full settings (for families toggle chip)

import { html, render, type TemplateResult } from "lit-html";
import browser from "webextension-polyfill";
import { loadAll } from "../lib/storage";
import { refreshMe } from "../lib/auth";
import {
  refreshHistoryFromServer,
  runScanSafe,
  shouldAutoScan,
} from "../lib/scan";
import { VULNRADAR } from "../lib/constants";
import { formatRelative } from "../lib/format";
import { ConnectPill } from "./components/connect-pill";
import { ScanButton } from "./components/scan-button";
import { ResultPanel } from "./components/result-panel";
import type {
  AuthMe,
  ScanHistoryRow,
  ScanMode,
  ScanResult,
  Settings,
} from "../lib/types";

const root = document.getElementById("app")!;

interface State {
  url: string | null;
  me: AuthMe | null;
  isScanning: boolean;
  result: ScanResult | null;
  error: string | null;
  skippedReason: string | null;
  mode: ScanMode;
  history: readonly ScanHistoryRow[];
  settings: Settings;
}

const state: State = {
  url: null,
  me: null,
  isScanning: false,
  result: null,
  error: null,
  skippedReason: null,
  mode: "quick",
  history: [],
  settings: undefined as unknown as Settings, // populated in init
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

function App(): TemplateResult {
  return html`
    ${ConnectPill({ me: state.me, onOpenOptions: openOptions })}
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
    ${state.history.length > 0
      ? html`
          <div class="section">
            <div class="section-header">
              <div class="section-title">Recent scans</div>
            </div>
            <div class="history">
              ${state.history.slice(0, 10).map((row) => HistoryRow(row))}
            </div>
          </div>
        `
      : null}
    ${ResultPanel({
      result: state.result,
      error: state.error,
      reason: state.skippedReason,
      onOpenDashboard: openDashboard,
    })}
  `;
}

function HistoryRow(row: ScanHistoryRow): TemplateResult {
  const findings = row.summary.critical + row.summary.high + row.summary.medium;
  return html`
    <div
      class="history-item"
      title=${row.url}
      @click=${() => openHistoryDetail(row.id)}
    >
      <span
        class="badge ${findings > 0 ? "high" : "low"}"
        style="font-size:9px;padding:1px 6px"
      >
        ${findings}
      </span>
      <span class="url">${row.url}</span>
      <span class="when">${formatRelative(row.scanned_at)}</span>
    </div>
  `;
}

// ---- Actions ----

function setMode(m: ScanMode) {
  state.mode = m;
  scheduleRender();
}

async function openOptions() {
  await browser.runtime.openOptionsPage();
}

async function openDashboard() {
  await browser.tabs.create({ url: `${VULNRADAR.apiHost}/dashboard` });
}

async function copyUrl() {
  if (!state.url) return;
  try {
    await navigator.clipboard.writeText(state.url);
  } catch {
    /* ignore */
  }
}

async function triggerScan() {
  if (state.isScanning || !state.url || !state.me) return;
  state.isScanning = true;
  state.error = null;
  state.result = null;
  state.skippedReason = null;
  scheduleRender();

  const skipReason = shouldAutoScan(state.url, state.settings);
  if (skipReason !== null) {
    state.isScanning = false;
    state.skippedReason = skipReason;
    scheduleRender();
    return;
  }

  const outcome = await runScanSafe({
    url: state.url,
    settings: state.settings,
  });

  state.isScanning = false;
  if (outcome.ok) {
    state.result = outcome.result;
    state.history = await refreshHistoryFromServer();
  } else {
    state.error = outcome.error ?? "Scan failed";
  }
  scheduleRender();
}

async function openHistoryDetail(id: number) {
  // Just open the dashboard history page for now. A future
  // enhancement would load the full scan detail inline.
  await browser.tabs.create({
    url: `${VULNRADAR.apiHost}/history/${id}`,
  });
}

// ---- Init ----

async function init() {
  const storage = await loadAll();
  state.settings = storage.settings;
  state.me = await refreshMe();
  state.history = await refreshHistoryFromServer();

  try {
    const res = (await browser.runtime.sendMessage({
      kind: "tab:url",
    })) as { url?: string | null } | undefined;
    state.url = res?.url ?? null;
  } catch {
    state.url = null;
  }

  scheduleRender();
}

init();
