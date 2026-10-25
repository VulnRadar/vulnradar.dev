"use client";

import { useState } from "react";
import { Languages, Loader2 } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { focus } from "@/lib/ui/animations";
import { API } from "@/lib/config/client-constants";
import { LOCALE_NAMES, isLocale } from "@/lib/i18n/config";
import {
  originalTextLang,
  translateStatusText,
} from "@/components/support/translatable-message-utils";

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
  //
  // A failed attempt keeps the button. It used to take it away, and with it
  // the failure message that was meant to replace it, so the control a keyboard
  // user had just pressed vanished and focus fell to <body> with nothing said.
  const canTranslate = Boolean(bodyLocale);
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
    <div className={cn("flex flex-col", className)}>
      {/* The author's own words are in their language, and a screen reader
          needs to be told. A translation is in the reader's, so it inherits. */}
      <div
        lang={originalTextLang(bodyLocale, readingTranslation)}
        className="whitespace-pre-wrap break-words"
      >
        {showing}
      </div>
      {/* This row is always mounted. A live region that appears with its text
          already inside it is not announced, so the failure message used to be
          silent even in the one state it could show, and a swap between the
          original and the translation changes the text above without a word.
          Padding only when there is something in the row, so a message with
          nothing to offer takes no more room than it did. */}
      <div
        className={cn(
          "flex items-center gap-2 text-[11px] text-muted-foreground",
          canTranslate && "pt-2",
        )}
      >
        {canTranslate &&
          (translated ? (
            <button
              type="button"
              onClick={() => setShowingOriginal((v) => !v)}
              className={cn(
                "-my-1 inline-flex min-h-6 items-center gap-1 rounded-sm underline underline-offset-2 hover:text-foreground",
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
                "-my-1 inline-flex min-h-6 items-center gap-1 rounded-sm underline underline-offset-2 hover:text-foreground disabled:opacity-60",
                focus.ring,
              )}
            >
              {busy ? (
                <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
              ) : (
                <Languages aria-hidden className="h-3 w-3" />
              )}
              {failed
                ? "Try again"
                : writtenIn
                  ? `Translate from ${writtenIn}`
                  : "Translate"}
            </button>
          ))}
        <span role="status">{translateStatusText(failed)}</span>
      </div>
    </div>
  );
}
