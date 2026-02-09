import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { Newspaper, Zap, Shield, Users, Tag, List, RefreshCw, Lock, Gauge, MessageSquare, Sparkles, Eye } from "lucide-react"

const CHANGELOG = [
  {
    version: "1.0.0",
    date: "February 2026",
    title: "First Release",
    highlights: true,
    changes: [
      { icon: Shield, label: "65+ Security Checks", desc: "Comprehensive vulnerability scanning covering HTTP headers, SSL/TLS, content security policies, cookies, server disclosure, DNS, and much more." },
      { icon: Users, label: "User Accounts & Auth", desc: "Full authentication system with sign up, login, profile management, two-factor authentication (TOTP), backup codes, and secure password reset." },
      { icon: Lock, label: "Admin Dashboard", desc: "Admin panel with user management, audit logs, session tracking, and the ability to revoke sessions or API keys." },
      { icon: Zap, label: "Webhooks & Notifications", desc: "Discord, Slack, and generic webhook integrations. Get notified automatically when scans complete." },
      { icon: RefreshCw, label: "Scheduled & Bulk Scanning", desc: "Set up recurring scans on daily, weekly, or monthly intervals. Scan up to 10 URLs at once with bulk scanning." },
      { icon: Eye, label: "Scan Comparison & Sharing", desc: "Side-by-side comparison of scan results over time. Generate shareable links for client reports." },
      { icon: Tag, label: "Scan Tags & History", desc: "Full scan history with search, filtering, and custom tags. Organize scans by project, environment, or client." },
      { icon: List, label: "PDF Export", desc: "Export scan results as professional PDF reports ready for stakeholders." },
      { icon: Users, label: "Teams & Organizations", desc: "Create teams, invite members with role-based access (owner/admin/viewer), and collaborate on security scans." },
      { icon: Gauge, label: "API Keys & Rate Limiting", desc: "Generate API keys for programmatic scanning with built-in rate limiting to prevent abuse." },
      { icon: MessageSquare, label: "Contact & Support", desc: "Dedicated support page for reporting issues, requesting features, or getting help." },
      { icon: Eye, label: "Self-Scan Demo", desc: "Try VulnRadar on itself with a one-click demo scan to see the scanner in action -- no account required." },
      { icon: Sparkles, label: "Onboarding Tour", desc: "Interactive walkthrough for first-time users covering all key features." },
      { icon: Newspaper, label: "Documentation", desc: "Full API documentation, usage guides, legal pages, and this changelog." },
    ],
  },
]

export default function ChangelogPage() {
  return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-6 sm:py-10">
          <div className="flex flex-col gap-2 mb-8">
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Newspaper className="h-6 w-6 text-primary" />
              Changelog
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {"What's"} new in VulnRadar. Follow along as we ship new checks, features, and improvements.
            </p>
          </div>

          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-[19px] top-0 bottom-0 w-px bg-border hidden sm:block" />

            <div className="flex flex-col gap-10">
              {CHANGELOG.map((release) => (
                  <div key={release.version} className="relative">
                    {/* Timeline dot */}
                    <div className="absolute left-[13px] top-1 w-[13px] h-[13px] rounded-full border-2 border-primary bg-background hidden sm:block" />

                    <div className="sm:pl-12 flex flex-col gap-4">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                    <span className="inline-flex items-center rounded-md bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 text-xs font-semibold font-mono w-fit">
                      v{release.version}
                    </span>
                        <span className="text-xs text-muted-foreground">{release.date}</span>
                        {release.highlights && (
                            <span className="inline-flex items-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider w-fit">
                        Latest
                      </span>
                        )}
                      </div>

                      <h2 className="text-lg font-bold text-foreground">{release.title}</h2>

                      <div className="flex flex-col gap-3">
                        {release.changes.map((change) => (
                            <div key={change.label} className="flex gap-3 p-3 rounded-xl border border-border bg-card">
                              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 shrink-0 mt-0.5">
                                <change.icon className="h-4 w-4 text-primary" />
                              </div>
                              <div className="flex-1">
                                <p className="text-sm font-medium text-foreground">{change.label}</p>
                                <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{change.desc}</p>
                              </div>
                            </div>
                        ))}
                      </div>
                    </div>
                  </div>
              ))}
            </div>
          </div>
        </main>
        <Footer />
      </div>
  )
}
