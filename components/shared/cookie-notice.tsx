"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/config/client-constants";
import { cn } from "@/lib/ui/utils";

const STORAGE_KEY = "vr-cookie-notice-dismissed";

/**
 * Whether a modal has put this bar out of reach.
 *
 * The bar is a body child mounted beside the page, so an open modal treats it
 * as page content behind the dialog: Radix marks it `aria-hidden`, and our own
 * modal shells (useInertBackground) add `inert` as well. Either way its
 * buttons stop working, but it is z-60, above the z-50 scrim, so it stayed on
 * screen looking clickable and ignoring every click. Reading the same two
 * attributes the modals write means it needs no list of modals to watch.
 */
export function isCoveredByModal(
  el: Pick<Element, "getAttribute" | "hasAttribute">,
): boolean {
  return el.getAttribute("aria-hidden") === "true" || el.hasAttribute("inert");
}

/**
 * Dismissible cookie notice, shown once until dismissed (persisted in
 * localStorage). VulnRadar sets only strictly-necessary cookies (session, CSRF,
 * theme, consent), so this is an informational bottom bar, not a
 * blocking accept/reject consent gate. SSR-safe: renders nothing on the server
 * and on the first client render (so hydration matches), then appears on mount
 * only if it hasn't been dismissed.
 */
export function CookieNotice() {
  const [visible, setVisible] = useState(false);
  const [covered, setCovered] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      // Storage blocked (private mode, etc.): show it; dismiss just won't persist.
    }
    // oxlint-disable-next-line react/set-state-in-effect -- one-shot post-mount reveal based on localStorage; keeps SSR/first-render output empty
    if (!dismissed) setVisible(true);
  }, []);

  // Publish the bar's real height the way site-notifications.tsx publishes
  // --vr-banner-h. This bar is mounted last in the root layout, so at an equal
  // z-index it painted over every fixed bottom control in the app: the "Save
  // Changes" bars on /profile and two admin editors, and the docs "Contents"
  // button. At 375px it is roughly 125px tall (three lines of copy plus a
  // button row), which covered those controls completely. Anything fixed to
  // the bottom offsets by --vr-cookie-h instead of guessing a constant.
  useEffect(() => {
    const el = barRef.current;
    const root = document.documentElement;
    if (!el) {
      root.style.setProperty("--vr-cookie-h", "0px");
      delete root.dataset.cookieNotice;
      return;
    }
    // The height is not enough on a phone. Everything fixed to the bottom
    // lifts by --vr-cookie-h, so while this bar is up the support launcher
    // sits 137px higher than usual and lands on whatever the page has there:
    // on the landing hero at 390px that is the "Try the demo" button, with a
    // 56px circle over its corner. The flag lets app/globals.css take the
    // launcher out of the way until the notice is answered, which is one
    // decision at a time rather than two overlays fighting for the same
    // corner.
    root.dataset.cookieNotice = "open";
    const observer = new ResizeObserver(([entry]) => {
      root.style.setProperty("--vr-cookie-h", `${entry.contentRect.height}px`);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.setProperty("--vr-cookie-h", "0px");
      delete root.dataset.cookieNotice;
    };
  }, [visible]);

  // Hidden, not removed, while a modal covers it: `invisible` keeps the box, so
  // --vr-cookie-h stays published and the modal layer's bottom padding does not
  // jump as the dialog animates in, and the bar is back the moment the modal
  // takes its attributes off. Display none would report a height of 0 and move
  // everything anchored above the bar twice per modal.
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const observer = new MutationObserver(() => {
      setCovered(isCoveredByModal(el));
    });
    observer.observe(el, {
      attributes: true,
      attributeFilter: ["aria-hidden", "inert"],
    });
    return () => observer.disconnect();
  }, [visible]);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore: nothing to persist to */
    }
  }

  if (!visible) return null;

  return (
    <div
      ref={barRef}
      role="region"
      aria-label="Cookie notice"
      // Everything fixed to the bottom already adds --vr-cookie-h, so the chat
      // launcher's collision probe must not also climb over this bar.
      data-publishes-bottom-offset="--vr-cookie-h"
      // z-60, above the z-50 floating save bars, so the two never tie on
      // paint order; they offset above it via --vr-cookie-h.
      className={cn(
        "fixed inset-x-0 bottom-0 z-60 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80",
        covered && "invisible",
      )}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-6">
        <p className="flex-1 text-sm text-muted-foreground">
          We use only essential cookies to keep you signed in and the app
          working, no advertising or third-party tracking. See our{" "}
          <a
            href={ROUTES.LEGAL_PRIVACY}
            className="text-primary hover:underline"
          >
            Privacy Policy
          </a>
          .
        </p>
        {/* Both controls at 44px on a phone, stepping back down from sm. This
            bar sits over the bottom of every page in the product and its two
            dismiss controls were 32px and 28px tall, which is the wrong place
            to make someone aim. The bar republishes --vr-cookie-h on resize,
            so the extra height is picked up by everything anchored above it. */}
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" onClick={dismiss} className="h-11 sm:h-8">
            Got it
          </Button>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss cookie notice"
            className="flex h-11 w-11 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:h-auto sm:w-auto sm:p-1.5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
