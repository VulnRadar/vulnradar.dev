import { Header } from "@/components/scanner/header";
import { Footer } from "@/components/scanner/footer";
import {
  Zap,
  Shield,
  Lock,
  ShieldCheck,
  ShieldAlert,
  Bell,
  Heart,
  Layout,
  Crown,
  Key,
  BellRing,
  Globe,
  Share2,
  Fingerprint,
  FileText,
  FileSearch,
  FileDown,
  FileSpreadsheet,
  Filter,
  Activity,
  Link2,
  BarChart3,
  Database,
  Timer,
  Palette,
  Wrench,
  Container,
  Settings,
  Trash2,
  Eye,
  Mail,
  Users,
  UserCheck,
  MessageSquare,
  Newspaper,
  Sparkles,
  Network,
  Layers,
  List,
  Tag,
  RefreshCw,
  Gauge,
  Search,
  ScanSearch,
  Columns3,
  AlertTriangle,
  Menu,
  Smartphone,
  Pencil,
  Image,
  ServerCrash,
  ServerCog,
  GitMerge,
  Code,
  Bug,
  Target,
  Radar,
  Crosshair,
  CheckCircle,
  CalendarClock,
  UserCog,
  CheckCircle2,
  Package,
  Server,
  type LucideIcon,
} from "lucide-react";
import { APP_NAME } from "@/lib/config/constants";

