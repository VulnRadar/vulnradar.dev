import Link from "next/link"
import { Mail, FileText, BookOpen } from "lucide-react"
import { SUPPORT_EMAIL } from "@/lib/config/constants"

const QUICK_LINKS = [
  { icon: BookOpen, label: "Documentation", href: "/docs", desc: "Guides & API reference" },
  { icon: FileText, label: "Changelog", href: "/changelog", desc: "Latest updates" },
  { icon: Mail, label: "Email Us", href: `mailto:${SUPPORT_EMAIL}`, desc: SUPPORT_EMAIL },
]

export function ContactQuickLinks() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {QUICK_LINKS.map((link) => (
        <Link
          key={link.label}
          href={link.href}
          className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:bg-muted/50 hover:border-accent transition-all"
        >
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 shrink-0">
            <link.icon className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{link.label}</p>
            <p className="text-[11px] text-muted-foreground">{link.desc}</p>
          </div>
        </Link>
      ))}
    </div>
  )
}
