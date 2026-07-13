// Connect pill: "Connected as email@example.com [PLAN]" or
// "Not connected" with a link to the Options page.
// Uses the extension favicon as a visual anchor.

import { html, type TemplateResult } from "lit-html";
import type { AuthMe } from "../../lib/types";

export interface ConnectPillProps {
  readonly me: AuthMe | null;
  readonly onOpenOptions: () => void;
}

const PLAN_LABEL: Record<AuthMe["plan"], string> = {
  free: "Free",
  core_supporter: "Core",
  pro_supporter: "Pro",
  elite_supporter: "Elite",
};

const ICON = html`<img
  src="icons/icon-16.png"
  width="14"
  height="14"
  style="border-radius:3px;flex-shrink:0;display:block"
  alt=""
/>`;

export function ConnectPill(props: ConnectPillProps): TemplateResult {
  if (!props.me) {
    return html`
      <div class="pill disconnected">
        ${ICON}
        <span class="label">Not connected</span>
        <button class="section-action" @click=${props.onOpenOptions}>
          Connect
        </button>
      </div>
    `;
  }
  const plan = PLAN_LABEL[props.me.plan] ?? props.me.plan;
  const displayName =
    props.me.name && props.me.name.length > 0
      ? props.me.name
      : props.me.email;
  return html`
    <div class="pill connected" title=${props.me.email}>
      ${ICON}
      <span class="label">${displayName}</span>
      <span class="plan">${plan}</span>
    </div>
  `;
}
