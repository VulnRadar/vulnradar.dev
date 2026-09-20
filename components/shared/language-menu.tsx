"use client";

import { useLocale, useTranslations } from "next-intl";
import { Check, Languages } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/ui/utils";
import { focus } from "@/lib/ui/animations";
import { LOCALES, LOCALE_NAMES, type Locale } from "@/lib/i18n/config";
import { useSetLanguage } from "@/components/shared/use-set-language";

/**
 * The language switcher in the header, beside the theme toggle.
 *
 * An icon button rather than a labelled control: it sits in a row of icon
 * buttons, and every language is listed in its own words, so the menu says
 * what it offers without the trigger having to.
 */
export function LanguageMenu({ className }: { className?: string }) {
  const t = useTranslations("language");
  const current = useLocale() as Locale;
  const { setLanguage, busy } = useSetLanguage();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("select")}
        title={t("label")}
        disabled={busy}
        className={cn(
          // The same shape, size and states as the bell beside it: a circle,
          // 44px below sm for the touch target, and a held-open look while
          // the menu is showing.
          "inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60 sm:h-9 sm:w-9",
          "data-[state=open]:bg-muted data-[state=open]:text-foreground",
          focus.ring,
          className,
        )}
      >
        <Languages aria-hidden className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {LOCALES.map((locale) => (
          <DropdownMenuItem
            key={locale}
            onSelect={() => {
              if (locale !== current) void setLanguage(locale);
            }}
            className="justify-between gap-3"
          >
            {/* Its own name, because that is what someone looking for it
                reads. */}
            <span lang={locale}>{LOCALE_NAMES[locale]}</span>
            {locale === current && (
              <Check aria-hidden className="h-3.5 w-3.5 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
