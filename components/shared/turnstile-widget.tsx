"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import {
  SUPPORT_EMAIL,
  TURNSTILE_ENABLED,
} from "@/lib/config/client-constants";

/**
 * How long to wait for challenges.cloudflare.com before telling the user it is
 * not coming. Long enough to survive a slow mobile connection, short enough
 * that nobody sits in front of a greyed-out submit button wondering why.
 */
const TURNSTILE_LOAD_TIMEOUT_MS = 10_000;

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
  const [failed, setFailed] = useState(false);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the externally-loaded Turnstile script's readiness (a global, not React-owned state)
    if (getTurnstile()) setReady(true);
  }, [ready]);

  // If challenges.cloudflare.com never answers (corporate proxy, ad blocker,
  // regional block, Cloudflare outage) the widget used to stay an empty div
  // forever and the gated submit button stayed greyed out with no explanation,
  // so the user could neither sign up nor reach the contact form to say so.
  // Bound the wait and surface a failure instead of hanging silently.
  useEffect(() => {
    if (ready || failed) return;
    const timer = setTimeout(() => setFailed(true), TURNSTILE_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [ready, failed]);

  useEffect(() => {
    if (!ready || !widgetRef.current || widgetIdRef.current) return;
    const turnstile = getTurnstile();
    if (!turnstile) return;
    try {
      widgetIdRef.current = turnstile.render(widgetRef.current, {
        sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
        theme: "auto",
        callback: (token: string) => {
          setFailed(false);
          onVerifyRef.current(token);
        },
        "expired-callback": () => onExpireRef.current?.(),
        // Turnstile itself failed (challenge could not be fetched or solved).
        // Without these the widget just sits there.
        "error-callback": () => setFailed(true),
        "timeout-callback": () => setFailed(true),
        "unsupported-callback": () => setFailed(true),
      });
    } catch (err) {
      console.error("[Turnstile] Failed to render widget:", err);
      setFailed(true);
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
      {failed && (
        <p
          role="status"
          className="text-xs text-muted-foreground text-center leading-relaxed"
        >
          Verification could not load, so we cannot check this form. Refresh the
          page to try again, or email{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-primary hover:underline"
          >
            {SUPPORT_EMAIL}
          </a>{" "}
          and we will help from there.
        </p>
      )}
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        onLoad={() => setReady(true)}
        onError={() => setFailed(true)}
      />
    </>
  );
}
