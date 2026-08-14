"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { TURNSTILE_ENABLED } from "@/lib/config/constants";

interface TurnstileWindow extends Window {
  turnstile?: {
    render: (el: HTMLElement, opts: Record<string, unknown>) => string;
    remove: (id: string) => void;
  };
}

function getTurnstile(): TurnstileWindow["turnstile"] {
  return typeof window === "undefined"
    ? undefined
    : (window as TurnstileWindow).turnstile;
}

interface TurnstileWidgetProps {
  onVerify: (token: string) => void;
  onExpire?: () => void;
  className?: string;
}

/**
 * Cloudflare Turnstile widget, shared by signup and contact (both used to
 * carry their own copy of this).
 *
 * Client-side navigation away and back remounts this component without
 * reloading challenges.cloudflare.com/turnstile/v0/api.js: the <script> tag
 * and window.turnstile both persist across the route change. A version that
 * only became "ready" from <Script onLoad> never rendered again after the
 * first page visit, because Next.js does not reliably refire onLoad for an
 * already-loaded script on a fresh mount. Checking window.turnstile directly
 * on mount (the useState initializer and the effect below) covers that case;
 * onLoad stays as the path for a genuine first load, when the global truly
 * is not there yet.
 */
export function TurnstileWidget({
  onVerify,
  onExpire,
  className,
}: TurnstileWidgetProps) {
  const [ready, setReady] = useState(() => !!getTurnstile());
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  // Latest callbacks without re-running the render effect on every parent
  // re-render (a new onVerify closure on every keystroke would otherwise
  // tear down and recreate the widget constantly).
  const onVerifyRef = useRef(onVerify);
  useEffect(() => {
    onVerifyRef.current = onVerify;
  }, [onVerify]);
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (ready) return;
    if (getTurnstile()) setReady(true);
  }, [ready]);

  useEffect(() => {
    if (!ready || !widgetRef.current || widgetIdRef.current) return;
    const turnstile = getTurnstile();
    if (!turnstile) return;
    try {
      widgetIdRef.current = turnstile.render(widgetRef.current, {
        sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
        theme: "auto",
        callback: (token: string) => onVerifyRef.current(token),
        "expired-callback": () => onExpireRef.current?.(),
      });
    } catch (err) {
      console.error("[Turnstile] Failed to render widget:", err);
    }
    return () => {
      if (widgetIdRef.current && turnstile) {
        try {
          turnstile.remove(widgetIdRef.current);
        } catch (err) {
          console.error("[Turnstile] Failed to remove widget:", err);
        }
        widgetIdRef.current = null;
      }
    };
  }, [ready]);

  if (!TURNSTILE_ENABLED) return null;

  return (
    <>
      <div ref={widgetRef} className={className ?? "flex justify-center"} />
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        onLoad={() => setReady(true)}
      />
    </>
  );
}
