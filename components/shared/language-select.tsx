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
    if (next === current) return;
    void setLanguage(next as Locale);
  }

  return (
    <div className={className}>
      <Select value={current} onValueChange={choose} disabled={busy}>
        {/* The trigger holds the value and nothing else. A globe next to
            SelectValue wrapped onto its own line, because the trigger already
            spends its width on the value and the chevron. */}
        <SelectTrigger
          className="w-full sm:w-56"
          aria-label={t("select")}
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
