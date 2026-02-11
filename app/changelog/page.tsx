import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { Newspaper, Zap, Shield, Users, Tag, List, RefreshCw, Lock, Gauge, MessageSquare, Sparkles, Eye, ShieldCheck, Target, Brain, AlertTriangle, Search, Bell, Heart, Layout } from "lucide-react"

const CHANGELOG = [
  {
    version: "1.3.0",
    date: "February 10, 2026",
    title: "Landing Page, Donations & Major UI Polish",
    highlights: true,
    changes: [
      { icon: Eye, label: "Beautiful Landing Page", desc: "New public landing page showcasing VulnRadar's features, benefits, and capabilities. Professional hero section, feature grid, stats showcase, FAQ, and vulnerability coverage highlights." },
      { icon: Heart, label: "Support VulnRadar", desc: "New donation system via Buy Me a Coffee. Support the project to help fund development and keep VulnRadar free for everyone. Access via /donate or the footer links." },
      { icon: Shield, label: "Smart Routing", desc: "Intelligent routing system: unauthenticated visitors see the landing page at /, while authenticated users are automatically redirected to /dashboard for seamless access to the scanner." },
      { icon: Layout, label: "Unified Results UI", desc: "Scan results now display in a consistent gray card with the scanned URL and all action buttons (Scan Again, Export PDF/JSON, Share) grouped together at the top for easy access." },
      { icon: Eye, label: "History Page Polish", desc: "History detail view now matches the dashboard styling with the same gray card layout, showing scanned URL and action buttons in a unified design." },
      { icon: Sparkles, label: "Enhanced OG Image", desc: "Completely redesigned Open Graph image with radar visualization, gradient backgrounds, glow effects, threat blips, and professional typography. Matches the favicon style perfectly." },
      { icon: Shield, label: "Consistent OpenGraph", desc: "Fixed OpenGraph metadata to use consistent URLs across all pages. All shared links now display the same professional embed on Discord and social platforms." },
      { icon: Zap, label: "Improved Login Flow", desc: "Login and signup now redirect directly to /dashboard instead of going through the landing page, providing a faster and smoother user experience." },
      { icon: Shield, label: "2FA-Enabled Password Resets", desc: "Users with two-factor authentication can now reset their passwords via email. After reset, they still need their authenticator code to log in, maintaining security while improving usability." },
      { icon: Bell, label: "Security Notifications", desc: "All password resets now trigger a security notification email. If users didn't request the reset, they're immediately alerted with instructions to contact support." },
      { icon: Lock, label: "Atomic Password Reset", desc: "Password reset now uses database transactions with row-level locking to prevent race conditions and ensure emails are only sent once per request." },
      { icon: MessageSquare, label: "Landing Page Contact Form", desc: "Public contact form with Turnstile protection allows visitors to reach out before signing up. Sends professional emails to both the team and the user." },
    ],
  },
  {
    version: "1.2.0",
    date: "February 9, 2026",
    title: "Comprehensive Security Check Expansion",
    highlights: false,
    changes: [
      { icon: Shield, label: "10 New Critical Security Checks", desc: "Added detection for SQL injection patterns, command injection, XXE vulnerabilities, SSRF, path traversal, insecure authentication, deserialization flaws, missing rate limiting, GraphQL introspection, and clickjacking protection gaps." },
      { icon: AlertTriangle, label: "Stricter Detection Logic", desc: "Dramatically reduced false positives across all checks. Mixed content detection now filters localhost and examples. Email exposure requires 2+ addresses. Open redirect detection identifies actual vulnerable patterns, not just parameter names." },
      { icon: Search, label: "Enhanced Pattern Matching", desc: "Improved detection of SQL errors (MySQL, PostgreSQL, MSSQL, Oracle, SQLite), command execution (Node.js, Python, Java), and framework-specific patterns. All checks now filter documentation and placeholder code." },
      { icon: Target, label: "Context-Aware Filtering", desc: "Every check now excludes common false positives: example.com, localhost, placeholder text, HTML comments, and documentation code. Minimum thresholds prevent single-occurrence noise." },
      { icon: Brain, label: "Smarter Vulnerability Assessment", desc: "New checks identify actual exploitable vulnerabilities (SQL errors visible, insecure auth mechanisms, missing cookie flags) rather than theoretical risks. Focus on real-world attack vectors." },
    ],
  },
  {
    version: "1.1.4",
    date: "February 9, 2026",
    title: "Smart Security Analysis",
    highlights: false,
    changes: [
      { icon: Brain, label: "Framework-Aware Scanning", desc: "Scanner now detects Next.js, React, Vue, and Angular frameworks and recognizes when 'unsafe-inline' or 'unsafe-eval' CSP directives are framework requirements rather than security vulnerabilities. These are now marked as 'info' level instead of 'high'." },
      { icon: ShieldCheck, label: "Intelligent Safety Rating", desc: "Safety rating now considers actual security threats rather than just counting severity levels. Framework-required directives don't count against the safety score. Sites need multiple high-severity issues or critical vulnerabilities to be marked 'unsafe'." },
      { icon: Target, label: "Context-Aware Analysis", desc: "Improved threat assessment logic that distinguishes between necessary framework trade-offs and actual exploitable vulnerabilities, providing more accurate security assessments for modern web applications." },
    ],
  },
  {
    version: "1.1.3",
    date: "February 9, 2026",
    title: "Scanner Accuracy Improvements",
    highlights: false,
    changes: [
      { icon: Target, label: "Reduced False Positives", desc: "Improved prototype pollution detection to focus on actual vulnerable library functions (Lodash, jQuery) rather than flagging legitimate framework code patterns." },
      { icon: Shield, label: "Better Threat Detection", desc: "Enhanced scanning logic now distinguishes between potentially dangerous code patterns and safe framework implementations, providing more accurate security assessments." },
    ],
  },
  {
    version: "1.1.2",
    date: "February 9, 2026",
    title: "Safety Rating Indicator",
    highlights: false,
    changes: [
      { icon: ShieldCheck, label: "Website Safety Rating", desc: "Scan reports now prominently display a safety indicator (Safe to View / View with Caution / Not Safe to View) based on vulnerability severity. This helps non-technical users quickly understand if a website is safe to browse." },
      { icon: Eye, label: "PDF Report Safety Rating", desc: "Exported PDF reports now include the safety rating section, making it easy to share security assessments with clients and stakeholders." },
    ],
  },
  {
    version: "1.1.1",
    date: "February 9, 2026",
    title: "Metadata & Branding Polish",
    highlights: false,
    changes: [
      { icon: Sparkles, label: "Consistent Social Cards", desc: "All pages now display unified OpenGraph metadata with consistent VulnRadar branding when shared on Discord, Twitter, or other social platforms." },
      { icon: Eye, label: "Unified Page Titles", desc: "Browser tabs now show 'VulnRadar' consistently across all pages for cleaner branding and better recognition." },
      { icon: Shield, label: "Enhanced Security Headers", desc: "Improved Content Security Policy configuration to allow Cloudflare Turnstile while maintaining strong security protections." },
    ],
  },
  {
    version: "1.1.0",
    date: "February 9, 2026",
    title: "Contact System & UI Enhancements",
    highlights: false,
    changes: [
      { icon: MessageSquare, label: "Enhanced Contact Form", desc: "Redesigned contact page with category selection (Bug Report, Feature Request, Security Issue, General Help) and instant email delivery without blocking the UI." },
      { icon: Shield, label: "CAPTCHA Protection", desc: "Integrated Cloudflare Turnstile to prevent spam and bot submissions on the contact form while maintaining a seamless user experience." },
      { icon: Users, label: "Team Collaboration", desc: "Team members can now view each other's scan history and full scan details for better collaboration. Click 'View Scans' next to any team member to see their complete vulnerability scan history and detailed results." },
      { icon: Users, label: "Team Invite Emails", desc: "Team invitations are now sent via email with secure invite links. Invited members receive professional branded emails with team details and one-click acceptance." },
      { icon: Sparkles, label: "Professional Email Templates", desc: "Beautiful dark-themed email templates with gradient accents for contact confirmations, password resets, and team invitations." },
      { icon: Zap, label: "Instant Response Times", desc: "Contact form submissions and password reset requests now respond immediately while emails are sent in the background, dramatically improving user experience." },
      { icon: Lock, label: "Smart Email Routing", desc: "Contact emails route with proper Reply-To headers and automatic user confirmations for every submission." },
      { icon: Eye, label: "Improved Scanner UI", desc: "Added 'Scan Another URL' button above results for easier navigation and better user flow." },
    ],
  },
  {
    version: "1.0.0",
    date: "February 8, 2026",
    title: "First Release",
    highlights: false,
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
