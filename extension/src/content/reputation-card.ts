// On-page "site alert" card: a small, dismissible toast injected into the
// page (Shadow DOM, isolated from page CSS both ways) that shows either
//   - a known-host summary (last scan's danger score + severity counts), or
//   - a "scan this site?" prompt for a host nobody has scanned yet.
//
// Modeled on a password manager's save-login prompt: unobtrusive, corner-
// positioned, one click to dismiss or mute. The background decides WHETHER
// to show this (mute settings, throttling, the API call itself all happen
// there - see service-worker.ts's maybeShowReputationFromSender) and just
// hands this module the data to render.

import { html, render, type TemplateResult } from "lit-html";
import { colorForScore } from "../lib/badge";
import { VULNRADAR } from "../lib/constants";
import { formatRelative } from "../lib/format";
import type { ReputationResponse } from "../lib/types";

const HOST_ID = "vulnradar-reputation-host";
const AUTO_DISMISS_MS_KNOWN = 12_000;
const AUTO_DISMISS_MS_UNKNOWN = 20_000;

export interface CardActions {
  readonly onScanNow: (url: string) => void;
  readonly onMuteSite: () => void;
  readonly onMuteGlobal: () => void;
  readonly onDismiss: () => void;
}

let shadowRoot: ShadowRoot | null = null;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

function ensureRoot(): ShadowRoot {
  if (shadowRoot) return shadowRoot;
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.setAttribute("data-vulnradar", "true");
  (document.body ?? document.documentElement).appendChild(host);
  shadowRoot = host.attachShadow({ mode: "open" });
  return shadowRoot;
}

export function hideCard(): void {
  if (dismissTimer !== null) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  if (!shadowRoot) return;
  render(html``, shadowRoot);
}

function scheduleAutoDismiss(ms: number): void {
  if (dismissTimer !== null) clearTimeout(dismissTimer);
  dismissTimer = setTimeout(hideCard, ms);
}

function cancelAutoDismiss(): void {
  if (dismissTimer !== null) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
}

function MuteRow(actions: CardActions): TemplateResult {
  return html`
    <div class="mute-row">
      <button class="text-btn" @click=${actions.onMuteSite}>
        Not this site
      </button>
      <button class="text-btn" @click=${actions.onMuteGlobal}>Turn off</button>
    </div>
  `;
}

function Chrome(body: TemplateResult, onDismiss: () => void): TemplateResult {
  return html`
    <style>
      ${CARD_CSS}
    </style>
    <div class="card" @mouseenter=${cancelAutoDismiss}>
      <div class="card-head">
        <span class="brand">VulnRadar</span>
        <button class="icon-btn" title="Dismiss" @click=${onDismiss}>
          &times;
        </button>
      </div>
      ${body}
    </div>
  `;
}

export function showKnownCard(
  data: ReputationResponse,
  actions: CardActions,
): void {
  const root = ensureRoot();
  const score = data.dangerScore ?? 0;
  const color = colorForScore(score);
  const counts = data.severityCounts;
  const chips = counts
    ? (["critical", "high", "medium", "low"] as const)
        .filter((s) => counts[s] > 0)
        .map((s) => `${counts[s]} ${s}`)
    : [];

  const body = html`
    <div class="score-row">
      <span class="score" style="color:${color}">${score}</span>
      <div class="score-meta">
        <div class="title">Scanned before</div>
        <div class="sub">
          ${chips.length > 0 ? chips.join(" · ") : "No findings recorded"}
        </div>
      </div>
    </div>
    <div class="meta-row">
      <span class="when"
        >${data.lastScannedAt ? formatRelative(data.lastScannedAt) : ""}</span
      >
      ${
        data.scanId
          ? html`<a
              class="link"
              href="${VULNRADAR.apiHost}/host/${encodeURIComponent(data.host)}"
              target="_blank"
              rel="noreferrer"
              @click=${actions.onDismiss}
              >View full report</a
            >`
          : null
      }
    </div>
    ${MuteRow(actions)}
  `;

  render(Chrome(body, actions.onDismiss), root);
  scheduleAutoDismiss(AUTO_DISMISS_MS_KNOWN);
}

export function showUnknownCard(url: string, actions: CardActions): void {
  const root = ensureRoot();
  const body = html`
    <div class="prompt-row">
      <div class="title">Scan this site?</div>
      <div class="sub">No VulnRadar scan on record for this host yet.</div>
    </div>
    <div class="actions-row">
      <button class="btn-primary" @click=${() => actions.onScanNow(url)}>
        Scan now
      </button>
    </div>
    ${MuteRow(actions)}
  `;
  render(Chrome(body, actions.onDismiss), root);
  scheduleAutoDismiss(AUTO_DISMISS_MS_UNKNOWN);
}

const CARD_CSS = `
  :host { all: initial; }
  .card {
    --vr-bg: #ffffff;
    --vr-card: #f9fafb;
    --vr-text: #15192a;
    --vr-text-muted: #666e80;
    --vr-border: #d8dce4;
    --vr-primary: #0babcc;
    --vr-primary-fg: #ffffff;
    position: fixed;
    right: 16px;
    bottom: 16px;
    width: 292px;
    box-sizing: border-box;
    background: var(--vr-bg);
    color: var(--vr-text);
    border: 1px solid var(--vr-border);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
    font: 13px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: 12px 14px;
    z-index: 2147483647;
    animation: vr-slide-in 180ms ease-out;
  }
  @media (prefers-color-scheme: dark) {
    .card {
      --vr-bg: #13161f;
      --vr-card: #1a1e2b;
      --vr-text: #eaeef4;
      --vr-text-muted: #7d8497;
      --vr-border: #232735;
      --vr-primary: #0dccf2;
      --vr-primary-fg: #0e111a;
    }
  }
  @keyframes vr-slide-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  * { box-sizing: border-box; }
  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .brand {
    font-weight: 700;
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--vr-primary);
  }
  .icon-btn {
    appearance: none;
    background: none;
    border: none;
    color: var(--vr-text-muted);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    padding: 0 2px;
  }
  .icon-btn:hover { color: var(--vr-text); }
  .score-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .score {
    font-size: 26px;
    font-weight: 700;
    line-height: 1;
    flex-shrink: 0;
  }
  .score-meta .title, .prompt-row .title {
    font-weight: 600;
    color: var(--vr-text);
  }
  .score-meta .sub, .prompt-row .sub {
    font-size: 12px;
    color: var(--vr-text-muted);
    margin-top: 2px;
  }
  .meta-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 10px;
    font-size: 12px;
  }
  .when { color: var(--vr-text-muted); }
  .link {
    color: var(--vr-primary);
    text-decoration: none;
    font-weight: 500;
  }
  .link:hover { text-decoration: underline; }
  .actions-row { margin-top: 10px; }
  .btn-primary {
    appearance: none;
    width: 100%;
    background: var(--vr-primary);
    color: var(--vr-primary-fg);
    border: none;
    border-radius: 6px;
    padding: 7px 10px;
    font: inherit;
    font-weight: 600;
    font-size: 12px;
    cursor: pointer;
  }
  .btn-primary:hover { opacity: 0.9; }
  .mute-row {
    display: flex;
    gap: 14px;
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid var(--vr-border);
  }
  .text-btn {
    appearance: none;
    background: none;
    border: none;
    color: var(--vr-text-muted);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
    padding: 0;
  }
  .text-btn:hover { color: var(--vr-text); text-decoration: underline; }
`;
