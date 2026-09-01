// Popup entry. State machine + lit-html renderer.
//
// Critical: triggerScan() does NOT call shouldAutoScanPolicy().
// Manual scans via the popup must always run regardless of autoScan setting.
// Only the background auto-scan pipeline checks that policy.

import { html, render, type TemplateResult } from "lit-html";
import browser from "webextension-polyfill";
import { get, loadAll, onChanged, set } from "../lib/storage";
import {
  isScanInProgressStale,
  scanInProgressTimeLeftMs,
} from "../lib/scan-lifecycle";
import type { LastScanCompletion } from "../lib/storage";
import { refreshMe } from "../lib/auth";
import { api } from "../lib/api";
import { fetchHistoryFromServer, getHistory } from "../lib/scan";
import type { ScanOutcome } from "../lib/scan";
import { classifyScanTarget } from "../lib/scan-target";
import { applyTheme, watchSystemTheme } from "../lib/theme";
import { VULNRADAR } from "../lib/constants";
import { CLEAN_SOLID } from "../lib/tokens";
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
  ReportFormat,
  ScanHistoryRow,
  ScanMode,
  ScanResult,
  Severity,
  Settings,
  Vulnerability,
} from "../lib/types";

const root = document.getElementById("app")!;

// The same popup document, opened as a full browser TAB (via the "Open in tab"
// footer button below). A toolbar popup can't be resized -- the browser fixes
// its size by content -- so this is the resizable, roomy view. In tab mode the
// active-tab URL isn't the site the user was looking at (it's this tab), so the
// opener passes ?url=, and actions must NOT window.close() (that would close the
// whole tab). data-fulltab drives the wider layout in popup.css.
const FULLTAB_PARAMS = new URLSearchParams(location.search);
const IS_FULLTAB = FULLTAB_PARAMS.get("fulltab") === "1";
if (IS_FULLTAB) document.documentElement.setAttribute("data-fulltab", "");

/** Close the popup window, but never when running as a full tab. */
function closePopupWindow(): void {
  if (!IS_FULLTAB) window.close();
}

