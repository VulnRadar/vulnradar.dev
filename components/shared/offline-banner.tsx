"use client";

import { WifiOff } from "lucide-react";
import { useOnline } from "@/lib/hooks/use-online";

/**
 * The one place the app admits it is offline.
 *
 * Mounted once in app/layout.tsx so it covers every route. Pinned to the
 * bottom rather than the top on purpose: the top edge already carries the
 * site-notification banner and the impersonation banner, both of which the
 * fixed header offsets itself below via CSS variables, and a third band up
 * there would have to join that arrangement for a state that lasts seconds.
 *
 * `role="status"` rather than `role="alert"`: losing the connection is worth
 * announcing, but not worth interrupting whatever a screen reader is already
 * reading out.
 */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;

  return (
    <div
      // Lifted above the cookie notice by its published height. This pill is
      // z-70, above that bar's z-60, so at a flat bottom-4 it painted its own
      // two lines of text straight over the notice's copy on a phone, where
      // the notice is roughly 125px tall.
      className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+var(--vr-cookie-h,0px))] z-70 flex justify-center px-4 transition-[bottom] duration-300"
    >
      <p
        role="status"
        className="pointer-events-auto flex items-center gap-2.5 rounded-lg border border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/10 px-3.5 py-3 text-sm text-foreground shadow-lg backdrop-blur"
      >
        <WifiOff
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-[hsl(var(--warning))]"
        />
        <span>
          <span className="font-medium">You are offline.</span> Nothing on this
          page is up to date.
        </span>
      </p>
    </div>
  );
}
