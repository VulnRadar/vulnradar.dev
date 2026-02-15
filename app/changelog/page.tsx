import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { Newspaper, Zap, Shield, Users, Tag, List, RefreshCw, Lock, Gauge, MessageSquare, Sparkles, Eye, ShieldCheck, Target, Brain, AlertTriangle, Search, Bell, Heart, Layout, Mail, CheckCircle, Trash2, Camera, Crown, UserCheck, Key, BellRing, ChevronRight, BadgeCheck, Globe, Share2, Fingerprint, Smartphone, FileText, ScanSearch, Filter, Sun, Radar, Network, ShieldOff, FileDown, FileSpreadsheet, Pencil, Activity, Link2, BarChart3 } from "lucide-react"
import { APP_NAME, TOTAL_CHECKS_LABEL } from "@/lib/constants"

const CHANGELOG = [
  {
    version: "1.6.1",
    date: "February 15, 2026",
    title: "CSV Export, Scan Notes, Public Status Pages & Repository Migration",
    highlights: true,
    changes: [
      { icon: FileSpreadsheet, label: "CSV Export", desc: "One-click CSV export of all scan findings alongside the existing JSON and PDF options. Outputs properly escaped columns for Title, Severity, Category, Description, Evidence, Risk Impact, and Fix Steps -- ready for import into JIRA, Linear, or spreadsheets." },
      { icon: Pencil, label: "Scan Notes & Annotations", desc: "Add freeform notes to any scan result from the history detail view. Write reminders like 'Fixed CSP issue, re-scan next week' or 'Known false positive, ignore'. Notes are persisted to the database (max 2,000 characters) and only editable by the scan owner." },
      { icon: BarChart3, label: "Public Status Pages", desc: "New /status/[domain] pages show a domain's security health over time. Displays the current safety rating, a findings trend chart, severity breakdown bars, and a scan history table. Fully public, no authentication required -- link to it from your site as a trust signal." },
      { icon: Tag, label: "Tag Input Fix", desc: "Fixed a bug where pressing Space while typing a tag in the history view would trigger browser-level key handlers and open unrelated panels. Key events are now properly contained within the tag input field." },
      { icon: Activity, label: "Admin Shared Scans Card", desc: "Added a 10th stat card to the admin dashboard showing the count of scans with active share tokens. Both stat card rows are now an even 5-column grid layout." },
      { icon: Bell, label: "Simplified Notification Preferences", desc: "Removed the Advanced Security Alerts section from profile notification preferences. The four toggles for Failed Login Attempts, New Login Notifications, Rate Limit Alerts, and API Key Rotations have been removed to streamline the settings." },
      { icon: Link2, label: "Repository & Links Migration", desc: "Updated all GitHub references from RejectModders/VulnRadar to VulnRadar/vulnradar.dev across the footer, README, docs setup guide, and docs layout. Updated the Discord invite link across the notification center." },
    ],
  },
  {
    version: "1.6.0",
    date: "February 15, 2026",
    title: "Advanced Scan Engine, DNS/TLS Checks, Subdomain Overhaul & PDF Branding",
    highlights: false,
    changes: [
      { icon: Radar, label: "DNS Security Checks", desc: "Scans now check for SPF, DMARC, DKIM, and DNSSEC records. Flags missing email spoofing protection, weak SPF policies (+all), DMARC set to 'none', and missing DNSSEC validation across 8 common DKIM selectors." },
      { icon: Lock, label: "TLS Certificate Analysis", desc: "New async TLS checks connect to the target and inspect the actual SSL certificate. Detects expired certs, certs expiring within 30 days, self-signed certificates, incomplete certificate chains, and weak TLS protocol versions (1.0/1.1)." },
      { icon: ScanSearch, label: "Live robots.txt & security.txt Fetch", desc: "Instead of just searching the page body, the scanner now actually fetches /robots.txt and /.well-known/security.txt from the domain. Analyzes robots.txt for 16 sensitive path patterns (admin, .env, .git, backups) and validates security.txt for proper Contact field and Expires date." },
      { icon: ShieldOff, label: "11 New Advanced Header Checks", desc: "Added HSTS preload directive validation, CSP upgrade-insecure-requests, __Host-/__Secure- cookie prefix detection, COEP credentialless/require-corp, NEL (Network Error Logging), Expect-CT, Timing-Allow-Origin wildcard, deprecated Feature-Policy, CSP report-uri deprecation, and X-Content-Type-Options value validation. Total checks now 120+." },
      { icon: Network, label: "Subdomain Discovery Overhaul", desc: "Expanded from ~35 to 150+ common subdomain prefixes. Added 3 new passive data sources (HackerTarget, subdomain.center, RapidDNS) running in parallel with crt.sh. DNS resolution checks filter dead entries before HTTP probing. Smart root domain extraction handles subdomains (test.example.com becomes example.com) and double TLDs (.co.uk)." },
      { icon: Tag, label: "Subdomain Source Badges", desc: "Each discovered subdomain now shows color-coded source badges (crt.sh, hackertarget, rapiddns, subdomain.center, brute-force) with a summary bar showing how many results each source contributed." },
      { icon: Filter, label: "Category Filter on Results", desc: "The results list now includes a category filter row with color-coded badges for headers, SSL, content, cookies, configuration, and information disclosure. Filter findings by category alongside the existing severity filter." },
      { icon: FileText, label: "Multi-Page PDF Export", desc: "PDF export now generates unlimited pages instead of truncating at one. All findings with full fix steps, code examples, and explanations render across as many pages as needed with page numbers on every page." },
      { icon: FileDown, label: "Branded PDF Cover Page", desc: "PDF reports now open with a professional VulnRadar-branded cover page showing the target URL, scan date/time, duration, total checks performed, safety rating with color coding, and a severity breakdown with visual bar indicators. Every page includes a branded header and footer." },
      { icon: Sun, label: "Theme Toggle on Shared Pages", desc: "Public shared scan pages (/shared/[token]) now include a theme toggle in the header, allowing visitors to switch between dark and light mode." },
      { icon: Eye, label: "Shared Page Redesign", desc: "The shared scan view has been fully redesigned to match the dashboard/history pattern with an action bar at the top, response headers panel, subdomain discovery, and consistent styling throughout." },
      { icon: Sparkles, label: "Demo Page Parity", desc: "The demo scanner now runs the full async check suite (DNS, TLS, live-fetch) and displays response headers, subdomain discovery, and the redesigned action bar layout matching the authenticated experience." },
      { icon: Share2, label: "Shares Pagination & Share Button Cleanup", desc: "The /shares page now paginates at 5 items per page. The share button no longer shows a revoke button after sharing -- it shows a clean 'Copy Link' button matching the shares page pattern." },
      { icon: Shield, label: "Response Headers in History & Shared Views", desc: "Response headers are now persisted to the database during scans and displayed in history detail views and shared scan pages. Previously they were only shown on the live scan result." },
    ],
  },
  {
    version: "1.5.3",
    date: "February 14, 2026",
    title: "Shared Scans Management, Scan Deletion & Safety Rating Fixes",
    highlights: false,
    changes: [
      { icon: Share2, label: "Shared Scans Management Page", desc: "New Shares page displays all your active shared scan results with one-click copy, view, and revoke options. Manage permissions and track which scans are publicly accessible from a centralized dashboard." },
      { icon: Trash2, label: "Individual Scan Deletion", desc: "Delete specific scans from history without deleting your entire history. Only the scan owner can see and use the delete button. Team members have read-only access to shared scans." },
      { icon: ShieldCheck, label: "Smart Safety Rating Across All Pages", desc: "Fixed badge, shared, and shares management pages to use the intelligent safety rating engine. Sites with only hardening recommendations (missing headers) now correctly show as 'Safe' instead of 'Unsafe'." },
      { icon: Eye, label: "Full Findings Data in List Views", desc: "Badge page and shares management now include full findings arrays when fetching scan lists, enabling accurate safety classification instead of relying on summary counts." },
    ],
  },
  {
    version: "1.5.2",
    date: "February 14, 2026",
    title: "Public Badge Widget, Subdomain Discovery, Live Scan Evidence & Rate Limit Fixes",
    highlights: false,
    changes: [
      { icon: BadgeCheck, label: "Embeddable Security Badge", desc: "Site owners can now embed a 'Secured by VulnRadar' badge on their website. The badge dynamically renders as an SVG showing Safe/Caution/Unsafe status with the last scan date, linking back to the shared report. Grab the HTML or Markdown snippet from the new Badge page." },
      { icon: Globe, label: "Subdomain & Asset Discovery", desc: "After scanning a domain, VulnRadar now discovers subdomains via Certificate Transparency logs (crt.sh) and common prefix probing (www, api, admin, staging, dev, mail, etc.). Each discovered subdomain shows reachability status and can be scanned with one click." },
      { icon: Fingerprint, label: "60+ Secret Detection Patterns", desc: "Massively expanded the hardcoded secrets detector from 7 to 60+ patterns. Now catches AWS, Azure, GCP, Stripe, PayPal, OpenAI, Anthropic, GitHub, GitLab, Slack, Discord, Twilio, SendGrid, MongoDB URIs, PostgreSQL URIs, JWT tokens, SSH/RSA/PGP private keys, and generic API key/password assignments. Each match shows a partially redacted value as proof." },
      { icon: Eye, label: "Live Scan Evidence", desc: "All vulnerability findings now show actual content extracted from the live page instead of generic descriptions. Mixed-content violations list the real HTTP URLs found, SRI-missing checks show the exact script sources, and sensitive comments display the matched comment text." },
      { icon: Shield, label: "Response Header Inspector", desc: "Scan results now include a collapsible Response Headers panel showing the raw HTTP headers returned by the target site, with badges highlighting which security headers are present or missing." },
      { icon: Smartphone, label: "Mobile Share Button Fix", desc: "The Share button now works reliably on mobile. Uses the native Web Share API (share sheet) on supported devices, with a clipboard fallback using both the modern Clipboard API and legacy execCommand for maximum compatibility." },
      { icon: Share2, label: "Badge Stats API", desc: "New public API endpoints serve badge SVGs and scan stats in JSON format, enabling third-party integrations and status monitoring dashboards." },
      { icon: ShieldCheck, label: "Smart Safety Rating Engine", desc: "Badges now use the same intelligent safety classification as the shared reports. Sites with only missing headers (hardening recommendations) show as 'Safe', while only exploitable vulnerabilities count toward 'Unsafe'. Fixes false positives on major sites." },
      { icon: Zap, label: "Generous Rate Limits", desc: "Increased scan rate limit from 10 per hour to 100 per hour. Bulk scanning now supports 10 scans per hour (scan 100+ URLs per bulk scan, counted as 1). Perfect for security researchers and automation testing." },
    ],
  },
  {
    version: "1.5.1",
    date: "February 14, 2026",
    title: "Notification Center & Admin Panel Pagination",
    highlights: false,
    changes: [
      { icon: BellRing, label: "Unified Notification Center", desc: "Replaced scattered popup notifications with a single, unified Notification Center. All alerts (backup code warnings, version updates, Discord announcements) now appear in a stacked card UI with dot navigation and a 1/3 counter, showing the most important notifications first." },
      { icon: List, label: "Audit Log & Staff Pagination", desc: "The admin panel's Audit Log and Staff tabs now paginate at 5 items per page with the same PaginationControl component used elsewhere. Audit log pagination is server-side for performance, while staff uses client-side pagination." },
      { icon: ChevronRight, label: "Instant Admin Button", desc: "The Admin tab in the navbar no longer flickers on page navigation. The user's role is cached in sessionStorage so the button renders immediately without waiting for the API response." },
    ],
  },
  {
    version: "1.5.0",
    date: "February 13, 2026",
    title: "Role-Based Staff System, Profile Pictures & Hashed Backup Codes",
    highlights: false,
    changes: [
      { icon: Crown, label: "Role-Based Access Control", desc: "Replaced the binary admin/user system with a full role hierarchy: Admin, Moderator, Support, and User. Each role has scoped permissions -- Support is view-only, Moderators can disable accounts and force logouts, and Admins have full control." },
      { icon: Shield, label: "Owner Account Protection", desc: "User ID 1 (the first registered account) is now fully protected at the API level. No other admin can modify, disable, or delete the owner account." },
      { icon: Camera, label: "Profile Picture Upload", desc: "Users can now upload a profile picture from their profile page. Includes a full image crop dialog with drag-to-reposition, zoom slider, and circular preview. Supports JPG, PNG, and GIF up to 5MB." },
      { icon: Users, label: "Redesigned Staff Page", desc: "The public /staff page now groups team members by role (Administrators, Moderators, Support) with profile pictures, role badges, and a polished card layout." },
      { icon: UserCheck, label: "Staff Navbar Access", desc: "Support and Moderator roles now see the Admin tab in the navigation bar, not just Admins. The admin button loads instantly on page changes using cached role data." },
      { icon: Eye, label: "Avatars Everywhere", desc: "Profile pictures now appear across the admin panel (user list, user detail, audit logs, active staff) and on shared scan pages. Falls back to colored initials when no picture is set." },
      { icon: Key, label: "Hashed Backup Codes", desc: "2FA backup codes are now hashed using scrypt (same as passwords) instead of stored in plaintext. Existing users with old codes see a warning dialog prompting them to regenerate immediately." },
      { icon: AlertTriangle, label: "Backup Code Rotation Warning", desc: "Users with legacy plaintext backup codes are shown a prominent dialog on login explaining their codes are invalid and need to be regenerated from the profile page." },
      { icon: Trash2, label: "Legacy Column Cleanup", desc: "Dropped the deprecated is_admin boolean column from the database. All role checks now use the role column exclusively." },
      { icon: MessageSquare, label: "Discord Announcement", desc: "A dismissible notification banner announces the new Discord server to all users. Uses a cookie so it only appears once per user." },
    ],
  },
  {
    version: "1.4.0",
    date: "February 13, 2026",
    title: `${TOTAL_CHECKS_LABEL} Security Checks, Smart Safety Engine & Pagination`,
    highlights: false,
    changes: [
      { icon: Brain, label: `${TOTAL_CHECKS_LABEL} Security Checks`, desc: `Completely refactored the scanner engine from a monolithic 3,500-line file into a clean data-driven architecture. All check metadata now lives in a JSON data file with a pure detection engine in TypeScript. Expanded from 75 to ${TOTAL_CHECKS_LABEL} checks covering headers, SSL, content, cookies, configuration, and information disclosure.` },
      { icon: ShieldCheck, label: "Smart Safety Rating Engine", desc: "Rebuilt the safety rating from scratch with a three-tier classification system. Tier 1 (Exploitable) covers real threats like SQL injection, XSS, and exposed credentials. Tier 2 (Hardening) covers missing headers and best practices. Tier 3 (Informational) is excluded entirely. Sites like Discord and Reddit now correctly show as 'Safe' instead of being falsely flagged for missing optional headers." },
      { icon: Target, label: "Framework-Aware Detection", desc: "The scanner now detects Next.js, Nuxt, and Angular and adjusts severity accordingly. CSP directives like unsafe-inline in style-src are marked as INFO on framework sites instead of HIGH, eliminating false positives. A dedicated framework-required CSP check explains which directives are expected for the detected framework." },
      { icon: List, label: "Pagination Everywhere", desc: "Added pagination across the app using a reusable PaginationControl component. History page shows 10 scans per page, admin panel shows 5 users per page, and team scan history is paginated at 10 per page. All with smooth transitions instead of full-page reloads." },
      { icon: Search, label: "Server-Side Admin Search", desc: "Admin user search now queries the database directly with ILIKE filtering across all users, not just the current page. Results update live with a 300ms debounce and smooth opacity transitions -- no page flicker." },
      { icon: Shield, label: "Security Header Fixes", desc: "Fixed CSP trailing semicolon that caused Vercel to strip frame-ancestors directive. Verified X-Frame-Options and Content-Security-Policy headers are properly served in production using debug header analysis." },
      { icon: Zap, label: "Centralized Constants System", desc: "All environment variables (database, SMTP, Turnstile, contact email) are now managed through a centralized constants file with proper validation, replacing scattered process.env calls throughout the codebase." },
      { icon: RefreshCw, label: "Smooth Admin Pagination", desc: "Admin panel pagination and audit log paging no longer trigger full-page skeleton reloads. Only the table content dims briefly with a smooth opacity transition while new data loads in the background." },
    ],
  },
  {
    version: "1.3.2",
    date: "February 11, 2026",
    title: "Bugfix: API key revoke route & minor stability improvements",
    highlights: false,
    changes: [
      { icon: Zap, label: "Fix: API key revoke route", desc: "Resolved a runtime TypeError when revoking API keys by ensuring dynamic route `params` are awaited per Next.js App Router guidance (prevents `Cannot destructure property 'id'` errors)." },
      { icon: Search, label: "Stability improvements", desc: "Small robustness fixes across API routes and improved logging for notification decisions." },
    ],
  },
  {
    version: "1.3.1",
    date: "February 11, 2026",
    title: "Notification preference fixes & DB migration improvements",
    highlights: false,
    changes: [
      { icon: Bell, label: "Respect user notification preferences", desc: "Security-related emails (profile name/email/password changes, 2FA enable/disable, backup codes, and password reset confirmations) now respect each user's 'Security Alerts' preference instead of always sending." },
      { icon: Zap, label: "API key prefix length increased", desc: "Database migration increases api_keys.key_prefix to 64 characters to support longer prefixes and future-proof API keys." },
      { icon: Search, label: "Notification debug logging", desc: "Added lightweight debug logs to help diagnose notification decisions and ensure emails are skipped when preferences are disabled." },
      { icon: RefreshCw, label: "Migration SQL fixes", desc: "Fixed syntax issues in the DB migration SQL (removed stray diff markers) so automatic schema migrations run without syntax errors." },
    ],
  },
  {
    version: "1.3.0",
    date: "February 10, 2026",
    title: "Email Verification, Landing Page & Major UI Polish",
    highlights: false,
    changes: [
      { icon: Mail, label: "Email Verification Required", desc: "New users must verify their email address before logging in. A verification link is sent upon signup that expires in 24 hours." },
      { icon: CheckCircle, label: "Auto-Login on Verification", desc: "Clicking the email verification link automatically verifies your account and logs you in, redirecting straight to the dashboard." },
      { icon: RefreshCw, label: "Resend Verification", desc: "Can't find your verification email? Request a new one directly from the login page. Rate-limited to prevent abuse." },
      { icon: Shield, label: "Verification Token Security", desc: "Tokens are single-use and expire after 24 hours. Already-used tokens show a clear message instead of a generic error." },
      { icon: Eye, label: "Beautiful Landing Page", desc: "New public landing page showcasing VulnRadar's features, benefits, and capabilities. Professional hero section, feature grid, stats showcase, FAQ, and vulnerability coverage highlights." },
      { icon: Heart, label: "Support VulnRadar", desc: "New donation system via Buy Me a Coffee. Support the project to help fund development and keep VulnRadar free for everyone. Access via /donate or the footer links." },
      { icon: Shield, label: "Smart Routing", desc: "Intelligent routing system: unauthenticated visitors see the landing page at /, while authenticated users are automatically redirected to /dashboard for seamless access to the scanner." },
      { icon: Layout, label: "Unified Results UI", desc: "Scan results now display in a consistent gray card with the scanned URL and all action buttons (Scan Again, Export PDF/JSON, Share) grouped together at the top for easy access." },
      { icon: Eye, label: "History Page Polish", desc: "History detail view now matches the dashboard styling with the same gray card layout, showing scanned URL and action buttons in a unified design." },
      { icon: Sparkles, label: "Enhanced OG Image", desc: "Completely redesigned Open Graph image with radar visualization, gradient backgrounds, glow effects, threat blips, and professional typography. Matches the favicon style perfectly." },
      { icon: Zap, label: "Instant Response Times", desc: "Signup, verification emails, and password resets are sent in the background, so you get an immediate response without waiting for email delivery." },
      { icon: Lock, label: "Password Reset Security Info", desc: "Password reset confirmation emails now include the IP address and device information of who requested the reset for better security awareness." },
      { icon: Shield, label: "2FA-Enabled Password Resets", desc: "Users with two-factor authentication can now reset their passwords via email. After reset, they still need their authenticator code to log in, maintaining security while improving usability." },
      { icon: Bell, label: "Security Notifications", desc: "All password resets now trigger a security notification email. If users didn't request the reset, they're immediately alerted with instructions to contact support." },
      { icon: Lock, label: "Atomic Password Reset", desc: "Password reset now uses database transactions with row-level locking to prevent race conditions and ensure emails are only sent once per request." },
      { icon: MessageSquare, label: "Landing Page Contact Form", desc: "Public contact form with Turnstile protection allows visitors to reach out before signing up. Sends professional emails to both the team and the user." },
      { icon: RefreshCw, label: "Auto Session Cleanup", desc: "Expired sessions are now automatically cleaned up every 24 hours to keep the database tidy." },
      { icon: Trash2, label: "Code Cleanup", desc: "Removed unused functions and variables across the codebase. Consolidated duplicate IP detection logic into a shared utility." },
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
      { icon: Eye, label: "Unified Page Titles", desc: `Browser tabs now show ${APP_NAME} consistently across all pages for cleaner branding and better recognition.` },
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