// Read straight from the manifest (filled from package.json at build time) so
// the footer can never drift from the actual shipped version the way a
// hand-maintained constant did.
const EXT_VERSION = browser.runtime.getManifest().version;

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
  // Set when the active tab isn't a useful target (a search engine / results
  // page). The popup warns before scanning it, but "Scan anyway" still runs.
  targetWarning: string | null;
  // Fetched once from the public, unauthenticated GET /api/version -- the
  // version of the VulnRadar instance VULNRADAR.apiHost points at, not the
  // account you're connected to. null until the request resolves (or fails).
  appVersion: string | null;
  // True until init() finishes its first pass (tab query + auth + history).
  // Lets the very first paint show a neutral "Connecting..." shell instead of
  // a blank popup, without briefly claiming "Not connected" before auth loads.
  initializing: boolean;
  // Finding ids currently expanded to show evidence / impact / fix steps.
  // The API already sends those fields on every finding; before this they
  // were fetched and then thrown away, with only title + description shown.
  expandedFindings: ReadonlySet<string>;
  // Report format currently downloading (null when idle), so the export
  // buttons can show progress and not be double-fired.
  exportingFormat: ReportFormat | null;
  exportError: string | null;
  // Distinguishes "you have not scanned anything yet" from "the history
  // request failed", which an empty array alone cannot.
  historyLoadFailed: boolean;
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
  targetWarning: null,
  appVersion: null,
  initializing: true,
  expandedFindings: new Set<string>(),
  exportingFormat: null,
  exportError: null,
  historyLoadFailed: false,
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
      initializing: state.initializing,
      onOpenOptions: openOptions,
    })}
    ${RateLimitBar()}
    ${ScanButton({
      url: state.url,
      isScanning: state.isScanning,
      isAuthed: !!state.me,
      mode: state.mode,
      families: state.settings.families,
      onScan: () => triggerScan(),
      onModeChange: setMode,
      onCopyUrl: copyUrl,
    })}
    ${LiveStatus()}
    ${
      state.targetWarning
        ? html`
            <div class="target-warning" role="alert">
              <div class="target-warning-text">
                <span class="target-warning-icon" aria-hidden="true"
                  >&#9888;</span
                >
                <span>${state.targetWarning}</span>
              </div>
              <div class="target-warning-actions">
                <button
                  type="button"
                  class="target-warning-proceed"
                  @click=${() => triggerScan(true)}
                >
                  Scan anyway
                </button>
                <button
                  type="button"
                  class="target-warning-dismiss"
                  @click=${() => {
                    state.targetWarning = null;
                    scheduleRender();
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          `
        : null
    }
    ${state.result ? ResultPanel(state.result, state.resultIsStale) : null}
    ${
      state.error
        ? html`
            <div class="error-banner" role="alert">
              <span aria-hidden="true">&#9888;</span>
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
                <h2 class="section-title">This site</h2>
              </div>
              <div class="history">
                ${withPrevious(siteHistory.slice(0, 5), state.history).map(
                  ({ row, previous }) => HistoryRow(row, previous),
                )}
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
                <h2 class="section-title">Recent scans</h2>
              </div>
              <div class="history">
                ${withPrevious(otherHistory.slice(0, 5), state.history).map(
                  ({ row, previous }) => HistoryRow(row, previous),
                )}
              </div>
            </div>
          `
        : null
    }
    ${HistoryEmptyState()}
    <div class="popup-footer">
      <span
        >v${EXT_VERSION}${state.appVersion ? html` &middot; VulnRadar v${state.appVersion}` : null}</span
      >
      <div class="footer-actions">
        ${
          isHttpUrl(state.url)
            ? html`
                <button
                  type="button"
                  class="footer-settings"
                  @click=${showSiteAlertAgain}
                >
                  Show site alert
                </button>
              `
            : null
        }
        ${
          IS_FULLTAB
            ? null
            : html`
                <button
                  type="button"
                  class="footer-settings"
                  @click=${openInTab}
                  title="Open this view in a resizable browser tab"
                >
                  Open in tab
                </button>
              `
        }
        <button type="button" class="footer-settings" @click=${openOptions}>
          Settings
        </button>
      </div>
    </div>
  `;
}

/**
 * The one live region in the popup (SC 4.1.3).
 *
 * A scan takes seconds to minutes and its whole progression is conveyed
 * visually: the button label changes to "Scanning...", then a result panel
 * appears somewhere else in the document. Neither is announced. A disabled
 * button in particular is skipped by most screen readers, so the "Scanning..."
 * label a sighted user watches is exactly the feedback a screen reader user
 * never gets.
 *
 * Deliberately ONE region rendered in a fixed position rather than
 * aria-live sprinkled on each panel: a live region that appears and
 * disappears from the DOM is unreliable (it has to be present before the text
 * changes for the change to be announced), and several competing polite
 * regions interrupt each other.
 */
function LiveStatus(): TemplateResult {
  let message = "";
  if (state.copyConfirm) {
    // Transient (1.5s) and always the most recent thing the user did, so it
    // outranks the scan state underneath it.
    message = "Findings copied to the clipboard.";
  } else if (state.isScanning) {
    message = "Scan running.";
  } else if (state.error) {
    message = `Scan failed. ${state.error}`;
  } else if (state.result) {
    const r = state.result;
    message = `Scan finished. Danger score ${r.dangerScore ?? 0} out of 10, ${r.findings.length} ${r.findings.length === 1 ? "finding" : "findings"}.`;
  }
  return html`<p class="sr-only" role="status">${message}</p>`;
}

/**
 * First-run and failed-load states for the history block.
 *
 * The two history sections were each wrapped in a `length > 0` guard and
 * nothing else, so a freshly installed extension rendered the connect pill,
 * the scan button and the footer, with nothing to say what the panel would
 * hold once you scanned. It also could not tell an empty history from a
 * history request that failed.
 */
function HistoryEmptyState(): TemplateResult | null {
  if (state.history.length > 0 || state.initializing || !state.me) return null;
  if (state.historyLoadFailed) {
    return html`
      <div class="section">
        <div class="empty-state">
          Could not load your scan history. Your past scans are safe: this is
          only the list. Reopen the popup to try again.
        </div>
      </div>
    `;
  }
  return html`
    <div class="section">
      <div class="empty-state">
        No scans yet. Hit Scan this page and the result lands here, with a trend
        arrow once you scan the same site twice.
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
        <span class="rate-unlimited-icon" aria-hidden="true">&#8734;</span>
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
  // A branch that ran out of time budget was NOT checked, so a zero-finding
  // result alongside one is not an all-clear. The "Clean" chip is a positive
  // assertion and must not be rendered from an absence.
  const incomplete = r.incomplete ?? [];
  const score = r.dangerScore ?? 0;
  // Rungs read off the shared severity ramp rather than a fifth hand-written
  // colour list, so a severity retune reaches this too.
  const scoreColor =
    score >= 8
      ? severityHex("critical")
      : score >= 5
        ? severityHex("high")
        : score >= 3
          ? severityHex("medium")
          : score >= 1
            ? severityHex("low")
            : CLEAN_SOLID;
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
      ${
        r.redirect
          ? html`
              <div class="result-redirect">
                <span class="target-warning-icon" aria-hidden="true"
                  >&#9888;</span
                >
                <div>
                  <div class="result-redirect-title">
                    ${
                      r.redirect.kind === "login"
                        ? "This page is behind a login"
                        : "The scanned page redirected"
                    }
                  </div>
                  <div class="result-redirect-reason">${r.redirect.reason}</div>
                </div>
              </div>
            `
          : null
      }
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
            ${
              r.summary.total === 0 && !incomplete.length
                ? html`<span class="badge clean">Clean</span>`
                : null
            }
            ${
              incomplete.length > 0
                ? html`<span class="badge warn-incomplete"
                    >${incomplete.length}&thinsp;unfinished</span
                  >`
                : null
            }
          </div>
          ${
            incomplete.length > 0
              ? html`<div class="incomplete-note">
                  ${incomplete.join(", ")} did not finish, so this scan does not
                  cover ${incomplete.length === 1 ? "it" : "them"}.
                </div>`
              : null
          }
          <div class="result-sub-row">
            <span class="result-timing"
              >${formatRelative(r.scannedAt)} &middot;
              ${formatDuration(r.duration)}</span
            >
            ${isStale ? html`<span class="stale-chip">cached</span>` : null}
          </div>
        </div>
        <!-- "Copy" on its own does not say what it copies. The confirmation is
             announced by LiveStatus rather than by an aria-live on this
             button, because a live region that also carries an aria-label is
             announced inconsistently: some screen readers read the label
             instead of the changed text. -->
        <button
          type="button"
          class="copy-report"
          @click=${copyReport}
          title="Copy findings to clipboard"
          aria-label="Copy findings to clipboard"
        >
          ${state.copyConfirm ? "Copied!" : "Copy"}
        </button>
      </div>
      ${
        r.findings.length > 0
          ? html`
              <div class="findings">
                ${r.findings.slice(0, 20).map((v) => FindingRow(v))}
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
          : html`<div class="no-findings">
              No findings from the checks that ran.
            </div>`
      }
      ${r.scanHistoryId ? ExportBar(r) : null}
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
          Full report <span aria-hidden="true">&rarr;</span>
        </a>
      </div>
    </div>
  `;
}

