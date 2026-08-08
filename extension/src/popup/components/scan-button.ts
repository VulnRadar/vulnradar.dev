// Scan button + mode toggle + URL pill.
// Layout:
//   [URL bar with copy]
//   [Quick | Deep]        [N/16 families]
//   [       Scan this page        ]
//
// Mode = "quick" (single page) | "deep" (crawl up to maxPages same-origin)
// The families chip shows how many categories are enabled.

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

  if (!props.url) {
    return html`
      <div class="empty-url-state">
        <img
          src="icons/icon-48.png"
          width="32"
          height="32"
          style="border-radius:8px;opacity:0.5"
          alt=""
        />
        <div class="empty-url-text">Navigate to a website to scan it</div>
        ${
          !props.isAuthed
            ? html`
                <div class="empty-url-sub">
                  Connect an API key in Settings first
                </div>
              `
            : null
        }
      </div>
    `;
  }

  return html`
    <div class="scan-section">
      <div class="url-pill" title=${props.url}>
        <span class="icon">&rarr;</span>
        <span class="text">${truncateUrl(props.url, 52)}</span>
        <button class="copy" @click=${props.onCopyUrl} title="Copy URL">
          Copy
        </button>
      </div>
      <div class="scan-controls-row">
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
      </div>
      <button
        class="scan-button-full"
        @click=${props.onScan}
        ?disabled=${props.isScanning || !props.isAuthed}
        title=${props.isAuthed ? "Scan this page" : "Connect an API key first"}
      >
        ${
          props.isScanning
            ? html`<span class="spinner"></span> Scanning&hellip;`
            : html`Scan this page`
        }
      </button>
    </div>
  `;
}
