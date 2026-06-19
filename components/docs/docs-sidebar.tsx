"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/ui/utils";
import { ChevronRight } from "lucide-react";
import type { NavItem } from "./docs-types";

interface DocsSidebarProps {
  navItems: NavItem[];
}

export function DocsSidebar({ navItems }: DocsSidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:block w-64 flex-shrink-0 border-r border-border/50">
      <nav className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto py-8 px-6">
        <div className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Documentation
          </h2>
        </div>
        <ul className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href) &&
                (item.href !== "/docs" || pathname === "/docs");

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "group flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                  {isActive && (
                    <ChevronRight className="h-3 w-3 ml-auto text-primary" />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Version Badge */}
        <div className="mt-8 pt-6 border-t border-border/50">
          <div className="px-3 py-2.5 rounded-xl bg-card/50 border border-border/50 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">API Version:</span> v2
            <br />
            <span className="text-[10px]">v1 deprecated</span>
          </div>
        </div>
      </nav>
    </aside>
  );
}
