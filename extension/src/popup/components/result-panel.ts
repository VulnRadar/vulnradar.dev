// Result panel: severity summary badges + per-finding list with
// one-line fix hint. Inline severity badge component to keep this
// self-contained.

import { html, type TemplateResult } from "lit-html";
import type { ScanResult, Vulnerability } from "../../lib/types";
import { formatCount, formatDuration, severityHex } from "../../lib/format";

export interface ResultPanelProps {
  readonly result: ScanResult | null;
  readonly error: string | null;
  readonly reason: string | null;
  readonly onOpenDashboard: () => void;
}

function renderSummary(r: ScanResult): TemplateResult {
  const items: TemplateResult[] = [];
  for (const s of ["critical", "high", "medium", "low", "info"] as const) {
    const n = r.summary[s];
    if (n > 0) {
      items.push(html`<span class="badge ${s}">${n} ${s}</span>`);
    }
  }
  if (items.length === 0) {
    return html`<span class="badge low">0 issues</span>`;
  }
  return html`${items}`;
}

function renderFixSnippet(v: Vulnerability): TemplateResult | null {
  if (v.fixSteps && v.fixSteps.length > 0) {
    return html`<div class="fix">${v.fixSteps[0]}</div>`;
  }
  return null;
}

export function ResultPanel(props: ResultPanelProps): TemplateResult {
  if (props.reason) {
    return html`
      <div class="info-banner">
        <span>ℹ</span>
        <span>Skipped: ${props.reason}</span>
      </div>
    `;
  }
  if (props.error) {
    return html`
      <div class="error-banner">
        <span>⚠</span>
        <span>${props.error}</span>
      </div>
    `;
  }
  if (!props.result) return html``;
  const r = props.result;
  return html`
    <div class="result">
      <div class="result-summary">${renderSummary(r)}</div>
      ${
        r.findings.length > 0
          ? html`
              <div class="findings">
                ${r.findings.slice(0, 25).map(
                  (v) => html`
                    <div
                      class="finding"
                      style="border-left: 3px solid ${severityHex(v.severity)}"
                    >
                      <div class="title">${v.title}</div>
                      <div class="desc">${v.description}</div>
                      ${renderFixSnippet(v)}
                    </div>
                  `,
                )}
                ${
                  r.findings.length > 25
                    ? html`<div class="empty">
                        +${r.findings.length - 25} more in dashboard
                      </div>`
                    : null
                }
              </div>
            `
          : html`<div class="empty">No issues found.</div>`
      }
      <div class="result-footer">
        <span
          >${formatCount(r.findings.length)} findings ·
          ${formatDuration(r.duration)}</span
        >
        <a
          href="#"
          @click=${(e: Event) => {
            e.preventDefault();
            props.onOpenDashboard();
          }}
        >
          Open in dashboard →
        </a>
      </div>
    </div>
  `;
}
