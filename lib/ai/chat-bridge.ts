"use client";

/**
 * Cross-component bridge into the floating AI chat widget
 * (components/ai-chat/chat-widget.tsx), so a page far from the widget (the
 * "Ask about this" button under an AI scan summary, see
 * components/scanner/scan-summary.tsx) can open it pre-seeded with a
 * message instead of building a second, separate chat surface. Same
 * window-CustomEvent idiom as QUERY_CHANGE_EVENT in lib/ui/url-state.ts.
 *
 * Deliberately reused rather than duplicated: the widget is already scoped
 * to "help with VulnRadar" (see lib/ai/system-prompt.ts), already treats
 * scan data pasted into chat as untrusted content rather than instructions,
 * and already has a `/history [id]` command that loads a specific scan's
 * context on demand. A second chat UI would either re-solve all of that or
 * skip it.
 */

export const AI_CHAT_ASK_EVENT = "vr:ai-chat-ask";

export interface AiChatAskDetail {
  prompt: string;
}

/**
 * Opens the chat widget and, once the viewer is signed in, sends `prompt`
 * as the first user message so the conversation continues normally from
 * there. If the viewer is signed out, the widget still opens (to its own
 * sign-in gate) but nothing is sent -- there's no composer to send it
 * through in that state, and the widget's session-cookie-gated
 * POST /api/v3/ai/chat would just 401 on it anyway.
 */
export function askAiChatAbout(prompt: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<AiChatAskDetail>(AI_CHAT_ASK_EVENT, {
      detail: { prompt },
    }),
  );
}