const EXPORT_FORMATS: readonly { format: ReportFormat; label: string }[] = [
  { format: "pdf", label: "PDF" },
  { format: "sarif", label: "SARIF" },
  { format: "md", label: "Markdown" },
  { format: "json", label: "JSON" },
];

/**
 * Export this scan as a real report file. Hits the same
 * GET /api/v3/history/[id]/report the dashboard and CI use, so the popup
 * produces byte-identical output rather than a second, drifting formatter.
 * Only rendered once the scan has a history id (an unsaved scan has nothing
 * to export).
 */
function ExportBar(r: ScanResult): TemplateResult {
  const busy = state.exportingFormat !== null;
  return html`
    <div class="export-bar">
      <span class="export-label" id="export-label">Export</span>
      <div class="export-buttons" role="group" aria-labelledby="export-label">
        ${EXPORT_FORMATS.map(
          ({ format, label }) => html`
            <button
              type="button"
              class="export-btn"
              ?disabled=${busy}
              title=${`Download this scan as ${label}`}
              aria-label=${`Download this scan as ${label}`}
              @click=${() => exportReport(r, format)}
            >
              ${state.exportingFormat === format ? "…" : label}
            </button>
          `,
        )}
      </div>
    </div>
    ${
      state.exportError
        ? html`<div class="export-error" role="alert">
            ${state.exportError}
          </div>`
        : null
    }
  `;
}

