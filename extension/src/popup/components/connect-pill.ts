// Connect pill: "Connected as email@example.com [PLAN]" or
// "Not connected" with a link to the Options page.

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

export function ConnectPill(props: ConnectPillProps): TemplateResult {
  if (!props.me) {
    return html`
      <div class="pill disconnected">
        <span class="dot"></span>
        <span class="label">Not connected</span>
        <button class="section-action" @click=${props.onOpenOptions}>
          Connect
        </button>
      </div>
    `;
  }
  const plan = PLAN_LABEL[props.me.plan] ?? props.me.plan;
  const email =
    props.me.name && props.me.name.length > 0
      ? `${props.me.name} \u00b7 ${props.me.email}`
      : props.me.email;
  return html`
    <div class="pill connected">
      <span class="dot"></span>
      <span class="label" title=${email}>${email}</span>
      <span class="plan">${plan}</span>
    </div>
  `;
}
