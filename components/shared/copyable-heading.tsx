"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyToClipboard } from "@/lib/ui/clipboard";

interface CopyableHeadingProps {
  /** Copied to the clipboard, and shown in full as the tooltip. */
  value: string;
  /** What the heading shows, when it is shorter than `value`. */
  display?: string;
  /** What the value is, for the copy confirmation: "URL", "hostname". */
  noun: string;
}

/**
 * The page's subject (a scanned URL, a hostname) as its h1, which copies
 * itself when activated.
 *
 * This was built by hand on /dashboard, /history, /host and /shared, and the
 * copies drifted: two rendered the heading at text-base, below even the
 * failure-page tier, while the other two put the h1 inside the button, which
 * is invalid (a button takes phrasing content). All four named the button
 * "Copy scanned URL" with aria-label, which also became the heading's text, so
 * a screen reader moving by heading heard the action instead of the URL, and
 * a successful copy was only an icon swap nobody using one could perceive.
 *
 * Tier B size, without text-balance, which does nothing next to truncate.
 */
export function CopyableHeading({
  value,
  display,
  noun,
}: CopyableHeadingProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (await copyToClipboard(value)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <>
      <h1 className="flex min-w-0 items-center">
        <button
          type="button"
          onClick={copy}
          title={value}
          className="group flex min-w-0 items-center gap-2 rounded-sm text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate text-xl font-semibold tracking-tight text-foreground transition-colors group-hover:text-primary sm:text-2xl">
            {display ?? value}
          </span>
          <span className="sr-only">, copy {noun}</span>
          {copied ? (
            <Check
              aria-hidden
              className="h-4 w-4 shrink-0 text-[hsl(var(--success))]"
            />
          ) : (
            <Copy
              aria-hidden
              className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            />
          )}
        </button>
      </h1>
      {/* Outside the button: a button's children are presentational, so a
          live region inside it is never announced. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? `${noun} copied` : ""}
      </span>
    </>
  );
}