/**
 * One finding, collapsed to severity + title + description, expanding to the
 * detail the API has been sending all along: where it was found (evidence),
 * why it matters (riskImpact / explanation), how to fix it (fixSteps), and
 * further reading (references). Before this, those fields arrived on every
 * scan and were silently dropped, so the popup could tell you that something
 * was wrong but never what to do about it.
 */
function FindingRow(v: Vulnerability): TemplateResult {
  const isOpen = state.expandedFindings.has(v.id);
  const hasDetail = Boolean(
    v.evidence ||
    v.riskImpact ||
    v.explanation ||
    (v.fixSteps && v.fixSteps.length > 0) ||
    (v.references && v.references.length > 0),
  );

  const toggle = () => {
    const next = new Set(state.expandedFindings);
    if (next.has(v.id)) next.delete(v.id);
    else next.add(v.id);
    state.expandedFindings = next;
    scheduleRender();
  };

  return html`
    <div
      class="finding"
      style="border-left: 3px solid ${severityHex(v.severity)}"
    >
      <!-- a11y (SC 4.1.2): a finding with no extra detail is not a control and
           is now marked as nothing at all. It used to carry
           role="presentation" together with aria-label, aria-expanded="false"
           and tabindex="-1", which is three contradictions in one element:
           role="presentation" is ignored outright on an element with a global
           ARIA attribute, so the row fell back to generic while still
           announcing a collapsed-expandable state it did not have, and
           aria-label on a generic element is not exposed either. Only the rows
           that really do expand get the button contract. -->
      ${
        hasDetail
          ? html`<div
              class="finding-header finding-header-clickable"
              role="button"
              tabindex="0"
              aria-expanded=${String(isOpen)}
              aria-label=${`${isOpen ? "Hide" : "Show"} details for ${v.title}`}
              @click=${toggle}
              @keydown=${onActivate(toggle)}
            >
              ${FindingHeaderContent(v, true, isOpen)}
            </div>`
          : html`<div class="finding-header">
              ${FindingHeaderContent(v, false, isOpen)}
            </div>`
      }
      ${
        v.description
          ? html`<div class="finding-desc">${v.description}</div>`
          : null
      }
      ${isOpen ? FindingDetail(v) : null}
    </div>
  `;
}

/** Severity chip + title + (when the row expands) the chevron. Split out only
 *  so FindingRow can render the same contents inside either the button-role
 *  wrapper or a plain one. */
function FindingHeaderContent(
  v: Vulnerability,
  hasDetail: boolean,
  isOpen: boolean,
): TemplateResult {
  return html`
    <span
      class="badge ${v.severity}"
      style="font-size:9px;padding:1px 5px;flex-shrink:0"
      >${v.severity}</span
    >
    <span class="finding-title">${v.title}</span>
    ${
      hasDetail
        ? html`<span
            class="finding-chevron ${isOpen ? "open" : ""}"
            aria-hidden="true"
            >&#9662;</span
          >`
        : null
    }
  `;
}