// Change categories with colors
const CHANGE_CATEGORIES = {
  added: {
    label: "Added",
    color:
      "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  },
  changed: {
    label: "Changed",
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  },
  fixed: {
    label: "Fixed",
    color:
      "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  },
  security: {
    label: "Security",
    color: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  },
  performance: {
    label: "Performance",
    color:
      "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  },
  deprecated: {
    label: "Deprecated",
    color:
      "bg-neutral-500/10 text-neutral-600 dark:text-neutral-400 border-neutral-500/20",
  },
} as const;

type ChangeCategory = keyof typeof CHANGE_CATEGORIES;

interface Change {
  icon: LucideIcon;
  label: string;
  desc: string;
  category?: ChangeCategory;
}

interface Release {
  version: string;
  date: string;
  title: string;
  highlights: boolean;
  summary?: string;
  changes: Change[];
}

const CHANGELOG: Release[] = [
  {
    version: "3.0.0",
    date: "June 25, 2026",
    title: "Simpler Scanner UX, Service Probes by Hostname, Detection Engine v3",
    highlights: true,
    summary:
      "Major UX rewrite of the scanner. Drop the protocol dropdown — just type a domain. Service probes (SSH, SMTP, IMAP, POP3, FTP, MongoDB) are togglable on the right with per-probe port inputs. Detection Engine bumped to v3.0.0 with cleaner category coverage. URL state for /dashboard is query-param driven (mode, probes). API: send probes: [\"ssh:22\", \"smtp:587\"] in the scan request body.",
    changes: [
      {
        icon: Layout,
        label: "Simpler /dashboard — URL + Right-Side Service Probes",
        desc: "Replaced the protocol dropdown (14 protocols) and scanners popover (12 categories) with a single domain input + a 6-chip service-probe panel. Mode toggle (Quick / Deep / Bulk) is always visible so you can switch out of Bulk back to a single scan. Each probe row has a port input with quick-pick chips for common ports. Web checks (12 categories) always run automatically.",
        category: "changed",
      },
      {
        icon: Server,
        label: "Service Probes by Hostname, Not URL Scheme",
        desc: "Probes open a TCP socket to the target hostname on a user-supplied port. Independent of URL scheme — you can ask \"does github.com also run SSH?\" with `probes: [\"ssh:22\"]` without constructing `ssh://github.com`. Default ports (22, 25, 143, 110, 21, 27017) are used if you omit the port. Each probe emits reachability + version-disclosure findings. Validated against an allowlist to prevent arbitrary port probing.",
        category: "added",
      },
      {
        icon: Link2,
        label: "URL State for /dashboard (mode + probes + ports)",
        desc: "Replaced all hash-based state with query params: /dashboard?mode=deep&probes=ssh:22,smtp:587. State is shareable, browser back/forward works, and the URL reflects the current scanner config. New lib/ui/url-state.ts helper exposes getQueryParam, setQueryParam, useQueryParam, useQueryParamInt with vr:query-change CustomEvent + popstate subscription.",
        category: "added",
      },
      {
        icon: Shield,
        label: "Detection Engine v3.0.0",
        desc: "Detection Engine version bumped 2.4.0 → 3.0.0 alongside the UX rewrite. Same 739 checks, same 12 categories, same severities. No detection regressions — the engine code is unchanged from v2.4.0's false-positive overhaul. The version bump reflects the new scanner UX surface (service probes as a first-class concept) rather than engine internals.",
        category: "changed",
      },
      {
        icon: Code,
        label: "API: `probes` Field on /api/v3/scan",
        desc: "New optional `probes` field on POST /api/v3/scan request body. Array of `\"<service>:<port>\"` strings. Example: `{\"url\": \"example.com\", \"probes\": [\"ssh:22\", \"smtp:587\"]}`. Old `scanners` field still accepted (advanced per-category override). URL normalization: bare hostnames auto-prepended with https://.",
        category: "added",
      },
      {
        icon: Settings,
        label: "Per-Family Check Toggle (12 Categories, Auto-Disable for HTTP)",
        desc: "New \"Check families\" panel in the scan form lets you enable/disable any of the 12 web check families (Headers, SSL, TLS, Cookies, Content, Info, Config, DNS, Email, API, Code, Secrets). When the URL starts with http:// (no TLS), SSL and TLS are auto-disabled but you can re-enable them manually if you want. State syncs to the URL via ?family_ssl=0 etc.",
        category: "added",
      },
      {
        icon: Code,
        label: "API Moved to v3 — v1 and v2 Removed",
        desc: "All endpoints moved from /api/v2/ to /api/v3/. v1 and v2 routes deleted. CONFIG_API_VERSION='v3', CONFIG_API_SUPPORTED_VERSIONS=['v3']. lib/config/constant.ts renamed API_V2 → API_V3 (API_V2 kept as alias for back-compat). All client fetch calls, middleware, public-paths allowlist, and the api-deprecation middleware updated. Docs only describe v3.",
        category: "changed",
      },
      {
        icon: Server,
        label: "Raw IPv4 Targets + Probe-Only Mode",
        desc: "API + scan form accept a public IPv4 literal as the target. Web checks (headers, SSL, TLS, cookies, content, info, configuration, code, secrets, API) are skipped — they need a hostname context — and DNS + email + any opted-in service probes still run. SSRF guards reject private/loopback IPs as before. Scanners UI auto-disables the affected families with a line-through and shows 'Raw IP detected — only DNS + service probes will run.' on the form.",
        category: "added",
      },
      {
        icon: Eye,
        label: "BrowserBase Live Browser Sessions (View Page)",
        desc: "Optional integration with BrowserBase. Set BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID in .env and a 'View Page' button appears on scan results. It opens a 5-minute remote browser session in a popup at /browser/{id} with the iframe view, a live countdown timer, and an End session button. The session auto-ends when the popup closes (no history). TTL hard-clamped to 300s. POST/GET/DELETE /api/v3/browser/sessions documented in the API reference.",
        category: "added",
      },
      {
        icon: Settings,
        label: "Dashboard: Scanners + Probes Split + Compact Controls",
        desc: "Replaced the single 'All Scanners' button with two separate dropdowns — one for check families (12), one for service probes (6). Both fit inline next to the Scan button. Mode toggle, URL input, and buttons all compacted to size='sm' (h-9, text-xs) to match the power-tool aesthetic of the rest of the dashboard.",
        category: "changed",
      },
    ],
  },
  {
    version: "2.3.1",
    date: "June 20, 2026",
    title: "Tooling Hardening, Node 22 LTS, Schema Version Gate",
    highlights: false,
    summary:
      "Stability release. Splits the monolithic db scripts into a version-aware framework (scripts/_lib + scripts/migrate + scripts/create-fresh-db), adds a startup-time schema version gate so apps running against a stale database refuse to boot with a clear red error box, pins the project to Node 22 LTS, and bumps 75 npm packages to their latest within-major versions. No app-facing feature changes; no DB schema changes (2.3.0 and 2.3.1 share the same DDL).",
    changes: [
      {
        icon: GitMerge,
        label: "Scripts Restructured Into Version-Aware Framework",
        desc: "scripts/_lib.mjs, scripts/migrate.mjs, and scripts/create-fresh-db.mjs (3 files, ~1950 lines) are now a clean framework: scripts/_lib/ for shared helpers (9 focused modules), scripts/migrate/ for the version-aware migrator (CLI, registry, planner, runner, detector, meta, 2 version files), scripts/create-fresh-db/ for fresh DB creation with a v1/v2 picker, plus a scripts/README.md. The Python drift detector is gone; replaced with a pure-Node scripts/_lib/audit-v2-tables.mjs registered as 'npm run audit:v2-tables'.",
        category: "changed",
      },
      {
        icon: Shield,
        label: "Schema Version Gate at App Startup",
        desc: "instrumentation.ts now reads vulnradar_schema_meta before doing anything else. If the row is missing or its schema_version is below CONFIG_MIN_SCHEMA_VERSION, the app prints a red-bordered error box to stderr and process.exit(1) with the exact 'npm run db:migrate' or 'npm run db:create' command to fix it. Replaces the old behaviour where stale databases would crash deep inside request handlers with cryptic 'column does not exist' errors.",
        category: "security",
      },
      {
        icon: Database,
        label: "Migration DDL Now Matches instrumentation.ts Exactly",
        desc: "Audited every one of the 15 v2 tables in scripts/migrate/versions/_snippets.mjs against the canonical DDL in instrumentation.ts. 11 of 15 had column mismatches; the worst was staff_activity (the migration was creating an action-log version while the app expected a heartbeat version). 9 orphan tables (RBAC, subscriptions, beta_features) were never implemented in the app and have been removed. Two dead user columns (stripe_subscription_metadata, subscription_source) are gone. npm run audit:v2-tables is a pure-Node drift detector that exits 1 on any future mismatch.",
        category: "fixed",
      },
      {
        icon: Settings,
        label: "Migration Always Runs, Even On Same Version",
        desc: "Same-version re-runs are now an explicit safety net. CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, and CREATE INDEX IF NOT EXISTS are all idempotent, so re-running catches any missed steps (e.g. a manually-edited table, a partial migration, an old codebase that was never properly versioned). The meta row is also re-written on every successful run to keep the app_version field current.",
        category: "changed",
      },
      {
        icon: ServerCog,
        label: "Node 22 LTS Is the New Minimum",
        desc: ".nvmrc + .node-version pin 22, package.json#engines is '>=20.0.0 <21.0.0 || >=22.0.0', and all 4 CI jobs (lint, typecheck, test, build) now use Node 22. Odd versions (21, 23) are explicitly excluded because vitest@4, balanced-match@4, brace-expansion@5, and minimatch@10 all list exactly that set in their engines field. There is no fix on the consumer side. Bug reports on other Node versions will not be investigated.",
        category: "changed",
      },
      {
        icon: Package,
        label: "75 npm Packages Bumped to Latest Within Major",
        desc: "All @radix-ui/*, @types/*, @hookform/resolvers 5.4.0, @neondatabase/serverless 1.1.0, autoprefixer 10.5.0, date-fns 4.4.0, jspdf-autotable 5.0.8, lucide-react 1.21.0, pg 8.22.0, react 19.2.7, react-dom 19.2.7, react-hook-form 7.80.0, react-resizable-panels 4.11.2, stripe 22.2.2, tailwind-merge 3.6.0, zod 4.4.3. Plus 2 major bumps (vite 5→8, vitest 2→4) that landed via dependabot PRs and tested clean.",
        category: "changed",
      },
      {
        icon: Wrench,
        label: ".npmrc Auto-Approves Native Postinstalls",
        desc: "npm 10+ blocks install scripts by default. .npmrc now allow-scripts for bcrypt, esbuild, sharp, unrs-resolver, and core-js so the native postinstalls run automatically on every install. Without these, the app would break at runtime with no esbuild binary or missing sharp. Also sets audit-level=high, fund=false, and update-notifier=false for cleaner CI logs.",
        category: "changed",
      },
      {
        icon: Bug,
        label: "Detection Engine v2.4.0 — False-Positive Overhaul",
        desc: "Detection Engine bumped to v2.4.0 after a major false-positive sweep against vulnradar.dev and sandbox.vulnradar.dev. Removed 25 HTML-body-fallback stub branches in lib/scanner/checks/information-disclosure.ts that fired `verify ...` evidence on every HTML page. Removed 7 generic fallback messages in code.ts (dangerouslySetInnerHTML, localStorage, sessionStorage) that fired on every Next.js page because the framework's bundled JS contains the keywords. Removed 2 Server-Timing content-type fallbacks in configuration.ts. Fixed OG-injection regex bug where `on\\w+=` matched `ontent=` inside `content=` (false-positive on every Next.js page with SVG icons followed by streaming scripts). Fixed vary-origin-missing-cors detector to only fire when Access-Control-Allow-Origin is actually dynamic (was firing on every HTML page without CORS). Fixed weak-crypto regex with word boundaries so `des` inside `description` no longer matches (was firing on every Next.js page). Tightened phone-number-leak regex to require separator chars between digit groups so Cloudflare Ray IDs are not flagged as phone numbers. Tightened code-xss-angular-bypass-dynamic to match only Angular `[innerHTML]` bindings, not React's `dangerouslySetInnerHTML`. Removed duplicate detector implementations: `reverse-tabnabbing` (now consolidated to `target-blank-no-noopener` in headers.ts), `cross-origin-embedder-policy-credentialless-missing` (duplicate of `coep-credentialless`), and 12 other stub JSON entries with no backing detector. Fixed CORP-Report-Only detector (CORP doesn't have a Report-Only variant). Fixed JSON metadata mismatches where titles/evidence didn't match detector output (early-data-header-missing now correctly describes TLS 1.3 0-RTT instead of rate limiting; cf-ray-header now correctly describes CDN request ID; config-file-leaked no longer has inline-style-attr metadata; coep-credentialless-missing, unsafe-target-blank, window-opener-leak all removed). Net effect: vulnradar.dev scan findings 177 → ~70, with all remaining findings backed by real evidence or correctly marked info-level.",
        category: "fixed",
      },
      // ── Second-round security audit (post-release) ────────────────────
      {
        icon: ScanSearch,
        label: "Scanner Detection Engine: 311 → 709 Checks, 12 Categories",
        desc: "Monolithic lib/scanner/checks.ts (2795 lines) + checks-data.json (5447 lines, 311 checks) split into per-category files. New lib/scanner/registry.ts aggregates 12 per-category detector modules + 12 per-category JSON metadata files via a single BUNDLES table. New categories: tls (cert vs URL-level), email (SPF/DMARC), api (REST/GraphQL/OpenAPI/JSONP), code (SAST-style), secrets-extended (focused credential patterns). Final counts: headers 107, content 194, code 127, configuration 48, information-disclosure 33, secrets-extended 54, api 43, email 28, tls 20, dns 23, cookies 22, ssl 10 — 709 unique checks with 0 duplicates. The registry.test.ts pins counts + uniqueness so any drift fails CI.",
        category: "added",
      },
      {
        icon: Network,
        label:
          "9 New Protocols: SSH, SFTP, SMTP, SMTPS, IMAP, IMAPS, POP3, POP3S, MongoDB",
        desc: "New lib/scanner/protocols/banner.ts with grabBanner() + bannerVersion() helpers. /api/v3/scan now dispatches these protocols to a real TCP banner-grab path (was HTTP-only). lib/scanner/protocols/index.ts has 14 protocol configs; lib/scanner/protocols/banner.ts returns a normalised { banner, version } pair regardless of protocol.",
        category: "added",
      },
      {
        icon: Layers,
        label: "Scanner Categories UX: New Icons + Total Count Bumped",
        desc: "components/scanner/scan-form.tsx extended to 12 categories with Cpu, KeyRound, Boxes, MailCheck, Network icons. lib/config/config-values.ts TOTAL_CHECKS_LABEL bumped 310+ → 700+. /api/v3/finding-types now returns {success, count, categories, data} from the new registry (was the monolithic 311-check JSON).",
        category: "changed",
      },
      {
        icon: ShieldAlert,
        label: "stripe/setup-products: Now Requires Admin Session",
        desc: "Was completely unauthenticated — any caller could rewrite the live Stripe catalog. Now gated with getSession() + STAFF_ROLES.ADMIN check. Closes a critical-severity unauthenticated write to billing.",
        category: "security",
      },
      {
        icon: Globe,
        label: "scan/discover SSRF Closed (batchHttpCheck)",
        desc: "batchHttpCheck was doing a raw fetch() on a user-controlled subdomain without validation. Replaced with safeFetch(url, init, [sub]) + validateScanTarget so the URL must resolve to a non-private IP and the subdomain is allow-listed.",
        category: "security",
      },
      {
        icon: Eye,
        label: "Discord OAuth Callback: No More PII in URL",
        desc: "callback/route.ts was forwarding discord_email in the redirect query string → it leaks into Referer headers, browser history, and server access logs. Now dropped. Also replaced 2× request.headers.get('x-forwarded-for')?.split(',')[0] with the proper getClientIp() helper (was XFF-spoofable for log analysis and rate-limit fingerprinting).",
        category: "security",
      },
      {
        icon: Database,
        label:
          "lib/database/db-utils: SQLi in getUserById/updateUser/batchDelete/batchUpdate Closed",
        desc: "getUserById column-list SQLi, updateUser column-name SQLi, and batchDelete/batchUpdate raw SQLi all closed with one consistent pattern: assertIdentifier() regex (^[a-zA-Z_][a-zA-Z0-9_]*$) + USER_UPDATABLE_COLUMNS allowlist + BATCH_ALLOWED_TABLES + BATCH_UPDATABLE_COLUMNS + parseSafeWhere parser that only accepts col = $n AND col = $m predicates. getUserById now takes a UserColumnProjection enum ('full' | 'public' | 'auth') so the column list is hardcoded. updateUser rejects any key not on the allowlist — role, password_hash, totp_secret can no longer be touched from outside the privileged code paths.",
        category: "security",
      },
      {
        icon: Globe,
        label: "safeFetch: Non-Canonical IPv6 Bypass Closed",
        desc: "isPrivateIP regex patterns only matched ::ffff:127. dotted form. Audit found 3 bypass classes: long-expanded 0:0:0:0:0:ffff:127.0.0.1, hex-encoded ::ffff:7f00:1, and RFC 6052 NAT64 64:ff9b::7f00:1. Added toCanonicalIPv6() to normalise any input to 8-group lowercase hex form + ipv4MappedToDotted() to extract and check embedded IPv4 against the IPv4 private ranges. 18 new tests pin canonicalisation for 14 attack variants + 3 public addresses + 4 IPv4 controls. The existing native IPv6 patterns (link-local, ULA, multicast, etc.) still apply to the canonical form.",
        category: "security",
      },
      {
        icon: Timer,
        label: "Discord OAuth State: Bound to userId, TTL 5min → 60s",
        desc: "discord-state.ts: state payload now includes an optional userId; verifyDiscordState() accepts an expectedUserId and rejects mismatches with a new 'user-mismatch' reason. TTL tightened from 5 minutes to 60 seconds to shrink the replay window. A leaked/forwarded state URL can no longer be replayed by a different signed-in user. discord/route.ts (initiator) and discord/callback/route.ts (receiver) updated to thread session.userId through.",
        category: "security",
      },
      {
        icon: Timer,
        label: "Email 2FA Code Consumption: TOCTOU Closed",
        desc: "auth/2fa/verify/route.ts: code was SELECTed, compared, then DELETEd in separate queries — two parallel requests both passed verification before either DELETE ran. Now uses atomic DELETE ... WHERE id = (SELECT id ... LIMIT 1) RETURNING id. Second request gets 0 rows and is rejected. Closes the email 2FA bypass.",
        category: "security",
      },
      {
        icon: Globe,
        label: "Login: Open-Redirect via ?redirect= Closed",
        desc: "app/login/page.tsx: any URL like /login?redirect=https://evil.com would 302 the user there after auth (perfect phishing vector). safeRedirect() helper now strips anything not starting with / and rejects // and /\\ (which would parse as protocol-relative).",
        category: "security",
      },
      {
        icon: RefreshCw,
        label: "Stripe Webhook: Idempotent on Retries",
        desc: "webhooks/stripe/route.ts: a Stripe retry of the same event would re-apply the plan upgrade, double-grant credits, etc. Added processed_stripe_events table (event_id PK, event_type, received_at) — first action of the handler is INSERT ... ON CONFLICT DO NOTHING RETURNING event_id. On conflict returns {received: true, replay: true} and exits. Schema added to instrumentation-v1.ts.",
        category: "fixed",
      },
      {
        icon: Bell,
        label: "Admin Notifications: action_url Scheme-Validated",
        desc: "admin/notifications/route.ts and [id]/route.ts now reject action_url unless it starts with https://, http://, or /. Closes stored XSS via javascript: URLs that admins could enter and other admins would activate by clicking.",
        category: "security",
      },
      {
        icon: Mail,
        label: "Mass Email Preview: HTML Injection Closed",
        desc: "components/admin/features/mass-email-manager.tsx: title and content were interpolated into a preview HTML block without escaping — an admin typing <script> or <iframe> would see it execute in their own browser. Added escapeHtml() and applied to both fields.",
        category: "security",
      },
      {
        icon: Settings,
        label: "env.ts: Stricter Validation at Startup",
        desc: "DATABASE_SSL now uses a BoolString zod schema (was string.optional() — values like '1' or 'yes' would slip through and silently disable SSL). AUTH_SECRET now requires min(32) chars. CONTACT_EMAIL and SUPPORT_EMAIL now validated with .email(). The app refuses to start on weak config instead of running with surprising defaults.",
        category: "security",
      },
      {
        icon: Database,
        label: "DB Pool: statement_timeout + query_timeout + application_name",
        desc: "lib/database/db.ts: pool now has statement_timeout: 30_000, query_timeout: 30_000, application_name: 'vulnradar'. One slow query used to be able to saturate the 10-connection pool; now it gets cancelled at 30s and the connection is returned. application_name appears in pg_stat_activity for easier ops triage.",
        category: "performance",
      },
      {
        icon: Container,
        label: "Dockerfile: Node 20 → Node 22",
        desc: "Both builder and runner stages were node:20-alpine. Node 20 reached end-of-life on 2026-04-30 and is no longer receiving security patches. Bumped to node:22-alpine in both stages. Also removed the placeholder API_KEY_ENCRYPTION_KEY env so the app fails closed at startup if an operator forgets to inject a real 64-char key — better than a silently-broken key vault.",
        category: "changed",
      },
      {
        icon: Package,
        label: "Removed Unused bcrypt, Pinned Caret Deps",
        desc: "bcrypt was in dependencies but never imported — uninstalled (3 packages removed). nodemailer (^9.0.1), eslint (^9.39.4), and eslint-config-next (^15.5.19) had caret prefixes that allowed minor-version drift; pinned to exact. .npmrc no longer allow-scripts for bcrypt or sharp (no longer in the tree).",
        category: "changed",
      },
      {
        icon: Database,
        label: "Database Cleanup: Single Transaction, Always-Released Client",
        desc: "lib/database/cleanup.ts: performDatabaseCleanup() now wraps all 17 deletes in a single BEGIN/COMMIT (READ COMMITTED isolation). A mid-run failure rolls back the whole pass instead of leaving partial state. finally{client.release()} guarantees the connection returns to the pool even on error. schedulePeriodicCleanup now tracks the active timer and clears it on subsequent calls (prevents double-scheduling on hot reload). New stopPeriodicCleanup() export for graceful shutdown.",
        category: "security",
      },
      {
        icon: FileText,
        label: "Test Count: 39 → 65",
        desc: "Added lib/scanner/safe-fetch.test.ts with 18 tests pinning IPv6 canonicalisation behaviour — 14 attack variants (long-expanded, hex-encoded, NAT64, embedded IPv4 in multiple private ranges) all blocked; 3 public IPv6 addresses allowed; 4 IPv4 controls. New registry.test.ts pins category counts and uniqueness for the 709-check split. All 65/65 tests pass.",
        category: "added",
      },
    ],
  },
  {
    version: "2.3.0",
    date: "June 20, 2026",
    title: "Comprehensive Security Patch & Quality Update",
    highlights: true,
    summary:
      "Security-patch release built on a full source audit. Closes every critical and high-severity finding across auth, crypto, sessions, rate-limiting, file uploads, webhooks, and access control; hardens the build/CI pipeline so typecheck and dependency-audit failures block merges; introduces per-route error boundaries, accessible forms, and a complete vitest test suite covering the security-critical code paths. Internals consolidated: single source of truth for constants, plans/products, scanner helpers, and admin role checks; duplicate code paths removed across ~10 admin route files.",
    changes: [
      // ── Critical security fixes (Phase 8C) ─────────────────────────
      {
        icon: Shield,
        label: "Database SSL Now Enforces Certificate Validation",
        desc: "Was rejectUnauthorized: false even when DATABASE_SSL=true, allowing any on-path attacker to MITM the database connection. Now rejectUnauthorized: true with optional DATABASE_SSL_CA override for self-signed certs. This was the single most impactful finding in the audit: every self-hosted deployment that enabled SSL to 'be safe' was in fact MITM-able.",
        category: "security",
      },
      {
        icon: Lock,
        label: "Fixed: Resend-Verification Token Hashing Regression",
        desc: "Was storing the raw token in token_hash while verify-email hashed with sha256, so every resend-generated link was dead AND a future 'fix' would have re-introduced the M-2 vulnerability Phase 8B had closed. Now mirrors the signup route: hash the token with sha256 before insert.",
        category: "fixed",
      },
      {
        icon: ShieldAlert,
        label: "Fixed: 'Log Out All Sessions' Cleared the Wrong Cookie",
        desc: "Was setting a literal 'session' cookie to expire instead of the real session cookie (default vulnradar_session). Server-side sessions were correctly deleted, but the stale browser cookie would re-arrive on the next request. Now uses cookies() with the actual AUTH_SESSION_COOKIE_NAME and wraps the handler with withErrorHandling.",
        category: "fixed",
      },
      {
        icon: Lock,
        label: "Removed All Hardcoded Fallback Secrets",
        desc: "Discord state HMAC and API key locator no longer fall back to global strings in the source. Any deployment missing AUTH_SECRET or API_KEY_ENCRYPTION_KEY now fails fast at startup with a clear error pointing at the missing var. ",
        category: "security",
      },
      {
        icon: ShieldCheck,
        label: "Zod-Validated Environment at Startup",
        desc: "New lib/config/env.ts validates process.env at server boot using a Zod schema. DATABASE_URL, API_KEY_ENCRYPTION_KEY, and NEXT_PUBLIC_APP_URL are required and length-validated. The server refuses to start with a partial config instead of 500ing on every request.",
        category: "security",
      },
      {
        icon: Globe,
        label: "IP Spoofing Fix (TRUSTED_PROXY_CIDR)",
        desc: "getClientIp was reading the leftmost entry of x-forwarded-for, which is trivially spoofable when no proxy is in play. Now honors TRUSTED_PROXY_CIDR: when set, walks the header right-to-left skipping trusted hops and returns the first untrusted IP. Adds IPv4/IPv6 CIDR parser.",
        category: "security",
      },
      {
        icon: Image,
        label: "Avatar Upload Hardening (XSS Prevention)",
        desc: "Was accepting any data:image/* URL including data:image/svg+xml;base64,<SVG with inline script>, ready to render as XSS. New lib/uploads/avatar.ts enforces: MIME allowlist (png/jpeg only, SVG rejected), magic-bytes check against the declared MIME, 5 MiB cap. Empty string and Discord CDN URLs still allowed.",
        category: "security",
      },
      {
        icon: Key,
        label: "Backup Codes Bumped to 80 Bits (NIST 800-63B)",
        desc: "Was randomBytes(4) = 32 bits per code, below NIST/OWASP guidance. Now randomBytes(10) = 80 bits. Code format is XXXXX-XXXXX-XXXXX-XXXXX (20 hex chars) for readability; hash function unchanged so stored backups are compatible after re-generation.",
        category: "security",
      },
      {
        icon: Eye,
        label: "Stripe Webhook No Longer Logs Customer Email",
        desc: "Three console.log sites were emitting customerEmail PII to log aggregators that retain indefinitely. Replaced with userId (already known from the RETURNING clause) and event.id for correlation. PII stays out of log streams.",
        category: "security",
      },
      // ── Accessibility (Phase 8B) ─────────────────────────────────────
      {
        icon: Eye,
        label: "Icon-Only Buttons Get aria-label",
        desc: "~15 icon-only buttons across profile, admin, shares, pricing, login, and signup now have descriptive aria-labels so screen readers announce the action. Toggle buttons (show/hide password, copy state) also get aria-pressed.",
        category: "changed",
      },
      {
        icon: Eye,
        label: "Form Labels Now Bound to Inputs",
        desc: "Across ~15 forms (profile, security, admin, billing, search inputs), every Label component now has a matching htmlFor/id pair on its input. Search inputs with placeholder-only labels got explicit aria-label. Billing code input gained inputMode=numeric and pattern=[0-9]{6} for mobile numeric keyboard.",
        category: "changed",
      },
      {
        icon: Layers,
        label: "ConfirmDialog Migrated to Radix AlertDialog",
        desc: "Hand-rolled div-overlay with no role=dialog, no focus trap, no escape-key handling is now @radix-ui/react-alert-dialog. Focus trap, escape dismissal, and role=alertdialog come for free. The other 6 custom modals (cancel sub, team members, staff, IP rules, gift sub, crawl selector) were given role=dialog + aria-modal + escape + focus management via a new useModalA11y hook without the rewrite risk of a full Radix migration.",
        category: "changed",
      },
      {
        icon: Layers,
        label: "Per-Route Error Boundaries + Loading States",
        desc: "Previously a thrown error on /profile would replace the entire app with the root 500 page. New app/{dashboard,profile,history,admin,shares,teams,pricing,compare}/error.tsx files keep the surrounding chrome intact and show an inline error with a Try Again button. Matching loading.tsx files show a centered spinner with a route-specific label during data fetches. aria-live=polite announces the transition.",
        category: "added",
      },
      // ── Build / CI hardening ───────────────────────────────────────
      {
        icon: Shield,
        label: "Typecheck and npm audit Now Block Merges",
        desc: "CI was running npx tsc --noEmit with continue-on-error: true (typecheck errors were silently ignored) and next.config.mjs had typescript.ignoreBuildErrors: true. Both removed. A new npm audit --audit-level=high --omit=dev step blocks merges on high/critical CVEs. format:check also added to the lint job so prettier drift can no longer slip through.",
        category: "security",
      },
      {
        icon: Settings,
        label: "SECURITY.md Updated to v2.4.x",
        desc: "Previously the supported versions table said 2.2.x / 2.1.x, leaving researchers reporting against an EOL build. Now lists 2.4.x as the supported release. Stale PGP-placeholder block removed.",
        category: "changed",
      },
      // ── Test infrastructure ────────────────────────────────────────
      {
        icon: Code,
        label: "Test Infrastructure: vitest + 39 Tests",
        desc: "Zero tests previously. Now: vitest@2.1.9 + @vitest/coverage-v8 as devDeps, vitest.config.ts with per-folder coverage thresholds (80% lib/auth, 70% lib/rate-limiting, 50% lib/**, 30% app/**), a new test job in CI, and 39 passing tests covering: AES-256-GCM roundtrip + tampered-ciphertext rejection (lib/auth/crypto), Discord HMAC state roundtrip + malformed/expired/wrong-secret rejection (lib/auth/discord-state), scrypt N:r:p:salt:hash format parsing (lib/auth/auth), rate-limit window logic with mocked pg pool (lib/rate-limiting/rate-limit), and 11 avatar-validator cases including the SVG-rejected-XSS case (lib/uploads/avatar).",
        category: "added",
      },
      // ── Refactors & consolidations (Phase 8A) ──────────────────────
      {
        icon: Shield,
        label: "API Key Validation is Now O(1)",
        desc: "Added a key_locator column (indexed HMAC prefix of the raw key). Every API request looks up the key by indexed prefix instead of scanning and decrypting every row. Old keys without a locator are backfilled on first successful match.",
        category: "security",
      },
      {
        icon: Lock,
        label: "Stronger Password Hashing",
        desc: "scrypt cost bumped from the Node default to OWASP 2024+ baseline (N=131072). Hash format now stores the cost so old and new hashes verify correctly. Existing logins keep working.",
        category: "security",
      },
      {
        icon: ShieldCheck,
        label: "Signed Discord OAuth State",
        desc: "Discord OAuth state is now HMAC-signed with a server-side secret and random nonce. Prevents forged callbacks from logging in as any linked Discord user.",
        category: "security",
      },
      {
        icon: Fingerprint,
        label: "Strong Device Trust Cookies",
        desc: "Replaced the brute-forceable 32-bit hash of IP+User-Agent with an opaque 256-bit random token stored server-side in device_trust. Trusted devices are looked up by exact match, not fingerprint.",
        category: "security",
      },
      {
        icon: ShieldAlert,
        label: "Re-authentication for Sensitive Changes",
        desc: "Changing name, email, or avatar now requires the current password (verified against the stored hash). A stolen session cookie alone can no longer take over an account by changing the email.",
        category: "security",
      },
      {
        icon: Timer,
        label: "2FA Rate Limit + Timing-Safe Compare",
        desc: "2FA verify endpoint is now rate-limited per user (5 attempts / 5 min) and uses a constant-time compare on the pending cookie. Closes the brute-force window on 6-digit TOTP codes.",
        category: "security",
      },
      {
        icon: Network,
        label: "SSRF Re-Validation",
        desc: "Webhook test endpoint and schedule creation now re-run URL/SSRF validation before fetching. Blocks private, loopback, and link-local targets even if the URL was inserted via a non-standard code path.",
        category: "security",
      },
      {
        icon: Eye,
        label: "Minimal Staff Endpoint",
        desc: "Public staff page now exposes only display name and role. No avatar URLs, no emails, no seniority ordering that would help target admins for phishing.",
        category: "security",
      },
      {
        icon: Lock,
        label: "Email & Reset Tokens Hashed at Rest",
        desc: "Verification and password-reset tokens are SHA-256 hashed before INSERT. A database dump no longer yields working tokens. Verify routes hash the incoming token with the same function.",
        category: "security",
      },
      {
        icon: Mail,
        label: "No Email Bodies in Logs",
        desc: "Email send failures log only to/subject/length metadata. Bodies can contain reset links, 2FA codes, or share tokens and must never appear in logs.",
        category: "security",
      },
      {
        icon: Shield,
        label: "Tightened Content Security Policy",
        desc: "Removed the broad https: wildcards from script-src, style-src, and font-src. Each integration now lists its explicit origin (Cloudflare, Tawk, Google Fonts).",
        category: "security",
      },
      {
        icon: ServerCrash,
        label: "1 MiB Request Body Cap",
        desc: "parseBody rejects payloads over 1 MiB based on the Content-Length header before reading them. Prevents multi-GB JSON bodies from being buffered by the server.",
        category: "security",
      },
      {
        icon: Timer,
        label: "Per-Email Forgot-Password Rate Limit",
        desc: "On top of the per-IP limit, forgot-password is now rate-limited per email (3 / hour). Stops residential NATs or botnets from spamming resets for many distinct addresses.",
        category: "security",
      },
      {
        icon: FileDown,
        label: "Data Exports Never Cached",
        desc: "GDPR data export download endpoint sets Cache-Control: no-store so browsers and proxies can't cache PII exports.",
        category: "security",
      },
      {
        icon: Gauge,
        label: "Correct Rate-Limit Headers",
        desc: "API rate-limit headers now reflect the user's actual plan-based daily limit instead of a hardcoded 50.",
        category: "fixed",
      },
      {
        icon: Settings,
        label: "Stripe Lazy Accessor",
        desc: "Replaced the Proxy that threw on first property access with getStripe(): Stripe | null. Routes now bail out cleanly with 503 when Stripe isn't configured.",
        category: "changed",
      },
      {
        icon: Settings,
        label: "Single Source of Truth for Constants",
        desc: "Client-safe constants (staff roles, API routes, app routes, severity levels) live in one file. Server-only re-exports them so existing imports keep working.",
        category: "changed",
      },
      {
        icon: Database,
        label: "Plans & Products Consolidated",
        desc: "Billing tiers are now defined once. The Stripe product list (monthly + yearly variants) is derived automatically, so adding a tier updates both with one edit.",
        category: "changed",
      },
      {
        icon: Shield,
        label: "Admin Role Helpers Consolidated",
        desc: "requireStaff, requireAdmin, and logAuditAction moved to lib/auth/authorization.ts. Eliminated ~80 lines of duplicated auth-check boilerplate across 5 admin route files.",
        category: "changed",
      },
      {
        icon: Zap,
        label: "Notifications Source of Truth",
        desc: "Notification preferences are now defined by a single NOTIFICATION_COLUMNS map. The type, the column list, and the type-to-column lookup are all derived from it.",
        category: "changed",
      },
      {
        icon: Code,
        label: "SSRF Helpers Consolidated",
        desc: "The manual-octet isPrivateHostname in async-checks.ts is gone. All SSRF checks now go through the single helper in lib/scanner/safe-fetch.ts.",
        category: "changed",
      },
      {
        icon: Globe,
        label: "SCAN_PROTOCOLS Moved to Protocols Module",
        desc: "Client and scanner code now share a single protocol list. Added 'dns' to the Category union so they no longer drift.",
        category: "changed",
      },
      {
        icon: Code,
        label: "Client API Helpers Promoted",
        desc: "apiGet / apiPost / apiPatch / apiDelete / apiClient moved from components/admin to lib/api/client.ts. Three raw-fetch call sites updated to use them.",
        category: "changed",
      },
    ],
  },
  {
    version: "2.2.3",
    date: "April 9, 2026",
    title: "HTTPS Scanning Fix & Security Stabilization",
    highlights: true,
    summary:
      "Critical fix for HTTPS scanning failures caused by SSL/TLS certificate validation issues introduced in 2.2.2 security hardening. Resolved issue where resolved IPs were used for all protocols, breaking certificate validation for HTTPS URLs. Enhanced configuration system and middleware stability with comprehensive code quality improvements.",
    changes: [
      {
        icon: Shield,
        label: "HTTPS Scanning Fix",
        desc: "Fixed critical bug where resolved IPs were used for HTTPS connections, causing SSL/TLS certificate validation failures. HTTPS/WSS connections now preserve original hostname to maintain certificate validity while HTTP/WS connections use resolved IPs for DNS rebinding prevention. Maintains security protections while restoring HTTPS functionality.",
        category: "fixed",
      },
      {
        icon: Lock,
        label: "Protocol-Specific IP Handling",
        desc: "Implemented smart IP resolution: HTTP protocols use resolved IP to prevent DNS rebinding attacks, HTTPS protocols keep original hostname for certificate validation. Both preserve Host header for virtual hosting support. Fixes regression from 2.2.2 while maintaining SSRF security improvements.",
        category: "security",
      },
      {
        icon: Zap,
        label: "Billing Verification & Configuration",
        desc: "Improved billing verification checks and enhanced configuration visibility across the system. Better handling of billing state transitions and clearer configuration error messages.",
        category: "changed",
      },
      {
        icon: Network,
        label: "Middleware Stability",
        desc: "Improved middleware stability and URL configuration handling with better error handling and edge case coverage. Enhanced request routing and enhanced response formatting for consistency.",
        category: "changed",
      },
      {
        icon: Bug,
        label: "Code Quality Improvements",
        desc: "Extensive code quality fixes addressing 40+ findings including redundant variables, unused imports, improved error handling, and type safety. Comprehensive review and refactoring of codebase for maintainability and performance.",
        category: "changed",
      },
    ],
  },
  {
    version: "2.2.2",
    date: "April 7, 2026",
    title: "Security Hardening & Code Quality Improvements",
    highlights: false,
    summary:
      "Comprehensive security fixes addressing SSRF vulnerabilities across all scan endpoints, enhanced DNS rebinding prevention, dependency updates to latest versions, and extensive code quality improvements. Improved error logging for webhooks and email notifications.",
    changes: [
      {
        icon: Shield,
        label: "SSRF Vulnerability Fixes",
        desc: "Fixed Server-Side Request Forgery vulnerabilities in all scan routes (bulk, crawl, discover, demo) using safeFetch wrapper with URL validation through validateScanTarget. Implemented DNS rebinding prevention using resolved IPs with Host header preservation.",
        category: "security",
      },
      {
        icon: Lock,
        label: "Enhanced DNS Validation",
        desc: "Added proper IPv4 and IPv6 private range detection using isIP() validation from Node.js 'net' module. Split IP patterns by version for efficient checking. Prevents direct IPv6 access while allowing public IPv6 addresses.",
        category: "security",
      },
      {
        icon: Network,
        label: "Fetch Timeout & Abort Control",
        desc: "Added 30-second timeout to safeFetch with AbortController and proper signal handling. Respects caller-provided abort signals while applying default timeout for network operations.",
        category: "added",
      },
      {
        icon: AlertTriangle,
        label: "Incomplete String Escaping Fix",
        desc: "Fixed incomplete regex escaping in private-ip-exposure check using comprehensive escapeRegExp() helper function that properly escapes all regex metacharacters.",
        category: "security",
      },
      {
        icon: Database,
        label: "API Key Rate Limiting Fix",
        desc: "Removed unsafe non-null assertion operator (!) on keyData by storing apiKeyDailyLimit as variable during authentication phase. Added proper type checking for rate limit operations.",
        category: "fixed",
      },
      {
        icon: Bug,
        label: "Code Quality Improvements",
        desc: "Fixed 5+ code quality issues: corrected cookie-path-broad check to return findings, removed duplicate checks (postmessage-wildcard, graphql-introspection, internal-ip-exposed), fixed ssn-pattern using search() instead of indexOf with RegExp.",
        category: "changed",
      },
      {
        icon: Zap,
        label: "Error Logging Enhancement",
        desc: "Added comprehensive error logging for email notification failures and webhook delivery failures. Improved debugging visibility for scanning operations and notification system issues.",
        category: "changed",
      },
      {
        icon: Package,
        label: "Dependency Updates",
        desc: "Updated all core dependencies to latest versions including @hookform/resolvers (5.2.2), Stripe (22.0.0), react-resizable-panels (4.9.0), zod (4.3.6), and TypeScript (6.0.2) with full compatibility verification.",
        category: "changed",
      },
    ],
  },
  {
    version: "2.2.1",
    date: "April 5, 2026",
    title: "Broadcast Messaging Hotfix",
    highlights: false,
    summary:
      "Fixed database schema mismatch in broadcast messaging system that prevented admin broadcasts from being sent.",
    changes: [
      {
        icon: Bell,
        label: "Broadcast Query Fix",
        desc: "Removed references to non-existent 'sent_by' column in broadcast_messages table. Updated SELECT and UPDATE queries to properly track broadcast status and timestamps.",
        category: "fixed",
      },
    ],
  },
  {
    version: "2.2.0",
    date: "March 31, 2026",
    title: "Backend Optimization, API Enhancements & Security Hardening",
    highlights: true,
    summary:
      "Comprehensive backend optimization and API improvements with enhanced performance. Improved UI responsiveness and visual consistency across the platform. Critical security vulnerabilities patched including SSRF prevention, enhanced password hashing, and comprehensive input validation.",
    changes: [
      {
        icon: Zap,
        label: "Backend Performance Optimization",
        desc: "Optimized database queries, improved async request handling, and streamlined API response times. Enhanced caching mechanisms and improved middleware efficiency across all endpoints.",
        category: "performance",
      },
      {
        icon: Network,
        label: "API Enhancements",
        desc: "Updated API endpoints with better validation, improved error handling, and enhanced response consistency. Refined request/response formatting for better client integration and clearer API contracts.",
        category: "changed",
      },
      {
        icon: Palette,
        label: "UI/UX Improvements",
        desc: "Enhanced UI responsiveness, improved visual consistency, updated component styling, and better accessibility across all pages. Refined typography and spacing for improved readability.",
        category: "changed",
      },
      {
        icon: Shield,
        label: "SSRF Vulnerability Patches",
        desc: "Comprehensive fixes for Server-Side Request Forgery vulnerabilities across all API scan endpoints. Added strict URL validation, protocol checking, and hostname verification to prevent malicious requests.",
        category: "security",
      },
      {
        icon: Lock,
        label: "Enhanced Password Hashing",
        desc: "Migrated from SHA-256 to bcrypt with salt cost 12 for secure password and API key storage. Improved cryptographic strength and resistance to brute force attacks.",
        category: "security",
      },
      {
        icon: Bug,
        label: "Input Validation & Sanitization",
        desc: "Implemented robust input validation across all endpoints, fixed ReDoS vulnerabilities in regex patterns, and enhanced HTML tag filtering with proper multi-pass sanitization.",
        category: "security",
      },
      {
        icon: AlertTriangle,
        label: "Additional Security Fixes",
        desc: "Fixed incomplete URL scheme validation, improved email domain validation, enhanced certificate verification, and added cryptographic randomness to sensitive operations.",
        category: "security",
      },
    ],
  },
  {
    version: "2.1.2",
    date: "March 27, 2026",
    title:
      "Admin Panel UX Improvements, Gift Subscriptions & Support Role Fixes",
    highlights: false,
    summary:
      "Major improvements to the admin panel user management including gift subscription system with plan/duration selection, fixed modal z-index issues causing header disappearance, proper support role badge coloring, and streamlined user list actions.",
    changes: [
      {
        icon: Crown,
        label: "Gift Subscription System",
        desc: "New gift subscription dialog allows admins to grant temporary premium access with selectable plan tiers (Core, Pro, Elite Supporter) and customizable durations (7 days to 1 year). Gift subscription automatically awards Premium badge to recipients.",
        category: "added",
      },
      {
        icon: Tag,
        label: "Plan Name Formatting",
        desc: "Added formatPlanName() helper to properly display plan names with spaces (e.g., 'elite_supporter' displays as 'Elite Supporter'). Plan badges now show correct styling for all supporter tiers.",
        category: "fixed",
      },
      {
        icon: Shield,
        label: "Support Role Badge Color",
        desc: "Fixed Support role badge which had no visible color due to CSS variable issues. Now displays proper blue styling (bg-blue-500/10 text-blue-500) matching other role badges.",
        category: "fixed",
      },
      {
        icon: Layout,
        label: "Modal Z-Index Fixes",
        desc: "Replaced Select dropdowns for Role and Plan with modal dialogs using fixed positioning (z-[100]) to prevent header from disappearing when selections are open. All modals now properly layer above page content.",
        category: "fixed",
      },
      {
        icon: Bell,
        label: "Notifications Manager Modal Fix",
        desc: "Moved notifications-manager to dedicated folder and replaced Dialog/Select components with fixed-position modals. Type, Variant, and Audience selections now use modal dialogs that don't cause navbar issues.",
        category: "fixed",
      },
      {
        icon: Key,
        label: "Premium Badge Auto-Award",
        desc: "Gifting a subscription or changing a user's plan to any supporter tier now automatically awards the Premium badge. Downgrading to Free plan automatically removes the Premium badge.",
        category: "added",
      },
      {
        icon: UserCog,
        label: "Update Plan/Name/Email API",
        desc: "Added missing update_plan, update_name, and update_email API cases to admin route. All changes now properly send email notifications and log actions. Plan changes blocked while user has active gift.",
        category: "added",
      },
      {
        icon: Eye,
        label: "Removed Disable Button from User List",
        desc: "Removed the Disable/Enable (Ban) button from the users list table. Account disable functionality is now only available in the user detail panel's Actions tab for better UX.",
        category: "changed",
      },
      {
        icon: CheckCircle,
        label: "All Actions Use Confirmation Modal",
        desc: "All support actions (Clear Rate Limits, Verify/Unverify Email, Clear Avatar, Toggle Beta Access) now route through the SaveConfirmationModal with required email notification instead of executing directly.",
        category: "changed",
      },
    ],
  },
  {
    version: "2.1.1",
    date: "March 23, 2026",
    title:
      "Profile UI Redesign, Email Notifications for Scans & API Key Security Enhancement",
    highlights: true,
    summary:
      "Complete overhaul of the Settings/Profile page with modern sidebar navigation, consistent spacing, and unified icon styling. Added email notifications for scan completions and critical findings. Enhanced API key security by permanently deleting old keys on rotation instead of archiving them.",
    changes: [
      {
        icon: Palette,
        label: "Complete Profile/Settings Redesign",
        desc: "Redesigned the entire Settings page with modern sidebar navigation on desktop (sticky positioning), mobile-friendly horizontal tabs, and consistent card-based content layout. All sections now use unified spacing (gap-10 between sections, gap-4 between items), standardized icon badges with blue primary color, and clean typography hierarchy.",
        category: "changed",
      },
      {
        icon: Layout,
        label: "Sidebar Navigation Overhaul",
        desc: "New two-column layout with left sidebar showing all 7 tabs (General, Billing, Security, Developer, Notifications, Privacy, Connected Accounts). Desktop sidebar is sticky with smooth hover states. Mobile uses horizontal scrollable tab bar. Navigation items use consistent styling with proper active states and visual feedback.",
        category: "changed",
      },
      {
        icon: Bell,
        label: "Standardized Icon Styling",
        desc: "All section header icons now use consistent primary blue badge styling (bg-primary/10, text-primary) with 9x9 icon containers and rounded-lg styling. Removed inconsistent gray secondary styling. All 40+ section headers throughout all tabs now have uniform visual appearance.",
        category: "changed",
      },
      {
        icon: Wrench,
        label: "Notification Card Spacing Fix",
        desc: "Increased CardContent spacing from gap-2/gap-3 to gap-4 with pb-4 bottom padding. Individual notification items now have p-4 padding instead of p-3 for better breathing room. Description text spacing improved from mt-0.5 to mt-1. All notification sections now have consistent, readable spacing.",
        category: "fixed",
      },
      {
        icon: Zap,
        label: "Removed Unnecessary Product Section",
        desc: "Removed the 'Product' notification section containing 'Product Updates' and 'Tips & Guides' toggles. Cleaned up NotificationPrefs interface and state initialization to remove product-related email preference keys. Streamlined Notifications tab to focus on actionable alerts.",
        category: "changed",
      },
      {
        icon: Mail,
        label: "Email Notifications for Scan Completion",
        desc: "Added automatic email notifications when scans complete. Users receive detailed summary email with findings breakdown (critical, high, medium, low, info counts), scan duration, and direct link to view full report. Respects user's email_scan_complete preference from settings.",
        category: "added",
      },
      {
        icon: AlertTriangle,
        label: "Critical Findings Alert Emails",
        desc: "Added urgent email alerts when critical or high severity vulnerabilities are detected. Alert emails use warning styling with prominent severity counts and action-required messaging. Sent automatically after scan completion if thresholds are exceeded. Respects user's severity_alerts preference.",
        category: "added",
      },
      {
        icon: CalendarClock,
        label: "Scheduled Scan Email Templates",
        desc: "Added email template infrastructure for scheduled scan completions with schedule name prominently displayed. Templates ready for integration with scheduled scan execution when available. Full summary formatting matching on-demand scan emails.",
        category: "added",
      },
      {
        icon: Key,
        label: "API Key Rotation Security Enhancement",
        desc: "Changed API key rotation behavior from soft-delete (setting revoked_at) to hard-delete. Old keys are now permanently removed from database when rotated with no historical trace. Prevents potential bypass attempts where users could access archived keys.",
        category: "security",
      },
      {
        icon: RefreshCw,
        label: "Scan Notification Key Mapping Fix",
        desc: "Fixed Scanning Notifications section toggle keys to properly map to state interface (email_scan_complete, email_critical_findings, email_schedules). Previously used mismatched keys causing toggles to display incorrect state. Toggles now correctly show as ON by default.",
        category: "fixed",
      },
      {
        icon: UserCog,
        label: "Profile Header Simplification",
        desc: "Removed top-right user card display from Settings page header. Kept only the 'Settings' title and description for cleaner, more focused layout. Page header now takes up less visual space.",
        category: "changed",
      },
      {
        icon: CheckCircle2,
        label: "Import Fix for CheckCircle2",
        desc: "Added missing CheckCircle2 icon import from lucide-react to fix ReferenceError in Notifications tab. All notification icons now properly import and render without errors.",
        category: "fixed",
      },
    ],
  },
  {
    version: "2.1.0",
    date: "March 21, 2026",
    title:
      "Complete UI/UX Redesign, Support Actions System & Admin Dashboard Overhaul",
    highlights: true,
    summary:
      "Comprehensive redesign of all user-facing pages with modern design patterns. New support action confirmation system with email notifications, fixed staff role detection for unlimited access, and complete admin panel modernization. All sorting functionality restored and working correctly.",
    changes: [
      {
        icon: Palette,
        label: "Complete UI/UX Redesign",
        desc: "Redesigned all major pages with a clean, professional dashboard aesthetic. Dashboard now features larger stat cards with colored icons, improved activity charts, severity breakdowns, and better visual hierarchy. All pages follow consistent rounded-xl card styling with proper spacing and borders.",
        category: "changed",
      },
      {
        icon: Layout,
        label: "Dashboard Component Revamp",
        desc: "Redesigned dashboard with stat cards showing totals, unique sites, API scans, and web scans with proper icon backgrounds. Added activity charts with improved tooltips and better axis labels. Severity breakdown uses minimal cards with accent bars. Recent scans section shows relative timestamps and source icons.",
        category: "changed",
      },
      {
        icon: List,
        label: "History Page Modernization",
        desc: "History page now displays a table-style list with proper column headers (URL, Source, Issues, Scanned, Actions). Added stats row showing totals, clean scans, issues count. Dropdown action menus on each row. Improved severity badges with colored dots and backgrounds.",
        category: "changed",
      },
      {
        icon: FileSearch,
        label: "Scan Results Pages Update",
        desc: "Revamped scan-summary, results-list, and issue-detail components with cleaner card layouts, better typography hierarchy, and improved collapsible sections. Issue detail cards now show severity bars, animated evidence indicators, and better reference sections.",
        category: "changed",
      },
      {
        icon: GitMerge,
        label: "Compare Page Redesign",
        desc: "Redesigned compare page with cleaner two-column layout, numbered selection steps, better visual diff indicators with green for fixed and red for new issues. Added 'No Changes' state when scans are identical.",
        category: "changed",
      },
      {
        icon: Share2,
        label: "Shared & Shares Pages Revamp",
        desc: "Shared scan results page improved with hero header card and severity-based gradient accents. Shares list page now shows stats row with active shares breakdown, table-style layout with status badges, and dropdown menus for manage actions.",
        category: "changed",
      },
      {
        icon: Users,
        label: "Teams Page Complete Redesign",
        desc: "Teams page now includes search input, table-style layout for teams with members and role columns. Team detail view uses cleaner cards with proper sections for members, pending invites, and member scan history. Join page simplified with better visual hierarchy and centered layout.",
        category: "changed",
      },
      {
        icon: Palette,
        label: "Badge Page Modernization",
        desc: "Badge embed page redesigned with two-column layout. Left column shows scan selection list with search, severity badges, and timestamps. Right column displays badge preview with hover effects and clean snippet blocks with proper code formatting.",
        category: "changed",
      },
      {
        icon: Pencil,
        label: "Profile Pages Restructure",
        desc: "Profile page redesigned with sidebar navigation on left and cleaner content cards on right. Sidebar shows all 7 tabs (General, Security, Connected Accounts, Billing, Developer, Notifications, Privacy) with proper styling. Each section uses improved form layouts with better visual hierarchy.",
        category: "changed",
      },
      {
        icon: ShieldAlert,
        label: "Admin Panel Complete Overhaul",
        desc: "Admin page streamlined from 3400+ to 2000 lines with cleaner stat cards, improved tab navigation, and modernized data tables. Better user list UI with search, cleaner user detail panel with two-column layout. All sections use consistent styling and spacing.",
        category: "changed",
      },
      {
        icon: Bell,
        label: "Support Actions System",
        desc: "New support action confirmation modal system. All support actions (Force Logout, Revoke API Keys, Reset Password, etc.) now queue through a SaveConfirmationModal with action review. Email notification toggle is always enabled for support actions with 'Required' badge instead of toggle.",
        category: "added",
      },
      {
        icon: Mail,
        label: "Support Action Email Notifications",
        desc: "Added email notifications for support actions: revoke_sessions, revoke_api_keys, force_logout_all, and reset_password. All staff actions now send detailed email notification to affected user about the action taken, who performed it, and when.",
        category: "added",
      },
      {
        icon: Shield,
        label: "Staff Role Unlimited Access Fix",
        desc: "Fixed billing and daily limits to properly recognize all staff roles (admin, moderator, support) as unlimited. Previously only 'admin' was marked unlimited. All staff roles now correctly show 'Unlimited Access' in billing section and get unlimited daily scans.",
        category: "fixed",
      },
      {
        icon: RefreshCw,
        label: "Severity Sorting Fix",
        desc: "Fixed the High→Low and Low→High severity sorting which was completely broken. Sorting now works in both directions using proper SEVERITY_ORDER values. Results properly sort by severity level when toggled.",
        category: "fixed",
      },
      {
        icon: Settings,
        label: "Consistent Token Loading",
        desc: "Standardized all loading states across share pages to use simple Loader2 spinner with text instead of fancy ping animations. Consistent loading UX across /shares and /shared/[token] pages.",
        category: "changed",
      },
      {
        icon: ShieldCheck,
        label: "Form & Modal Improvements",
        desc: "Improved form layouts with better label styling, cleaner toggle switches for preferences, consistent textarea sizing, and better organized sections in modals. DeleteConfirmationModal now shows item details before deletion.",
        category: "changed",
      },
      {
        icon: Shield,
        label: "Discord Device Trust Fix",
        desc: "Fixed bug where checking 'Trust this device for 30 days' on 2FA verification page after Discord OAuth login wasn't actually setting the device trust cookie. The rememberDevice checkbox value from the 2FA verification form is now properly used for both standard login AND Discord OAuth flows.",
        category: "fixed",
      },
      {
        icon: Wrench,
        label: "Request Body Parsing Enhancement",
        desc: "Improved parseBody() utility function with better error handling and content-type validation. Now checks content-type header before attempting JSON parsing, gracefully falls back to JSON for missing/unspecified content-types, and provides clearer error messages for malformed requests.",
        category: "changed",
      },
    ],
  },
  {
    version: "2.0.5",
    date: "March 16, 2026",
    title: "API Rate Limiting Complete & Enhanced Legal Documentation",
    highlights: true,
    summary:
      "Comprehensive API rate limiting implementation across all documented endpoints with proper daily limit tracking, source tracking fixes for crawl/bulk operations, DELETE endpoint implementation, and enhanced accessibility documentation.",
    changes: [
      {
        icon: Key,
        label: "Complete API Rate Limiting",
        desc: "Implemented rate limit checks across all scan endpoints (scan, crawl, bulk, discover) and history endpoints (GET, POST, PATCH, DELETE). All rate-limited endpoints check the user's configured daily limit (typically 50), return 429 status when exceeded, and include proper rate limit headers (X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset).",
        category: "added",
      },
      {
        icon: Gauge,
        label: "API Usage Tracking",
        desc: "All documented API endpoints now record usage via recordUsage() for proper daily limit accounting. Usage is tracked in api_usage table with proper rate limiting applied to all operations that count against the daily quota. Discover endpoint exempt from rate limits per documentation.",
        category: "added",
      },
      {
        icon: Settings,
        label: "Dynamic Daily Limit per API Key",
        desc: "Replaced hardcoded 50-request limit with dynamic keyData.dailyLimit from API key configuration. All rate limit checks now use the configured daily limit from the user's specific API key, allowing different keys to have different quotas.",
        category: "changed",
      },
      {
        icon: Radar,
        label: "Source Tracking Fix for Crawl/Bulk",
        desc: "Fixed crawl and bulk scan endpoints to correctly report source as 'api-crawl'/'api-bulk' vs 'deep-crawl'/'bulk' based on authentication method. Previously hardcoded 'web', now properly tracks API vs session-based scans in history.",
        category: "fixed",
      },
      {
        icon: Trash2,
        label: "DELETE Handler for History",
        desc: "Implemented missing DELETE handler for /api/v3/history/[id] endpoint. Users can now delete individual scans via API with proper authentication and rate limiting applied.",
        category: "added",
      },
      {
        icon: Shield,
        label: "Terms Acceptance Enforcement on API",
        desc: "All rate-limited API endpoints now check if user has accepted latest terms (tos_accepted_at). API requests from users who haven't accepted new terms receive 403 Forbidden with message directing them to log in and accept terms before using API.",
        category: "security",
      },
      {
        icon: Link2,
        label: "Comprehensive History API Rate Limiting",
        desc: "Added rate limiting to all history endpoints: GET /history (list scans), DELETE /history (delete all), GET /history/[id] (get scan details), PATCH /history/[id] (update notes), DELETE /history/[id] (delete single scan). All endpoints properly validate API keys and track usage.",
        category: "added",
      },
      {
        icon: AlertTriangle,
        label: "Rate Limit Exemption for Discovery",
        desc: "Discover endpoint (/api/v3/scan/crawl/discover) properly exempted from rate limiting per documentation. Users can perform unlimited discovery operations without consuming daily API quota.",
        category: "changed",
      },
      {
        icon: FileText,
        label: "Enhanced Accessibility Documentation",
        desc: "Updated Accessibility Statement with better CAPTCHA alternatives (direct email contact), PDF accessibility notes with support contact, browser update recommendations, and disclaimer about response times during high volume periods.",
        category: "changed",
      },
      {
        icon: Heart,
        label: "Improved Donate Page",
        desc: "Enhanced donate page with better visual design including gradient background, heart icon with glow effect, fallback donate button if redirect fails, and thank you message after redirect.",
        category: "changed",
      },
    ],
  },
  {
    version: "2.0.4",
    date: "March 16, 2026",
    title: "Comprehensive Legal Overhaul & API Route Authentication Fix",
    highlights: true,
    summary:
      "Major update to all legal documents for full Missouri/US compliance including CCPA/CPRA, state privacy laws, and GDPR. Fixed API key authentication across all v2 endpoints and added terms re-acceptance system for returning users.",
    changes: [
      {
        icon: FileText,
        label: "Legal Documents Overhaul",
        desc: "Complete rewrite of Terms of Service, Privacy Policy, Acceptable Use Policy, and Disclaimer for Missouri/US compliance. Added governing law (Missouri), arbitration clause, class action waiver, severability, force majeure, and assignment clauses. Updated age requirement to 13+ with COPPA-compliant parental consent language.",
        category: "changed",
      },
      {
        icon: Shield,
        label: "CCPA/CPRA & State Privacy Compliance",
        desc: "Added comprehensive California Consumer Privacy Act disclosures including right to know, delete, and opt-out. Added compliance sections for Virginia (VCDPA), Colorado (CPA), Connecticut (CTDPA), and Utah (UCPA) privacy laws. Added Do Not Track disclosure.",
        category: "added",
      },
      {
        icon: Bell,
        label: "Terms Re-Acceptance System",
        desc: "New terms_updated_at config value tracks when legal documents were last updated. Users who previously accepted terms before this date are shown an updated TOS modal with amber styling explaining the changes. Modal requires re-accepting all 4 checkboxes before continuing.",
        category: "added",
      },
      {
        icon: FileSearch,
        label: "New Legal Pages",
        desc: "Added DMCA Policy page with full takedown procedure, counter-notification process, and repeat infringer policy. Added Accessibility Statement page with WCAG 2.1 Level AA compliance commitment, known limitations, and feedback channels.",
        category: "added",
      },
      {
        icon: Key,
        label: "API Route Authentication Fix",
        desc: "Fixed critical bug where /api/v3/scan/crawl, /api/v3/scan/bulk, /api/v3/history, and /api/v3/history/[id] routes only accepted session auth but not API key authentication. All endpoints now properly support Bearer token authentication with rate limiting.",
        category: "fixed",
      },
      {
        icon: Lock,
        label: "Data Breach Notification Policy",
        desc: "Added Missouri-compliant data breach notification policy (Mo. Rev. Stat. 407.1500) to Privacy Policy. Users will be notified without unreasonable delay after discovery of breaches affecting their personal information.",
        category: "added",
      },
      {
        icon: Mail,
        label: "Contact Form Privacy Notice",
        desc: "Added mini privacy notice to the contact form explaining data collection and linking to the Privacy Policy. Clarifies that contact information won't be used for marketing.",
        category: "added",
      },
      {
        icon: FileText,
        label: "Enhanced Privacy Policy",
        desc: "Added 3 new sections: Legal Compliance (law enforcement disclosures), Business Transfers (merger/acquisition), and Authorized Scanning Responsibility (security scanning liability). Added Security Disclaimer clarifying scan results are informational with potential false positives/negatives. Added Service Availability Disclaimer protecting against downtime claims.",
        category: "added",
      },
      {
        icon: Shield,
        label: "Security Tool Disclaimers",
        desc: "Explicit disclaimers in Terms of Service that VulnRadar scan results are informational only and may contain false positives or false negatives. Service does not guarantee detection of all vulnerabilities. Added that no method is 100% secure.",
        category: "added",
      },
      {
        icon: AlertTriangle,
        label: "Mass Scanning Prevention",
        desc: "Added 'No Automated Mass Scanning' rule to Acceptable Use Policy. Users prohibited from performing large-scale internet-wide scanning or systematically enumerating large numbers of targets without explicit authorization for each target.",
        category: "added",
      },
      {
        icon: Layout,
        label: "Public Legal Pages Accessibility",
        desc: "Fixed DMCA and Accessibility pages to use correct public-facing header and footer when users are not logged in. Pages now render with PublicPageShell instead of logged-in components. Added to PUBLIC_PATHS for unrestricted access.",
        category: "fixed",
      },
      {
        icon: Link2,
        label: "Footer Legal Links Reorganization",
        desc: "Reorganized guest footer to display all 7 legal pages in order: Terms of Service, Privacy Policy, Disclaimer, Acceptable Use, DMCA Policy, Accessibility, and GDPR/Data Request. Removed Pricing button from legal pages footer. Added all missing links to logged-in scanner footer with 'Legal' section header.",
        category: "changed",
      },
      {
        icon: Heart,
        label: "Accessibility Improvements",
        desc: "Enhanced Accessibility Statement with better CAPTCHA alternative access (email contact with copy-paste support), PDF export accessibility notes, browser update recommendations, and note about response time variation during high volume periods.",
        category: "changed",
      },
      {
        icon: Wrench,
        label: "Layout JSON Parse Fix",
        desc: "Fixed 'Unexpected end of JSON input' error on page load caused by empty localStorage values. Auth cache script now validates string length before parsing.",
        category: "fixed",
      },
    ],
  },
  {
    version: "2.0.3",
    date: "March 15, 2026",
    title: "310+ Security Checks, Config System Overhaul & UI Improvements",
    highlights: false,
    summary:
      "Massive expansion of the detection engine to 310+ checks, complete configuration system overhaul eliminating environment variable complexity, and important UI fixes for better cross-platform support.",
    changes: [
      {
        icon: ShieldCheck,
        label: "310+ Security Checks",
        desc: "Expanded detection engine from 175 to 310+ security checks. Added comprehensive checks for CSP directives (base-uri, form-action, frame-src, upgrade-insecure-requests), CORS misconfigurations, cookie security (domain scope, prefixes, partitioned), credential exposure patterns (AWS, Stripe, GitHub, npm, Docker Hub, SendGrid, Twilio, Slack/Discord webhooks), DOM security (clobbering, srcdoc iframes, blob/data URIs), and many more.",
        category: "added",
      },
      {
        icon: Settings,
        label: "Config System Overhaul",
        desc: "Eliminated all NEXT_PUBLIC environment variables for app metadata. New config-values.ts reads directly from config.yaml at startup with zero circular dependencies. Version numbers, app name, and all metadata now come from a single source of truth. No more hydration mismatches from stale cached values.",
        category: "changed",
      },
      {
        icon: FileText,
        label: "Updated Documentation",
        desc: "Setup docs now include complete .env.example with all sections (Database, SMTP, Stripe, Discord OAuth, Turnstile). Added new 'Application Configuration' section explaining config.yaml. All environment variable code blocks now have copy buttons. Removed outdated v1 API references.",
        category: "changed",
      },
      {
        icon: Layout,
        label: "Modal & Toast Scrolling",
        desc: "Added max-height constraints with overflow-y-auto to Dialog, AlertDialog, and Toast components. Long notifications and modal content now scroll properly instead of overflowing the viewport on all platforms.",
        category: "fixed",
      },
      {
        icon: Wrench,
        label: "Bulk Scan Helper Text",
        desc: "Fixed misleading 'must include https://' text in bulk scan form since the scanner auto-adds protocols.",
        category: "fixed",
      },
    ],
  },
  {
    version: "2.0.2",
    date: "March 14, 2026",
    title: "Badge page 500 error fixed",
    highlights: true,
    changes: [
      {
        icon: Wrench,
        label: "Bug Fix",
        desc: "Resolved a 500 error on the badge page caused by a missing import during server rendering. The required module is now properly imported, allowing the page to load normally.",
      },
    ],
  },
  {
    version: "2.0.1",
    date: "March 14, 2026",
    title: "Detection Engine v2.0.1, Subdomain Caching & Share Modal",
    highlights: false,
    summary:
      "Major detection engine improvements to reduce false positives, new subdomain caching system, and a beautiful custom share modal for scan results.",
    changes: [
      {
        icon: ShieldCheck,
        label: "Detection Engine v2.0.1",
        desc: "Major improvements to reduce false positives. CSP checks now skip framework sites (Next.js, Nuxt, Angular) that legitimately require unsafe-inline/eval. Fixed wildcard detection to not flag 'https:' as a wildcard. XXE and reflected input checks now skip code examples and documentation. CDN fallback check no longer flags analytics scripts like cloudflareinsights.com.",
        category: "changed",
      },
      {
        icon: Globe,
        label: "Subdomain Discovery Caching",
        desc: "Subdomain results are now cached for 4 hours in the database to prevent rate limiting on external APIs. Shows cache status with time remaining until refresh, plus a 'Refresh Now' button to force-refresh if needed. Also expanded the discovery limit from 150 to 1000 subdomains.",
        category: "added",
      },
      {
        icon: Share2,
        label: "Custom Share Modal",
        desc: "Replaced the native browser share with a custom YouTube-style share modal. Share scan results directly to X (Twitter), Facebook, LinkedIn, WhatsApp, or Email with one click. The modal includes a copy-to-clipboard link button with visual feedback.",
        category: "added",
      },
      {
        icon: Bell,
        label: "Admin Notifications UI Overhaul",
        desc: "Completely redesigned the notification cards in the admin panel. New cleaner card layout with colored accent bar, improved badge styling using neutral backgrounds for better readability, larger icons, better spacing, and always-visible action buttons.",
        category: "changed",
      },
      {
        icon: FileText,
        label: "Admin User Notes",
        desc: "Added a dedicated Notes section in the admin user detail panel. Staff can now add internal notes about users that persist across sessions. Notes display the author, timestamp, and full note content in a scrollable list.",
        category: "added",
      },
      {
        icon: Settings,
        label: "Dynamic Version System",
        desc: "Completely eliminated hardcoded version numbers. All versions now read from config.yaml at server startup and are cached for the instance lifetime. No more lazy loading or build-time injection - versions are immediately available when the app starts.",
        category: "changed",
      },
      {
        icon: Wrench,
        label: "Bug Fixes",
        desc: "Fixed JSON parse errors in admin activity API when request body is empty. Fixed nested anchor tag hydration errors in history page. Fixed subdomain discovery button passing click event instead of boolean. Added missing DialogDescription for accessibility. Fixed notifications manager dialog centering. Added data-scroll-behavior attribute for Next.js smooth scrolling compatibility.",
        category: "fixed",
      },
    ],
  },
  {
    version: "2.0.0",
    date: "March 12, 2026",
    title:
      "Stripe Billing, Discord Integration, Admin Notifications & Design System Overhaul",
    highlights: false,
    summary:
      "The biggest release yet with full Stripe billing integration, Discord account linking, comprehensive admin notification system, and a complete design system overhaul.",
    changes: [
      {
        icon: Crown,
        label: "Stripe Billing Integration",
        desc: "Full Stripe Checkout integration with 4 subscription tiers: Free, Core Supporter ($5/mo), Pro Supporter ($10/mo), and Elite Supporter ($20/mo). Each tier unlocks higher scan limits. Billing portal for managing subscriptions, automatic webhook handling for subscription lifecycle events, and seamless upgrade/downgrade flows.",
        category: "added",
      },
      {
        icon: Globe,
        label: "Discord Account Linking",
        desc: "Link your Discord account to your VulnRadar profile for enhanced community features. OAuth2 flow with secure token storage, profile display showing Discord avatar and username, and one-click unlink option. Enables future Discord bot integrations and community verification.",
        category: "added",
      },
      {
        icon: BellRing,
        label: "Admin Notification System",
        desc: "Comprehensive notification system for site-wide announcements. Admins can create Banner, Modal, Toast, or Bell notifications with customizable variants (info, success, warning, error), audience targeting (all, authenticated, unauthenticated, admin, staff), scheduling with start/end dates, and unique cookie-based dismiss tracking per notification.",
        category: "added",
      },
      {
        icon: Palette,
        label: "Design System Overhaul",
        desc: "Complete redesign of the color system using semantic design tokens. Primary color updated to a refined cyan/teal, all hover states standardized to use neutral gray accent colors, and consistent theming across all pages. Removed blue/purple color bleeding in favor of cohesive neutral palette with intentional accent colors.",
        category: "changed",
      },
      {
        icon: Zap,
        label: "API v2 Migration",
        desc: "All API endpoints migrated from /api/v1/ to /api/v3/ with automatic deprecation warnings. New API_VERSION constant enables single-source version control. v1 endpoints return deprecation headers directing developers to upgrade. Full backward compatibility maintained during transition period.",
        category: "changed",
      },
      {
        icon: Database,
        label: "Enhanced Database Schema",
        desc: "New tables for Discord accounts (discord_accounts), Stripe customers (stripe_customers), subscriptions (stripe_subscriptions), and admin notifications (admin_notifications). Added cookie_id column for unique notification dismiss tracking. Improved indexing for billing and notification queries.",
        category: "added",
      },
      {
        icon: ShieldCheck,
        label: "Subscription-Gated Scanning",
        desc: "Scan limits now enforced based on subscription tier. Free users get 50 scans/month, Core gets 100, Pro gets 150, Elite gets 500. Usage tracking via billing API with clear limit indicators in the UI. Self-hosters can disable billing entirely via config.yaml.",
        category: "added",
      },
      {
        icon: Settings,
        label: "Admin Notifications Manager",
        desc: "Full CRUD interface for managing site notifications. Create notifications with rich options: type selector, variant badges, audience targeting, path patterns for page-specific display, scheduling controls, dismiss duration, and action buttons with external link support. Real-time preview of notification appearance.",
        category: "added",
      },
      {
        icon: Bell,
        label: "Multi-Type Notification Display",
        desc: "Banner notifications appear at page top with gradient accents and megaphone icons. Modal notifications show as centered overlays with backdrop blur. Toast notifications stack in bottom-right corner with auto-dismiss progress bars. Each type respects its own cookie-based dismiss state independently.",
        category: "added",
      },
      {
        icon: Link2,
        label: "Discord Profile Modal",
        desc: "New modal for connecting Discord accounts with OAuth2 authorization flow. Shows connected account details including avatar, username, and Discord ID. Clean disconnect flow with confirmation. Integrated into profile page security section.",
        category: "added",
      },
      {
        icon: BarChart3,
        label: "Billing Dashboard",
        desc: "New /pricing page showing all subscription tiers with feature comparison. Current plan highlighted with usage statistics. One-click upgrade buttons that redirect to Stripe Checkout. Billing portal access for existing subscribers to manage payment methods and cancel subscriptions.",
        category: "added",
      },
      {
        icon: Wrench,
        label: "Stripe Webhook Automation",
        desc: "Automatic webhook endpoint registration on first billing API call. Handles checkout.session.completed, customer.subscription.updated, customer.subscription.deleted, and invoice.payment_failed events. Robust signature verification and idempotent event processing.",
        category: "added",
      },
      {
        icon: Activity,
        label: "Staff Heartbeat System",
        desc: "Real-time presence tracking for staff members. Automatic status updates (online/away/offline) based on activity. Visible in admin panel for coordinating support coverage. Uses efficient polling with 30-second intervals.",
        category: "added",
      },
      {
        icon: Filter,
        label: "Notification Audience Targeting",
        desc: "Notifications can target specific audiences: all users, authenticated only, unauthenticated only, admin only, or staff only. Path patterns allow page-specific notifications (e.g., only show on /dashboard). Priority system ensures most important notifications display first.",
        category: "added",
      },
      {
        icon: Timer,
        label: "Scheduled Notifications",
        desc: "Set start and end dates for notifications. Notifications automatically appear when starts_at is reached and disappear after ends_at. Perfect for maintenance windows, limited-time announcements, and scheduled promotions.",
        category: "added",
      },
      {
        icon: Fingerprint,
        label: "Unique Cookie-Based Dismiss",
        desc: "Each notification has a unique cookie_id (notif_ + 16 hex chars). Dismissing one notification doesn't affect others. Dismiss duration configurable per notification (hours until cookie expires). Persists across sessions and page refreshes.",
        category: "added",
      },
    ],
  },
  {
    version: "1.9.5-patch.1",
    date: "March 9, 2026",
    title: "API v1 routes fixed",
    highlights: false,
    changes: [
      {
        icon: Wrench,
        label: "Middleware Routing Fix",
        desc: "Updated middleware to whitelist /api/v1/scan, /api/v1/history, and /api/version so API clients and docs are no longer redirected to the login page; API handlers continue to validate API keys and enforce rate limits.",
        category: "fixed",
      },
    ],
  },
  {
    version: "1.9.5",
    date: "March 7, 2026",
    title: "API v1 Versioning, Developer SDK Support & Finding Types Endpoint",
    highlights: false,
    changes: [
      {
        icon: Zap,
        label: "API v1 Versioning",
        desc: "All API endpoints have been migrated to /api/v1/ for proper versioning. This prepares the codebase for v2.0 which will introduce breaking changes. The version and security-txt endpoints remain unversioned at /api/version and /api/security-txt respectively.",
        category: "changed",
      },
      {
        icon: FileText,
        label: "New Finding Types Endpoint",
        desc: "Added GET /api/v1/finding-types endpoint that returns all 110+ security check definitions including id, type, title, category, and severity. This enables SDK developers to programmatically access check metadata for building integrations.",
        category: "added",
      },
      {
        icon: Key,
        label: "Developer Documentation",
        desc: "New 'Developers' section in the docs for SDK and package developers. Documents the finding-types endpoint, SDK development guidelines, and links to the official Python SDK (vulnradar-py) currently in development.",
        category: "added",
      },
      {
        icon: Globe,
        label: "Updated API Documentation",
        desc: "API docs now reflect the /api/v1/ base URL for all authenticated endpoints. Code examples (curl, JavaScript, Python) updated with correct versioned paths. Version endpoint documented as unversioned.",
        category: "changed",
      },
      {
        icon: Shield,
        label: "Scanner Engine v2.0.0",
        desc: "checks-data.json version bumped to 2.0.0 to align with the scanner engine version. All check definitions and scanner components now share the same version number.",
        category: "changed",
      },
    ],
  },
  {
    version: "1.9.4-patch.1",
    date: "February 28, 2026",
    title: "API Key Encryption Fix, Stronger Key Entropy & Validation Overhaul",
    highlights: false,
    changes: [
      {
        icon: Lock,
        label: "Fixed Encrypted Key Validation",
        desc: "Fixed a critical bug where API keys stored with AES-256-GCM encryption could not be validated. The previous implementation incorrectly attempted to compare re-encrypted ciphertexts, which always differ due to random IVs. Validation now decrypts stored keys and compares plaintext values, with automatic fallback to hash-based lookup for legacy keys.",
        category: "security",
      },
      {
        icon: Key,
        label: "Increased API Key Entropy",
        desc: "API key generation upgraded from 24 random bytes (48 hex characters) to 32 random bytes (64 hex characters), significantly increasing key entropy and resistance to brute-force attacks.",
        category: "security",
      },
      {
        icon: Shield,
        label: "Longer Deprecated Placeholders",
        desc: "Deprecated placeholder strings in key_hash column upgraded from 16 random letters to 48 random bytes (96 hex characters). Placeholders are now generated using cryptographically secure randomBytes instead of Math.random(), and are fully random hex strings.",
        category: "security",
      },
      {
        icon: Fingerprint,
        label: "Decrypt-and-Compare Validation",
        desc: "API key validation when encryption is configured now iterates all stored encrypted keys, decrypts each one, and compares against the provided key. Gracefully handles decryption failures per-key and falls back to hash-based lookup for backward compatibility with pre-encryption keys.",
        category: "changed",
      },
      {
        icon: Zap,
        label: "Zero Breaking Changes",
        desc: "Fully backward compatible with existing API keys and installations. No database migrations required. Endpoints that accept API keys (/api/scan, etc.) work seamlessly with both encrypted and hash-stored keys without any client-side changes.",
        category: "changed",
      },
    ],
  },
  {
    version: "1.9.4",
    date: "February 26, 2026",
    title:
      "UI Consistency, Docker Build-Time Vars, Discord Giveaway & Encryption-First API Keys",
    highlights: false,
    changes: [
      {
        icon: Palette,
        label: "Unified Landing & Dashboard Fonts",
        desc: "Fixed landing page header font inconsistency. Landing page header now uses the same sans-serif font (font-sans) as the dashboard, ensuring consistent typography across all pages.",
        category: "fixed",
      },
      {
        icon: Container,
        label: "Docker Build-Time Environment Variable Support",
        desc: "Fixed Docker CAPTCHA integration by implementing proper build-time argument passing. Dockerfile now accepts ARG directives for NEXT_PUBLIC_APP_URL and NEXT_PUBLIC_TURNSTILE_SITE_KEY. These are converted to ENV during build so Next.js embeds them into the client bundle. Turnstile keys are now properly available in Docker containers.",
        category: "fixed",
      },
      {
        icon: Heart,
        label: "Discord Giveaway Notification",
        desc: "Added prominent giveaway notification for 3 months FREE VulnRadar Elite Supporter tier. Notification displays in the bell icon for all users, refreshes every 24 hours, and ends automatically on March 12. Direct link to Discord server for contest entry.",
        category: "added",
      },
      {
        icon: Key,
        label: "Encryption-First API Key Storage",
        desc: "Implemented encryption-first storage strategy for API keys. When API_KEY_ENCRYPTION_KEY is configured, keys are now stored ONLY encrypted (no hash). Only the encrypted key is persisted in the database. Falls back to hash-only for deployments without encryption configured.",
        category: "security",
      },
      {
        icon: Lock,
        label: "Hash-Based Fallback & Conditional Lookup",
        desc: "When API_KEY_ENCRYPTION_KEY is not configured, keys fall back to SHA-256 hash-only storage for O(1) lookup performance. API key validation automatically adapts based on encryption configuration without breaking existing deployments.",
        category: "changed",
      },
    ],
  },
  {
    version: "1.9.3",
    date: "February 24, 2026",
    title: "Admin Version Monitoring & Enhanced Admin Controls",
    highlights: false,
    changes: [
      {
        icon: Bell,
        label: "Automatic Admin Version Monitoring",
        desc: "Admins now automatically receive version update notifications via the notification bell without visiting the admin page. Behind version: check every 24 hours with 'Update Available' alert. Current version: check weekly. Ahead of version: check weekly (early access). Removed manual version check UI from admin dashboard.",
        category: "added",
      },
      {
        icon: Shield,
        label: "Intelligent Notification Frequency",
        desc: "Version monitoring adapts based on deployment state. Behind versions trigger urgent 24-hour reminders with a direct link to changelog. Current and ahead versions check weekly for awareness. Each notification state is tracked with local storage to avoid redundant alerts.",
        category: "added",
      },
      {
        icon: Settings,
        label: "Extended Admin Management Options",
        desc: "Added comprehensive admin controls for managing users, teams, security settings, and platform configuration. Admins now have expanded visibility into user activity, API key management, and system health.",
        category: "added",
      },
      {
        icon: Lock,
        label: "Enhanced Admin Page Security",
        desc: "All admin operations now enforce proper RBAC (role-based access control) with granular permission checks. Admin audit logging added to track sensitive actions and changes.",
        category: "security",
      },
    ],
  },
  {
    version: "1.9.2",
    date: "February 24, 2026",
    title: "Security Hardening, GDPR Compliance & Docker Production Overhaul",
    highlights: false,
    changes: [
      {
        icon: Lock,
        label: "Stricter Password Strength Calculator",
        desc: "Overhauled the password strength scoring system. Added a common password dictionary (120+ passwords), sequential character detection (abc, 123), and repeated character penalties. 'Password' is no longer rated as 'Fair'. Extracted into a shared lib/password-strength.ts used by both signup and reset-password pages.",
        category: "security",
      },
      {
        icon: Key,
        label: "AES-256-GCM API Key Encryption",
        desc: "API keys are now encrypted at rest using AES-256-GCM authenticated encryption in addition to the existing SHA-256 hash lookup. A new API_KEY_ENCRYPTION_KEY environment variable (32-byte hex) enables application-level encryption for secure key storage and admin recovery. The hash is kept for O(1) validation performance.",
        category: "security",
      },
      {
        icon: Globe,
        label: "Expanded Fix Examples for 8 Security Checks",
        desc: "Every major header security check (HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, Server Disclosure, CORS) now includes fix examples for Nginx, Apache, Caddy, Express (Node.js), Deno (Hono), and Bun (Elysia) in addition to Next.js.",
        category: "added",
      },
      {
        icon: Container,
        label: "Docker Production Overhaul",
        desc: "docker-compose.yml now uses the pre-built ghcr.io/vulnradar/vulnradar:latest image by default - no local build required. Added health checks, resource limits, log rotation, and restart policies. A separate docker-compose.dev.yml override enables build-from-source for development. Updated setup docs accordingly.",
        category: "changed",
      },
      {
        icon: ShieldCheck,
        label: "GDPR Compliance & Data Request Links",
        desc: "Added a dedicated GDPR section (Article 15-17 rights) to the Privacy Policy with a direct link to profile data export. 'GDPR / Data Request' link added to both the main footer and the guest footer on public pages. Users in the EU can now easily find how to exercise their data rights.",
        category: "added",
      },
      {
        icon: FileText,
        label: "Privacy Policy Updates",
        desc: "Privacy policy now explicitly references GDPR Articles 15-17, explains how to exercise data rights both in-app and via email, and includes a 30-day response commitment for data requests.",
        category: "changed",
      },
    ],
  },
  {
    version: "1.9.1",
    date: "February 23, 2026",
    title: "ToS Modal & Header Fixes",
    highlights: false,
    changes: [
      {
        icon: FileText,
        label: "ToS modal wording",
        desc: "ToS modal now clearly notifies users that bypassing the acceptance screen does not waive their legal obligations. Ensures the notice displays reliably across guest and authenticated flows.",
        category: "changed",
      },
      {
        icon: Layout,
        label: "Centralized Route & API Constants",
        desc: "Updated header.tsx to fix rendering/auth-state flicker and ensure correct navigation is shown for guests and signed-in users.",
        category: "fixed",
      },
    ],
  },
  {
    version: "1.9.0",
    date: "February 23, 2026",
    title: "Auth-Aware Public Pages, Codebase Refactor & Performance",
    highlights: false,
    changes: [
      {
        icon: Shield,
        label: "Auth-Aware Public Pages",
        desc: "Demo, Staff, Legal, and Shared pages now detect whether the viewer is logged in. Authenticated users see the full Header with navigation and Footer. Guests see a minimal branded header with a Sign In button and compact legal footer. All four layouts share a single reusable PublicPageShell component.",
        category: "added",
      },
      {
        icon: Layout,
        label: "Centralized Route & API Constants",
        desc: "Added ROUTES (25 routes), API (30+ endpoints), ROLE_BADGE_STYLES, and STAFF_ROLES constants to lib/constants.ts. High-traffic shared components (Header, Footer, middleware, AuthProvider, public-page-shell, public-paths) now reference constants instead of hardcoded strings.",
        category: "changed",
      },
      {
        icon: Wrench,
        label: "Role Badge Deduplication",
        desc: "Consolidated 4 separate copies of role badge styling logic in the admin page into a single ROLE_BADGE_STYLES map. Staff, Shared, and Teams pages also use the centralized badge map, ensuring consistent colors for Admin, Moderator, Support, and Beta Tester badges across the entire app.",
        category: "changed",
      },
      {
        icon: Zap,
        label: "Dynamic Imports for Heavy Components",
        desc: "Added next/dynamic lazy loading for 7 below-the-fold components on the Dashboard (IssueDetail, ExportButton, ShareButton, ResponseHeaders, SubdomainDiscovery, CrawlUrlSelector, OnboardingTour) and ImageCropDialog on the Profile page. Reduces initial JavaScript bundle size.",
        category: "performance",
      },
      {
        icon: Lock,
        label: "Auth Flow UI Standardization",
        desc: "Forgot Password and Reset Password pages redesigned to match the Login/Signup card pattern: max-w-sm card, logo + app name header, consistent error alerts using semantic destructive tokens, and password strength indicator on reset. All auth pages now use APP_NAME instead of hardcoded strings.",
        category: "changed",
      },
      {
        icon: Globe,
        label: "Landing Page Refresh",
        desc: "Fixed favicon reference (png to svg), added Demo CTA in hero and navigation, alternated section backgrounds for visual rhythm, added text-balance/text-pretty to headings, and updated stats section with accurate product information.",
        category: "changed",
      },
      {
        icon: Trash2,
        label: "Dead Code Removal",
        desc: "Removed the unused VersionNotification component (superseded by the Notification Center bell). Removed duplicate STAFF_BADGE_COLORS constant from Teams page in favor of centralized ROLE_BADGE_STYLES.",
        category: "changed",
      },
      {
        icon: Eye,
        label: "Accessibility Improvements",
        desc: "Added aria-labels to all icon-only buttons in Teams page (save, cancel, remove member, close panel). Wrapped Footer link grid in a nav landmark with aria-label. Added loading='lazy' to avatar images in Admin, Staff, and Teams pages.",
        category: "changed",
      },
      {
        icon: Link2,
        label: "Semantic Navigation in PublicPageShell",
        desc: "Replaced all button + router.push() patterns with proper next/link Link components in the public page shell for better SEO, accessibility, and browser navigation behavior. Added copyright line to guest footer.",
        category: "changed",
      },
    ],
  },
  {
    version: "1.8.0",
    date: "February 21, 2026",
    title: "Email 2FA, Expanded Notifications & 55+ New Security Checks",
    highlights: false,
    changes: [
      {
        icon: Mail,
        label: "Email-Based Two-Factor Authentication",
        desc: "New 2FA method that sends a 6-digit verification code to your email on every login. Enable it from the Security tab in your profile. Choose between Authenticator App or Email 2FA (one at a time). Codes expire after 10 minutes with rate limiting to prevent abuse.",
        category: "added",
      },
      {
        icon: BellRing,
        label: "18 Granular Notification Preferences",
        desc: "Notification settings expanded from 5 toggles to 18, organized into 5 categories: Security (login alerts, password changes, 2FA changes, session alerts), Scanning (scan complete, failures, severity alerts, schedules), API & Integrations (API keys, usage alerts, webhooks, webhook failures), Account (data exports, account changes, team invites), and Product (updates, tips & guides). Each notification type can be individually toggled.",
        category: "added",
      },
      {
        icon: Target,
        label: "Accurate Notification Routing",
        desc: "All email notifications now route through the correct preference type. Password change emails respect the password_changes toggle, 2FA emails respect two_factor_changes, account updates respect account_changes. Previously all security-adjacent emails used a single generic security type.",
        category: "fixed",
      },
      {
        icon: Radar,
        label: "55+ New Security Checks (175+ Total)",
        desc: "Expanded detection engine to 175+ checks including: header information leaks (X-Powered-By, X-Runtime, X-Debug, Via, X-Backend-Server, ETag inode leaks), advanced CSP analysis (unsafe-inline without nonce, unsafe-eval, wildcard sources, data: URIs), CORS policy validation (null origin, excessive header exposure, preflight caching), referrer policy analysis, server error detection (SQL, PHP, ASP.NET, Django, Laravel), secrets exposure (JWT tokens, private keys, connection strings, .env files, .git directories), and content security (missing iframe sandbox, unencrypted WebSocket, mixed-content forms, inline event handlers).",
        category: "added",
      },
      {
        icon: Bell,
        label: "Notification Bell in Header",
        desc: "Replaced full-screen notification modal with a compact bell icon in the header showing unread count. Notifications (version updates, Discord invites) appear in a dismissible dropdown. Backup codes modal remains separate and always interrupts as a full-screen overlay for security-critical updates.",
        category: "changed",
      },
      {
        icon: Filter,
        label: "Scanner Category Selector",
        desc: "Added 'Select Scanners' button next to Scan button to choose which security categories to run: Security Headers, SSL/TLS, Cookie Security, Content Analysis, Info Disclosure, Configuration, and DNS & Email. Reduces scan time and allows targeted security assessments.",
        category: "added",
      },
      {
        icon: Zap,
        label: "Major Performance Improvements",
        desc: "Fixed admin tab and notification bell from triggering API calls on every page navigation. Moved /api/auth/me to app-level SWR with 5-minute deduping via new AuthProvider context, eliminating duplicate requests and page load freeze. Header now renders instantly with cached auth state.",
        category: "performance",
      },
      {
        icon: Bug,
        label: "Fixed /shared Page Auth Detection",
        desc: "Shared scan links now detect if the viewer is logged in. Authenticated users see the full Header with navigation and the standard Footer. Guests see a minimal header with Sign In button.",
        category: "fixed",
      },
      {
        icon: ShieldAlert,
        label: "Engine Version 2.0.0",
        desc: "Detection engine bumped to v2.0.0 reflecting the massive expansion of security checks, improved categorization, and scanner selector feature.",
        category: "changed",
      },
    ],
  },
  {
    version: "1.7.4",
    date: "February 19, 2026",
    title: "Docker Production Ready, Mobile UX Overhaul & Error Pages",
    highlights: false,
    changes: [
      {
        icon: Container,
        label: "Docker Production Ready",
        desc: "Fixed Dockerfile with a dummy DATABASE_URL during build so Next.js compiles without a live database. Real credentials are injected at runtime via Docker Compose. Updated docker-compose.yml to pass through all env vars (SMTP, Turnstile, contact email). Added Docker Compose overrides to .env.example.",
        category: "fixed",
      },
      {
        icon: Menu,
        label: "Mobile Menu Overlay",
        desc: "Replaced the push-down mobile navigation dropdown with a Sheet overlay that slides in from the right. No longer pushes page content down when opened.",
        category: "changed",
      },
      {
        icon: Smartphone,
        label: "Icon-Only Buttons on Mobile",
        desc: "Buttons with icon + text (View Scans, Invite, Delete Team, Export, Share, Copy Link, Revoke, Clear All, etc.) now show only icons on mobile and full text on desktop across all pages: teams, history, dashboard, badge, and scanner components.",
        category: "changed",
      },
      {
        icon: Pencil,
        label: "Editable Team Names",
        desc: "Team owners and admins can now rename teams inline with a pencil icon, input field, and save/cancel controls. Added a PATCH endpoint to /api/teams.",
        category: "added",
      },
      {
        icon: Image,
        label: "Team Member Avatars",
        desc: "Team member rows now display profile pictures when available, with a fallback to the initial letter avatar. The members API now returns avatar_url from the users table.",
        category: "added",
      },
      {
        icon: ServerCrash,
        label: "Custom Error Page",
        desc: "Added a styled 500 error page with a grid background, terminal-style error digest block, copy-to-clipboard, and navigation links. Matches the existing 404 page design.",
        category: "added",
      },
    ],
  },
  {
    version: "1.7.3",
    date: "February 19, 2026",
    title: "Unified Footer, Contact Upgrades & Error Pages",
    highlights: false,
    changes: [
      {
        icon: Globe,
        label: "Version Check via GitHub Releases",
        desc: "The startup version check and /api/version endpoint now use the GitHub Releases API instead of fetching raw package.json. Console output now shows a direct link to the specific release tag when an update is available.",
        category: "changed",
      },
      {
        icon: Layout,
        label: "Unified Footer Across All Pages",
        desc: "Replaced all inline footers (landing page, docs layout, etc.) with a shared Footer component featuring a 5-column grid layout with Product, Resources, Legal sections, a donate button, and social links.",
        category: "changed",
      },
      {
        icon: Mail,
        label: "Contact Email Auto-Fill",
        desc: "The contact page now auto-fills and locks the email field for logged-in users. Name is also auto-filled but remains editable.",
        category: "added",
      },
      {
        icon: Users,
        label: "Staff Application via Contact Form",
        desc: "Added an 'Apply for Staff' category to the contact form with Support and Moderator roles. Includes a role dropdown, required Discord username, availability field, and a volunteer notice explaining positions are unpaid and voluntary.",
        category: "added",
      },
      {
        icon: ServerCrash,
        label: "Error Pages",
        desc: "Added proper error pages: a client-side error boundary (500) with retry and support links, and a global-error fallback for fatal layout crashes with inline styles.",
        category: "added",
      },
    ],
  },
  {
    version: "1.7.2",
    date: "February 19, 2026",
    title: "Self-Hosted Schema & Stability Fixes",
    highlights: false,
    changes: [
      {
        icon: Database,
        label: "Scan History Save Fix",
        desc: "Fixed scans not saving to history. The INSERT query referenced a non-existent 'scan_notes' column instead of the correct 'notes' column, causing every save to silently fail. Affected the quick scan, deep crawl, and bulk scan routes.",
        category: "fixed",
      },
      {
        icon: Bug,
        label: "Bulk Scan Notes",
        desc: "Bulk scan results now include the default scan note (version + engine info) in the database, matching the behavior of quick scan and deep crawl.",
        category: "fixed",
      },
      {
        icon: Wrench,
        label: "Silent Catch Logging",
        desc: "Added console.error logging to previously silent catch blocks in the scan, crawl, and bulk routes. DB failures during history saves are now logged to the server console instead of being swallowed.",
        category: "fixed",
      },
      {
        icon: Shield,
        label: "Notification Preferences Cleanup",
        desc: "Removed phantom notification preference columns that were referenced in API code but never existed in the schema. All notification routes, lib, and schema are now in sync.",
        category: "fixed",
      },
      {
        icon: FileSearch,
        label: "Docs Column Name Fixes",
        desc: "Fixed documentation examples referencing non-existent columns: 'username' corrected to 'name' in the setup verification SQL, version numbers updated across all docs.",
        category: "fixed",
      },
    ],
  },
  {
    version: "1.7.1",
    date: "February 19, 2026",
    title: "Migration Tool Improvements & Documentation Overhaul",
    highlights: false,
    changes: [
      {
        icon: GitMerge,
        label: "Table & Column Rename Detection",
        desc: "The migration tool now detects renamed tables and columns between versions. When an old name exists in the DB but the new name is expected, it offers to rename it in-place (preserving all data). Rename mappings are defined at the top of migrate.mjs for easy maintenance.",
        category: "added",
      },
      {
        icon: Database,
        label: "Smarter Migration Prompts",
        desc: "Review prompts (non-destructive) now default to Yes (Y/n), while destructive actions (dropping columns/tables) still default to No (y/N). Every action requires explicit confirmation, and table drops require double confirmation.",
        category: "changed",
      },
      {
        icon: Bug,
        label: "Migration Parser Rewrite",
        desc: "Completely rewrote the schema parser from a fragile regex approach to a line-by-line state machine. Correctly handles DEFAULT NOW(), REFERENCES, nested parentheses, and all SQL types. No more false 'extra column' reports for created_at.",
        category: "fixed",
      },
      {
        icon: FileSearch,
        label: "Extra Table Detection",
        desc: "Tables in the database that aren't part of the VulnRadar schema are now flagged as EXTRA TABLE with row counts, and can be selectively dropped. Includes a recommendation to use a dedicated database.",
        category: "added",
      },
      {
        icon: Wrench,
        label: "Documentation Overhaul",
        desc: "Fully updated the Setup and API docs: added Deep Crawl, Crawl Discover, and Version Check endpoints. Setup docs now cover auto-schema via instrumentation.ts, the migration tool, version checking, correct env vars, and accurate table names.",
        category: "changed",
      },
      {
        icon: ServerCog,
        label: "Startup Version Check",
        desc: "Self-hosted instances now log the running version and check GitHub for updates on every server startup. Shows colored messages: green if current, yellow with release link if behind, and a fun message if somehow ahead.",
        category: "added",
      },
      {
        icon: Shield,
        label: "Exact Hostname Crawl Fix",
        desc: "Fixed the crawler following links to subdomains (e.g. r.agg.moe when scanning agg.moe). Now uses exact hostname matching instead of registered domain matching.",
        category: "fixed",
      },
    ],
  },
  {
    version: "1.7.0",
    date: "February 18, 2026",
    title: "Deep Crawl URL Selector, IP Rate-Limited Demo & Auto Scan Notes",
    highlights: false,
    changes: [
      {
        icon: Network,
        label: "Deep Crawl URL Selector",
        desc: "Deep Crawl now discovers pages first, then shows a selection modal where you pick exactly which pages to scan. Toggle individual URLs on/off, search/filter the list, or use Select All/Deselect All. No more scanning pages you don't care about.",
        category: "added",
      },
      {
        icon: Filter,
        label: "Smart Crawl URL Filtering",
        desc: "The crawler now filters out asset files (.css, .js, .woff, .json, etc.), internal framework paths (/_next/, /static/, /api/), and garbage URLs with encoded characters or regex-like patterns. Only real, human-navigable pages are discovered.",
        category: "added",
      },
      {
        icon: Globe,
        label: "Same-Domain Redirect Handling",
        desc: "Sites that redirect (e.g. disutils.com to disutils.com/en/home) are now followed correctly. The crawler checks registered domains instead of strict origins, so language-prefixed redirects and www variants are all crawled properly.",
        category: "fixed",
      },
      {
        icon: Layers,
        label: "Crawl Results Separated by Page",
        desc: "Deep Crawl results now show findings for the URL you entered as the main view. Other crawled pages appear in a collapsible 'Also Crawled' section below the summary, each expandable to view their individual findings.",
        category: "changed",
      },
      {
        icon: Shield,
        label: "IP-Based Demo Rate Limiting",
        desc: "The demo scanner now rate-limits by IP address via the database instead of cookies. 5 scans per 12 hours per IP. No more bypassing limits by clearing cookies.",
        category: "security",
      },
      {
        icon: FileText,
        label: "Auto Scan Notes",
        desc: "Every scan automatically gets a default note with the VulnRadar version and Detection Engine version (e.g. 'VulnRadar v1.7.0 (Detection Engine v1.5.0)'). Notes are saved to the DB immediately and appear on shared scans.",
        category: "added",
      },
      {
        icon: Link2,
        label: "Full URL Display in History",
        desc: "History and Compare pages now show the full URL path (e.g. example.com/docs/api) instead of just the hostname. Compare is restricted to scans from the same domain.",
        category: "changed",
      },
      {
        icon: Lock,
        label: "Demo Subdomain Auth Message",
        desc: "The Subdomain Discovery button on the demo page now shows a friendly 'Log in to use this feature' message instead of a generic error when unauthenticated users try to use it.",
        category: "changed",
      },
      {
        icon: Wrench,
        label: "Code Cleanup",
        desc: "Removed all em-dash patterns from comments and user-visible text across 14 files. Replaced with colons, commas, and parentheses for cleaner copy.",
        category: "changed",
      },
    ],
  },
  {
    version: "1.6.8",
    date: "February 16, 2026",
    title: "Metadata & Social Preview Fixes",
    highlights: false,
    changes: [
      {
        icon: Sparkles,
        label: "Page Metadata Fixed",
        desc: "Resolved an issue where page metadata (title, description, Open Graph and Twitter card tags) sometimes failed to render; social previews and browser titles now display correct content and consistent VulnRadar branding.",
        category: "fixed",
      },
      {
        icon: Newspaper,
        label: "Consistent OG Images",
        desc: "Fixed generation and serving of Open Graph images so link previews show the branded VulnRadar image across Discord, Twitter, and other platforms.",
        category: "fixed",
      },
      {
        icon: CheckCircle,
        label: "Canonical & Meta Tags",
        desc: "Canonical links and meta description are now consistent site-wide; metadata no longer mismatches between server and client renders.",
        category: "fixed",
      },
    ],
  },
  {
    version: "1.6.7",
    date: "February 16, 2026",
    title: "Scan Notes Visibility & Team Collaboration",
    highlights: false,
    changes: [
      {
        icon: Eye,
        label: "Notes Visible to Team Members",
        desc: "Scan notes are now visible to all team members viewing a scan in the history page. Previously, the entire notes section was hidden unless you were the scan owner. Team members can now see notes to stay informed about scan context, known false positives, and remediation progress.",
        category: "added",
      },
      {
        icon: Lock,
        label: "Owner-Only Edit Permissions",
        desc: "Only the original scan owner can add or edit notes. Team members see a read-only view with no edit/add buttons. The backend PATCH endpoint was already restricted to the owner via WHERE user_id, so this enforces the same rule on the frontend.",
        category: "changed",
      },
      {
        icon: Share2,
        label: "Notes on Shared Scans",
        desc: "Shared scan links now include notes in the API response and render them read-only on the shared scan page. Anyone with a share link can see the scan owner's notes, giving external reviewers full context about the scan findings.",
        category: "added",
      },
      {
        icon: MessageSquare,
        label: "Empty State Messaging",
        desc: "Non-owners now see 'No notes for this scan.' instead of the owner-facing 'Click Add Note to annotate this scan.' prompt, making it clear that only the scan creator can add notes.",
        category: "changed",
      },
    ],
  },
  {
    version: "1.6.6",
    date: "February 15, 2026",
    title: "Subdomain Discovery Depth & Deep Scan Prefix",
    highlights: false,
    changes: [
      {
        icon: Search,
        label: "Increased Subdomain Discovery Depth",
        desc: "Subdomain Discovery now fetches up to 150 subdomains per domain (up from 25), providing more comprehensive reconnaissance for larger targets.",
        category: "changed",
      },
      {
        icon: ScanSearch,
        label: "Deep Scan URL Prefix",
        desc: "Quick Scan and Deep Scan now show up to 8 characters of URL path prefix (after the hostname) in scanner UI and history, making it easier to identify exact pages scanned.",
        category: "changed",
      },
    ],
  },
  {
    version: "1.6.5",
    date: "February 15, 2026",
    title: "Scan Depth & Performance Improvements",
    highlights: false,
    changes: [
      {
        icon: Gauge,
        label: "Deeper Crawl Limit",
        desc: "Deep Scan now crawls up to 15 pages (up from 10), providing more thorough website coverage for vulnerability detection.",
        category: "changed",
      },
      {
        icon: Zap,
        label: "Parallel Fetch with Concurrency Limit",
        desc: "Crawler now fetches pages in parallel batches of 3 with a 1-second delay between batches, significantly speeding up deep scans while respecting server rate limits.",
        category: "performance",
      },
      {
        icon: Timer,
        label: "Consistent Fetch Timeout",
        desc: "All HTTP requests now use a consistent 10-second timeout (previously varied between 8-15s), improving scan reliability and predictability.",
        category: "changed",
      },
    ],
  },
  {
    version: "1.6.4",
    date: "February 14, 2026",
    title: "Subdomain Discovery & Real-Time Progress",
    highlights: false,
    changes: [
      {
        icon: Globe,
        label: "Subdomain Discovery",
        desc: "New 'Discover Subdomains' feature on the dashboard. Leverages crt.sh certificate transparency logs to find subdomains for any target domain. Results show subdomain names with one-click scanning.",
        category: "added",
      },
      {
        icon: Activity,
        label: "Real-Time Scan Progress",
        desc: "Scan progress indicator now shows current step (Fetching, Analyzing Headers, Checking Cookies, etc.) in real-time, giving users visibility into what the scanner is doing.",
        category: "added",
      },
      {
        icon: Crosshair,
        label: "Accurate Progress Tracking",
        desc: "Progress bar now accurately reflects completion based on actual scanner phases rather than arbitrary timing, improving user confidence during longer scans.",
        category: "changed",
      },
    ],
  },
  {
    version: "1.6.3",
    date: "February 14, 2026",
    title: "Scanner Category Visualization",
    highlights: false,
    changes: [
      {
        icon: Columns3,
        label: "Category Breakdown Chart",
        desc: "Scan results now include a visual breakdown showing findings by category (Headers, Cookies, SSL, Content, etc.) using a stacked progress bar with tooltips for each category count.",
        category: "added",
      },
      {
        icon: Filter,
        label: "Category Filtering",
        desc: "Click on any category in the breakdown chart to filter the findings list to only show vulnerabilities in that category. Click again to show all.",
        category: "added",
      },
    ],
  },
  {
    version: "1.6.2",
    date: "February 13, 2026",
    title: "Expanded Security Coverage",
    highlights: false,
    changes: [
      {
        icon: ShieldAlert,
        label: "15+ New Security Checks",
        desc: "Added checks for outdated SSL protocols (SSLv3, TLS 1.0, TLS 1.1), weak cipher suites, missing OCSP stapling, short certificate validity, CT log presence, and several new header validations.",
        category: "added",
      },
      {
        icon: AlertTriangle,
        label: "Improved Severity Ratings",
        desc: "Refined severity classifications based on real-world exploitability. Info-level findings separated from actual vulnerabilities for cleaner reporting.",
        category: "changed",
      },
    ],
  },
  {
    version: "1.6.1",
    date: "February 12, 2026",
    title: "Export & Sharing Enhancements",
    highlights: false,
    changes: [
      {
        icon: FileDown,
        label: "CSV Export",
        desc: "Export scan results to CSV format for spreadsheet analysis and integration with other security tools.",
        category: "added",
      },
      {
        icon: FileSpreadsheet,
        label: "Enhanced PDF Reports",
        desc: "PDF exports now include executive summary section, category breakdown charts, and cleaner formatting for client-ready reports.",
        category: "changed",
      },
    ],
  },
  {
    version: "1.6.0",
    date: "February 11, 2026",
    title: "Deep Crawl Scanning",
    highlights: false,
    changes: [
      {
        icon: Network,
        label: "Deep Crawl Mode",
        desc: "New scanning mode that automatically discovers and scans linked pages on a website. Crawls up to 10 pages deep following same-origin links.",
        category: "added",
      },
      {
        icon: Layers,
        label: "Aggregated Findings",
        desc: "Deep Crawl results aggregate findings across all crawled pages with deduplication, showing which vulnerabilities appear on multiple pages.",
        category: "added",
      },
      {
        icon: Link2,
        label: "Link Discovery",
        desc: "Scanner now extracts and validates internal links from HTML content, building a site map for comprehensive coverage.",
        category: "added",
      },
    ],
  },
  {
    version: "1.5.0",
    date: "February 10, 2026",
    title: "Scheduled Scanning & Bulk Operations",
    highlights: false,
    changes: [
      {
        icon: RefreshCw,
        label: "Scheduled Scans",
        desc: "Set up recurring scans on daily, weekly, or monthly intervals. Receive email notifications when scheduled scans complete with summary of changes since last scan.",
        category: "added",
      },
      {
        icon: List,
        label: "Bulk Scanning",
        desc: "Scan up to 10 URLs simultaneously with a single click. Results are grouped and can be compared side-by-side.",
        category: "added",
      },
      {
        icon: Tag,
        label: "Scan Tags",
        desc: "Organize scans with custom tags for easy filtering and grouping in history.",
        category: "added",
      },
    ],
  },
  {
    version: "1.4.0",
    date: "February 10, 2026",
    title: "Team Collaboration",
    highlights: false,
    changes: [
      {
        icon: Users,
        label: "Teams & Organizations",
        desc: "Create teams, invite members via email, and collaborate on security scans. Team members can view shared scan history and results.",
        category: "added",
      },
      {
        icon: UserCheck,
        label: "Role-Based Access",
        desc: "Assign Owner, Admin, or Viewer roles to team members with appropriate permissions for each level.",
        category: "added",
      },
      {
        icon: Mail,
        label: "Team Invitations",
        desc: "Branded email invitations with secure one-click acceptance flow.",
        category: "added",
      },
    ],
  },
  {
    version: "1.3.0",
    date: "February 9, 2026",
    title: "API Access & Webhooks",
    highlights: false,
    changes: [
      {
        icon: Key,
        label: "API Keys",
        desc: "Generate API keys for programmatic scanning. Use the REST API to integrate VulnRadar into your CI/CD pipeline or custom tools.",
        category: "added",
      },
      {
        icon: Zap,
        label: "Webhooks",
        desc: "Configure webhooks to receive scan results via Discord, Slack, or generic HTTP endpoints. Real-time notifications when scans complete.",
        category: "added",
      },
      {
        icon: Gauge,
        label: "Rate Limiting",
        desc: "API rate limiting based on subscription tier with clear headers indicating remaining quota.",
        category: "added",
      },
    ],
  },
  {
    version: "1.2.0",
    date: "February 9, 2026",
    title: "Comparison & History",
    highlights: false,
    changes: [
      {
        icon: Eye,
        label: "Scan Comparison",
        desc: "Compare any two scans side-by-side to see what changed between assessments. Highlights new, resolved, and unchanged findings.",
        category: "added",
      },
      {
        icon: RefreshCw,
        label: "Full Scan History",
        desc: "Complete history of all scans with search, filtering, and pagination. Never lose a scan result again.",
        category: "added",
      },
      {
        icon: Share2,
        label: "Shareable Links",
        desc: "Generate public or team-only share links for scan results. Perfect for client reports or team collaboration.",
        category: "added",
      },
    ],
  },
  {
    version: "1.1.2",
    date: "February 9, 2026",
    title: "Safety Rating Indicator",
    highlights: false,
    changes: [
      {
        icon: ShieldCheck,
        label: "Website Safety Rating",
        desc: "Scan reports now prominently display a safety indicator (Safe to View / View with Caution / Not Safe to View) based on vulnerability severity. This helps non-technical users quickly understand if a website is safe to browse.",
        category: "added",
      },
      {
        icon: Eye,
        label: "PDF Report Safety Rating",
        desc: "Exported PDF reports now include the safety rating section, making it easy to share security assessments with clients and stakeholders.",
        category: "added",
      },
    ],
  },
  {
    version: "1.1.1",
    date: "February 9, 2026",
    title: "Metadata & Branding Polish",
    highlights: false,
    changes: [
      {
        icon: Sparkles,
        label: "Consistent Social Cards",
        desc: "All pages now display unified OpenGraph metadata with consistent VulnRadar branding when shared on Discord, Twitter, or other social platforms.",
        category: "changed",
      },
      {
        icon: Eye,
        label: "Unified Page Titles",
        desc: `Browser tabs now show ${APP_NAME} consistently across all pages for cleaner branding and better recognition.`,
        category: "changed",
      },
      {
        icon: Shield,
        label: "Enhanced Security Headers",
        desc: "Improved Content Security Policy configuration to allow Cloudflare Turnstile while maintaining strong security protections.",
        category: "security",
      },
    ],
  },
  {
    version: "1.1.0",
    date: "February 9, 2026",
    title: "Contact System & UI Enhancements",
    highlights: false,
    changes: [
      {
        icon: MessageSquare,
        label: "Enhanced Contact Form",
        desc: "Redesigned contact page with category selection (Bug Report, Feature Request, Security Issue, General Help) and instant email delivery without blocking the UI.",
        category: "added",
      },
      {
        icon: Shield,
        label: "CAPTCHA Protection",
        desc: "Integrated Cloudflare Turnstile to prevent spam and bot submissions on the contact form while maintaining a seamless user experience.",
        category: "security",
      },
      {
        icon: Users,
        label: "Team Collaboration",
        desc: "Team members can now view each other's scan history and full scan details for better collaboration. Click 'View Scans' next to any team member to see their complete vulnerability scan history and detailed results.",
        category: "added",
      },
      {
        icon: Users,
        label: "Team Invite Emails",
        desc: "Team invitations are now sent via email with secure invite links. Invited members receive professional branded emails with team details and one-click acceptance.",
        category: "added",
      },
      {
        icon: Sparkles,
        label: "Professional Email Templates",
        desc: "Beautiful dark-themed email templates with gradient accents for contact confirmations, password resets, and team invitations.",
        category: "added",
      },
      {
        icon: Zap,
        label: "Instant Response Times",
        desc: "Contact form submissions and password reset requests now respond immediately while emails are sent in the background, dramatically improving user experience.",
        category: "performance",
      },
      {
        icon: Lock,
        label: "Smart Email Routing",
        desc: "Contact emails route with proper Reply-To headers and automatic user confirmations for every submission.",
        category: "changed",
      },
      {
        icon: Eye,
        label: "Improved Scanner UI",
        desc: "Added 'Scan Another URL' button above results for easier navigation and better user flow.",
        category: "changed",
      },
    ],
  },
  {
    version: "1.0.0",
    date: "February 8, 2026",
    title: "First Release",
    highlights: false,
    changes: [
      {
        icon: Shield,
        label: "65+ Security Checks",
        desc: "Comprehensive vulnerability scanning covering HTTP headers, SSL/TLS, content security policies, cookies, server disclosure, DNS, and much more.",
        category: "added",
      },
      {
        icon: Users,
        label: "User Accounts & Auth",
        desc: "Full authentication system with sign up, login, profile management, two-factor authentication (TOTP), backup codes, and secure password reset.",
        category: "added",
      },
      {
        icon: Lock,
        label: "Admin Dashboard",
        desc: "Admin panel with user management, audit logs, session tracking, and the ability to revoke sessions or API keys.",
        category: "added",
      },
      {
        icon: Zap,
        label: "Webhooks & Notifications",
        desc: "Discord, Slack, and generic webhook integrations. Get notified automatically when scans complete.",
        category: "added",
      },
      {
        icon: RefreshCw,
        label: "Scheduled & Bulk Scanning",
        desc: "Set up recurring scans on daily, weekly, or monthly intervals. Scan up to 10 URLs at once with bulk scanning.",
        category: "added",
      },
      {
        icon: Eye,
        label: "Scan Comparison & Sharing",
        desc: "Side-by-side comparison of scan results over time. Generate shareable links for client reports.",
        category: "added",
      },
      {
        icon: Tag,
        label: "Scan Tags & History",
        desc: "Full scan history with search, filtering, and custom tags. Organize scans by project, environment, or client.",
        category: "added",
      },
      {
        icon: List,
        label: "PDF Export",
        desc: "Export scan results as professional PDF reports ready for stakeholders.",
        category: "added",
      },
      {
        icon: Users,
        label: "Teams & Organizations",
        desc: "Create teams, invite members with role-based access (owner/admin/viewer), and collaborate on security scans.",
        category: "added",
      },
      {
        icon: Gauge,
        label: "API Keys & Rate Limiting",
        desc: "Generate API keys for programmatic scanning with built-in rate limiting to prevent abuse.",
        category: "added",
      },
      {
        icon: MessageSquare,
        label: "Contact & Support",
        desc: "Dedicated support page for reporting issues, requesting features, or getting help.",
        category: "added",
      },
      {
        icon: Eye,
        label: "Self-Scan Demo",
        desc: "Try VulnRadar on itself with a one-click demo scan to see the scanner in action, no account required.",
        category: "added",
      },
      {
        icon: Sparkles,
        label: "Onboarding Tour",
        desc: "Interactive walkthrough for first-time users covering all key features.",
        category: "added",
      },
      {
        icon: Newspaper,
        label: "Documentation",
        desc: "Full API documentation, usage guides, legal pages, and this changelog.",
        category: "added",
      },
    ],
  },
];

function CategoryBadge({ category }: { category?: ChangeCategory }) {
  if (!category) return null;
  const { label, color } = CHANGE_CATEGORIES[category];
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${color}`}
    >
      {label}
    </span>
  );
}

export default function ChangelogPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 py-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Changelog</h1>
          <p className="text-muted-foreground">
            Follow along as we ship new security checks, features, and
            improvements.
          </p>
        </div>

        {/* Timeline */}
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-[11px] top-3 bottom-3 w-px bg-border hidden sm:block" />

          <div className="flex flex-col gap-10">
            {CHANGELOG.map((release, index) => (
              <article key={release.version} className="relative">
                {/* Timeline dot */}
                <div
                  className={`absolute left-0 top-1.5 w-[22px] h-[22px] rounded-full border-2 hidden sm:flex items-center justify-center ${
                    index === 0
                      ? "border-primary bg-primary"
                      : "border-border bg-background"
                  }`}
                >
                  {index === 0 && (
                    <div className="w-2 h-2 rounded-full bg-primary-foreground" />
                  )}
                </div>

                <div className="sm:pl-10 flex flex-col gap-4">
                  {/* Version header */}
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-md px-2.5 py-0.5 text-sm font-bold font-mono ${
                          index === 0
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary text-foreground"
                        }`}
                      >
                        v{release.version}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {release.date}
                      </span>
                      {index === 0 && (
                        <span className="inline-flex items-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-2 py-0.5 text-xs font-medium">
                          Latest
                        </span>
                      )}
                    </div>
                    <h2 className="text-lg font-semibold text-foreground">
                      {release.title}
                    </h2>
                    {release.summary && (
                      <p className="text-sm text-muted-foreground">
                        {release.summary}
                      </p>
                    )}
                  </div>

                  {/* Changes list */}
                  <div className="flex flex-col gap-2">
                    {release.changes.map((change, changeIndex) => (
                      <div
                        key={changeIndex}
                        className="flex gap-3 p-3 rounded-lg border border-border/50 bg-card/50 hover:bg-card transition-colors"
                      >
                        <div
                          className={`flex items-center justify-center w-8 h-8 rounded-md shrink-0 ${
                            change.category === "security"
                              ? "bg-red-500/10"
                              : change.category === "added"
                                ? "bg-emerald-500/10"
                                : change.category === "fixed"
                                  ? "bg-amber-500/10"
                                  : change.category === "performance"
                                    ? "bg-purple-500/10"
                                    : "bg-primary/10"
                          }`}
                        >
                          <change.icon
                            className={`h-4 w-4 ${
                              change.category === "security"
                                ? "text-red-600 dark:text-red-400"
                                : change.category === "added"
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : change.category === "fixed"
                                    ? "text-amber-600 dark:text-amber-400"
                                    : change.category === "performance"
                                      ? "text-purple-600 dark:text-purple-400"
                                      : "text-primary"
                            }`}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-0.5">
                            <h3 className="font-medium text-sm text-foreground">
                              {change.label}
                            </h3>
                            <CategoryBadge category={change.category} />
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            {change.desc}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>

        {/* End marker */}
        <div className="flex items-center justify-center mt-12 mb-4">
          <div className="flex items-center gap-3 px-4 py-2 rounded-full border border-border bg-card/50 text-sm text-muted-foreground">
            <div className="w-2 h-2 rounded-full bg-border" />
            <span>The beginning of {APP_NAME}</span>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
