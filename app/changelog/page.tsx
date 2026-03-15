import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import {
  Zap,
  Shield,
  Users,
  Tag,
  List,
  RefreshCw,
  Lock,
  Gauge,
  MessageSquare,
  Sparkles,
  Eye,
  ShieldCheck,
  Target,
  AlertTriangle,
  Search,
  Bell,
  Heart,
  Layout,
  Mail,
  CheckCircle,
  Trash2,
  Camera,
  Crown,
  UserCheck,
  Key,
  BellRing,
  ChevronRight,
  BadgeCheck,
  Globe,
  Share2,
  Fingerprint,
  Smartphone,
  FileText,
  ScanSearch,
  Filter,
  Sun,
  Radar,
  Network,
  ShieldOff,
  FileDown,
  FileSpreadsheet,
  Pencil,
  Activity,
  Link2,
  BarChart3,
  Bug,
  ShieldAlert,
  Database,
  ServerCrash,
  Columns3,
  Crosshair,
  FileSearch,
  Timer,
  Layers,
  GitMerge,
  Palette,
  ServerCog,
  Wrench,
  Container,
  Menu,
  Image,
  Newspaper,
  Settings,
  Plus,
  ArrowRight,
  type LucideIcon,
} from "lucide-react"
import { APP_NAME, TOTAL_CHECKS_LABEL, APP_VERSION } from "@/lib/constants"
import Link from "next/link"

