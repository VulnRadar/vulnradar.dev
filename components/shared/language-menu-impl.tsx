"use client";

import { useEffect, useRef } from "react";
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
import {
  LOCALES,
  LOCALE_NAMES,
  isLocale,
  type Locale,
} from "@/lib/i18n/config";
import { useSetLanguage } from "@/components/shared/use-set-language";
import { languageTriggerClassName } from "@/components/shared/language-menu-trigger";

export interface LanguageMenuImplProps {
  className?: string;
  /** The reader's own click or tap is what loaded this, so the menu opens as
   *  it mounts instead of making them click twice. */
  defaultOpen?: boolean;
  /** The static button had focus when this replaced it. It is gone, so the
   *  new trigger takes focus or a keyboard user lands on the page body. */
  focusTrigger?: boolean;
}

/**
 * The language switcher's menu: the Radix dropdown, the save hook and the
 * toast. Loaded by language-menu.tsx on first hover, focus or press, so none
 * of it is in the header's chunk.
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
export function LanguageMenuImpl({
  className,
  defaultOpen = false,
  focusTrigger = false,
}: LanguageMenuImplProps) {
  const t = useTranslations("language");
  const current = useLocale() as Locale;
  const { setLanguage, busy, error } = useSetLanguage();
  const { toast } = useToast();
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!error) return;
    toast({
      variant: "destructive",
      title: "Could not change the language",
      description: error,
    });
  }, [error, toast]);

  // Once, on mount. An open menu takes focus into its own list and gives it
  // back to the trigger when it closes, so only the closed case needs this.
  useEffect(() => {
    if (focusTrigger && !defaultOpen) triggerRef.current?.focus();
  }, [focusTrigger, defaultOpen]);

  function choose(next: string) {
    if (busy || next === current || !isLocale(next)) return;
    void setLanguage(next);
  }

  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger
        ref={triggerRef}
        aria-label={t("select")}
        title={t("label")}
        aria-busy={busy}
        className={languageTriggerClassName(className)}
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
