"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { copyToClipboard } from "@/lib/ui/clipboard";

/** How long "Copied" stays up. Five hand-rolled copies had drifted to 1500, 1800 and 2000ms. */
export const COPIED_FEEDBACK_MS = 2000;

/**
 * The state half of every copy button: copy for real (lib/ui/clipboard.ts
 * reports whether it worked), then show "Copied" for the same length of time
 * everywhere.
 *
 * `key` lets one hook serve several copy targets on the same surface (the
 * three snippets on the badge page): `copied` is the key that was copied last,
 * or null. Call `copy(text)` without a key for a single target and read
 * `copied !== null`.
 */
export function useCopyFeedback() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async (text: string, key = "default") => {
    const ok = await copyToClipboard(text);
    if (!ok) return false;
    if (timer.current) clearTimeout(timer.current);
    setCopied(key);
    timer.current = setTimeout(() => setCopied(null), COPIED_FEEDBACK_MS);
    return true;
  }, []);

  return { copied, copy };
}

/**
 * The announcement half. A copy button swaps its icon or its text to
 * "Copied", which a screen reader does not reliably read out, because the
 * control's focus did not change. Render this beside the button (never inside
 * it: a button's children are presentational and a live region there is not
 * announced).
 */
export function CopiedAnnouncement({
  copied,
  noun,
}: {
  /** Truthy while the "Copied" state is showing. */
  copied: unknown;
  /** What was copied: "link", "error details", "summary". */
  noun: string;
}) {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {copied ? `${noun.charAt(0).toUpperCase()}${noun.slice(1)} copied` : ""}
    </span>
  );
}
