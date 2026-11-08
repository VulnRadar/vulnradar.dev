"use client";

import { Check, Copy } from "lucide-react";
import {
  CopiedAnnouncement,
  useCopyFeedback,
} from "@/components/shared/copy-feedback";
import { focus } from "@/lib/ui/animations";
import { cn } from "@/lib/ui/utils";

/**
 * A colour value that copies itself. The hex is the button's visible label,
 * so the accessible name ("Copy Primary, light theme, #61a6fa") contains
 * what a speech-input user sees and says, and the colour's name tells apart
 * two buttons that copy the same hex.
 *
 * The negative margin is on the left only: it lines the hex up with the
 * column while the hover fill reaches into the gap before it. On the right
 * it would push the fill past the end of the row.
 */
export function CopyHex({ value, name }: { value: string; name: string }) {
  const { copied, copy } = useCopyFeedback();
  return (
    <>
      <button
        type="button"
        onClick={() => copy(value)}
        className={cn(
          "-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 font-mono text-sm text-foreground transition-colors hover:bg-muted sm:min-h-8",
          focus.ring,
        )}
      >
        <span className="sr-only">Copy {name}, </span>
        {value}
        {copied ? (
          <Check aria-hidden className="h-3.5 w-3.5 text-primary" />
        ) : (
          <Copy aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>
      <CopiedAnnouncement copied={copied} noun={`${name}, ${value}`} />
    </>
  );
}
