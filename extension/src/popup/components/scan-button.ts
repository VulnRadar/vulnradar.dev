// Scan button + mode toggle + URL pill.
// Mode = "quick" (single page) | "deep" (crawl up to 15 same-origin pages)
// The families chip shows the count of currently enabled categories.

import { html, type TemplateResult } from "lit-html";
import type { ScanMode, ScannerCategory } from "../../lib/types";
import { CATEGORIES_BY_ID } from "../../lib/categories";
import { truncateUrl } from "../../lib/format";

export interface ScanButtonProps {
  readonly url: string | null;
  readonly isScanning: boolean;
  readonly isAuthed: boolean;
  readonly mode: ScanMode;
  readonly families: Readonly<Record<ScannerCategory, boolean>>;
  readonly onScan: () => void;
  readonly onModeChange: (mode: ScanMode) => void;
  readonly onCopyUrl: () => void;
}

export function ScanButton(props: ScanButtonProps): TemplateResult {
  const enabledCount = Object.values(props.families).filter(Boolean).length;
  const totalCount = Object.keys(CATEGORIES_BY_ID).length;
  return html`
    ${props.url
      ? html`
          <div class="url-pill" title=${props.url}>
            <span class="icon">\u2192</span>
            <span class="text">${truncateUrl(props.url, 56)}</span>
            <button
              class="copy"
              @click=${props.onCopyUrl}
              title="Copy URL"
            >
              Copy
            </button>
          </div>
        `
      : html`
          <div class="empty">
            <div class="icon">\u00b7</div>
            <div>No active tab to scan.</div>
          </div>
        `}
    <div class="scan-controls">
      <div class="mode-toggle" role="tablist" aria-label="Scan mode">
        <button
          role="tab"
          class=${props.mode === "quick" ? "active" : ""}
          aria-selected=${props.mode === "quick"}
          @click=${() => props.onModeChange("quick")}
          ?disabled=${props.isScanning}
        >
          Quick
        </button>
        <button
          role="tab"
          class=${props.mode === "deep" ? "active" : ""}
          aria-selected=${props.mode === "deep"}
          @click=${() => props.onModeChange("deep")}
          ?disabled=${props.isScanning}
        >
          Deep
        </button>
      </div>
      <div class="families-chip" title="Enabled check families">
        ${enabledCount}/${totalCount} families
      </div>
      <button
        class="scan-button"
        @click=${props.onScan}
        ?disabled=${props.isScanning || !props.url || !props.isAuthed}
        title=${props.isAuthed ? "Scan this page" : "Connect an API key first"}
      >
        ${props.isScanning
          ? html`<span class="spinner"></span> Scanning\u2026`
          : html`Scan this page`}
      </button>
    </div>
  `;
}
