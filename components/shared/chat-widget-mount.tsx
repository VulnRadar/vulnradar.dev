"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import { AI_CHAT_ASK_EVENT, type AiChatAskDetail } from "@/lib/ai/chat-bridge";

/**
 * Keeps the floating AI chat widget off the critical path of every page.
 *
 * ChatWidget used to be a static import in the root layout, which put it in
 * the /layout entry chunk and therefore on all 311 routes. It pulls
 * react-markdown and remark-gfm at module scope, measured at ~50 KB gzipped
 * across two chunks, roughly a fifth of the JS an anonymous visitor to
 * /landing downloads, and it fires /api/v3/ai/info on mount. Every crawler and
 * every visitor to the ~790 public marketing and SEO pages paid for a chat
 * client most of them never open.
 *
 * Here it is imported on demand instead, once the browser goes idle, so the
 * download and that request never compete with first paint. The launcher
 * button appears a beat later than it used to, which is the whole trade.
 *
 * The one thing that must not break is lib/ai/chat-bridge.ts: "Ask about this"
 * on a scan summary dispatches a window event the widget subscribes to in an
 * effect, and an unmounted widget drops it. So the event also forces the
 * import, and the detail is re-dispatched on the next frame once the widget
 * has mounted and its own listener is live.
 */
export function ChatWidgetMount() {
  const [Widget, setWidget] = useState<ComponentType | null>(null);
  const pendingAsk = useRef<AiChatAskDetail | null>(null);

  const load = useCallback(() => {
    void import("@/components/ai-chat/chat-widget").then((mod) => {
      // Stored via an updater so React does not call the component as a
      // lazy state initialiser.
      setWidget(() => mod.ChatWidget);
    });
  }, []);

  useEffect(() => {
    if (Widget) return;

    const onAsk = (event: Event) => {
      pendingAsk.current =
        (event as CustomEvent<AiChatAskDetail>).detail ?? null;
      load();
    };
    window.addEventListener(AI_CHAT_ASK_EVENT, onAsk);

    // requestIdleCallback is unsupported in Safari before 17, so fall back to
    // a plain timeout rather than never loading the widget there.
    const hasIdle = typeof window.requestIdleCallback === "function";
    const handle = hasIdle
      ? window.requestIdleCallback(load, { timeout: 3000 })
      : window.setTimeout(load, 1500);

    return () => {
      window.removeEventListener(AI_CHAT_ASK_EVENT, onAsk);
      if (hasIdle) window.cancelIdleCallback(handle as number);
      else window.clearTimeout(handle as number);
    };
  }, [Widget, load]);

  useEffect(() => {
    const detail = pendingAsk.current;
    if (!Widget || !detail) return;
    pendingAsk.current = null;
    // One frame after the widget commits, so its own listener is registered.
    const frame = requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent<AiChatAskDetail>(AI_CHAT_ASK_EVENT, { detail }),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [Widget]);

  return Widget ? <Widget /> : null;
}
