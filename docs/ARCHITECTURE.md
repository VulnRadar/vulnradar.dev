# Architecture

VulnRadar is a Next.js 15 App Router application with a modular, multi-tenant-ready structure.

## Project Layout

```
vulnradar.dev/
├── app/                    # Next.js App Router (file-system routing)
│   ├── (auth)/             # Public auth pages (login, signup, etc.)
│   ├── admin/              # Admin dashboard (role-gated)
│   ├── api/v2/             # REST API v2
│   ├── dashboard/          # User dashboard
│   ├── docs/               # Public documentation site
│   ├── history/            # Scan history
│   ├── legal/              # Legal pages (terms, privacy, etc.)
│   ├── pricing/            # Pricing page + checkout
│   ├── profile/            # User profile
│   ├── teams/              # Team management
│   ├── layout.tsx          # Root layout
│   └── globals.css         # Global styles + Tailwind
│
├── components/             # React components (mostly client-side)
│   ├── admin/              # Admin-specific (audit, features, notifications, etc.)
│   ├── auth/               # Auth forms
│   ├── badge/              # Public badge widgets
│   ├── billing/            # Stripe checkout
│   ├── compare/            # Scan comparison UI
│   ├── contact/            # Contact form
│   ├── demo/               # Demo scan UI
│   ├── docs/               # Documentation site components
│   ├── history/            # History UI
│   ├── landing/            # Marketing landing page
│   ├── legal/              # Legal page components
│   ├── modals/             # Modal dialogs
│   ├── pricing/            # Pricing UI
│   ├── profile/            # Profile tabs
│   ├── providers/          # React context providers
│   ├── scanner/            # Scan UI (results, dashboard, etc.)
│   ├── shared/             # Shared UI (notification center, etc.)
│   ├── shares/             # Public scan shares
│   ├── teams/              # Team UI
│   └── ui/                 # shadcn/ui primitives
│
├── hooks/                  # Custom React hooks
│
├── lib/                    # Server-side libraries (no React)
│   ├── api/                # API helpers, deprecation, request utils
│   ├── auth/               # Sessions, permissions, 2FA, password strength
│   ├── billing/            # Stripe integration, plans
│   ├── config/             # ★ Configuration (see CONFIG.md)
│   ├── database/           # PostgreSQL pool + query helpers
│   ├── discord/            # Discord OAuth utilities
│   ├── email/              # Transactional email templates
│   ├── features/           # Feature flag utilities
│   ├── hooks/              # Server hooks (admin heartbeat)
│   ├── notifications/      # In-app + email notifications
│   ├── rate-limiting/      # Login/signup/scan rate limits
│   ├── reports/            # PDF report generation
│   ├── scanner/            # ★ Security scanner engine (310+ checks)
│   ├── types/              # Shared TypeScript types (config, etc.)
│   └── ui/                 # Animation utilities, classNames
│
├── instrumentation.ts      # Next.js instrumentation (DB init, version check)
├── middleware.ts           # Auth middleware (cookie validation, redirects)
│
├── public/                 # Static assets (favicons, og-image, .well-known)
│
├── scripts/                # Build/admin scripts
│   ├── migrate.mjs
│   └── create-fresh-db.mjs
│
├── docs/                   # ★ Project documentation (CONFIG, ARCHITECTURE, etc.)
│
├── .github/                # GitHub-specific (workflows, dependabot, etc.)
│   ├── workflows/
│   ├── dependabot.yml
│   ├── labeler.yml
│   ├── CODEOWNERS
│   └── pull_request_template.md
│
├── .vscode/, .idea/        # Editor settings (gitignored)
├── next.config.mjs         # Next.js config
├── tsconfig.json           # TypeScript config
├── tailwind.config.ts      # Tailwind config
├── postcss.config.mjs      # PostCSS config
├── eslint.config.mjs       # ESLint 9 flat config
├── Dockerfile              # Multi-stage Docker build
├── docker-compose.yml      # Production compose (app + postgres)
├── SECURITY.md             # Security policy
└── package.json
```

## Key Subsystems

### 1. Configuration (`lib/config/`)

See [CONFIG.md](CONFIG.md) for the full architecture. Single source of truth:
`lib/config/config-values.ts` → `lib/types/config.ts` (typed `DEFAULT_CONFIG`) →
`lib/config/constants.ts` (re-exports + route maps) → application code.

### 2. Database (`lib/database/`)

- **Driver:** `@neondatabase/serverless` (works against vanilla Postgres too via `pg`)
- **Pool:** Single `pool` instance in `lib/database/db.ts`
- **Schema:** Created by `scripts/create-fresh-db.mjs` (idempotent CREATE TABLE IF NOT EXISTS)
- **Migrations:** `scripts/migrate.mjs` for ad-hoc migrations
- **Type-safety:** Hand-written query results (no ORM) — simpler for this codebase

### 3. Authentication (`lib/auth/`)

