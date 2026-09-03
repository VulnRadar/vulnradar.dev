"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/ui/utils";
import {
  Scale,
  Shield,
  AlertTriangle,
  FileText,
  Accessibility,
  Copyright,
} from "lucide-react";

const legalPages = [
  { href: "/legal/terms", label: "Terms of Service", icon: Scale },
  { href: "/legal/privacy", label: "Privacy Policy", icon: Shield },
  { href: "/legal/disclaimer", label: "Disclaimer", icon: AlertTriangle },
  { href: "/legal/acceptable-use", label: "Acceptable Use", icon: FileText },
  {
    href: "/legal/accessibility",
    label: "Accessibility",
    icon: Accessibility,
  },
  { href: "/legal/dmca", label: "DMCA Policy", icon: Copyright },
];

export function LegalNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Legal documents"
      className="mb-8 flex flex-wrap gap-2 border-b border-border/50 pb-6"
    >
      {legalPages.map((page) => {
        const isActive = pathname === page.href;
        const Icon = page.icon;
        return (
          <Link
            key={page.href}
            href={page.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              // rounded-md, not rounded-lg: these are chips, and the radius
              // ladder in CLAUDE.md puts a control-shaped thing one rung
              // below the card it sits on.
              // min-h-9 gives the row a consistent height whether or not the
              // label wraps to the short form on a phone.
              "flex min-h-9 items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors",
              "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "border-primary/30 bg-primary/10 font-medium text-primary"
                : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{page.label}</span>
            <span className="sm:hidden">{page.label.split(" ")[0]}</span>
          </Link>
        );
      })}
    </nav>
  );
}
