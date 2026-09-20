"use client";

import { useState } from "react";
import { Languages, Loader2 } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { focus } from "@/lib/ui/animations";
import { API } from "@/lib/config/client-constants";
import { LOCALE_NAMES, isLocale } from "@/lib/i18n/config";

export interface TranslatableMessageProps {
  ticketId: number;
  messageId: number;
  /** Exactly what the author wrote. Never replaced. */
  body: string;
  /** The language it was written in, once known. */
  bodyLocale?: string | null;
  /** The same message in the reader's language, when it has been translated. */
  translation?: string | null;
  className?: string;
}

/**
 * One message of a support thread, in the language the reader reads.
 *
 * Support is two people who may not share a language. When the message was
 * written in another one, this shows the translation and keeps the original a
 * click away, both ways round: the customer reads the reply in their language,
 * and staff read the question in theirs.
 *
 * The original is what the thread is a record of, so it is never overwritten,
 * it is labelled whenever a translation is on screen, and a translation that
 * cannot be produced leaves the message exactly as it was written.
 */
export function TranslatableMessage({
  ticketId,
  messageId,
  body,
  bodyLocale,
  translation,
  className,
}: TranslatableMessageProps) {
  const [translated, setTranslated] = useState<string | null>(
    translation ?? null,
  );
  const [showingOriginal, setShowingOriginal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // Nothing to offer when the message is already in the reader's language:
  // the API only sends a translation, or a foreign bodyLocale, when it is not.
  const canTranslate = Boolean(bodyLocale) && (translated !== null || !failed);
  const writtenIn =
    bodyLocale && isLocale(bodyLocale) ? LOCALE_NAMES[bodyLocale] : bodyLocale;

  async function translate() {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`${API.SUPPORT_TICKETS}/${ticketId}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      const data = (await res.json().catch(() => null)) as {
        text?: string;
      } | null;
      if (!res.ok || !data?.text) throw new Error("no translation");
      setTranslated(data.text);
      setShowingOriginal(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const showing = translated && !showingOriginal ? translated : body;
  const readingTranslation = Boolean(translated) && !showingOriginal;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="whitespace-pre-wrap break-words">{showing}</div>
      {canTranslate && (
        <div className="flex items-center gap-2 pt-1 text-[11px] text-muted-foreground">
          {translated ? (
            <button
              type="button"
              onClick={() => setShowingOriginal((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1 rounded-sm underline underline-offset-2 hover:text-foreground",
                focus.ring,
              )}
            >
              <Languages aria-hidden className="h-3 w-3" />
              {readingTranslation
                ? writtenIn
                  ? `Translated. Show the original (${writtenIn})`
                  : "Translated. Show the original"
                : "Show the translation"}
            </button>
          ) : (
            <button
              type="button"
              onClick={translate}
              disabled={busy}
              className={cn(
                "inline-flex items-center gap-1 rounded-sm underline underline-offset-2 hover:text-foreground disabled:opacity-60",
                focus.ring,
              )}
            >
              {busy ? (
                <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
              ) : (
                <Languages aria-hidden className="h-3 w-3" />
              )}
              {writtenIn ? `Translate from ${writtenIn}` : "Translate"}
            </button>
          )}
          {failed && (
            <span>Could not translate this one. It is shown as written.</span>
          )}
        </div>
      )}
    </div>
  );
}
