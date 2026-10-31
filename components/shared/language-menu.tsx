"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Languages } from "lucide-react";
import { languageTriggerClassName } from "@/components/shared/language-menu-trigger";
import {
  loadLanguageMenuImpl,
  peekLanguageMenuImpl,
  type LanguageMenuImpl,
} from "@/components/shared/language-menu-loader";

interface Loaded {
  Menu: LanguageMenuImpl;
  /** The reader's own press is what asked for it. */
  open: boolean;
  /** The button they were on is about to be replaced. */
  focus: boolean;
}

/**
 * The language switcher in the header, beside the theme toggle.
 *
 * An icon button rather than a labelled control: it sits in a row of icon
 * buttons, and every language is listed in its own words, so the menu says
 * what it offers without the trigger having to.
 *
 * This is only the button. The menu itself (the Radix dropdown, the save hook,
 * the toast) is in language-menu-impl.tsx and is imported the first time the
 * pointer comes near, the button takes focus or a finger lands on it, so a
 * header that nobody uses the switcher in does not carry any of it. The button
 * is drawn with the same classes the real trigger uses
 * (language-menu-trigger.ts), so the swap changes nothing on screen.
 *
 * Three things keep the swap from being noticed:
 *
 * - A press opens the menu as it mounts (defaultOpen), so the reader is not
 *   asked to click twice for one intention.
 * - The shell is replaced by an element that has no focus. If the shell had it,
 *   the new trigger takes it, so a keyboard user who tabbed here does not land
 *   on the page body when the chunk arrives.
 * - While a pointer is down the swap waits for the click. Replacing the button
 *   between pointerdown and click would send the click to an element Radix
 *   does not open on, and the tap would do nothing.
 *
 * If the import fails the button stays, and the next press tries again.
 */
export function LanguageMenu({ className }: { className?: string }) {
  const t = useTranslations("language");
  // A header that mounts after another one already loaded the menu goes
  // straight to it. Safe in an initialiser: the cache is only filled by a
  // gesture after hydration, so a server-rendered first paint never sees it.
  const [loaded, setLoaded] = useState<Loaded | null>(() => {
    const Menu = peekLanguageMenuImpl();
    return Menu ? { Menu, open: false, focus: false } : null;
  });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<LanguageMenuImpl | null>(null);
  const wantsOpen = useRef(false);
  const pointerDown = useRef(false);

  const settle = useCallback(() => {
    const Menu = menuRef.current;
    if (!Menu || pointerDown.current) return;
    const focus =
      buttonRef.current !== null &&
      document.activeElement === buttonRef.current;
    const open = wantsOpen.current;
    setLoaded((prev) => prev ?? { Menu, open, focus });
  }, []);

  const warm = useCallback(() => {
    loadLanguageMenuImpl()
      .then((Menu) => {
        menuRef.current = Menu;
        settle();
      })
      .catch(() => {
        wantsOpen.current = false;
      });
  }, [settle]);

  const release = useCallback(() => {
    pointerDown.current = false;
    settle();
  }, [settle]);

  if (loaded) {
    return (
      <loaded.Menu
        className={className}
        defaultOpen={loaded.open}
        focusTrigger={loaded.focus}
      />
    );
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={t("select")}
      title={t("label")}
      aria-haspopup="menu"
      aria-expanded={false}
      data-state="closed"
      className={languageTriggerClassName(className)}
      onPointerEnter={warm}
      onFocus={warm}
      onTouchStart={warm}
      onPointerDown={() => {
        pointerDown.current = true;
      }}
      onPointerCancel={release}
      // A mouse leaving ends a press that will never click. A touch pointer
      // "leaves" as the finger lifts, which is before the click: releasing
      // there swapped the button out between the tap and its click, and the
      // trigger that replaced it opens on pointerdown, so the tap did nothing.
      // A touch press ends at its click, or at pointercancel.
      onPointerLeave={(event) => {
        if (event.pointerType !== "touch") release();
      }}
      onClick={() => {
        pointerDown.current = false;
        wantsOpen.current = true;
        warm();
      }}
    >
      <Languages aria-hidden className="h-4 w-4" />
    </button>
  );
}
