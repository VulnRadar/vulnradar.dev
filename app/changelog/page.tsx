import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { Newspaper, Zap, Shield, Users, Tag, List, RefreshCw, Lock, Gauge, MessageSquare, Sparkles, Eye, ShieldCheck, Target, Brain, AlertTriangle, Search, Bell, Heart, Layout, Mail, CheckCircle, Trash2, Camera, Crown, UserCheck, Key, BellRing, ChevronRight, BadgeCheck, Globe, Share2, Fingerprint, Smartphone, FileText, ScanSearch, Filter, Sun, Radar, Network, ShieldOff, FileDown, FileSpreadsheet, Pencil, Activity, Link2, BarChart3, Bug, ShieldAlert, Database, ServerCrash, Columns3, Crosshair, FileSearch, Timer, Layers, GitMerge, Palette, ServerCog, Wrench, Container, Menu, Image } from "lucide-react"
import { APP_NAME, TOTAL_CHECKS_LABEL } from "@/lib/constants"

const CHANGELOG = [
  {
    version: "1.8.0",
    date: "February 20, 2026",
    title: "55+ New Security Checks, Notification Bell & Performance Overhaul",
    highlights: true,
    changes: [
      { icon: Radar, label: "55+ New Security Checks (175+ Total)", desc: "Expanded detection engine to 175+ checks including: header information leaks (X-Powered-By, X-Runtime, X-Debug, Via, X-Backend-Server, ETag inode leaks), advanced CSP analysis (unsafe-inline without nonce, unsafe-eval, wildcard sources, data: URIs), CORS policy validation (null origin, excessive header exposure, preflight caching), referrer policy analysis, server error detection (SQL, PHP, ASP.NET, Django, Laravel), secrets exposure (JWT tokens, private keys, connection strings, .env files, .git directories), and content security (missing iframe sandbox, unencrypted WebSocket, mixed-content forms, inline event handlers)." },
      { icon: Bell, label: "Notification Bell in Header", desc: "Replaced full-screen notification modal with a compact bell icon in the header showing unread count. Notifications (version updates, Discord invites) appear in a dismissible dropdown. Backup codes modal remains separate and always interrupts as a full-screen overlay for security-critical updates." },
      { icon: Filter, label: "Scanner Category Selector", desc: "Added 'Select Scanners' button next to Scan button to choose which security categories to run: Security Headers, SSL/TLS, Cookie Security, Content Analysis, Info Disclosure, Configuration, and DNS & Email. Reduces scan time and allows targeted security assessments." },
      { icon: Zap, label: "Major Performance Improvements", desc: "Fixed admin tab and notification bell from triggering API calls on every page navigation. Moved /api/auth/me to app-level SWR with 5-minute deduping via new AuthProvider context, eliminating duplicate requests and page load freeze. Header now renders instantly with cached auth state." },
      { icon: Bug, label: "Fixed /shared Page Auth Detection", desc: "Shared scan links now detect if the viewer is logged in. Authenticated users see the full Header with navigation and the standard Footer. Guests see a minimal header with Sign In button." },
      { icon: ShieldAlert, label: "Engine Version 2.0.0", desc: "Detection engine bumped to v2.0.0 reflecting the massive expansion of security checks, improved categorization, and scanner selector feature." },
    ],
  },
  {
    version: "1.7.4",
    date: "February 19, 2026",
    title: "Docker Production Ready, Mobile UX Overhaul & Error Pages",
    highlights: true,
    changes: [
      { icon: Container, label: "Docker Production Ready", desc: "Fixed Dockerfile with a dummy DATABASE_URL during build so Next.js compiles without a live database. Real credentials are injected at runtime via Docker Compose. Updated docker-compose.yml to pass through all env vars (SMTP, Turnstile, contact email). Added Docker Compose overrides to .env.example." },
      { icon: Menu, label: "Mobile Menu Overlay", desc: "Replaced the push-down mobile navigation dropdown with a Sheet overlay that slides in from the right. No longer pushes page content down when opened." },
      { icon: Smartphone, label: "Icon-Only Buttons on Mobile", desc: "Buttons with icon + text (View Scans, Invite, Delete Team, Export, Share, Copy Link, Revoke, Clear All, etc.) now show only icons on mobile and full text on desktop across all pages: teams, history, dashboard, shares, badge, and scanner components." },
      { icon: Pencil, label: "Editable Team Names", desc: "Team owners and admins can now rename teams inline with a pencil icon, input field, and save/cancel controls. Added a PATCH endpoint to /api/teams." },
      { icon: Image, label: "Team Member Avatars", desc: "Team member rows now display profile pictures when available, with a fallback to the initial letter avatar. The members API now returns avatar_url from the users table." },
      { icon: ServerCrash, label: "Custom Error Page", desc: "Added a styled 500 error page with a grid background, terminal-style error digest block, copy-to-clipboard, and navigation links. Matches the existing 404 page design." },
    ],
  },
  {
    version: "1.7.3",
    date: "February 19, 2026",
    title: "Unified Footer, Contact Upgrades & Error Pages",
    highlights: false,
    changes: [
      { icon: Globe, label: "Version Check via GitHub Releases", desc: "The startup version check and /api/version endpoint now use the GitHub Releases API instead of fetching raw package.json. Console output now shows a direct link to the specific release tag when an update is available." },
      { icon: Layout, label: "Unified Footer Across All Pages", desc: "Replaced all inline footers (landing page, docs layout, etc.) with a shared Footer component featuring a 5-column grid layout with Product, Resources, Legal sections, a donate button, and social links." },
      { icon: Mail, label: "Contact Email Auto-Fill", desc: "The contact page now auto-fills and locks the email field for logged-in users. Name is also auto-filled but remains editable." },
      { icon: Users, label: "Staff Application via Contact Form", desc: "Added an 'Apply for Staff' category to the contact form with Support and Moderator roles. Includes a role dropdown, required Discord username, availability field, and a volunteer notice explaining positions are unpaid and voluntary." },
      { icon: ServerCrash, label: "Error Pages", desc: "Added proper error pages: a client-side error boundary (500) with retry and support links, and a global-error fallback for fatal layout crashes with inline styles." },
    ],
  },
  {
    version: "1.7.2",
    date: "February 19, 2026",
    title: "Self-Hosted Schema & Stability Fixes",
    highlights: false,
    changes: [
      { icon: Database, label: "Scan History Save Fix", desc: "Fixed scans not saving to history. The INSERT query referenced a non-existent 'scan_notes' column instead of the correct 'notes' column, causing every save to silently fail. Affected the quick scan, deep crawl, and bulk scan routes." },
      { icon: Bug, label: "Bulk Scan Notes", desc: "Bulk scan results now include the default scan note (version + engine info) in the database, matching the behavior of quick scan and deep crawl." },
      { icon: Wrench, label: "Silent Catch Logging", desc: "Added console.error logging to previously silent catch blocks in the scan, crawl, and bulk routes. DB failures during history saves are now logged to the server console instead of being swallowed." },
      { icon: Shield, label: "Notification Preferences Cleanup", desc: "Removed phantom notification preference columns that were referenced in API code but never existed in the schema. All notification routes, lib, and schema are now in sync." },
      { icon: FileSearch, label: "Docs Column Name Fixes", desc: "Fixed documentation examples referencing non-existent columns: 'username' corrected to 'name' in the setup verification SQL, version numbers updated across all docs." },
    ],
  },
  {
    version: "1.7.1",
    date: "February 19, 2026",
    title: "Migration Tool Improvements & Documentation Overhaul",
    highlights: false,
    changes: [
      { icon: GitMerge, label: "Table & Column Rename Detection", desc: "The migration tool now detects renamed tables and columns between versions. When an old name exists in the DB but the new name is expected, it offers to rename it in-place (preserving all data). Rename mappings are defined at the top of migrate.mjs for easy maintenance." },
      { icon: Database, label: "Smarter Migration Prompts", desc: "Review prompts (non-destructive) now default to Yes (Y/n), while destructive actions (dropping columns/tables) still default to No (y/N). Every action requires explicit confirmation, and table drops require double confirmation." },
      { icon: Bug, label: "Migration Parser Rewrite", desc: "Completely rewrote the schema parser from a fragile regex approach to a line-by-line state machine. Correctly handles DEFAULT NOW(), REFERENCES, nested parentheses, and all SQL types. No more false 'extra column' reports for created_at." },
      { icon: FileSearch, label: "Extra Table Detection", desc: "Tables in the database that aren't part of the VulnRadar schema are now flagged as EXTRA TABLE with row counts, and can be selectively dropped. Includes a recommendation to use a dedicated database." },
      { icon: Wrench, label: "Documentation Overhaul", desc: "Fully updated the Setup and API docs: added Deep Crawl, Crawl Discover, and Version Check endpoints. Setup docs now cover auto-schema via instrumentation.ts, the migration tool, version checking, correct env vars, and accurate table names." },
      { icon: ServerCog, label: "Startup Version Check", desc: "Self-hosted instances now log the running version and check GitHub for updates on every server startup. Shows colored messages: green if current, yellow with release link if behind, and a fun message if somehow ahead." },
      { icon: Shield, label: "Exact Hostname Crawl Fix", desc: "Fixed the crawler following links to subdomains (e.g. r.agg.moe when scanning agg.moe). Now uses exact hostname matching instead of registered domain matching." },
    ],
  },
  {
    version: "1.7.0",
    date: "February 18, 2026",
    title: "Deep Crawl URL Selector, IP Rate-Limited Demo & Auto Scan Notes",
    highlights: false,
    changes: [
      { icon: Network, label: "Deep Crawl URL Selector", desc: "Deep Crawl now discovers pages first, then shows a selection modal where you pick exactly which pages to scan. Toggle individual URLs on/off, search/filter the list, or use Select All/Deselect All. No more scanning pages you don't care about." },
      { icon: Filter, label: "Smart Crawl URL Filtering", desc: "The crawler now filters out asset files (.css, .js, .woff, .json, etc.), internal framework paths (/_next/, /static/, /api/), and garbage URLs with encoded characters or regex-like patterns. Only real, human-navigable pages are discovered." },
      { icon: Globe, label: "Same-Domain Redirect Handling", desc: "Sites that redirect (e.g. disutils.com to disutils.com/en/home) are now followed correctly. The crawler checks registered domains instead of strict origins, so language-prefixed redirects and www variants are all crawled properly." },
      { icon: Layers, label: "Crawl Results Separated by Page", desc: "Deep Crawl results now show findings for the URL you entered as the main view. Other crawled pages appear in a collapsible 'Also Crawled' section below the summary, each expandable to view their individual findings." },
      { icon: Shield, label: "IP-Based Demo Rate Limiting", desc: "The demo scanner now rate-limits by IP address via the database instead of cookies. 5 scans per 12 hours per IP. No more bypassing limits by clearing cookies." },
      { icon: FileText, label: "Auto Scan Notes", desc: "Every scan automatically gets a default note with the VulnRadar version and Detection Engine version (e.g. 'VulnRadar v1.7.0 (Detection Engine v1.5.0)'). Notes are saved to the DB immediately and appear on shared scans." },
      { icon: Link2, label: "Full URL Display in History", desc: "History and Compare pages now show the full URL path (e.g. example.com/docs/api) instead of just the hostname. Compare is restricted to scans from the same domain." },
      { icon: Lock, label: "Demo Subdomain Auth Message", desc: "The Subdomain Discovery button on the demo page now shows a friendly 'Log in to use this feature' message instead of a generic error when unauthenticated users try to use it." },
      { icon: Wrench, label: "Code Cleanup", desc: "Removed all em-dash (--) patterns from comments and user-visible text across 14 files. Replaced with colons, commas, and parentheses for cleaner copy." },
    ],
  },
  {
    version: "1.6.8",
    date: "February 16, 2026",
    title: "Metadata & Social Preview Fixes",
    highlights: false,
    changes: [
      { icon: Sparkles, label: "Page Metadata Fixed", desc: "Resolved an issue where page metadata (title, description, Open Graph and Twitter card tags) sometimes failed to render; social previews and browser titles now display correct content and consistent VulnRadar branding." },
      { icon: Newspaper, label: "Consistent OG Images", desc: "Fixed generation and serving of Open Graph images so link previews show the branded VulnRadar image across Discord, Twitter, and other platforms." },
      { icon: CheckCircle, label: "Canonical & Meta Tags", desc: "Canonical links and meta description are now consistent site-wide; metadata no longer mismatches between server and client renders." },
    ],
  },
  {
    version: "1.6.7",
    date: "February 16, 2026",
    title: "Scan Notes Visibility & Team Collaboration",
    highlights: false,
    changes: [
      { icon: Eye, label: "Notes Visible to Team Members", desc: "Scan notes are now visible to all team members viewing a scan in the history page. Previously, the entire notes section was hidden unless you were the scan owner. Team members can now see notes to stay informed about scan context, known false positives, and remediation progress." },
      { icon: Lock, label: "Owner-Only Edit Permissions", desc: "Only the original scan owner can add or edit notes. Team members see a read-only view with no edit/add buttons. The backend PATCH endpoint was already restricted to the owner via WHERE user_id, so this enforces the same rule on the frontend." },
      { icon: Share2, label: "Notes on Shared Scans", desc: "Shared scan links now include notes in the API response and render them read-only on the shared scan page. Anyone with a share link can see the scan owner's notes, giving external reviewers full context about the scan findings." },
      { icon: MessageSquare, label: "Empty State Messaging", desc: "Non-owners now see 'No notes for this scan.' instead of the owner-facing 'Click Add Note to annotate this scan.' prompt, making it clear that only the scan creator can add notes." },
    ],
  },
  {
    version: "1.6.6",
    date: "February 16, 2026",
    title: "Full API Audit & Bug Fixes",
    highlights: false,
    changes: [
      { icon: Wrench, label: "Team Creation Fixed", desc: "Fixed a critical bug where creating a team would fail with a 500 error. The TEAM_ROLES.OWNER constant was embedded as literal text inside the SQL query instead of being passed as a parameterized value, causing Postgres to throw a column-not-found error." },
      { icon: FileDown, label: "Data Export Download Fixed", desc: "The data export download endpoint was querying for a non-existent 'status' column (WHERE status = 'completed') instead of using the 'downloaded_at' column that the main export route actually sets. This caused the download route to always return 404 even after a successful export." },
      { icon: Shield, label: "49 API Routes Audited", desc: "Reviewed all 49 API routes for correctness, security, and consistency. Verified parameterized queries across all database operations, confirmed rate limiting on all public-facing endpoints, validated auth checks on all protected routes, and ensured consistent error handling patterns." },
      { icon: Bug, label: "Code Quality Cleanup", desc: "Replaced inline require('crypto') with a proper ES module import in the team members route. Removed leftover debug console.error('[v0]') statements from the data request route. Synced package.json version to match APP_VERSION constant." },
    ],
  },
  {
    version: "1.6.5",
    date: "February 16, 2026",
    title: "Subdomain Discovery Restored & Status-Coded Results",
    highlights: false,
    changes: [
      { icon: Globe, label: "Brute-Force Restored with 150+ Prefixes", desc: "Re-added DNS brute-force subdomain discovery with 150+ common prefixes covering infrastructure (www, mail, smtp, ftp), environments (dev, staging, qa, sandbox), admin panels (admin, cpanel, portal), CDN/assets (cdn, static, media), services (blog, shop, docs, status), auth (sso, vpn, oauth), DevOps (git, jenkins, docker, k8s, registry), databases (db, mysql, redis, mongo), and business systems (crm, erp, billing, checkout). All 150+ DNS lookups run in a single parallel batch so total time is roughly the same as a single lookup." },
      { icon: Palette, label: "Status-Coded Subdomain Results", desc: "Subdomain dots and status codes are now color-coded by HTTP response: green for 2xx (active), blue for 3xx (redirect), amber for 4xx (forbidden/not found), and red for 5xx (server error). Previously all reachable subdomains showed a green dot regardless of status code, making it hard to distinguish healthy services from blocked or erroring endpoints." },
      { icon: ServerCog, label: "Passive Source Reliability", desc: "Added User-Agent headers and increased timeouts on all four passive sources (crt.sh 15s, HackerTarget 10s, subdomain.center 10s, RapidDNS 10s). Some sources were silently rejecting requests without a browser-like User-Agent, returning empty results." },
    ],
  },
  {
    version: "1.6.4",
    date: "February 16, 2026",
    title: "Scanner Engine v1.5.0: Full Optimization Pass & Duplicate Removal",
    highlights: false,
    changes: [
      { icon: Layers, label: "Removed 8 Duplicate Checks", desc: "Eliminated redundant checks that were producing duplicate findings: sri-link-missing (same as sri-missing), unsafe-target-blank (same as reverse-tabnabbing), insecure-form-submission (same as form-action-http), websocket-wss (same as unencrypted-connections), html-comment-leaks (same as sensitive-comments), document-write-usage (caught by dangerous-inline-js), sensitive-files (false positive prone body text matching), and robots-txt-exposure (handled by live-fetch in async-checks)." },
      { icon: Timer, label: "Async Checks Fully Parallelized", desc: "SPF, DMARC, DKIM, and DNSSEC now all run in parallel instead of sequentially. DKIM uses Promise.race to early-exit as soon as the first valid selector is found. security.txt checks both URLs in parallel. robots.txt uses a single combined regex instead of 16 separate patterns. Total DNS check time reduced by ~60%." },
      { icon: Zap, label: "Reduced Timeouts Across the Board", desc: "TLS check timeout reduced from 8s to 5s. Fetch timeouts (robots.txt, security.txt) reduced from 8s to 5s. DNSSEC DoH queries reduced from 6s to 4s. Subdomain HTTP checks reduced from 5s/4s to 4s/3s. Overall async timeout reduced from 20s to 15s. These savings compound since checks now run in parallel." },
      { icon: Globe, label: "Subdomain Brute-Force Removed", desc: "Completely removed the 50-prefix brute-force subdomain list. Discovery now relies entirely on passive sources (crt.sh, HackerTarget, RapidDNS, subdomain.center) which already find real subdomains with actual DNS records. This eliminates the slowest part of subdomain discovery: DNS lookups on prefixes that almost never exist." },
      { icon: GitMerge, label: "Token Exposure Deduplicated", desc: "The token-exposure check no longer duplicates JWT detection (already handled by hardcoded-secrets). It now only checks for server session IDs (PHPSESSID, JSESSIONID, ASP.NET_SessionId) which are genuinely dangerous when exposed in HTML." },
      { icon: Trash2, label: "Removed Low-Value Checks", desc: "Removed expect-ct-missing (Expect-CT was deprecated and removed from Chrome in 2022, no browser enforces it) and dns-prefetch-control (X-DNS-Prefetch-Control has negligible security impact). These were cluttering scan results with unhelpful info-level findings." },
    ],
  },
  {
    version: "1.6.3",
    date: "February 16, 2026",
    title: "Scanner Accuracy Overhaul: False Positives, DKIM Detection & Body Limits",
    highlights: false,
    changes: [
      { icon: Crosshair, label: "API Key Detection Overhaul", desc: "Completely rewrote the hardcoded secrets scanner to eliminate false positives. Removed 25+ overly broad patterns that matched UUIDs (Postmark), any hex string near a brand name (Cloudflare, Heroku, Vercel, Netlify, Datadog, etc.), public JWT tokens (Supabase anon keys), and random digit sequences (Telegram). Only high-confidence prefixed patterns remain (e.g., sk_live_, ghp_, SG., AIzaSy). Database URI checks now require user:password@host format. Added automatic filtering of placeholder values (example, test_, dummy, xxxx) and localhost URIs." },
      { icon: Radar, label: "DKIM CNAME Detection", desc: "Fixed DKIM detection for ProtonMail and other providers that use CNAME-delegated DKIM records instead of inline TXT records. The scanner now checks both dns.resolveTxt() and dns.resolveCname() for each selector, and runs all selector checks in parallel for faster results. This resolves false 'No DKIM Records Found' warnings for ProtonMail, Fastmail, and similar providers." },
      { icon: FileSearch, label: "security.txt Detection Simplified", desc: "Rewrote the security.txt check to simply verify that either /.well-known/security.txt or /security.txt returns a 200 OK status. No more content validation that caused false positives when CDNs or proxies transformed the response body. If the endpoint exists and responds, it passes." },
      { icon: ShieldCheck, label: "DNSSEC Detection via DNS-over-HTTPS", desc: "Replaced the broken Node.js dns.resolve('DNSKEY') approach with Google and Cloudflare DNS-over-HTTPS APIs. The scanner now checks the AD (Authenticated Data) flag from both resolvers, which is the standard way to verify DNSSEC validation. This fixes false 'DNSSEC Not Enabled' warnings for domains using Cloudflare or any registrar with DNSSEC enabled." },
      { icon: ServerCrash, label: "Body Size Limit Reduced to 1MB", desc: "Lowered the maximum response body size from 2MB to 1MB for both the main scanner and demo scanner. The previous 2MB limit was still causing crashes on certain heavy websites. All security-relevant HTML content (meta tags, forms, inline scripts, framework fingerprints) lives in the first 100-500KB of any page." },
      { icon: Search, label: "Subdomain List Trimmed to 50", desc: "Reduced the brute-force subdomain wordlist from 150+ entries to the 50 most impactful prefixes (www, mail, api, admin, dev, staging, cdn, etc.). Passive sources (crt.sh, HackerTarget, RapidDNS, subdomain.center) handle extended discovery. Updated the UI loading text to reflect '50+ common prefixes'." },
      { icon: FileText, label: "Doc Page Detection", desc: "Added automatic detection of documentation and example pages. The secrets scanner now skips pages that contain 'documentation', 'example', and 'api' together, preventing false positives on API docs that show example keys and configuration snippets." },
    ],
  },
  {
    version: "1.6.2",
    date: "February 15, 2026",
    title: "Security Hardening, Crash Prevention & Scanner Accuracy Improvements",
    highlights: false,
    changes: [
      { icon: ServerCrash, label: "Scan Crash Prevention", desc: "Fixed a critical issue where scanning certain websites would crash the entire server for all users. Response bodies are now streamed with a 2MB size limit instead of reading the full body into memory. Sync checks are capped at 1MB to prevent catastrophic regex backtracking, and async checks (DNS, TLS, live-fetch) are wrapped in a 20-second timeout." },
      { icon: Shield, label: "Demo Scanner Hardened", desc: "Applied the same OOM and timeout protections to the demo scanner. Previously, unauthenticated users could crash the server by scanning a site with a massive response body through the demo page." },
      { icon: Bug, label: "SQL Injection Fix in Schedules", desc: "Fixed a SQL injection vector in the scheduled scans API where the interval value was being string-interpolated into the query. Now uses parameterized make_interval() with integer days for safe query execution." },
      { icon: ShieldAlert, label: "Webhook SSRF Protection", desc: "Webhook URLs are now validated against internal and private network addresses (localhost, 127.0.0.1, 169.254.x.x, 10.x, 192.168.x, .local) and must use HTTPS. Prevents server-side request forgery attacks through webhook creation." },
      { icon: Lock, label: "Profile Update Rate Limiting", desc: "Added rate limiting to the profile update endpoint to prevent brute-force attacks against the current password verification field. Uses the same rate limit configuration as other API endpoints." },
      { icon: Gauge, label: "Status API Rate Limiting", desc: "The public /status/[domain] API endpoint is now rate-limited to 30 requests per minute per IP address to prevent abuse and scraping." },
      { icon: ShieldCheck, label: "New Security Headers", desc: "Added Cross-Origin-Embedder-Policy (credentialless) and Expect-CT (enforce, max-age 86400) response headers to the Next.js configuration for stronger browser-level isolation and certificate transparency enforcement." },
      { icon: FileText, label: "security.txt Endpoint", desc: "Created a /.well-known/security.txt route serving a standards-compliant security disclosure file with Contact, Expires, Preferred-Languages, Canonical, and Policy fields." },
      { icon: Radar, label: "Expanded DKIM Selectors", desc: "Expanded DKIM selector detection from 8 to 19 selectors. Now includes ProtonMail (protonmail, protonmail2, protonmail3), Zendesk, Mandrill, and other common email provider selectors for more accurate DKIM detection." },
      { icon: Columns3, label: "Admin Mobile Grid Fix", desc: "Merged the two separate 5-card stat grids in the admin panel into a single 10-card responsive grid. On mobile (2 columns), all cards now fill evenly with no orphaned cards on their own row." },
      { icon: Database, label: "Instrumentation Schema Sync", desc: "Fully synchronized the instrumentation file with the production database schema. Added missing migrations for device_trust table, response_headers JSONB column, notes TEXT column, and data/downloaded_at columns on data_requests. Removed redundant ALTER TABLE calls that ran on every data-request API call." },
    ],
  },
  {
    version: "1.6.1",
    date: "February 15, 2026",
    title: "CSV Export, Scan Notes, Public Status Pages & Repository Migration",
    highlights: false,
    changes: [
      { icon: FileSpreadsheet, label: "CSV Export", desc: "One-click CSV export of all scan findings alongside the existing JSON and PDF options. Outputs properly escaped columns for Title, Severity, Category, Description, Evidence, Risk Impact, and Fix Steps, ready for import into JIRA, Linear, or spreadsheets." },
      { icon: Pencil, label: "Scan Notes & Annotations", desc: "Add freeform notes to any scan result from the history detail view. Write reminders like 'Fixed CSP issue, re-scan next week' or 'Known false positive, ignore'. Notes are persisted to the database (max 2,000 characters) and only editable by the scan owner." },
      { icon: BarChart3, label: "Public Status Pages", desc: "New /status/[domain] pages show a domain's security health over time. Displays the current safety rating, a findings trend chart, severity breakdown bars, and a scan history table. Fully public, no authentication required. Link to it from your site as a trust signal." },
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
      { icon: Share2, label: "Shares Pagination & Share Button Cleanup", desc: "The /shares page now paginates at 5 items per page. The share button no longer shows a revoke button after sharing. It shows a clean 'Copy Link' button matching the shares page pattern." },
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
      { icon: Crown, label: "Role-Based Access Control", desc: "Replaced the binary admin/user system with a full role hierarchy: Admin, Moderator, Support, and User. Each role has scoped permissions: Support is view-only, Moderators can disable accounts and force logouts, and Admins have full control." },
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
      { icon: Search, label: "Server-Side Admin Search", desc: "Admin user search now queries the database directly with ILIKE filtering across all users, not just the current page. Results update live with a 300ms debounce and smooth opacity transitions. No page flicker." },
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
      { icon: Eye, label: "Self-Scan Demo", desc: "Try VulnRadar on itself with a one-click demo scan to see the scanner in action, no account required." },
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
