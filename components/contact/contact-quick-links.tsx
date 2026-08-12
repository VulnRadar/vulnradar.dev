import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ROUTES, SUPPORT_EMAIL } from "@/lib/config/constants";

const QUICK_LINKS: { label: string; href: string; desc: string }[] = [
  {
    label: "Documentation",
    href: ROUTES.DOCS,
    desc: "Setup, the API reference, self-hosting, rate limits",
  },
  {
    label: "Changelog",
    href: ROUTES.CHANGELOG,
    desc: "What shipped, when, and what broke on the way",
  },
  {
    label: SUPPORT_EMAIL,
    href: `mailto:${SUPPORT_EMAIL}`,
    desc: "If a form is not how you want to do this",
  },
];

export function ContactQuickLinks() {
  return (
    <div>
      <h2 className="text-sm font-medium text-foreground mb-3">
        Answer might already exist
      </h2>
      <ul className="border-y border-border/50 divide-y divide-border/50">
        {QUICK_LINKS.map((link) => (
          <li key={link.label}>
            <Link
              href={link.href}
              className="group flex items-baseline gap-3 py-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors shrink-0">
                {link.label}
              </span>
              <span className="text-xs text-muted-foreground leading-relaxed">
                {link.desc}
              </span>
              <ArrowUpRight
                className="h-3.5 w-3.5 ml-auto shrink-0 self-center text-muted-foreground/60 group-hover:text-primary transition-colors"
                aria-hidden="true"
              />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
