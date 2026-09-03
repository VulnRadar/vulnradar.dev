"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  BookOpen,
  CalendarClock,
  Code,
  CreditCard,
  FileText,
  GitCompareArrows,
  Globe,
  Heart,
  History,
  Key,
  LifeBuoy,
  Lock,
  Radar,
  Share2,
  Shield,
  ShieldAlert,
  Sparkles,
  Users,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useAuth } from "@/components/providers/auth-provider";
import {
  APP_NAME,
  BILLING_ENABLED,
  ROUTES,
} from "@/lib/config/client-constants";

interface PaletteEntry {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Extra words the fuzzy match should hit, for names people use but we don't. */
  keywords?: string;
}

interface PaletteGroup {
  heading: string;
  entries: PaletteEntry[];
}

/**
 * Cmd/Ctrl-K palette, mounted once in app/layout.tsx.
 *
 * The app has eight top-level sections and no global search of any kind, so
 * every destination was a navigation exercise: scheduled scans meant Profile,
 * then the Developer tab, then the Schedules sub-tab. The entries below are
 * flat on purpose. Anything that takes three navigations in the UI should take
 * one here, which is why the profile sub-tabs are listed as their own rows
 * rather than as "Profile".
 *
 * Deliberately navigation-only for now. Entries that would start work (run a
 * scan, mint an API key) need the target page's own state and confirmation
 * flow, so they belong on the pages that own them.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { me, isStaff } = useAuth();
  const isLoggedIn = !!me?.userId;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "k" && e.key !== "K") return;
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      setOpen((prev) => !prev);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Close on navigation. The palette is outside the route subtree, so a
  // client-side navigation does not unmount it and it would otherwise stay
  // open on top of the page it just sent the user to.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacts to a route change, which is external to React state
    setOpen(false);
  }, [pathname]);

  const groups = useMemo<PaletteGroup[]>(() => {
    const out: PaletteGroup[] = [];

    if (isLoggedIn) {
      out.push({
        heading: "Go to",
        entries: [
          {
            id: "scanner",
            label: "Scanner",
            href: ROUTES.DASHBOARD,
            icon: Radar,
            keywords: "scan new dashboard",
          },
          {
            id: "history",
            label: "History",
            href: ROUTES.HISTORY,
            icon: History,
            keywords: "past scans results",
          },
          {
            id: "assets",
            label: "Assets",
            href: ROUTES.ASSETS,
            icon: Globe,
            keywords: "hosts inventory",
          },
          {
            id: "attack-surface",
            label: "Attack Surface",
            href: ROUTES.ATTACK_SURFACE,
            icon: ShieldAlert,
            keywords: "domains verified portfolio",
          },
          {
            id: "public-scans",
            label: "Public Scans",
            href: ROUTES.PUBLIC_SCANS,
            icon: Globe,
            keywords: "directory listed",
          },
          {
            id: "repos",
            label: "Repos",
            href: ROUTES.REPOS,
            icon: Code,
            keywords: "github repositories code",
          },
          {
            id: "compare",
            label: "Compare scans",
            href: ROUTES.COMPARE,
            icon: GitCompareArrows,
            keywords: "diff difference regression",
          },
          {
            id: "shares",
            label: "Shared links",
            href: ROUTES.SHARES,
            icon: Share2,
            keywords: "share report link",
          },
          {
            id: "teams",
            label: "Teams",
            href: ROUTES.TEAMS,
            icon: Users,
            keywords: "members invite organisation",
          },
          {
            id: "badge",
            label: "Status badge",
            href: ROUTES.BADGE,
            icon: Shield,
            keywords: "embed snippet readme svg",
          },
        ],
      });

      out.push({
        heading: "Monitoring and developer",
        entries: [
          {
            id: "schedules",
            label: "Scheduled scans",
            href: `${ROUTES.PROFILE}?tab=developer&dtab=schedules`,
            icon: CalendarClock,
            keywords: "recurring cron monitoring daily weekly",
          },
          {
            id: "webhooks",
            label: "Webhooks",
            href: `${ROUTES.PROFILE}?tab=developer&dtab=webhooks`,
            icon: Webhook,
            keywords: "callback notify integration slack",
          },
          {
            id: "api-keys",
            label: "API keys",
            href: `${ROUTES.PROFILE}?tab=developer&dtab=api-keys`,
            icon: Key,
            keywords: "token secret integration",
          },
        ],
      });

      out.push({
        heading: "Account",
        entries: [
          {
            id: "profile",
            label: "Profile and account settings",
            href: ROUTES.PROFILE,
            icon: Users,
            keywords: "name email avatar general",
          },
          {
            id: "security",
            label: "Security and two-factor",
            href: `${ROUTES.PROFILE}?tab=security`,
            icon: Lock,
            keywords: "2fa totp password sessions backup codes",
          },
          {
            id: "notifications",
            label: "Notification preferences",
            href: `${ROUTES.PROFILE}?tab=notifications`,
            icon: Activity,
            keywords: "email digest alerts",
          },
          {
            id: "privacy",
            label: "Privacy and data",
            href: `${ROUTES.PROFILE}?tab=privacy`,
            icon: Shield,
            keywords: "export delete account gdpr",
          },
          ...(BILLING_ENABLED
            ? [
                {
                  id: "billing",
                  label: "Billing and plan",
                  href: `${ROUTES.PROFILE}?tab=billing`,
                  icon: CreditCard,
                  keywords: "subscription invoice upgrade card",
                },
              ]
            : []),
        ],
      });

      if (isStaff) {
        out.push({
          heading: "Staff",
          entries: [
            {
              id: "admin",
              label: "Admin panel",
              href: ROUTES.ADMIN,
              icon: Sparkles,
              keywords: "staff moderation users",
            },
          ],
        });
      }
    }

    out.push({
      heading: isLoggedIn ? "Help and product" : `About ${APP_NAME}`,
      entries: [
        {
          id: "docs",
          label: "Documentation",
          href: ROUTES.DOCS,
          icon: BookOpen,
          keywords: "guide help manual setup",
        },
        {
          id: "docs-api",
          label: "API reference",
          href: ROUTES.DOCS_API,
          icon: Code,
          keywords: "rest endpoints developers",
        },
        {
          id: "playground",
          label: "API playground",
          href: ROUTES.API_PLAYGROUND,
          icon: Code,
          keywords: "try explorer request",
        },
        {
          id: "changelog",
          label: "Changelog",
          href: ROUTES.CHANGELOG,
          icon: FileText,
          keywords: "releases versions what is new",
        },
        {
          id: "contact",
          label: "Contact and support tickets",
          href: ROUTES.CONTACT,
          icon: LifeBuoy,
          keywords: "help ticket email support",
        },
        ...(BILLING_ENABLED
          ? [
              {
                id: "pricing",
                label: "Pricing",
                href: ROUTES.PRICING,
                icon: CreditCard,
                keywords: "plans cost upgrade",
              },
            ]
          : []),
        {
          id: "donate",
          label: "Donate",
          href: ROUTES.DONATE,
          icon: Heart,
          keywords: "support sponsor fund",
        },
      ],
    });

    return out;
  }, [isLoggedIn, isStaff]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command palette"
      description={`Search ${APP_NAME} and jump to any section.`}
    >
      <Command loop>
        <CommandInput placeholder="Jump to..." />
        <CommandList>
          <CommandEmpty>Nothing matches that.</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup key={group.heading} heading={group.heading}>
              {group.entries.map((entry) => (
                <CommandItem
                  key={entry.id}
                  value={`${entry.label} ${entry.keywords ?? ""}`}
                  onSelect={() => go(entry.href)}
                >
                  <entry.icon
                    aria-hidden
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                  />
                  {/* A nav name out of the palette registry, not user data, so
                      there is nothing to clip it for. */}
                  <span className="min-w-0">{entry.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
      <div className="flex items-center justify-between gap-3 border-t border-border/50 px-4 py-2.5 text-[11px] text-muted-foreground">
        <span>
          <kbd className="rounded border border-border/60 bg-muted px-1 py-0.5 font-mono">
            up
          </kbd>{" "}
          <kbd className="rounded border border-border/60 bg-muted px-1 py-0.5 font-mono">
            down
          </kbd>{" "}
          to move,{" "}
          <kbd className="rounded border border-border/60 bg-muted px-1 py-0.5 font-mono">
            enter
          </kbd>{" "}
          to open
        </span>
        <span>
          <kbd className="rounded border border-border/60 bg-muted px-1 py-0.5 font-mono">
            esc
          </kbd>{" "}
          to close
        </span>
      </div>
    </CommandDialog>
  );
}