function FindingDetail(v: Vulnerability): TemplateResult {
  return html`
    <div class="finding-detail">
      ${
        v.evidence
          ? html`
              <div class="fd-block">
                <div class="fd-label">Evidence</div>
                <pre class="fd-evidence">${v.evidence}</pre>
              </div>
            `
          : null
      }
      ${
        v.riskImpact
          ? html`
              <div class="fd-block">
                <div class="fd-label">Why it matters</div>
                <div class="fd-text">${v.riskImpact}</div>
              </div>
            `
          : null
      }
      ${
        v.explanation && v.explanation !== v.riskImpact
          ? html`
              <div class="fd-block">
                <div class="fd-label">Details</div>
                <div class="fd-text">${v.explanation}</div>
              </div>
            `
          : null
      }
      ${
        v.fixSteps && v.fixSteps.length > 0
          ? html`
              <div class="fd-block">
                <div class="fd-label">How to fix</div>
                <ol class="fd-steps">
                  ${v.fixSteps.map((s) => html`<li>${s}</li>`)}
                </ol>
              </div>
            `
          : null
      }
      ${
        v.references && v.references.length > 0
          ? html`
              <div class="fd-block">
                <div class="fd-label">References</div>
                <div class="fd-refs">
                  ${v.references
                    .slice(0, 4)
                    .map(
                      (href) => html`
                        <a
                          href=${href}
                          target="_blank"
                          rel="noopener noreferrer"
                          >${shortRef(href)}</a
                        >
                      `,
                    )}
                </div>
              </div>
            `
          : null
      }
    </div>
  `;
}

/** Hostname + a trimmed path, so a long docs URL stays on one line. */
function shortRef(href: string): string {
  try {
    const u = new URL(href);
    const s = u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, "");
    return s.length > 44 ? s.slice(0, 43) + "…" : s;
  } catch {
    return href.slice(0, 44);
  }
}

/** Enter/Space activate a non-button element given a role="button". Keeps the
 *  history rows (and any other div-as-button) operable by keyboard and to a
 *  screen reader, not just by mouse. */
function onActivate(fn: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
}

/**
 * One past scan. `previous` is the next-older scan of the SAME url, when the
 * loaded history has one, so the row can say whether things got better or
 * worse since then instead of only showing a raw count. Rescanning is
 * offered inline: re-running the exact url you are looking at was previously
 * a trip through the dashboard.
 */
/** The trend chip is a coloured arrow plus a bare number, which a screen
 *  reader reads as "black down-pointing triangle 3". role="img" plus this
 *  label replaces that with the sentence the arrow is standing in for. */
function trendLabel(delta: number): string {
  const n = Math.abs(delta);
  return `${n} ${n === 1 ? "finding" : "findings"} ${delta < 0 ? "fewer" : "more"} than the previous scan of this URL`;
}

function HistoryRow(
  row: ScanHistoryRow,
  previous?: ScanHistoryRow,
): TemplateResult {
  const critical = row.summary.critical + row.summary.high;
  const open = () => openHistoryDetail(row.id);
  const delta = previous ? row.findings_count - previous.findings_count : null;

  return html`
    <div class="history-item">
      <div
        class="history-main"
        role="button"
        tabindex="0"
        title=${row.url}
        aria-label=${`Open scan report for ${row.url}`}
        @click=${open}
        @keydown=${onActivate(open)}
      >
        <span
          class="badge ${
            critical > 0 ? "high" : row.summary.medium > 0 ? "medium" : "low"
          }"
          style="font-size:9px;padding:1px 6px"
        >
          ${row.findings_count}
        </span>
        ${
          delta !== null && delta !== 0
            ? html`<span
                class="trend ${delta < 0 ? "trend-better" : "trend-worse"}"
                role="img"
                title=${trendLabel(delta)}
                aria-label=${trendLabel(delta)}
                >${delta < 0 ? "▼" : "▲"}${Math.abs(delta)}</span
              >`
            : null
        }
        <span class="url">${truncateHostPath(row.url)}</span>
        <span class="when">${formatRelative(row.scanned_at)}</span>
      </div>
      <button
        type="button"
        class="history-rescan"
        ?disabled=${state.isScanning}
        title=${`Rescan ${row.url}`}
        aria-label=${`Rescan ${row.url}`}
        @click=${() => rescanUrl(row.url)}
      >
        <span aria-hidden="true">&#8635;</span>
      </button>
    </div>
  `;
}

