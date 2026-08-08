"use client";

import { useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronDown, List, X } from "lucide-react";
import { cn } from "@/lib/ui/utils";

export interface AdminTocItem {
  id: string;
  label: string;
  /** Optional group heading (e.g. "Security"). Items sharing a group are
   *  rendered together under one heading; omit on every item for a flat
   *  list with no headings. */
  group?: string;
  /** Marks the item representing whatever the caller currently has open,
   *  e.g. the active admin tab. Omit when there is no notion of "current". */
  active?: boolean;
  /** Run before scrolling, e.g. to switch an internal tab so the target
   *  section is actually mounted. Omit for a plain scroll-to-anchor entry. */
  onSelect?: () => void;
}

/**
 * Floating "Contents" pill, the admin-panel equivalent of the docs section's
 * DocsMobileNavTrigger. Only worth wiring up on pages long enough that a
 * reader would otherwise scroll blind to find a section (System Settings,
 * Audit Log, the user detail view), not on the single-card list views.
 *
 * This is for jumping to a section *within* whichever admin tab is already
 * open. Switching between top-level admin tabs on mobile uses
 * AdminMobileSectionTrigger below instead, an inline (non-floating) button,
 * so the two never compete for the same corner of the screen at once.
 */
export function AdminMobileTocTrigger({
  isOpen,
  onToggle,
}: {
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="lg:hidden fixed bottom-6 right-4 z-40">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls="admin-mobile-toc"
        className={cn(
          "flex items-center gap-2 rounded-full bg-primary px-3.5 py-2.5 text-sm font-medium text-primary-foreground shadow-lg",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
      >
        <List className="h-4 w-4" aria-hidden="true" />
        <span>Contents</span>
      </button>
    </div>
  );
}

/**
 * Inline (not floating) button that shows whichever admin tab is currently
 * active and opens AdminMobileToc as a site-wide section switcher. Lives at
 * the top of the mobile sidebar in place of the old horizontal icon strip.
 * Deliberately not a floating pill like AdminMobileTocTrigger: this page can
 * also be showing a per-tab AdminMobileTocTrigger (System Settings, Audit
 * Log, the user detail view), and two floating "Contents" buttons stacked in
 * the same corner would overlap.
 */
export function AdminMobileSectionTrigger({
  icon: Icon,
  label,
  isOpen,
  onToggle,
}: {
  icon: LucideIcon;
  label: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-controls="admin-section-nav"
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card px-3.5 py-2.5 text-left transition-colors",
        "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      <span className="flex items-center gap-2 min-w-0">
        <Icon className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
        <span className="text-sm font-medium text-foreground truncate">
          {label}
        </span>
      </span>
      <ChevronDown
        className="h-4 w-4 text-muted-foreground shrink-0"
        aria-hidden="true"
      />
    </button>
  );
}

interface AdminMobileTocProps {
  /** Name of the section this jump list belongs to, e.g. "System Settings". */
  title: string;
  /** Small uppercase label above the title, e.g. "On this page". */
  eyebrow?: string;
  items: AdminTocItem[];
  isOpen: boolean;
  onClose: () => void;
  /** DOM id for the dialog, referenced by the trigger's aria-controls. Only
   *  needs overriding when more than one AdminMobileToc could exist in the
   *  tree, e.g. the site-wide section switcher alongside a per-tab one. */
  id?: string;
}

/**
 * Full-screen drawer shared by two patterns: a per-tab "on this page" jump
 * list (System Settings, Audit Log, the user detail view) and the site-wide
 * admin section switcher rendered from /admin. Items with no `group` render
 * as a flat list (the per-tab usage); items that set `group` render grouped
 * under headings, matching how the desktop sidebar groups NAV_GROUPS.
 */
export function AdminMobileToc({
  title,
  eyebrow = "On this page",
  items,
  isOpen,
  onClose,
  id = "admin-mobile-toc",
}: AdminMobileTocProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSelect = (item: AdminTocItem) => {
    onClose();
    item.onSelect?.();
    // If onSelect switched an internal tab, give it a tick to mount before
    // scrolling to it.
    requestAnimationFrame(() => {
      document
        .getElementById(item.id)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  // Items with no `group` collapse into a single unheaded group so the
  // per-tab jump lists render exactly as before; items that set `group`
  // (the site-wide section switcher) render under headings in that order.
  const groups = items.reduce<{ group: string; items: AdminTocItem[] }[]>(
    (acc, item) => {
      const groupLabel = item.group ?? "";
      const existing = acc.find((g) => g.group === groupLabel);
      if (existing) existing.items.push(item);
      else acc.push({ group: groupLabel, items: [item] });
      return acc;
    },
    [],
  );

  return (
    <div
      id={id}
      role="dialog"
      aria-modal="true"
      aria-label={`${title} navigation`}
      className="lg:hidden fixed inset-0 z-40 overflow-y-auto bg-background/95 backdrop-blur-sm"
    >
      <div className="px-4 pb-24 pt-16 sm:px-6">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close navigation"
          className="absolute right-3 top-3 rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>

        <h2 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {eyebrow}
        </h2>
        <p className="mb-4 text-sm font-medium text-foreground">{title}</p>
        <nav aria-label={`${title} navigation`} className="space-y-5">
          {groups.map((g, i) => (
            <div key={g.group || `group-${i}`}>
              {g.group && (
                <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  {g.group}
                </h3>
              )}
              <div className="space-y-0.5">
                {g.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelect(item)}
                    aria-current={item.active ? "page" : undefined}
                    className={cn(
                      "block w-full rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      item.active
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-foreground hover:bg-muted",
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </div>
    </div>
  );
}
