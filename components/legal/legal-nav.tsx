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
  { href: "/legal/accessibility", label: "Accessibility", icon: Accessibility },
  { href: "/legal/dmca", label: "DMCA Policy", icon: Copyright },
];

export function LegalNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-2 mb-8 pb-6 border-b border-border/50">
      {legalPages.map((page) => {
        const isActive = pathname === page.href;
        const Icon = page.icon;
        return (
          <Link
            key={page.href}
            href={page.href}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors",
              isActive
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{page.label}</span>
            <span className="sm:hidden">{page.label.split(" ")[0]}</span>
          </Link>
        );
      })}
    </nav>
  );
}