- **Sessions:** iron-session, HttpOnly cookies, 7-day TTL (`CONFIG_SESSION_TIMEOUT_DAYS`)
- **Password hashing:** bcrypt (12 rounds)
- **2FA:** TOTP via `otplib` + email fallback codes
- **Device trust:** 30-day cookies for "remember this device"
- **API auth:** Bearer tokens (`vr_live_...`) for REST API, encrypted at rest with AES-256

### 4. Scanner Engine (`lib/scanner/`)

The 310+ security checks live in:

- `lib/scanner/checks.ts` — sync checks (headers, cookies, TLS, etc.)
- `lib/scanner/async-checks.ts` — async checks (crawling, content analysis)
- `lib/scanner/protocols/` — protocol-specific scanners
  - `https.ts` — TLS/SSL validation, certificate chain
  - `websocket.ts` — WS handshake + message inspection
  - `ftp.ts` — FTP/FTPS protocol checks
- `lib/scanner/safe-fetch.ts` — wrapped fetch with SSRF protections
- `lib/scanner/access-rules.ts` — robots.txt, scope whitelist
- `lib/scanner/safety-rating.ts` — score calculation
- `lib/scanner/types.ts` — shared types

Each check returns a `Finding` with severity (`info` / `low` / `medium` / `high` / `critical`).

### 5. API Layer (`app/api/v2/`)

REST v1 + v2 are both supported. Each route:

- Uses `withErrorHandling` wrapper (lib/api/api-utils.ts)
- Validates input with Zod (`Validate` helper)
- Returns standardized `ApiResponse.success` / `.error` / `.serverError`
- Rate-limited via `lib/rate-limiting/`

### 6. Billing (`lib/billing/`)

- Stripe Checkout for plan purchases
- Webhook handling in `app/api/v2/webhooks/stripe/route.ts`
- Plan limits + retention controlled by `CONFIG_BILLING_*` constants

### 7. Auth Permissions (`lib/auth/permissions.ts` + `permissions-client.ts`)

Role hierarchy: `user` (0) → `beta_tester` (0) → `support` (1) → `moderator` (2) → `admin` (3)

`hasStaffPermission` / `canAccessAdmin` / `canAccessStaffPage` helpers enforce RBAC at the API + UI layer.

## Request Lifecycle

```
┌──────────────────────────────────────────────────────────────┐
│  Browser → Next.js Request                                     │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  middleware.ts                                                  │
│   - Parse session cookie → load session.userId               │
│   - Check PUBLIC_PATHS allowlist                              │
│   - Redirect unauthenticated users to /login                 │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  Route handler (e.g. app/api/v2/scan/route.ts)                │
│   1. withErrorHandling wrapper                                  │
│   2. Auth check (getSession or API key)                        │
│   3. Rate limit check (lib/rate-limiting)                     │
│   4. Input validation (Zod via Validate)                       │
│   5. Business logic                                            │
│   6. Database query (lib/database)                             │
│   7. ApiResponse.success or .error                             │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  instrumentation.ts (startup hooks)                            │
│   - Initialize database schema on first boot                  │
│   - Version check via /api/version                              │
└──────────────────────────────────────────────────────────────┘
```

## CI/CD Pipeline

```
┌──────────────────────────────────────────────┐
│  On push to main / PR                          │
└──────────────────────────────────────────────┘
                  │
       ┌──────────┼──────────┬──────────────┐
       ▼          ▼          ▼              ▼
   ┌──────┐  ┌────────┐  ┌────────┐   ┌────────────┐
   │ Lint │  │Typecheck│  │ Build  │   │ CodeQL     │
   │(ESL) │  │ (tsc)  │  │(Next)  │   │ (default   │
   │ 9    │  │        │  │        │   │  setup)    │
   └──────┘  └────────┘  └────────┘   └────────────┘

┌──────────────────────────────────────────────┐
│  On tag v*                                    │
└──────────────────────────────────────────────┘
                  │
                  ▼
         ┌──────────────────┐
         │  Docker publish  │
         │  (ghcr.io)        │
         └──────────────────┘

┌──────────────────────────────────────────────┐
│  Weekly / on PR                               │
└──────────────────────────────────────────────┘
                  │
       ┌──────────┼──────────┐
       ▼          ▼          ▼
   ┌──────┐  ┌────────┐  ┌────────┐
   │Stale │  │ Label  │  │Depend-│
   │      │  │  (PR)  │  │ abot  │
   └──────┘  └────────┘  └────────┘
                                │
                                ▼
                      ┌──────────────┐
                      │Dependabot   │
                      │auto-merge   │
                      │(patch only) │
                      └──────────────┘
```

See `.github/workflows/` for the exact definitions and `docs/DEVELOPMENT.md` for the
developer workflow.

## See also

- [CONFIG.md](CONFIG.md) — configuration architecture
- [DEVELOPMENT.md](DEVELOPMENT.md) — local dev setup
- [SELF_HOSTING.md](SELF_HOSTING.md) — Docker deployment
