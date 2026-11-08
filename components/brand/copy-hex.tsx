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
 * so the accessible name ("Copy #60a5fa") contains what a speech-input user
 * sees and says.
 */
export function CopyHex({ value, name }: { value: string; name: string }) {
  const { copied, copy } = useCopyFeedback();
  return (
    <>
      <button
        type="button"
        onClick={() => copy(value)}
        title={`Copy ${name}, ${value}`}
        className={cn(
          "-mx-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 font-mono text-sm text-foreground transition-colors hover:bg-muted sm:min-h-8",
          focus.ring,
        )}
      >
        <span className="sr-only">Copy </span>
        {value}
        {copied ? (
          <Check aria-hidden className="h-3.5 w-3.5 text-primary" />
        ) : (
          <Copy aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>
      <CopiedAnnouncement copied={copied} noun={`${name} ${value}`} />
    </>
  );
}
