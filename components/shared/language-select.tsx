"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InlineAlert } from "@/components/shared/inline-alert";
import { LOCALES, LOCALE_NAMES, type Locale } from "@/lib/i18n/config";
import { useSetLanguage } from "@/components/shared/use-set-language";

/**
 * The language this reader gets the site in.
 *
 * Each language is listed in its own words, because someone looking for
 * Japanese is looking for 日本語. Saving refreshes the current route rather
 * than reloading the page: the language is decided server-side per request
 * (lib/i18n/request.ts), so re-rendering is all that is needed, and whatever
 * the reader had open stays open.
 */
export function LanguageSelect({ className }: { className?: string }) {
  const t = useTranslations("language");
  const current = useLocale() as Locale;
  const { setLanguage, busy, error } = useSetLanguage();

  function choose(next: string) {
    if (busy || next === current) return;
    void setLanguage(next as Locale);
  }

  return (
    <div className={className}>
      {/* Busy is aria-busy on the trigger, not `disabled` on the Select. A
          disabled trigger cannot keep focus, and the Select hands focus back
          to it as the list closes, so a choice made from the keyboard left
          focus on the page body. A second pick while a save is in flight is
          ignored in choose() instead. */}
      <Select value={current} onValueChange={choose}>
        {/* The trigger holds the value and nothing else. A globe next to
            SelectValue wrapped onto its own line, because the trigger already
            spends its width on the value and the chevron. */}
        <SelectTrigger
          className="w-full sm:w-56 aria-busy:opacity-60"
          aria-label={t("select")}
          aria-busy={busy}
          id="language-select"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LOCALES.map((locale) => (
            <SelectItem key={locale} value={locale}>
              {LOCALE_NAMES[locale]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && (
        <InlineAlert tone="error" className="mt-2">
          {error}
        </InlineAlert>
      )}
    </div>
  );
}
