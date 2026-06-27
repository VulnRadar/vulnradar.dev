import Link from "next/link";
import { Mail, FileText, BookOpen } from "lucide-react";
import { SUPPORT_EMAIL } from "@/lib/config/constants";

const QUICK_LINKS = [
  {
    icon: BookOpen,
    label: "Documentation",
    href: "/docs",
    desc: "Guides & API reference",
  },
  {
    icon: FileText,
    label: "Changelog",
    href: "/changelog",
    desc: "Latest updates",
  },
  {
    icon: Mail,
    label: "Email Us",
    href: `mailto:${SUPPORT_EMAIL}`,
    desc: SUPPORT_EMAIL,
  },
];

export function ContactQuickLinks() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {QUICK_LINKS.map((link) => (
        <Link
          key={link.label}
          href={link.href}
          className="flex flex-row sm:flex-col items-center sm:items-center gap-3 sm:gap-2 p-3 rounded-xl border border-border/50 bg-card/50 hover:bg-card/80 hover:border-primary/30 transition-all text-left sm:text-center"
        >
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 shrink-0">
            <link.icon className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1 sm:flex-initial">
            <p className="text-sm font-medium text-foreground">{link.label}</p>
            <p className="text-[11px] text-muted-foreground truncate">
              {link.desc}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}
