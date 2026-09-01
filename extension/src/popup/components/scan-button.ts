// Scan button + mode toggle + URL pill.
// Layout:
//   [URL bar with copy]
//   [Quick | Deep]        [N/16 families]
//   [       Scan this page        ]
//
// Mode = "quick" (single page) | "deep" (crawl multiple same-origin pages)
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
        <span class="icon" aria-hidden="true">&rarr;</span>
        <span class="text">${truncateUrl(props.url, 52)}</span>
        <button
          class="copy"
          @click=${props.onCopyUrl}
          title="Copy URL"
          aria-label="Copy the page URL"
        >
          Copy
        </button>
      </div>
      <div class="scan-controls-row">
        <!-- a11y (SC 4.1.2): this was role="tablist" / role="tab" /
             aria-selected, and there is no role="tabpanel" anywhere in the
             extension and no aria-controls, so the tab contract was announced
             and never honoured: assistive tech offered tab navigation into
             panels that do not exist, and the arrow-key movement a tablist
             promises was never implemented either. Quick and Deep are two
             toggle buttons that set one field on the next scan, so they are
             described as that. Same resolution, for the same reason, as the
             API playground's language picker in the main app. -->
        <div class="mode-toggle" role="group" aria-label="Scan mode">
          <button
            type="button"
            class=${props.mode === "quick" ? "active" : ""}
            aria-pressed=${props.mode === "quick"}
            @click=${() => props.onModeChange("quick")}
            ?disabled=${props.isScanning}
          >
            Quick
          </button>
          <button
            type="button"
            class=${props.mode === "deep" ? "active" : ""}
            aria-pressed=${props.mode === "deep"}
            @click=${() => props.onModeChange("deep")}
            ?disabled=${props.isScanning}
          >
            Deep
          </button>
        </div>
        <!-- The tooltip this used to carry ("Enabled check families") was
             unreachable: a title on a non-focusable <div> never opens by
             keyboard and gives it no accessible name either. The word it was
             explaining is now in the text. -->
        <div class="families-chip">
          ${enabledCount}/${totalCount} check families
        </div>
      </div>
      <button
        class="scan-button-full"
        type="button"
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
