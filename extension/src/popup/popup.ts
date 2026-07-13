// Popup entry. State machine + lit-html renderer.
//
// Critical: triggerScan() does NOT call shouldAutoScanPolicy().
// Manual scans via the popup must always run regardless of autoScan setting.
// Only the background auto-scan pipeline checks that policy.

import { html, render, type TemplateResult } from "lit-html";
import browser from "webextension-polyfill";
import { get, loadAll } from "../lib/storage";
import { refreshMe } from "../lib/auth";
import { refreshHistoryFromServer, runScanSafe } from "../lib/scan";
import { applyTheme } from "../lib/theme";
import { VULNRADAR } from "../lib/constants";
import { formatCount, formatDuration, formatRelative, severityHex } from "../lib/format";
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

interface State {
  url: string | null;
  me: AuthMe | null;
  isScanning: boolean;
  result: ScanResult | null;
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
  isScanning: false,
  result: null,
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
    try { return state.url ? new URL(state.url).hostname : null; } catch { return null; }
  })();

  const siteHistory = hostname
    ? state.history.filter((r) => {
        try { return new URL(r.url).hostname === hostname; } catch { return false; }
      })
    : [];
  const otherHistory = state.history.filter((r) => !siteHistory.includes(r));

  return html`
    ${ConnectPill({ me: state.me, onOpenOptions: openOptions })}
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
    ${state.result ? ResultPanel(state.result) : null}
    ${state.error ? html`
      <div class="error-banner">
        <span>&#9888;</span>
        <span>${state.error}</span>
      </div>
    ` : null}
    ${siteHistory.length > 0 ? html`
      <div class="section">
        <div class="section-header">
          <div class="section-title">This site</div>
        </div>
        <div class="history">
          ${siteHistory.slice(0, 5).map((row) => HistoryRow(row))}
        </div>
      </div>
    ` : null}
    ${otherHistory.length > 0 ? html`
      <div class="section">
        <div class="section-header">
          <div class="section-title">Recent scans</div>
        </div>
        <div class="history">
          ${otherHistory.slice(0, 5).map((row) => HistoryRow(row))}
        </div>
      </div>
    ` : null}
  `;
}

function RateLimitBar(): TemplateResult {
  const rl = state.rateLimitInfo;
  if (!rl || !state.me) return html``;
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

function ResultPanel(r: ScanResult): TemplateResult {
  const score = r.dangerScore ?? 0;
  const scoreColor =
    score >= 8 ? "#ef4444" :
    score >= 5 ? "#f97316" :
    score >= 3 ? "#eab308" :
    score >= 1 ? "#3b82f6" :
    "#22c55e";

  const severities = ["critical", "high", "medium", "low", "info"] as Severity[];

  return html`
    <div class="result">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <div class="danger-score" style="color:${scoreColor}">
          <span class="score-num">${score}</span>
          <div>
            <div class="score-label">Danger score</div>
            <div style="font-size:10px;color:var(--vr-text-muted)">out of 10</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
          <div class="result-summary">
            ${severities.map((s) => {
              const n = r.summary[s];
              return n > 0 ? html`<span class="badge ${s}">${n}</span>` : null;
            })}
            ${r.summary.total === 0 ? html`<span class="badge low">Clean</span>` : null}
          </div>
          <button
            class="copy-report"
            @click=${copyReport}
            title="Copy findings to clipboard"
          >
            ${state.copyConfirm ? "Copied!" : "Copy report"}
          </button>
        </div>
      </div>
      ${r.findings.length > 0 ? html`
        <div class="findings">
          ${r.findings.slice(0, 20).map((v) => html`
            <div class="finding" style="border-left:3px solid ${severityHex(v.severity)}">
              <div class="finding-header">
                <span class="badge ${v.severity}" style="font-size:9px;padding:2px 6px;flex-shrink:0">${v.severity}</span>
                <div class="title">${v.title}</div>
              </div>
              <div class="desc">${v.description}</div>
              ${v.fixSteps?.[0] ? html`<div class="fix">${v.fixSteps[0]}</div>` : null}
            </div>
          `)}
          ${r.findings.length > 20 ? html`
            <div class="empty">+${r.findings.length - 20} more in dashboard</div>
          ` : null}
        </div>
      ` : html`<div class="empty">No issues found.</div>`}
      <div class="result-footer">
        <span>${formatCount(r.findings.length)} findings &middot; ${formatDuration(r.duration)}</span>
        <a href="#" @click=${(e: Event) => { e.preventDefault(); openDashboard(); }}>
          Open in dashboard &rarr;
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

async function openOptions() {
  await browser.runtime.openOptionsPage();
}

async function openDashboard() {
  await browser.tabs.create({ url: `${VULNRADAR.apiHost}/dashboard` });
}

async function copyUrl() {
  if (!state.url) return;
  try { await navigator.clipboard.writeText(state.url); } catch { /* noop */ }
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
    setTimeout(() => { state.copyConfirm = false; scheduleRender(); }, 1500);
  } catch { /* noop */ }
}

async function triggerScan() {
  // No shouldAutoScanPolicy() check here — manual scans always proceed.
  if (state.isScanning || !state.url || !state.me) return;
  state.isScanning = true;
  state.error = null;
  state.result = null;
  scheduleRender();

  const outcome = await runScanSafe({
    url: state.url,
    settings: state.settings,
    mode: state.mode, // wire the toggle to the actual request
  });

  state.isScanning = false;
  if (outcome.ok) {
    state.result = outcome.result;
    state.history = await refreshHistoryFromServer();
    // Refresh rate limit info from storage (updated as a side effect of runScan)
    state.rateLimitInfo = await get("rateLimitInfo");
  } else {
    state.error = outcome.error ?? "Scan failed";
  }
  scheduleRender();
}

async function openHistoryDetail(id: number) {
  if (id > 0) {
    await browser.tabs.create({ url: `${VULNRADAR.apiHost}/history/${id}` });
  } else {
    await browser.tabs.create({ url: `${VULNRADAR.apiHost}/dashboard` });
  }
}

// ---- Init ----

async function init() {
  const storage = await loadAll();
  state.settings = storage.settings;
  state.rateLimitInfo = storage.rateLimitInfo ?? null;

  // Apply theme before first render to prevent flash
  applyTheme(state.settings.theme);

  state.me = await refreshMe();
  state.history = await refreshHistoryFromServer();

  try {
    const res = (await browser.runtime.sendMessage({ kind: "tab:url" })) as
      | { url?: string | null }
      | undefined;
    state.url = res?.url ?? null;
  } catch {
    state.url = null;
  }

  scheduleRender();
}

init();
