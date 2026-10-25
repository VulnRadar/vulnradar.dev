"use client";

import { useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Languages, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/ui/utils";
import { focus } from "@/lib/ui/animations";
import {
  LOCALES,
  LOCALE_NAMES,
  isLocale,
  type Locale,
} from "@/lib/i18n/config";
import { useSetLanguage } from "@/components/shared/use-set-language";

/**
 * The language switcher in the header, beside the theme toggle.
 *
 * An icon button rather than a labelled control: it sits in a row of icon
 * buttons, and every language is listed in its own words, so the menu says
 * what it offers without the trigger having to.
 *
 * The list is a radio group, so the current language is part of the menu's
 * semantics (aria-checked) instead of a tick a screen reader never sees.
 * Saving shows on the trigger as aria-busy and a spinner rather than by
 * disabling it: the menu has just closed and handed focus back to that
 * trigger, and a button that is disabled in that same commit cannot hold it,
 * so focus fell to the page body after every choice. A failed save is
 * announced as a toast, since the menu is closed by then and has nowhere of
 * its own to say so.
 */
export function LanguageMenu({ className }: { className?: string }) {
  const t = useTranslations("language");
  const current = useLocale() as Locale;
  const { setLanguage, busy, error } = useSetLanguage();
  const { toast } = useToast();

  useEffect(() => {
    if (!error) return;
    toast({
      variant: "destructive",
      title: "Could not change the language",
      description: error,
    });
  }, [error, toast]);

  function choose(next: string) {
    if (busy || next === current || !isLocale(next)) return;
    void setLanguage(next);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("select")}
        title={t("label")}
        aria-busy={busy}
        className={cn(
          // The same shape, size and states as the bell beside it: a circle,
          // 44px below sm for the touch target, and a held-open look while
          // the menu is showing.
          "inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-busy:opacity-60 sm:h-9 sm:w-9",
          "data-[state=open]:bg-muted data-[state=open]:text-foreground",
          focus.ring,
          className,
        )}
      >
        {busy ? (
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
        ) : (
          <Languages aria-hidden className="h-4 w-4" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuRadioGroup value={current} onValueChange={choose}>
          {LOCALES.map((locale) => (
            // Its own name, because that is what someone looking for it
            // reads.
            <DropdownMenuRadioItem key={locale} value={locale} lang={locale}>
              {LOCALE_NAMES[locale]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
