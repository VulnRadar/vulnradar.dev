"use client";

import { useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronDown, List, X } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { modalCloseChip } from "@/components/ui/modal-grammar";

export interface AdminTocItem {
  /** Unique per list: it is this item's React key. Several items can point
   *  at the same DOM node (System Settings' tabs all live inside one
   *  #settings-panel card), so use `targetId` for the scroll anchor and keep
   *  this distinct. Duplicate ids made React reconcile the wrong button with
   *  the wrong item, so tapping one tab switched to another. */
  id: string;
  /** Element to scroll to, when it differs from `id`. Defaults to `id`. */
  targetId?: string;
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
  /** Health of the destination, mirrored from the desktop sidebar's dot so a
   *  phone shows which section is unhealthy without opening every one. Only
   *  the two states worth interrupting for: healthy renders nothing. */
  status?: "warn" | "crit";
}

/** Amber needs attention, red is critical. One vocabulary, shared by the
 *  desktop sidebar in app/admin/page.tsx and both mobile surfaces here. */
function StatusDot({ status }: { status: "warn" | "crit" }) {
  return (
    <span
      className={cn(
        "h-1.5 w-1.5 shrink-0 rounded-full",
        status === "crit" ? "bg-destructive" : "bg-[hsl(var(--warning))]",
      )}
      aria-hidden="true"
    />
  );
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
  raised = false,
}: {
  isOpen: boolean;
  onToggle: () => void;
  /** Set while a floating save bar is showing. Those bars are z-50 and
   *  pinned to the bottom, and this pill used to be z-40 at bottom-6, so
   *  editing one field covered the pill. On System Settings the desktop
   *  TabsList is hidden below lg, which left the admin with no way to
   *  switch tabs until they saved or discarded. */
  raised?: boolean;
}) {
  return (
    <div
      className={cn(
        // Both offsets add --vr-cookie-h on top of the constant: the cookie
        // notice is z-60 and roughly 125px tall on a phone, so even the
        // raised 96px put this pill behind it. The save bars it clears are
        // themselves lifted by the same variable, so the two stay stacked.
        "lg:hidden fixed right-4 z-50 transition-[bottom] duration-200",
        raised
          ? "bottom-[calc(6rem+var(--vr-cookie-h,0px))]"
          : "bottom-[calc(1.5rem+var(--vr-cookie-h,0px))]",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls="admin-mobile-toc"
        className={cn(
          "flex items-center gap-2 rounded-full bg-primary px-3.5 py-2.5 text-sm font-medium text-primary-foreground shadow-lg",
          "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
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
  status,
  statusLabel,
}: {
  icon: LucideIcon;
  label: string;
  isOpen: boolean;
  onToggle: () => void;
  /** Worst state across every section, so a phone shows a fault without the
   *  operator opening the drawer. The desktop sidebar is always visible and
   *  carries this per item; on mobile the drawer is closed by default, so the
   *  aggregate has to live on the thing that opens it. */
  status?: "warn" | "crit";
  /** Read out in place of the dot, which cannot carry meaning on its own. */
  statusLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-controls="admin-section-nav"
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-lg border bg-card px-3.5 py-2.5 text-left transition-colors",
        "hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        status === "crit"
          ? "border-destructive/40"
          : status === "warn"
            ? "border-[hsl(var(--warning))]/40"
            : "border-border",
      )}
    >
      <span className="flex items-center gap-2 min-w-0">
        <Icon className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
        {/* Section names come from nav.ts ("Trust & Safety", "Hosts & Shares"),
            so there is nothing unbounded here for an ellipsis to protect
            against. */}
        <span className="text-sm font-medium text-foreground">{label}</span>
      </span>
      <span className="flex items-center gap-2 shrink-0">
        {status && (
          <>
            <StatusDot status={status} />
            <span className="sr-only">{statusLabel ?? "Needs attention"}</span>
          </>
        )}
        <ChevronDown
          className="h-4 w-4 text-muted-foreground"
          aria-hidden="true"
        />
      </span>
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
  const panelRef = useRef<HTMLDivElement | null>(null);

  // a11y. This drawer declares role="dialog" aria-modal="true" below but only
  // ever handled Escape: Tab walked straight out into the page behind, which
  // is neither aria-hidden nor inert, so a screen-reader user was told the
  // background was inert when it was fully reachable. It also dropped focus
  // to <body> on close instead of returning it to the trigger. Same trap and
  // same restore as components/docs/docs-mobile-nav.tsx, which is the sibling
  // implementation of this exact widget.
  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !panel.contains(active))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSelect = (item: AdminTocItem) => {
    onClose();
    item.onSelect?.();
    // If onSelect switched an internal tab, give it a tick to mount before
    // scrolling to it.
    requestAnimationFrame(() => {
      document
        .getElementById(item.targetId ?? item.id)
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
      ref={panelRef}
      id={id}
      role="dialog"
      aria-modal="true"
      aria-label={`${title} navigation`}
      className="lg:hidden fixed inset-0 z-40 overflow-y-auto bg-background/95 backdrop-blur-xs"
    >
      <div className="px-4 pb-24 pt-16 sm:px-6">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close navigation"
          className={cn(modalCloseChip, "right-3 top-3")}
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
                <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
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
                      "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                      "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                      item.active
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-foreground hover:bg-muted",
                    )}
                  >
                    {/* Same as the section trigger above: a nav label, not
                        user data. */}
                    <span className="min-w-0">{item.label}</span>
                    {item.status && (
                      <>
                        <StatusDot status={item.status} />
                        <span className="sr-only">
                          {item.status === "crit"
                            ? "Critical"
                            : "Needs attention"}
                        </span>
                      </>
                    )}
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
