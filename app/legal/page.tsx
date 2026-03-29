import Link from "next/link"
import { Scale, Shield, AlertTriangle, FileText, Accessibility, Copyright } from "lucide-react"
import { APP_NAME } from "@/lib/config/constants"

const legalPages = [
  { 
    href: "/legal/terms", 
    title: "Terms of Service", 
    description: "The terms and conditions that govern your use of our service.",
    icon: Scale 
  },
  { 
    href: "/legal/privacy", 
    title: "Privacy Policy", 
    description: "How we collect, use, and protect your personal information.",
    icon: Shield 
  },
  { 
    href: "/legal/disclaimer", 
    title: "Disclaimer", 
    description: "Important legal notices about the limitations of our service.",
    icon: AlertTriangle 
  },
  { 
    href: "/legal/acceptable-use", 
    title: "Acceptable Use Policy", 
    description: "Guidelines for appropriate and authorized use of our scanning tools.",
    icon: FileText 
  },
  { 
    href: "/legal/accessibility", 
    title: "Accessibility Statement", 
    description: "Our commitment to digital accessibility and WCAG compliance.",
    icon: Accessibility 
  },
  { 
    href: "/legal/dmca", 
    title: "DMCA & Copyright Policy", 
    description: "Procedures for reporting copyright infringement claims.",
    icon: Copyright 
  },
]

export default function LegalIndexPage() {
  return (
    <div className="space-y-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight mb-2">Legal</h1>
        <p className="text-sm text-muted-foreground">
          Legal documents and policies for {APP_NAME}.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {legalPages.map((page) => {
          const Icon = page.icon
          return (
            <Link
              key={page.href}
              href={page.href}
              className="group p-5 rounded-xl border border-border/50 bg-card/50 hover:bg-card/80 hover:border-primary/30 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10 group-hover:bg-primary/15 transition-colors">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h2 className="font-medium text-foreground group-hover:text-primary transition-colors">
                    {page.title}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    {page.description}
                  </p>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