/**
 * Pair each row with the next-older scan of the same url, so HistoryRow can
 * render a trend. `rows` is expected newest-first (the order the history API
 * returns), so the match is simply the next later entry with that url.
 */
function withPrevious(
  rows: readonly ScanHistoryRow[],
  all: readonly ScanHistoryRow[],
): { row: ScanHistoryRow; previous?: ScanHistoryRow }[] {
  return rows.map((row) => {
    const idx = all.indexOf(row);
    const previous = all
      .slice(idx + 1)
      .find((candidate) => candidate.url === row.url);
    return previous ? { row, previous } : { row };
  });
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
    closePopupWindow();
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
  closePopupWindow();
}

/** Open this popup UI as a full browser tab (the resizable view). Carries the
 *  current tab's URL so the tab view scans the same site, not itself. */
async function openInTab() {
  const target =
    browser.runtime.getURL("popup.html") +
    "?fulltab=1" +
    (state.url ? `&url=${encodeURIComponent(state.url)}` : "");
  await browser.tabs.create({ url: target });
  closePopupWindow();
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

async function triggerScan(force = false) {
  // No shouldAutoScanPolicy() check here — manual scans always proceed.
  if (state.isScanning || !state.url || !state.me) return;
  // Warn (don't block) before scanning a non-target like a search engine
  // results page. The warning card's "Scan anyway" calls triggerScan(true).
  if (!force) {
    const classification = classifyScanTarget(state.url);
    if (!classification.scannable) {
      state.targetWarning = classification.reason ?? null;
      scheduleRender();
      return;
    }
  }
  state.targetWarning = null;
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
 * Re-run a scan for a url straight from its history row, without having to
 * navigate there first. Same background relay as triggerScan (so it survives
 * the popup closing) and the same target-classification warning is skipped:
 * this url was already scanned once deliberately.
 */
async function rescanUrl(url: string) {
  if (state.isScanning || !state.me) return;
  state.isScanning = true;
  state.error = null;
  state.result = null;
  state.targetWarning = null;
  scheduleRender();

  let outcome: ScanOutcome;
  try {
    outcome = (await browser.runtime.sendMessage({
      kind: "scan:url",
      url,
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
    state.history = await getHistory();
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

/** Shown when a scan's background context died before it could report back. */
const INTERRUPTED_SCAN_MESSAGE =
  "That scan was interrupted and its result was lost. Run it again.";

/**
 * Called when init() finds a scan already in flight for the current tab's
 * URL (started by a popup instance that has since been torn down). Watches
 * storage for the background clearing scanInProgress, then applies
 * whatever it finished with instead of leaving a spinner that would
 * otherwise never resolve on its own in this fresh popup instance.
 *
 * `timeLeftMs` is the rest of that scan's own ceiling. Without it, a popup
 * opened just inside the window waits on an onChanged event that never fires
 * when the background has already been killed.
 */
function watchInProgressScan(url: string, timeLeftMs: number): void {
  let deadline: ReturnType<typeof setTimeout> | undefined;

  const unsubscribe = onChanged((changes) => {
    if (!("scanInProgress" in changes)) return;
    if (changes.scanInProgress.newValue != null) return; // still running
    unsubscribe();
    if (deadline !== undefined) clearTimeout(deadline);
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

  deadline = setTimeout(() => {
    unsubscribe();
    void (async () => {
      const current = await get("scanInProgress");
      if (current?.url !== url) return; // it finished; nothing to recover
      await set("scanInProgress", null);
      state.isScanning = false;
      state.error = INTERRUPTED_SCAN_MESSAGE;
      scheduleRender();
    })();
  }, timeLeftMs);
}

/**
 * Ask the service worker to fetch + save a report. The download runs there,
 * not here: this popup is destroyed the moment the browser's save dialog
 * takes focus, which would revoke a blob URL created in this context
 * mid-download.
 */
async function exportReport(r: ScanResult, format: ReportFormat) {
  if (state.exportingFormat) return;
  const id = r.scanHistoryId;
  if (!id) return;

  let host = "scan";
  try {
    host = new URL(r.url).hostname || "scan";
  } catch {
    /* keep the default */
  }

  state.exportingFormat = format;
  state.exportError = null;
  scheduleRender();
  try {
    const res = (await browser.runtime.sendMessage({
      kind: "report:export",
      id,
      format,
      host,
    })) as { ok?: true; error?: string } | undefined;
    if (res?.error) state.exportError = res.error;
  } catch (err) {
    state.exportError = err instanceof Error ? err.message : String(err);
  } finally {
    state.exportingFormat = null;
    scheduleRender();
  }
}

async function openHistoryDetail(id: number) {
  if (id > 0) {
    await browser.tabs.create({
      url: `${VULNRADAR.apiHost}/history?scan=${id}`,
    });
  } else {
    await browser.tabs.create({ url: `${VULNRADAR.apiHost}/dashboard` });
  }
  closePopupWindow();
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
  // The full-tab view (IS_FULLTAB) can sit open across an OS theme flip, which
  // applyTheme's one-shot resolve of "system" would miss. Harmless in the
  // popup, which is torn down long before the OS theme changes under it.
  watchSystemTheme(() => state.settings.theme);
  // Use attribute presence (not "true"/"false" string) for compact mode
  if (state.settings.compactMode) {
    document.documentElement.setAttribute("data-compact", "");
  } else {
    document.documentElement.removeAttribute("data-compact");
  }

  // First paint now, after theme + settings are read from (fast) storage but
  // BEFORE the slow refreshMe() network round-trip below. Without this the
  // popup stays blank for the full auth request; with it the themed shell
  // ("Connecting...") shows immediately and fills in as each piece resolves.
  scheduleRender();

  const authResult = await refreshMe();
  state.me = authResult.me;
  state.connectionFailed = authResult.connectionFailed;
  // Prefer local cache (no rate-limit cost). Fall back to a single server
  // fetch only when the cache is empty (e.g. fresh install or cleared storage).
  const cached = await getHistory();
  if (cached.length > 0) {
    state.history = cached;
  } else {
    const fetched = await fetchHistoryFromServer();
    state.history = fetched.rows;
    state.historyLoadFailed = !fetched.ok;
  }

  if (IS_FULLTAB) {
    // In the full-tab view the active tab IS this page, so tabs.query would
    // return our own URL. The opener passed the site to scan as ?url= instead.
    const passedUrl = FULLTAB_PARAMS.get("url");
    state.url = passedUrl && isHttpUrl(passedUrl) ? passedUrl : null;
  } else {
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
  const inProgress =
    tabUrl && storage.scanInProgress?.url === tabUrl
      ? storage.scanInProgress
      : null;
  if (inProgress && isScanInProgressStale(inProgress)) {
    // The background died before its `finally` could clear this (browser
    // restart, extension reload, worker crash). Left alone it pins the popup
    // on "Scanning..." with the Scan button disabled forever, on exactly the
    // site the user is trying to check.
    await set("scanInProgress", null);
    state.error = INTERRUPTED_SCAN_MESSAGE;
  } else if (inProgress && tabUrl) {
    state.isScanning = true;
    state.mode = inProgress.mode;
    watchInProgressScan(tabUrl, scanInProgressTimeLeftMs(inProgress));
  } else if (
    tabUrl &&
    storage.lastScanCompletion?.url === tabUrl &&
    Date.now() - storage.lastScanCompletion.finishedAt <
      VULNRADAR.recentScanCompletionWindowMs
  ) {
    applyScanCompletion(storage.lastScanCompletion);
  }

  state.initializing = false;
  scheduleRender();

  // Best-effort: if VULNRADAR.apiHost is unreachable or the request fails,
  // the footer just omits the app version rather than showing an error --
  // this is a QoL detail, not something worth a status banner over.
  api
    .version()
    .then((res) => {
      state.appVersion = res.body.current;
      scheduleRender();
    })
    .catch(() => {
      // state.appVersion stays null; footer shows only the extension version.
    });
}

init();
