"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/ui/utils";
import { formatMmSs, secondsRemaining } from "@/lib/browserbase/viewer-session";
import { countdownAnnouncement } from "@/lib/browserbase/countdown-announcement";

interface SessionCountdownProps {
  /** The user-controlled deadline, epoch ms. */
  expiresAt: number;
  canExtend: boolean;
  /** Minutes granted so far, out of maxMinutes. */
  minutesAllocated: number;
  maxMinutes: number;
  onExtend: () => void;
}

/**
 * The clock in the viewer's top bar, and the +1m button beside it.
 *
 * It owns the once-a-second tick. That tick used to be state on the page, so
 * the whole viewer (the header, the iframe's wrapper and every row of the
 * network dock) re-rendered sixty times a minute to move one number. Ending the
 * session is the page's job and runs off a single timeout; this is display
 * only.
 *
 * The ticking digits are a role="timer" (a timer is not a live region by
 * default), so a screen reader is not read a new number every second. What it
 * hears comes from the separate status element below, which changes only on
 * load, at 30 and 10 seconds, on expiry and when the session is extended.
 */
export function SessionCountdown({
  expiresAt,
  canExtend,
  minutesAllocated,
  maxMinutes,
  onExtend,
}: SessionCountdownProps) {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = secondsRemaining(expiresAt, now);
  const message = countdownAnnouncement(remaining, minutesAllocated);
  // Empty at first and filled in an effect: a live region only announces text
  // that arrives after it is in the page, so a value present on first render
  // would be skipped and "Session lasts 1 minute" would never be heard.
  const [announced, setAnnounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setAnnounced(message), 0);
    return () => clearTimeout(id);
  }, [message]);
  const expiresSoon = remaining <= 60;
  const expiresCritical = remaining <= 20;

  return (
    <div
      className={cn(
        "shrink-0 flex items-stretch h-9 sm:h-8 rounded-md border overflow-hidden transition-colors",
        expiresCritical
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : expiresSoon
            ? "border-[hsl(var(--warning))]/25 bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))]"
            : "border-border/60 bg-muted/40 text-muted-foreground",
      )}
    >
      <div
        className="flex items-center gap-1.5 px-2.5 text-xs font-medium tabular-nums"
        role="timer"
        title={`Session time remaining: ${formatMmSs(remaining)}`}
      >
        <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
          <span
            className={cn(
              "animate-ping absolute inline-flex h-full w-full rounded-full opacity-60",
              expiresCritical
                ? "bg-destructive"
                : expiresSoon
                  ? "bg-[hsl(var(--warning))]"
                  : "bg-[hsl(var(--success))]",
            )}
          />
          <span
            className={cn(
              "relative inline-flex rounded-full h-1.5 w-1.5",
              expiresCritical
                ? "bg-destructive"
                : expiresSoon
                  ? "bg-[hsl(var(--warning))]"
                  : "bg-[hsl(var(--success))]",
            )}
          />
        </span>
        {formatMmSs(remaining)}
      </div>
      <button
        onClick={onExtend}
        disabled={!canExtend}
        // a11y (SC 4.1.2): the visible "+1m" is an abbreviation, so the
        // accessible name spells the action out. title stays as the
        // sighted-user tooltip, which is unreachable on touch.
        aria-label="Extend session by 1 minute"
        title={
          canExtend
            ? `Add 1 minute (${minutesAllocated}/${maxMinutes} min used)`
            : `Maximum session time reached (${maxMinutes} min total)`
        }
        className={cn(
          "flex items-center px-2 border-l text-[11px] font-medium tabular-nums transition-colors",
          expiresCritical
            ? "border-destructive/30"
            : expiresSoon
              ? "border-[hsl(var(--warning))]/25"
              : "border-border/60",
          canExtend
            ? "hover:bg-foreground/5 hover:text-foreground cursor-pointer"
            : "opacity-40 cursor-not-allowed",
        )}
      >
        +1m
      </button>
      <span role="status" className="sr-only">
        {announced}
      </span>
    </div>
  );
}