// Change categories with colors
const CHANGE_CATEGORIES = {
  added: { label: "Added", color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
  changed: { label: "Changed", color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" },
  fixed: { label: "Fixed", color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" },
  security: { label: "Security", color: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" },
  performance: { label: "Performance", color: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20" },
  deprecated: { label: "Deprecated", color: "bg-neutral-500/10 text-neutral-600 dark:text-neutral-400 border-neutral-500/20" },
} as const

type ChangeCategory = keyof typeof CHANGE_CATEGORIES

interface Change {
  icon: LucideIcon
  label: string
  desc: string
  category?: ChangeCategory
}

interface Release {
  version: string
  date: string
  title: string
  highlights: boolean
  summary?: string
  changes: Change[]
}

const CHANGELOG: Release[] = [
  {
    version: "2.0.3",
    date: "March 15, 2026",
    title: "310+ Security Checks, Config System Overhaul & UI Improvements",
    highlights: true,
    summary: "Massive expansion of the detection engine to 310+ checks, complete configuration system overhaul eliminating environment variable complexity, and important UI fixes for better cross-platform support.",
    changes: [
      { icon: ShieldCheck, label: "310+ Security Checks", desc: "Expanded detection engine from 175 to 310+ security checks. Added comprehensive checks for CSP directives (base-uri, form-action, frame-src, upgrade-insecure-requests), CORS misconfigurations, cookie security (domain scope, prefixes, partitioned), credential exposure patterns (AWS, Stripe, GitHub, npm, Docker Hub, SendGrid, Twilio, Slack/Discord webhooks), DOM security (clobbering, srcdoc iframes, blob/data URIs), and many more.", category: "added" },
      { icon: Settings, label: "Config System Overhaul", desc: "Eliminated all NEXT_PUBLIC environment variables for app metadata. New config-values.ts reads directly from config.yaml at startup with zero circular dependencies. Version numbers, app name, and all metadata now come from a single source of truth. No more hydration mismatches from stale cached values.", category: "changed" },
      { icon: FileText, label: "Updated Documentation", desc: "Setup docs now include complete .env.example with all sections (Database, SMTP, Stripe, Discord OAuth, Turnstile). Added new 'Application Configuration' section explaining config.yaml. All environment variable code blocks now have copy buttons. Removed outdated v1 API references.", category: "changed" },
      { icon: Layout, label: "Modal & Toast Scrolling", desc: "Added max-height constraints with overflow-y-auto to Dialog, AlertDialog, and Toast components. Long notifications and modal content now scroll properly instead of overflowing the viewport on all platforms.", category: "fixed" },
      { icon: Wrench, label: "Bulk Scan Helper Text", desc: "Fixed misleading 'must include https://' text in bulk scan form since the scanner auto-adds protocols.", category: "fixed" },
    ],
  },
  {
    version: "2.0.1",
    date: "March 14, 2026",
    title: "Detection Engine v2.0.1, Subdomain Caching & Share Modal",
    highlights: false,
    summary: "Major detection engine improvements to reduce false positives, new subdomain caching system, and a beautiful custom share modal for scan results.",
    changes: [
      { icon: ShieldCheck, label: "Detection Engine v2.0.1", desc: "Major improvements to reduce false positives. CSP checks now skip framework sites (Next.js, Nuxt, Angular) that legitimately require unsafe-inline/eval. Fixed wildcard detection to not flag 'https:' as a wildcard. XXE and reflected input checks now skip code examples and documentation. CDN fallback check no longer flags analytics scripts like cloudflareinsights.com.", category: "changed" },
      { icon: Globe, label: "Subdomain Discovery Caching", desc: "Subdomain results are now cached for 4 hours in the database to prevent rate limiting on external APIs. Shows cache status with time remaining until refresh, plus a 'Refresh Now' button to force-refresh if needed. Also expanded the discovery limit from 150 to 1000 subdomains.", category: "added" },
      { icon: Share2, label: "Custom Share Modal", desc: "Replaced the native browser share with a custom YouTube-style share modal. Share scan results directly to X (Twitter), Facebook, LinkedIn, WhatsApp, or Email with one click. The modal includes a copy-to-clipboard link button with visual feedback.", category: "added" },
      { icon: Bell, label: "Admin Notifications UI Overhaul", desc: "Completely redesigned the notification cards in the admin panel. New cleaner card layout with colored accent bar, improved badge styling using neutral backgrounds for better readability, larger icons, better spacing, and always-visible action buttons.", category: "changed" },
      { icon: FileText, label: "Admin User Notes", desc: "Added a dedicated Notes section in the admin user detail panel. Staff can now add internal notes about users that persist across sessions. Notes display the author, timestamp, and full note content in a scrollable list.", category: "added" },
      { icon: Settings, label: "Dynamic Version System", desc: "Completely eliminated hardcoded version numbers. All versions now read from config.yaml at server startup and are cached for the instance lifetime. No more lazy loading or build-time injection - versions are immediately available when the app starts.", category: "changed" },
      { icon: Wrench, label: "Bug Fixes", desc: "Fixed JSON parse errors in admin activity API when request body is empty. Fixed nested anchor tag hydration errors in history page. Fixed subdomain discovery button passing click event instead of boolean. Added missing DialogDescription for accessibility. Fixed notifications manager dialog centering. Added data-scroll-behavior attribute for Next.js smooth scrolling compatibility.", category: "fixed" },
    ],
  },
  {
    version: "2.0.0",
    date: "March 12, 2026",
    title: "Stripe Billing, Discord Integration, Admin Notifications & Design System Overhaul",
    highlights: false,
    summary: "The biggest release yet with full Stripe billing integration, Discord account linking, comprehensive admin notification system, and a complete design system overhaul.",
    changes: [
      { icon: Crown, label: "Stripe Billing Integration", desc: "Full Stripe Checkout integration with 4 subscription tiers: Free, Core Supporter ($5/mo), Pro Supporter ($10/mo), and Elite Supporter ($20/mo). Each tier unlocks higher scan limits. Billing portal for managing subscriptions, automatic webhook handling for subscription lifecycle events, and seamless upgrade/downgrade flows.", category: "added" },
      { icon: Globe, label: "Discord Account Linking", desc: "Link your Discord account to your VulnRadar profile for enhanced community features. OAuth2 flow with secure token storage, profile display showing Discord avatar and username, and one-click unlink option. Enables future Discord bot integrations and community verification.", category: "added" },
      { icon: BellRing, label: "Admin Notification System", desc: "Comprehensive notification system for site-wide announcements. Admins can create Banner, Modal, Toast, or Bell notifications with customizable variants (info, success, warning, error), audience targeting (all, authenticated, unauthenticated, admin, staff), scheduling with start/end dates, and unique cookie-based dismiss tracking per notification.", category: "added" },
      { icon: Palette, label: "Design System Overhaul", desc: "Complete redesign of the color system using semantic design tokens. Primary color updated to a refined cyan/teal, all hover states standardized to use neutral gray accent colors, and consistent theming across all pages. Removed blue/purple color bleeding in favor of cohesive neutral palette with intentional accent colors.", category: "changed" },
      { icon: Zap, label: "API v2 Migration", desc: "All API endpoints migrated from /api/v1/ to /api/v2/ with automatic deprecation warnings. New API_VERSION constant enables single-source version control. v1 endpoints return deprecation headers directing developers to upgrade. Full backward compatibility maintained during transition period.", category: "changed" },
      { icon: Database, label: "Enhanced Database Schema", desc: "New tables for Discord accounts (discord_accounts), Stripe customers (stripe_customers), subscriptions (stripe_subscriptions), and admin notifications (admin_notifications). Added cookie_id column for unique notification dismiss tracking. Improved indexing for billing and notification queries.", category: "added" },
      { icon: ShieldCheck, label: "Subscription-Gated Scanning", desc: "Scan limits now enforced based on subscription tier. Free users get 50 scans/month, Core gets 100, Pro gets 150, Elite gets 500. Usage tracking via billing API with clear limit indicators in the UI. Self-hosters can disable billing entirely via config.yaml.", category: "added" },
      { icon: Settings, label: "Admin Notifications Manager", desc: "Full CRUD interface for managing site notifications. Create notifications with rich options: type selector, variant badges, audience targeting, path patterns for page-specific display, scheduling controls, dismiss duration, and action buttons with external link support. Real-time preview of notification appearance.", category: "added" },
      { icon: Bell, label: "Multi-Type Notification Display", desc: "Banner notifications appear at page top with gradient accents and megaphone icons. Modal notifications show as centered overlays with backdrop blur. Toast notifications stack in bottom-right corner with auto-dismiss progress bars. Each type respects its own cookie-based dismiss state independently.", category: "added" },
      { icon: Link2, label: "Discord Profile Modal", desc: "New modal for connecting Discord accounts with OAuth2 authorization flow. Shows connected account details including avatar, username, and Discord ID. Clean disconnect flow with confirmation. Integrated into profile page security section.", category: "added" },
      { icon: BarChart3, label: "Billing Dashboard", desc: "New /pricing page showing all subscription tiers with feature comparison. Current plan highlighted with usage statistics. One-click upgrade buttons that redirect to Stripe Checkout. Billing portal access for existing subscribers to manage payment methods and cancel subscriptions.", category: "added" },
      { icon: Wrench, label: "Stripe Webhook Automation", desc: "Automatic webhook endpoint registration on first billing API call. Handles checkout.session.completed, customer.subscription.updated, customer.subscription.deleted, and invoice.payment_failed events. Robust signature verification and idempotent event processing.", category: "added" },
      { icon: Activity, label: "Staff Heartbeat System", desc: "Real-time presence tracking for staff members. Automatic status updates (online/away/offline) based on activity. Visible in admin panel for coordinating support coverage. Uses efficient polling with 30-second intervals.", category: "added" },
      { icon: Filter, label: "Notification Audience Targeting", desc: "Notifications can target specific audiences: all users, authenticated only, unauthenticated only, admin only, or staff only. Path patterns allow page-specific notifications (e.g., only show on /dashboard). Priority system ensures most important notifications display first.", category: "added" },
      { icon: Timer, label: "Scheduled Notifications", desc: "Set start and end dates for notifications. Notifications automatically appear when starts_at is reached and disappear after ends_at. Perfect for maintenance windows, limited-time announcements, and scheduled promotions.", category: "added" },
      { icon: Fingerprint, label: "Unique Cookie-Based Dismiss", desc: "Each notification has a unique cookie_id (notif_ + 16 hex chars). Dismissing one notification doesn't affect others. Dismiss duration configurable per notification (hours until cookie expires). Persists across sessions and page refreshes.", category: "added" },
    ],
  },
  {
    version: "1.9.5-patch.1",
    date: "March 9, 2026",
    title: "API v1 routes fixed",
    highlights: false,
    changes: [
      { icon: Wrench, label: "Middleware Routing Fix", desc: "Updated middleware to whitelist /api/v1/scan, /api/v1/history, and /api/version so API clients and docs are no longer redirected to the login page; API handlers continue to validate API keys and enforce rate limits.", category: "fixed" },
    ],
  },
  {
    version: "1.9.5",
    date: "March 7, 2026",
    title: "API v1 Versioning, Developer SDK Support & Finding Types Endpoint",
    highlights: false,
    changes: [
      { icon: Zap, label: "API v1 Versioning", desc: "All API endpoints have been migrated to /api/v1/ for proper versioning. This prepares the codebase for v2.0 which will introduce breaking changes. The version and security-txt endpoints remain unversioned at /api/version and /api/security-txt respectively.", category: "changed" },
      { icon: FileText, label: "New Finding Types Endpoint", desc: "Added GET /api/v1/finding-types endpoint that returns all 110+ security check definitions including id, type, title, category, and severity. This enables SDK developers to programmatically access check metadata for building integrations.", category: "added" },
      { icon: Key, label: "Developer Documentation", desc: "New 'Developers' section in the docs for SDK and package developers. Documents the finding-types endpoint, SDK development guidelines, and links to the official Python SDK (vulnradar-py) currently in development.", category: "added" },
      { icon: Globe, label: "Updated API Documentation", desc: "API docs now reflect the /api/v1/ base URL for all authenticated endpoints. Code examples (curl, JavaScript, Python) updated with correct versioned paths. Version endpoint documented as unversioned.", category: "changed" },
      { icon: Shield, label: "Scanner Engine v2.0.0", desc: "checks-data.json version bumped to 2.0.0 to align with the scanner engine version. All check definitions and scanner components now share the same version number.", category: "changed" },
    ],
  },
  {
    version: "1.9.4-patch.1",
    date: "February 28, 2026",
    title: "API Key Encryption Fix, Stronger Key Entropy & Validation Overhaul",
    highlights: false,
    changes: [
      { icon: Lock, label: "Fixed Encrypted Key Validation", desc: "Fixed a critical bug where API keys stored with AES-256-GCM encryption could not be validated. The previous implementation incorrectly attempted to compare re-encrypted ciphertexts, which always differ due to random IVs. Validation now decrypts stored keys and compares plaintext values, with automatic fallback to hash-based lookup for legacy keys.", category: "security" },
      { icon: Key, label: "Increased API Key Entropy", desc: "API key generation upgraded from 24 random bytes (48 hex characters) to 32 random bytes (64 hex characters), significantly increasing key entropy and resistance to brute-force attacks.", category: "security" },
      { icon: Shield, label: "Longer Deprecated Placeholders", desc: "Deprecated placeholder strings in key_hash column upgraded from 16 random letters to 48 random bytes (96 hex characters). Placeholders are now generated using cryptographically secure randomBytes instead of Math.random(), and are fully random hex strings.", category: "security" },
      { icon: Fingerprint, label: "Decrypt-and-Compare Validation", desc: "API key validation when encryption is configured now iterates all stored encrypted keys, decrypts each one, and compares against the provided key. Gracefully handles decryption failures per-key and falls back to hash-based lookup for backward compatibility with pre-encryption keys.", category: "changed" },
      { icon: Zap, label: "Zero Breaking Changes", desc: "Fully backward compatible with existing API keys and installations. No database migrations required. Endpoints that accept API keys (/api/scan, etc.) work seamlessly with both encrypted and hash-stored keys without any client-side changes.", category: "changed" },
    ],
  },
  {
    version: "1.9.4",
    date: "February 26, 2026",
    title: "UI Consistency, Docker Build-Time Vars, Discord Giveaway & Encryption-First API Keys",
    highlights: false,
    changes: [
      { icon: Palette, label: "Unified Landing & Dashboard Fonts", desc: "Fixed landing page header font inconsistency. Landing page header now uses the same sans-serif font (font-sans) as the dashboard, ensuring consistent typography across all pages.", category: "fixed" },
      { icon: Container, label: "Docker Build-Time Environment Variable Support", desc: "Fixed Docker CAPTCHA integration by implementing proper build-time argument passing. Dockerfile now accepts ARG directives for NEXT_PUBLIC_APP_URL and NEXT_PUBLIC_TURNSTILE_SITE_KEY. These are converted to ENV during build so Next.js embeds them into the client bundle. Turnstile keys are now properly available in Docker containers.", category: "fixed" },
      { icon: Heart, label: "Discord Giveaway Notification", desc: "Added prominent giveaway notification for 3 months FREE VulnRadar Elite Supporter tier. Notification displays in the bell icon for all users, refreshes every 24 hours, and ends automatically on March 12. Direct link to Discord server for contest entry.", category: "added" },
      { icon: Key, label: "Encryption-First API Key Storage", desc: "Implemented encryption-first storage strategy for API keys. When API_KEY_ENCRYPTION_KEY is configured, keys are now stored ONLY encrypted (no hash). Only the encrypted key is persisted in the database. Falls back to hash-only for deployments without encryption configured.", category: "security" },
      { icon: Lock, label: "Hash-Based Fallback & Conditional Lookup", desc: "When API_KEY_ENCRYPTION_KEY is not configured, keys fall back to SHA-256 hash-only storage for O(1) lookup performance. API key validation automatically adapts based on encryption configuration without breaking existing deployments.", category: "changed" },
    ],
  },
  {
    version: "1.9.3",
    date: "February 24, 2026",
    title: "Admin Version Monitoring & Enhanced Admin Controls",
    highlights: false,
    changes: [
      { icon: Bell, label: "Automatic Admin Version Monitoring", desc: "Admins now automatically receive version update notifications via the notification bell without visiting the admin page. Behind version: check every 24 hours with 'Update Available' alert. Current version: check weekly. Ahead of version: check weekly (early access). Removed manual version check UI from admin dashboard.", category: "added" },
      { icon: Shield, label: "Intelligent Notification Frequency", desc: "Version monitoring adapts based on deployment state. Behind versions trigger urgent 24-hour reminders with a direct link to changelog. Current and ahead versions check weekly for awareness. Each notification state is tracked with local storage to avoid redundant alerts.", category: "added" },
      { icon: Settings, label: "Extended Admin Management Options", desc: "Added comprehensive admin controls for managing users, teams, security settings, and platform configuration. Admins now have expanded visibility into user activity, API key management, and system health.", category: "added" },
      { icon: Lock, label: "Enhanced Admin Page Security", desc: "All admin operations now enforce proper RBAC (role-based access control) with granular permission checks. Admin audit logging added to track sensitive actions and changes.", category: "security" },
    ],
  },
  {
    version: "1.9.2",
    date: "February 24, 2026",
    title: "Security Hardening, GDPR Compliance & Docker Production Overhaul",
    highlights: false,
    changes: [
      { icon: Lock, label: "Stricter Password Strength Calculator", desc: "Overhauled the password strength scoring system. Added a common password dictionary (120+ passwords), sequential character detection (abc, 123), and repeated character penalties. 'Password' is no longer rated as 'Fair'. Extracted into a shared lib/password-strength.ts used by both signup and reset-password pages.", category: "security" },
      { icon: Key, label: "AES-256-GCM API Key Encryption", desc: "API keys are now encrypted at rest using AES-256-GCM authenticated encryption in addition to the existing SHA-256 hash lookup. A new API_KEY_ENCRYPTION_KEY environment variable (32-byte hex) enables application-level encryption for secure key storage and admin recovery. The hash is kept for O(1) validation performance.", category: "security" },
      { icon: Globe, label: "Expanded Fix Examples for 8 Security Checks", desc: "Every major header security check (HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, Server Disclosure, CORS) now includes fix examples for Nginx, Apache, Caddy, Express (Node.js), Deno (Hono), and Bun (Elysia) in addition to Next.js.", category: "added" },
      { icon: Container, label: "Docker Production Overhaul", desc: "docker-compose.yml now uses the pre-built ghcr.io/vulnradar/vulnradar:latest image by default - no local build required. Added health checks, resource limits, log rotation, and restart policies. A separate docker-compose.dev.yml override enables build-from-source for development. Updated setup docs accordingly.", category: "changed" },
      { icon: ShieldCheck, label: "GDPR Compliance & Data Request Links", desc: "Added a dedicated GDPR section (Article 15-17 rights) to the Privacy Policy with a direct link to profile data export. 'GDPR / Data Request' link added to both the main footer and the guest footer on public pages. Users in the EU can now easily find how to exercise their data rights.", category: "added" },
      { icon: FileText, label: "Privacy Policy Updates", desc: "Privacy policy now explicitly references GDPR Articles 15-17, explains how to exercise data rights both in-app and via email, and includes a 30-day response commitment for data requests.", category: "changed" },
    ],
  },
  {
    version: "1.9.1",
    date: "February 23, 2026",
    title: "ToS Modal & Header Fixes",
    highlights: false,
    changes: [
      { icon: FileText, label: "ToS modal wording", desc: "ToS modal now clearly notifies users that bypassing the acceptance screen does not waive their legal obligations. Ensures the notice displays reliably across guest and authenticated flows.", category: "changed" },
      { icon: Layout, label: "Centralized Route & API Constants", desc: "Updated header.tsx to fix rendering/auth-state flicker and ensure correct navigation is shown for guests and signed-in users.", category: "fixed" },
    ],
  },
  {
    version: "1.9.0",
    date: "February 23, 2026",
    title: "Auth-Aware Public Pages, Codebase Refactor & Performance",
    highlights: false,
    changes: [
      { icon: Shield, label: "Auth-Aware Public Pages", desc: "Demo, Staff, Legal, and Shared pages now detect whether the viewer is logged in. Authenticated users see the full Header with navigation and Footer. Guests see a minimal branded header with a Sign In button and compact legal footer. All four layouts share a single reusable PublicPageShell component.", category: "added" },
      { icon: Layout, label: "Centralized Route & API Constants", desc: "Added ROUTES (25 routes), API (30+ endpoints), ROLE_BADGE_STYLES, and STAFF_ROLES constants to lib/constants.ts. High-traffic shared components (Header, Footer, middleware, AuthProvider, public-page-shell, public-paths) now reference constants instead of hardcoded strings.", category: "changed" },
      { icon: Wrench, label: "Role Badge Deduplication", desc: "Consolidated 4 separate copies of role badge styling logic in the admin page into a single ROLE_BADGE_STYLES map. Staff, Shared, and Teams pages also use the centralized badge map, ensuring consistent colors for Admin, Moderator, Support, and Beta Tester badges across the entire app.", category: "changed" },
      { icon: Zap, label: "Dynamic Imports for Heavy Components", desc: "Added next/dynamic lazy loading for 7 below-the-fold components on the Dashboard (IssueDetail, ExportButton, ShareButton, ResponseHeaders, SubdomainDiscovery, CrawlUrlSelector, OnboardingTour) and ImageCropDialog on the Profile page. Reduces initial JavaScript bundle size.", category: "performance" },
      { icon: Lock, label: "Auth Flow UI Standardization", desc: "Forgot Password and Reset Password pages redesigned to match the Login/Signup card pattern: max-w-sm card, logo + app name header, consistent error alerts using semantic destructive tokens, and password strength indicator on reset. All auth pages now use APP_NAME instead of hardcoded strings.", category: "changed" },
      { icon: Globe, label: "Landing Page Refresh", desc: "Fixed favicon reference (png to svg), added Demo CTA in hero and navigation, alternated section backgrounds for visual rhythm, added text-balance/text-pretty to headings, and updated stats section with accurate product information.", category: "changed" },
      { icon: Trash2, label: "Dead Code Removal", desc: "Removed the unused VersionNotification component (superseded by the Notification Center bell). Removed duplicate STAFF_BADGE_COLORS constant from Teams page in favor of centralized ROLE_BADGE_STYLES.", category: "changed" },
      { icon: Eye, label: "Accessibility Improvements", desc: "Added aria-labels to all icon-only buttons in Teams page (save, cancel, remove member, close panel). Wrapped Footer link grid in a nav landmark with aria-label. Added loading='lazy' to avatar images in Admin, Staff, and Teams pages.", category: "changed" },
      { icon: Link2, label: "Semantic Navigation in PublicPageShell", desc: "Replaced all button + router.push() patterns with proper next/link Link components in the public page shell for better SEO, accessibility, and browser navigation behavior. Added copyright line to guest footer.", category: "changed" },
    ],
  },
  {
    version: "1.8.0",
    date: "February 21, 2026",
    title: "Email 2FA, Expanded Notifications & 55+ New Security Checks",
    highlights: false,
    changes: [
      { icon: Mail, label: "Email-Based Two-Factor Authentication", desc: "New 2FA method that sends a 6-digit verification code to your email on every login. Enable it from the Security tab in your profile. Choose between Authenticator App or Email 2FA (one at a time). Codes expire after 10 minutes with rate limiting to prevent abuse.", category: "added" },
      { icon: BellRing, label: "18 Granular Notification Preferences", desc: "Notification settings expanded from 5 toggles to 18, organized into 5 categories: Security (login alerts, password changes, 2FA changes, session alerts), Scanning (scan complete, failures, severity alerts, schedules), API & Integrations (API keys, usage alerts, webhooks, webhook failures), Account (data exports, account changes, team invites), and Product (updates, tips & guides). Each notification type can be individually toggled.", category: "added" },
      { icon: Target, label: "Accurate Notification Routing", desc: "All email notifications now route through the correct preference type. Password change emails respect the password_changes toggle, 2FA emails respect two_factor_changes, account updates respect account_changes. Previously all security-adjacent emails used a single generic security type.", category: "fixed" },
      { icon: Radar, label: "55+ New Security Checks (175+ Total)", desc: "Expanded detection engine to 175+ checks including: header information leaks (X-Powered-By, X-Runtime, X-Debug, Via, X-Backend-Server, ETag inode leaks), advanced CSP analysis (unsafe-inline without nonce, unsafe-eval, wildcard sources, data: URIs), CORS policy validation (null origin, excessive header exposure, preflight caching), referrer policy analysis, server error detection (SQL, PHP, ASP.NET, Django, Laravel), secrets exposure (JWT tokens, private keys, connection strings, .env files, .git directories), and content security (missing iframe sandbox, unencrypted WebSocket, mixed-content forms, inline event handlers).", category: "added" },
      { icon: Bell, label: "Notification Bell in Header", desc: "Replaced full-screen notification modal with a compact bell icon in the header showing unread count. Notifications (version updates, Discord invites) appear in a dismissible dropdown. Backup codes modal remains separate and always interrupts as a full-screen overlay for security-critical updates.", category: "changed" },
      { icon: Filter, label: "Scanner Category Selector", desc: "Added 'Select Scanners' button next to Scan button to choose which security categories to run: Security Headers, SSL/TLS, Cookie Security, Content Analysis, Info Disclosure, Configuration, and DNS & Email. Reduces scan time and allows targeted security assessments.", category: "added" },
      { icon: Zap, label: "Major Performance Improvements", desc: "Fixed admin tab and notification bell from triggering API calls on every page navigation. Moved /api/auth/me to app-level SWR with 5-minute deduping via new AuthProvider context, eliminating duplicate requests and page load freeze. Header now renders instantly with cached auth state.", category: "performance" },
      { icon: Bug, label: "Fixed /shared Page Auth Detection", desc: "Shared scan links now detect if the viewer is logged in. Authenticated users see the full Header with navigation and the standard Footer. Guests see a minimal header with Sign In button.", category: "fixed" },
      { icon: ShieldAlert, label: "Engine Version 2.0.0", desc: "Detection engine bumped to v2.0.0 reflecting the massive expansion of security checks, improved categorization, and scanner selector feature.", category: "changed" },
    ],
  },
  {
    version: "1.7.4",
    date: "February 19, 2026",
    title: "Docker Production Ready, Mobile UX Overhaul & Error Pages",
    highlights: false,
    changes: [
      { icon: Container, label: "Docker Production Ready", desc: "Fixed Dockerfile with a dummy DATABASE_URL during build so Next.js compiles without a live database. Real credentials are injected at runtime via Docker Compose. Updated docker-compose.yml to pass through all env vars (SMTP, Turnstile, contact email). Added Docker Compose overrides to .env.example.", category: "fixed" },
      { icon: Menu, label: "Mobile Menu Overlay", desc: "Replaced the push-down mobile navigation dropdown with a Sheet overlay that slides in from the right. No longer pushes page content down when opened.", category: "changed" },
      { icon: Smartphone, label: "Icon-Only Buttons on Mobile", desc: "Buttons with icon + text (View Scans, Invite, Delete Team, Export, Share, Copy Link, Revoke, Clear All, etc.) now show only icons on mobile and full text on desktop across all pages: teams, history, dashboard, badge, and scanner components.", category: "changed" },
      { icon: Pencil, label: "Editable Team Names", desc: "Team owners and admins can now rename teams inline with a pencil icon, input field, and save/cancel controls. Added a PATCH endpoint to /api/teams.", category: "added" },
      { icon: Image, label: "Team Member Avatars", desc: "Team member rows now display profile pictures when available, with a fallback to the initial letter avatar. The members API now returns avatar_url from the users table.", category: "added" },
      { icon: ServerCrash, label: "Custom Error Page", desc: "Added a styled 500 error page with a grid background, terminal-style error digest block, copy-to-clipboard, and navigation links. Matches the existing 404 page design.", category: "added" },
    ],
  },
  {
    version: "1.7.3",
    date: "February 19, 2026",
    title: "Unified Footer, Contact Upgrades & Error Pages",
    highlights: false,
    changes: [
      { icon: Globe, label: "Version Check via GitHub Releases", desc: "The startup version check and /api/version endpoint now use the GitHub Releases API instead of fetching raw package.json. Console output now shows a direct link to the specific release tag when an update is available.", category: "changed" },
      { icon: Layout, label: "Unified Footer Across All Pages", desc: "Replaced all inline footers (landing page, docs layout, etc.) with a shared Footer component featuring a 5-column grid layout with Product, Resources, Legal sections, a donate button, and social links.", category: "changed" },
      { icon: Mail, label: "Contact Email Auto-Fill", desc: "The contact page now auto-fills and locks the email field for logged-in users. Name is also auto-filled but remains editable.", category: "added" },
      { icon: Users, label: "Staff Application via Contact Form", desc: "Added an 'Apply for Staff' category to the contact form with Support and Moderator roles. Includes a role dropdown, required Discord username, availability field, and a volunteer notice explaining positions are unpaid and voluntary.", category: "added" },
      { icon: ServerCrash, label: "Error Pages", desc: "Added proper error pages: a client-side error boundary (500) with retry and support links, and a global-error fallback for fatal layout crashes with inline styles.", category: "added" },
    ],
  },
  {
    version: "1.7.2",
    date: "February 19, 2026",
    title: "Self-Hosted Schema & Stability Fixes",
    highlights: false,
    changes: [
      { icon: Database, label: "Scan History Save Fix", desc: "Fixed scans not saving to history. The INSERT query referenced a non-existent 'scan_notes' column instead of the correct 'notes' column, causing every save to silently fail. Affected the quick scan, deep crawl, and bulk scan routes.", category: "fixed" },
      { icon: Bug, label: "Bulk Scan Notes", desc: "Bulk scan results now include the default scan note (version + engine info) in the database, matching the behavior of quick scan and deep crawl.", category: "fixed" },
      { icon: Wrench, label: "Silent Catch Logging", desc: "Added console.error logging to previously silent catch blocks in the scan, crawl, and bulk routes. DB failures during history saves are now logged to the server console instead of being swallowed.", category: "fixed" },
      { icon: Shield, label: "Notification Preferences Cleanup", desc: "Removed phantom notification preference columns that were referenced in API code but never existed in the schema. All notification routes, lib, and schema are now in sync.", category: "fixed" },
      { icon: FileSearch, label: "Docs Column Name Fixes", desc: "Fixed documentation examples referencing non-existent columns: 'username' corrected to 'name' in the setup verification SQL, version numbers updated across all docs.", category: "fixed" },
    ],
  },
  {
    version: "1.7.1",
    date: "February 19, 2026",
    title: "Migration Tool Improvements & Documentation Overhaul",
    highlights: false,
    changes: [
      { icon: GitMerge, label: "Table & Column Rename Detection", desc: "The migration tool now detects renamed tables and columns between versions. When an old name exists in the DB but the new name is expected, it offers to rename it in-place (preserving all data). Rename mappings are defined at the top of migrate.mjs for easy maintenance.", category: "added" },
      { icon: Database, label: "Smarter Migration Prompts", desc: "Review prompts (non-destructive) now default to Yes (Y/n), while destructive actions (dropping columns/tables) still default to No (y/N). Every action requires explicit confirmation, and table drops require double confirmation.", category: "changed" },
      { icon: Bug, label: "Migration Parser Rewrite", desc: "Completely rewrote the schema parser from a fragile regex approach to a line-by-line state machine. Correctly handles DEFAULT NOW(), REFERENCES, nested parentheses, and all SQL types. No more false 'extra column' reports for created_at.", category: "fixed" },
      { icon: FileSearch, label: "Extra Table Detection", desc: "Tables in the database that aren't part of the VulnRadar schema are now flagged as EXTRA TABLE with row counts, and can be selectively dropped. Includes a recommendation to use a dedicated database.", category: "added" },
      { icon: Wrench, label: "Documentation Overhaul", desc: "Fully updated the Setup and API docs: added Deep Crawl, Crawl Discover, and Version Check endpoints. Setup docs now cover auto-schema via instrumentation.ts, the migration tool, version checking, correct env vars, and accurate table names.", category: "changed" },
      { icon: ServerCog, label: "Startup Version Check", desc: "Self-hosted instances now log the running version and check GitHub for updates on every server startup. Shows colored messages: green if current, yellow with release link if behind, and a fun message if somehow ahead.", category: "added" },
      { icon: Shield, label: "Exact Hostname Crawl Fix", desc: "Fixed the crawler following links to subdomains (e.g. r.agg.moe when scanning agg.moe). Now uses exact hostname matching instead of registered domain matching.", category: "fixed" },
    ],
  },
  {
    version: "1.7.0",
    date: "February 18, 2026",
    title: "Deep Crawl URL Selector, IP Rate-Limited Demo & Auto Scan Notes",
    highlights: false,
    changes: [
      { icon: Network, label: "Deep Crawl URL Selector", desc: "Deep Crawl now discovers pages first, then shows a selection modal where you pick exactly which pages to scan. Toggle individual URLs on/off, search/filter the list, or use Select All/Deselect All. No more scanning pages you don't care about.", category: "added" },
      { icon: Filter, label: "Smart Crawl URL Filtering", desc: "The crawler now filters out asset files (.css, .js, .woff, .json, etc.), internal framework paths (/_next/, /static/, /api/), and garbage URLs with encoded characters or regex-like patterns. Only real, human-navigable pages are discovered.", category: "added" },
      { icon: Globe, label: "Same-Domain Redirect Handling", desc: "Sites that redirect (e.g. disutils.com to disutils.com/en/home) are now followed correctly. The crawler checks registered domains instead of strict origins, so language-prefixed redirects and www variants are all crawled properly.", category: "fixed" },
      { icon: Layers, label: "Crawl Results Separated by Page", desc: "Deep Crawl results now show findings for the URL you entered as the main view. Other crawled pages appear in a collapsible 'Also Crawled' section below the summary, each expandable to view their individual findings.", category: "changed" },
      { icon: Shield, label: "IP-Based Demo Rate Limiting", desc: "The demo scanner now rate-limits by IP address via the database instead of cookies. 5 scans per 12 hours per IP. No more bypassing limits by clearing cookies.", category: "security" },
      { icon: FileText, label: "Auto Scan Notes", desc: "Every scan automatically gets a default note with the VulnRadar version and Detection Engine version (e.g. 'VulnRadar v1.7.0 (Detection Engine v1.5.0)'). Notes are saved to the DB immediately and appear on shared scans.", category: "added" },
      { icon: Link2, label: "Full URL Display in History", desc: "History and Compare pages now show the full URL path (e.g. example.com/docs/api) instead of just the hostname. Compare is restricted to scans from the same domain.", category: "changed" },
      { icon: Lock, label: "Demo Subdomain Auth Message", desc: "The Subdomain Discovery button on the demo page now shows a friendly 'Log in to use this feature' message instead of a generic error when unauthenticated users try to use it.", category: "changed" },
      { icon: Wrench, label: "Code Cleanup", desc: "Removed all em-dash patterns from comments and user-visible text across 14 files. Replaced with colons, commas, and parentheses for cleaner copy.", category: "changed" },
    ],
  },
  {
    version: "1.6.8",
    date: "February 16, 2026",
    title: "Metadata & Social Preview Fixes",
    highlights: false,
    changes: [
      { icon: Sparkles, label: "Page Metadata Fixed", desc: "Resolved an issue where page metadata (title, description, Open Graph and Twitter card tags) sometimes failed to render; social previews and browser titles now display correct content and consistent VulnRadar branding.", category: "fixed" },
      { icon: Newspaper, label: "Consistent OG Images", desc: "Fixed generation and serving of Open Graph images so link previews show the branded VulnRadar image across Discord, Twitter, and other platforms.", category: "fixed" },
      { icon: CheckCircle, label: "Canonical & Meta Tags", desc: "Canonical links and meta description are now consistent site-wide; metadata no longer mismatches between server and client renders.", category: "fixed" },
    ],
  },
  {
    version: "1.6.7",
    date: "February 16, 2026",
    title: "Scan Notes Visibility & Team Collaboration",
    highlights: false,
    changes: [
      { icon: Eye, label: "Notes Visible to Team Members", desc: "Scan notes are now visible to all team members viewing a scan in the history page. Previously, the entire notes section was hidden unless you were the scan owner. Team members can now see notes to stay informed about scan context, known false positives, and remediation progress.", category: "added" },
      { icon: Lock, label: "Owner-Only Edit Permissions", desc: "Only the original scan owner can add or edit notes. Team members see a read-only view with no edit/add buttons. The backend PATCH endpoint was already restricted to the owner via WHERE user_id, so this enforces the same rule on the frontend.", category: "changed" },
      { icon: Share2, label: "Notes on Shared Scans", desc: "Shared scan links now include notes in the API response and render them read-only on the shared scan page. Anyone with a share link can see the scan owner's notes, giving external reviewers full context about the scan findings.", category: "added" },
      { icon: MessageSquare, label: "Empty State Messaging", desc: "Non-owners now see 'No notes for this scan.' instead of the owner-facing 'Click Add Note to annotate this scan.' prompt, making it clear that only the scan creator can add notes.", category: "changed" },
    ],
  },
  {
    version: "1.6.6",
    date: "February 15, 2026",
    title: "Subdomain Discovery Depth & Deep Scan Prefix",
    highlights: false,
    changes: [
      { icon: Search, label: "Increased Subdomain Discovery Depth", desc: "Subdomain Discovery now fetches up to 150 subdomains per domain (up from 25), providing more comprehensive reconnaissance for larger targets.", category: "changed" },
      { icon: ScanSearch, label: "Deep Scan URL Prefix", desc: "Quick Scan and Deep Scan now show up to 8 characters of URL path prefix (after the hostname) in scanner UI and history, making it easier to identify exact pages scanned.", category: "changed" },
    ],
  },
  {
    version: "1.6.5",
    date: "February 15, 2026",
    title: "Scan Depth & Performance Improvements",
    highlights: false,
    changes: [
      { icon: Gauge, label: "Deeper Crawl Limit", desc: "Deep Scan now crawls up to 15 pages (up from 10), providing more thorough website coverage for vulnerability detection.", category: "changed" },
      { icon: Zap, label: "Parallel Fetch with Concurrency Limit", desc: "Crawler now fetches pages in parallel batches of 3 with a 1-second delay between batches, significantly speeding up deep scans while respecting server rate limits.", category: "performance" },
      { icon: Timer, label: "Consistent Fetch Timeout", desc: "All HTTP requests now use a consistent 10-second timeout (previously varied between 8-15s), improving scan reliability and predictability.", category: "changed" },
    ],
  },
  {
    version: "1.6.4",
    date: "February 14, 2026",
    title: "Subdomain Discovery & Real-Time Progress",
    highlights: false,
    changes: [
      { icon: Globe, label: "Subdomain Discovery", desc: "New 'Discover Subdomains' feature on the dashboard. Leverages crt.sh certificate transparency logs to find subdomains for any target domain. Results show subdomain names with one-click scanning.", category: "added" },
      { icon: Activity, label: "Real-Time Scan Progress", desc: "Scan progress indicator now shows current step (Fetching, Analyzing Headers, Checking Cookies, etc.) in real-time, giving users visibility into what the scanner is doing.", category: "added" },
      { icon: Crosshair, label: "Accurate Progress Tracking", desc: "Progress bar now accurately reflects completion based on actual scanner phases rather than arbitrary timing, improving user confidence during longer scans.", category: "changed" },
    ],
  },
  {
    version: "1.6.3",
    date: "February 14, 2026",
    title: "Scanner Category Visualization",
    highlights: false,
    changes: [
      { icon: Columns3, label: "Category Breakdown Chart", desc: "Scan results now include a visual breakdown showing findings by category (Headers, Cookies, SSL, Content, etc.) using a stacked progress bar with tooltips for each category count.", category: "added" },
      { icon: Filter, label: "Category Filtering", desc: "Click on any category in the breakdown chart to filter the findings list to only show vulnerabilities in that category. Click again to show all.", category: "added" },
    ],
  },
  {
    version: "1.6.2",
    date: "February 13, 2026",
    title: "Expanded Security Coverage",
    highlights: false,
    changes: [
      { icon: ShieldAlert, label: "15+ New Security Checks", desc: "Added checks for outdated SSL protocols (SSLv3, TLS 1.0, TLS 1.1), weak cipher suites, missing OCSP stapling, short certificate validity, CT log presence, and several new header validations.", category: "added" },
      { icon: AlertTriangle, label: "Improved Severity Ratings", desc: "Refined severity classifications based on real-world exploitability. Info-level findings separated from actual vulnerabilities for cleaner reporting.", category: "changed" },
    ],
  },
  {
    version: "1.6.1",
    date: "February 12, 2026",
    title: "Export & Sharing Enhancements",
    highlights: false,
    changes: [
      { icon: FileDown, label: "CSV Export", desc: "Export scan results to CSV format for spreadsheet analysis and integration with other security tools.", category: "added" },
      { icon: FileSpreadsheet, label: "Enhanced PDF Reports", desc: "PDF exports now include executive summary section, category breakdown charts, and cleaner formatting for client-ready reports.", category: "changed" },
    ],
  },
  {
    version: "1.6.0",
    date: "February 11, 2026",
    title: "Deep Crawl Scanning",
    highlights: false,
    changes: [
      { icon: Network, label: "Deep Crawl Mode", desc: "New scanning mode that automatically discovers and scans linked pages on a website. Crawls up to 10 pages deep following same-origin links.", category: "added" },
      { icon: Layers, label: "Aggregated Findings", desc: "Deep Crawl results aggregate findings across all crawled pages with deduplication, showing which vulnerabilities appear on multiple pages.", category: "added" },
      { icon: Link2, label: "Link Discovery", desc: "Scanner now extracts and validates internal links from HTML content, building a site map for comprehensive coverage.", category: "added" },
    ],
  },
  {
    version: "1.5.0",
    date: "February 10, 2026",
    title: "Scheduled Scanning & Bulk Operations",
    highlights: false,
    changes: [
      { icon: RefreshCw, label: "Scheduled Scans", desc: "Set up recurring scans on daily, weekly, or monthly intervals. Receive email notifications when scheduled scans complete with summary of changes since last scan.", category: "added" },
      { icon: List, label: "Bulk Scanning", desc: "Scan up to 10 URLs simultaneously with a single click. Results are grouped and can be compared side-by-side.", category: "added" },
      { icon: Tag, label: "Scan Tags", desc: "Organize scans with custom tags for easy filtering and grouping in history.", category: "added" },
    ],
  },
  {
    version: "1.4.0",
    date: "February 10, 2026",
    title: "Team Collaboration",
    highlights: false,
    changes: [
      { icon: Users, label: "Teams & Organizations", desc: "Create teams, invite members via email, and collaborate on security scans. Team members can view shared scan history and results.", category: "added" },
      { icon: UserCheck, label: "Role-Based Access", desc: "Assign Owner, Admin, or Viewer roles to team members with appropriate permissions for each level.", category: "added" },
      { icon: Mail, label: "Team Invitations", desc: "Branded email invitations with secure one-click acceptance flow.", category: "added" },
    ],
  },
  {
    version: "1.3.0",
    date: "February 9, 2026",
    title: "API Access & Webhooks",
    highlights: false,
    changes: [
      { icon: Key, label: "API Keys", desc: "Generate API keys for programmatic scanning. Use the REST API to integrate VulnRadar into your CI/CD pipeline or custom tools.", category: "added" },
      { icon: Zap, label: "Webhooks", desc: "Configure webhooks to receive scan results via Discord, Slack, or generic HTTP endpoints. Real-time notifications when scans complete.", category: "added" },
      { icon: Gauge, label: "Rate Limiting", desc: "API rate limiting based on subscription tier with clear headers indicating remaining quota.", category: "added" },
    ],
  },
  {
    version: "1.2.0",
    date: "February 9, 2026",
    title: "Comparison & History",
    highlights: false,
    changes: [
      { icon: Eye, label: "Scan Comparison", desc: "Compare any two scans side-by-side to see what changed between assessments. Highlights new, resolved, and unchanged findings.", category: "added" },
      { icon: RefreshCw, label: "Full Scan History", desc: "Complete history of all scans with search, filtering, and pagination. Never lose a scan result again.", category: "added" },
      { icon: Share2, label: "Shareable Links", desc: "Generate public or team-only share links for scan results. Perfect for client reports or team collaboration.", category: "added" },
    ],
  },
  {
    version: "1.1.2",
    date: "February 9, 2026",
    title: "Safety Rating Indicator",
    highlights: false,
    changes: [
      { icon: ShieldCheck, label: "Website Safety Rating", desc: "Scan reports now prominently display a safety indicator (Safe to View / View with Caution / Not Safe to View) based on vulnerability severity. This helps non-technical users quickly understand if a website is safe to browse.", category: "added" },
      { icon: Eye, label: "PDF Report Safety Rating", desc: "Exported PDF reports now include the safety rating section, making it easy to share security assessments with clients and stakeholders.", category: "added" },
    ],
  },
  {
    version: "1.1.1",
    date: "February 9, 2026",
    title: "Metadata & Branding Polish",
    highlights: false,
    changes: [
      { icon: Sparkles, label: "Consistent Social Cards", desc: "All pages now display unified OpenGraph metadata with consistent VulnRadar branding when shared on Discord, Twitter, or other social platforms.", category: "changed" },
      { icon: Eye, label: "Unified Page Titles", desc: `Browser tabs now show ${APP_NAME} consistently across all pages for cleaner branding and better recognition.`, category: "changed" },
      { icon: Shield, label: "Enhanced Security Headers", desc: "Improved Content Security Policy configuration to allow Cloudflare Turnstile while maintaining strong security protections.", category: "security" },
    ],
  },
  {
    version: "1.1.0",
    date: "February 9, 2026",
    title: "Contact System & UI Enhancements",
    highlights: false,
    changes: [
      { icon: MessageSquare, label: "Enhanced Contact Form", desc: "Redesigned contact page with category selection (Bug Report, Feature Request, Security Issue, General Help) and instant email delivery without blocking the UI.", category: "added" },
      { icon: Shield, label: "CAPTCHA Protection", desc: "Integrated Cloudflare Turnstile to prevent spam and bot submissions on the contact form while maintaining a seamless user experience.", category: "security" },
      { icon: Users, label: "Team Collaboration", desc: "Team members can now view each other's scan history and full scan details for better collaboration. Click 'View Scans' next to any team member to see their complete vulnerability scan history and detailed results.", category: "added" },
      { icon: Users, label: "Team Invite Emails", desc: "Team invitations are now sent via email with secure invite links. Invited members receive professional branded emails with team details and one-click acceptance.", category: "added" },
      { icon: Sparkles, label: "Professional Email Templates", desc: "Beautiful dark-themed email templates with gradient accents for contact confirmations, password resets, and team invitations.", category: "added" },
      { icon: Zap, label: "Instant Response Times", desc: "Contact form submissions and password reset requests now respond immediately while emails are sent in the background, dramatically improving user experience.", category: "performance" },
      { icon: Lock, label: "Smart Email Routing", desc: "Contact emails route with proper Reply-To headers and automatic user confirmations for every submission.", category: "changed" },
      { icon: Eye, label: "Improved Scanner UI", desc: "Added 'Scan Another URL' button above results for easier navigation and better user flow.", category: "changed" },
    ],
  },
  {
    version: "1.0.0",
    date: "February 8, 2026",
    title: "First Release",
    highlights: false,
    changes: [
      { icon: Shield, label: "65+ Security Checks", desc: "Comprehensive vulnerability scanning covering HTTP headers, SSL/TLS, content security policies, cookies, server disclosure, DNS, and much more.", category: "added" },
      { icon: Users, label: "User Accounts & Auth", desc: "Full authentication system with sign up, login, profile management, two-factor authentication (TOTP), backup codes, and secure password reset.", category: "added" },
      { icon: Lock, label: "Admin Dashboard", desc: "Admin panel with user management, audit logs, session tracking, and the ability to revoke sessions or API keys.", category: "added" },
      { icon: Zap, label: "Webhooks & Notifications", desc: "Discord, Slack, and generic webhook integrations. Get notified automatically when scans complete.", category: "added" },
      { icon: RefreshCw, label: "Scheduled & Bulk Scanning", desc: "Set up recurring scans on daily, weekly, or monthly intervals. Scan up to 10 URLs at once with bulk scanning.", category: "added" },
      { icon: Eye, label: "Scan Comparison & Sharing", desc: "Side-by-side comparison of scan results over time. Generate shareable links for client reports.", category: "added" },
      { icon: Tag, label: "Scan Tags & History", desc: "Full scan history with search, filtering, and custom tags. Organize scans by project, environment, or client.", category: "added" },
      { icon: List, label: "PDF Export", desc: "Export scan results as professional PDF reports ready for stakeholders.", category: "added" },
      { icon: Users, label: "Teams & Organizations", desc: "Create teams, invite members with role-based access (owner/admin/viewer), and collaborate on security scans.", category: "added" },
      { icon: Gauge, label: "API Keys & Rate Limiting", desc: "Generate API keys for programmatic scanning with built-in rate limiting to prevent abuse.", category: "added" },
      { icon: MessageSquare, label: "Contact & Support", desc: "Dedicated support page for reporting issues, requesting features, or getting help.", category: "added" },
      { icon: Eye, label: "Self-Scan Demo", desc: "Try VulnRadar on itself with a one-click demo scan to see the scanner in action, no account required.", category: "added" },
      { icon: Sparkles, label: "Onboarding Tour", desc: "Interactive walkthrough for first-time users covering all key features.", category: "added" },
      { icon: Newspaper, label: "Documentation", desc: "Full API documentation, usage guides, legal pages, and this changelog.", category: "added" },
    ],
  },
]

function CategoryBadge({ category }: { category?: ChangeCategory }) {
  if (!category) return null
  const { label, color } = CHANGE_CATEGORIES[category]
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${color}`}>
      {label}
    </span>
  )
}

export default function ChangelogPage() {
  const latestVersion = CHANGELOG[0]
  
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 w-full">
        {/* Hero Section */}
        <section className="relative border-b border-border/40 bg-gradient-to-b from-primary/5 via-background to-background">
          <div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--border)/0.3)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border)/0.3)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_110%)]" />
          <div className="relative max-w-4xl mx-auto px-4 py-16 sm:py-24">
            <div className="flex flex-col items-center text-center gap-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/5 text-sm text-muted-foreground">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
                <span className="font-mono text-xs">{TOTAL_CHECKS_LABEL} security checks</span>
              </div>
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground text-balance">
                Changelog
              </h1>
              <p className="text-lg text-muted-foreground max-w-2xl text-balance">
                Follow along as we ship new security checks, features, and improvements. 
                Building the most comprehensive web vulnerability scanner.
              </p>
              <div className="flex flex-col sm:flex-row items-center gap-4 mt-4">
                <Link 
                  href="/dashboard"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
                >
                  Start Scanning
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/docs"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border border-border bg-background hover:bg-accent transition-colors font-medium"
                >
                  View Documentation
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Latest Release Highlight */}
        <section className="border-b border-border/40 bg-card/50">
          <div className="max-w-4xl mx-auto px-4 py-8">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 border border-primary/20">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-muted-foreground">Latest Release</span>
                    <span className="inline-flex items-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                      New
                    </span>
                  </div>
                  <h2 className="text-xl font-bold text-foreground">v{latestVersion.version}</h2>
                </div>
              </div>
              <div className="sm:ml-auto text-sm text-muted-foreground">
                {latestVersion.date}
              </div>
            </div>
            {latestVersion.summary && (
              <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
                {latestVersion.summary}
              </p>
            )}
          </div>
        </section>

        {/* Timeline */}
        <section className="max-w-4xl mx-auto px-4 py-12">
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-6 top-0 bottom-0 w-px bg-gradient-to-b from-primary/50 via-border to-border hidden sm:block" />

            <div className="flex flex-col gap-12">
              {CHANGELOG.map((release, index) => (
                <article key={release.version} className="relative group">
                  {/* Timeline dot */}
                  <div className={`absolute left-[17px] top-1 w-[18px] h-[18px] rounded-full border-2 hidden sm:flex items-center justify-center ${
                    index === 0 
                      ? 'border-primary bg-primary' 
                      : 'border-border bg-background group-hover:border-primary/50'
                  } transition-colors`}>
                    {index === 0 && <div className="w-2 h-2 rounded-full bg-primary-foreground" />}
                  </div>

                  <div className="sm:pl-16 flex flex-col gap-5">
                    {/* Version header */}
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                        <span className={`inline-flex items-center rounded-lg px-3 py-1 text-sm font-bold font-mono ${
                          index === 0 
                            ? 'bg-primary text-primary-foreground' 
                            : 'bg-secondary text-foreground'
                        }`}>
                          v{release.version}
                        </span>
                        <span className="text-sm text-muted-foreground">{release.date}</span>
                        {release.highlights && index === 0 && (
                          <span className="inline-flex items-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                            Latest
                          </span>
                        )}
                      </div>
                      <h2 className="text-xl sm:text-2xl font-bold text-foreground">{release.title}</h2>
                      {release.summary && (
                        <p className="text-sm text-muted-foreground leading-relaxed">{release.summary}</p>
                      )}
                    </div>

                    {/* Changes grid */}
                    <div className="grid gap-3">
                      {release.changes.map((change, changeIndex) => (
                        <div 
                          key={changeIndex} 
                          className="flex gap-4 p-4 rounded-xl border border-border/60 bg-card hover:border-border hover:bg-card/80 transition-colors"
                        >
                          <div className={`flex items-center justify-center w-10 h-10 rounded-lg shrink-0 ${
                            change.category === 'security' ? 'bg-red-500/10' :
                            change.category === 'added' ? 'bg-emerald-500/10' :
                            change.category === 'fixed' ? 'bg-amber-500/10' :
                            change.category === 'performance' ? 'bg-purple-500/10' :
                            'bg-primary/10'
                          }`}>
                            <change.icon className={`h-5 w-5 ${
                              change.category === 'security' ? 'text-red-600 dark:text-red-400' :
                              change.category === 'added' ? 'text-emerald-600 dark:text-emerald-400' :
                              change.category === 'fixed' ? 'text-amber-600 dark:text-amber-400' :
                              change.category === 'performance' ? 'text-purple-600 dark:text-purple-400' :
                              'text-primary'
                            }`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <h3 className="font-semibold text-foreground">{change.label}</h3>
                              <CategoryBadge category={change.category} />
                            </div>
                            <p className="text-sm text-muted-foreground leading-relaxed">{change.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>

          {/* End of timeline */}
          <div className="flex items-center justify-center mt-16">
            <div className="flex items-center gap-4 px-6 py-3 rounded-full border border-border bg-card">
              <div className="w-3 h-3 rounded-full bg-primary/50" />
              <span className="text-sm text-muted-foreground">
                {"That's"} the beginning of {APP_NAME}
              </span>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
