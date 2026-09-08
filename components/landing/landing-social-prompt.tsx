"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import Link from "next/link";
import { SocialLinks } from "@/components/shared/social-links";
import { APP_NAME, ROUTES, SOCIAL_LINKS } from "@/lib/config/client-constants";
import { cn } from "@/lib/ui/utils";

const STORAGE_KEY = "vr-social-prompt-dismissed";

/**
 * How far down the page someone has to be before this appears, as a fraction
 * of the scrollable distance. Deliberately past the hero and the sample
 * finding: a prompt to follow us that arrives before anyone has seen what the
 * scanner does is asking for a favour before doing one. Someone this far down
 * has read the page.
 */
const REVEAL_AT = 0.45;

/**
 * A small, once-only invitation to follow the project, anchored to the bottom
 * of the landing page.
 *
 * Deliberately not a modal: nothing is trapped, nothing is blocked, and
 * ignoring it costs a scroll. It appears once per browser and remembers being
 * dismissed, so the second visit is clean.
 *
 * Renders nothing at all when a deployment has configured no social accounts,
 * because SOCIAL_LINKS has already dropped the unconfigured ones. A
 * self-hoster gets no empty box.
 */
export function LandingSocialPrompt() {
  const [visible, setVisible] = useState(false);
  const [entered, setEntered] = useState(false);

  const dismiss = useCallback(() => {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* private mode, storage blocked: it just shows again next visit */
    }
  }, []);

  useEffect(() => {
    if (SOCIAL_LINKS.length === 0) return;

    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") return;
    } catch {
      /* unreadable storage is treated as "not dismissed" */
    }

    function onScroll() {
      const scrollable =
        document.documentElement.scrollHeight - window.innerHeight;
      // A page shorter than the viewport has nothing to scroll, so the ratio
      // would be Infinity and the card would appear immediately.
      if (scrollable <= 0) return;
      if (window.scrollY / scrollable < REVEAL_AT) return;
      setVisible(true);
      window.removeEventListener("scroll", onScroll);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    // Covers a reload that restores a scroll position past the threshold,
    // where no scroll event ever fires.
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Escape closes it, the same as the X. It holds no focus of its own, so
  // this is on the document rather than on the card.
  useEffect(() => {
    if (!visible) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") dismiss();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible, dismiss]);

  // Mount first, then animate, so the transition has a frame to start from.
  useEffect(() => {
    if (!visible) return;
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, [visible]);

  if (!visible) return null;

  return (
    <aside
      aria-label={`Follow ${APP_NAME}`}
      // Sits above the cookie notice rather than under it: that bar publishes
      // its real height as --vr-cookie-h precisely so fixed bottom elements
      // stop guessing. z-40 keeps it under the notice's z-60, which is the
      // one thing that should win if they ever overlap.
      style={{ bottom: "calc(var(--vr-cookie-h, 0px) + 1rem)" }}
      className={cn(
        "fixed inset-x-4 z-40 sm:inset-x-auto sm:right-6 sm:w-80",
        "rounded-lg border border-border bg-card/95 p-4 shadow-lg backdrop-blur",
        "supports-[backdrop-filter]:bg-card/85",
        "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
        entered ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
      )}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss follow prompt"
        className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>

      <p className="pr-8 text-sm font-medium text-foreground">
        New checks ship most weeks
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Every release gets written up in plain English, including the bugs we
        found in our own scanner. Follow wherever you already read things.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1">
        <SocialLinks
          className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          iconClassName="h-4 w-4"
        />
      </div>

      <Link
        href={ROUTES.CHANGELOG}
        className="mt-2 inline-block text-sm text-primary hover:underline"
        onClick={dismiss}
      >
        Read the changelog
      </Link>
    </aside>
  );
}
