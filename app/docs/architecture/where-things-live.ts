import { REPO_DIRS } from "./repo-dirs.generated";

type RepoPath =
  | (typeof REPO_DIRS.top)[number]
  | `lib/${(typeof REPO_DIRS.lib)[number]}`
  | `components/${(typeof REPO_DIRS.components)[number]}`;

export type WhereRow = { dir: string; what: string; doc: string };

/**
 * The two columns a directory listing cannot write. Keyed by the generated
 * union, so a directory with no row here, or a row for a directory that is
 * gone, stops the typecheck rather than leaving a blank cell on the page.
 *
 * `doc` is a docs path, or a repo file when that is where the area is written
 * up. tests/app/docs/architecture-where-things-live.test.ts resolves each one.
 */
const NOTES: Record<RepoPath, { what: string; doc: string }> = {
  ".github": {
    what: "CI workflows, the scan-gate Action, issue and PR templates, CODEOWNERS and Dependabot.",
    doc: "/docs/architecture#cicd",
  },
  app: {
    what: "Next.js App Router: every page, layout and API route.",
    doc: "/docs/architecture#api",
  },
  audits: {
    what: "Past audit runs, one folder each, with the findings behind them.",
    doc: "audits/README.md",
  },
  cli: {
    what: "The vulnradar npm package: one entrypoint and its library.",
    doc: "/docs/cli",
  },
  components: {
    what: "React components, one folder per product surface. Listed below.",
    doc: "/docs/architecture#layout-components",
  },
  extension: {
    what: "The Chrome and Firefox extension, with its own package and build.",
    doc: "/docs/extension",
  },
  hooks: {
    what: "The subscription verification hook. The other shared hooks are in lib/hooks.",
    doc: "/docs/billing",
  },
  lib: {
    what: "Everything that is not a component: scanner, auth, billing, database, config. Listed below.",
    doc: "/docs/architecture#layout-lib",
  },
  public: {
    what: "Static files served as they are: icons, Open Graph images, extension screenshots.",
    doc: "/docs/architecture",
  },
  scripts: {
    what: "Database migrations, repair tools, backups and the knowledge compilers.",
    doc: "scripts/README.md",
  },
  tests: {
    what: "Mirrors the source tree, see tests/README.md.",
    doc: "tests/README.md",
  },

  "lib/admin": {
    what: "Admin panel data: audit queries, usage reports, staff gates, the alert webhook.",
    doc: "/docs/administration",
  },
  "lib/ai": {
    what: "The chat, AI verification and summaries, and the generated knowledge files.",
    doc: "/docs/ai",
  },
  "lib/api": {
    what: "Request helpers: API key auth, parseBody, Validate, ApiResponse.",
    doc: "/docs/architecture#api",
  },
  "lib/audit": {
    what: "The framework behind the audits folder and scripts/audit.",
    doc: "audits/README.md",
  },
  "lib/auth": {
    what: "Sessions, two-step verification, password hashing, device trust, staff checks.",
    doc: "/docs/architecture#auth",
  },
  "lib/backup": {
    what: "Database backup jobs and the scheduled worker.",
    doc: "/docs/administration",
  },
  "lib/billing": {
    what: "Stripe, the plan catalog, credits and usage.",
    doc: "/docs/architecture#billing",
  },
  "lib/brand": {
    what: "The brand kit data behind /brand.",
    doc: "/docs/architecture",
  },
  "lib/browserbase": {
    what: "Browser sessions: the client, the concurrency queue, the log poller.",
    doc: "/docs/scanning",
  },
  "lib/changelog": {
    what: "The release notes /changelog renders.",
    doc: "/docs/architecture",
  },
  "lib/config": {
    what: "Every tunable: config-values.ts, the settings registry, env validation.",
    doc: "/docs/architecture#config",
  },
  "lib/database": {
    what: "The connection pool, query helpers, boot steps and schema files.",
    doc: "/docs/architecture#database",
  },
  "lib/discord": {
    what: "Discord sign-in and profile helpers.",
    doc: "/docs/account-security",
  },
  "lib/domains": {
    what: "Domain ownership checks, scope rules and the re-verify worker.",
    doc: "/docs/scanning",
  },
  "lib/email": {
    what: "Transactional email: sending, layouts and campaigns.",
    doc: "/docs/config",
  },
  "lib/github": {
    what: "GitHub OAuth, saved connections and API calls.",
    doc: "/docs/github",
  },
  "lib/history": {
    what: "Scan history: list filters, rescans and scan ids.",
    doc: "/docs/triage",
  },
  "lib/hooks": {
    what: "Shared React hooks.",
    doc: "/docs/architecture",
  },
  "lib/i18n": {
    what: "Locales, the message catalog and the translation guide.",
    doc: "lib/i18n/README.md",
  },
  "lib/logging": {
    what: "Logging, path and value redaction, request errors.",
    doc: "/docs/troubleshooting",
  },
  "lib/net": {
    what: "Small network helpers: host matching and Discord webhook URLs.",
    doc: "/docs/webhooks",
  },
  "lib/notifications": {
    what: "In-app notifications and the posture digest.",
    doc: "/docs/account-security",
  },
  "lib/rate-limiting": {
    what: "Rate limit buckets, daily quotas and concurrent-scan slots.",
    doc: "/docs/rate-limits",
  },
  "lib/reports": {
    what: "SARIF, Markdown, CSV, PDF and compliance reports.",
    doc: "/docs/reports",
  },
  "lib/scanner": {
    what: "The detection engine: checks, check data, active probes, protocol scanners.",
    doc: "/docs/architecture#scanner",
  },
  "lib/seo": {
    what: "Page metadata and the content of the /checks pages.",
    doc: "/docs/architecture",
  },
  "lib/support": {
    what: "Support tickets and contact submissions.",
    doc: "/docs/administration",
  },
  "lib/tags": {
    what: "Scan tags and the rules that apply them automatically.",
    doc: "/docs/triage",
  },
  "lib/teams": {
    what: "Team helpers: the plan gate, scan sharing, team audit rows.",
    doc: "/docs/teams",
  },
  "lib/tour": {
    what: "The product tour's steps and positioning.",
    doc: "/docs/architecture",
  },
  "lib/ui": {
    what: "Client helpers: animation tokens, dates, plurals, clipboard.",
    doc: "/docs/architecture",
  },
  "lib/updater": {
    what: "In-app updates: release lookup, checksum and signature checks, apply.",
    doc: "/docs/self-hosting",
  },
  "lib/uploads": {
    what: "Avatar validation and storage.",
    doc: "/docs/account-security",
  },
  "lib/webhooks": {
    what: "Webhook delivery, signing and scan notifications.",
    doc: "/docs/webhooks",
  },

  "components/admin": {
    what: "The admin panel.",
    doc: "/docs/administration",
  },
  "components/ai-chat": {
    what: "The floating support chat.",
    doc: "/docs/ai",
  },
  "components/assets": {
    what: "The /assets list of discovered hosts.",
    doc: "/docs/scanning",
  },
  "components/auth": {
    what: "Sign-in, sign-up and password reset forms.",
    doc: "/docs/account-security",
  },
  "components/badge": {
    what: "The badge builder at /badge.",
    doc: "/docs/sharing",
  },
  "components/billing": {
    what: "Checkout screens and credit purchases.",
    doc: "/docs/billing",
  },
  "components/brand": {
    what: "The /brand page.",
    doc: "/docs/architecture",
  },
  "components/browser": {
    what: "Pieces of the live browser session viewer.",
    doc: "/docs/scanning",
  },
  "components/changelog": {
    what: "The /changelog page.",
    doc: "/docs/architecture",
  },
  "components/compare": {
    what: "Comparing two scans.",
    doc: "/docs/sharing",
  },
  "components/contact": {
    what: "The contact form and the support ticket dialog.",
    doc: "/docs/troubleshooting",
  },
  "components/dashboard": {
    what: "The dashboard's loading state.",
    doc: "/docs/scanning",
  },
  "components/demo": {
    what: "The public demo scan.",
    doc: "/docs/scanning",
  },
  "components/docs": {
    what: "This documentation site: shell, navigation, tables, code blocks.",
    doc: "/docs/architecture",
  },
  "components/domains": {
    what: "The domain control panel at /domains.",
    doc: "/docs/scanning",
  },
  "components/history": {
    what: "Scan history lists and detail headers.",
    doc: "/docs/triage",
  },
  "components/host": {
    what: "The per-host page: danger score trend, takedown line.",
    doc: "/docs/scanning",
  },
  "components/landing": {
    what: "The marketing landing page.",
    doc: "/docs/architecture",
  },
  "components/legal": {
    what: "Shared layout for the legal pages.",
    doc: "/docs/architecture",
  },
  "components/modals": {
    what: "Dialogs used across surfaces: profile cards, image crop, terms.",
    doc: "/docs/architecture",
  },
  "components/pricing": {
    what: "The /pricing page.",
    doc: "/docs/billing",
  },
  "components/profile": {
    what: "Profile tabs and their dialogs.",
    doc: "/docs/account-security",
  },
  "components/providers": {
    what: "The auth and theme React providers.",
    doc: "/docs/architecture#auth",
  },
  "components/public-scans": {
    what: "The public scans directory.",
    doc: "/docs/sharing",
  },
  "components/repos": {
    what: "GitHub repository scans at /repos.",
    doc: "/docs/github",
  },
  "components/scanner": {
    what: "The scan form and the results view.",
    doc: "/docs/scanning",
  },
  "components/seo": {
    what: "Structured data and the scan call-to-action on SEO pages.",
    doc: "/docs/architecture",
  },
  "components/shared": {
    what: "Components more than one surface uses: dialogs, alerts, copy feedback, the tour.",
    doc: "/docs/architecture",
  },
  "components/shares": {
    what: "The /shares list of shared scans.",
    doc: "/docs/sharing",
  },
  "components/support": {
    what: "Translated messages in support conversations.",
    doc: "/docs/administration",
  },
  "components/teams": {
    what: "Team management screens.",
    doc: "/docs/teams",
  },
  "components/ui": {
    what: "shadcn/ui primitives.",
    doc: "/docs/architecture",
  },
};

export const WHERE_THINGS_LIVE: Record<keyof typeof REPO_DIRS, WhereRow[]> = {
  top: REPO_DIRS.top.map((dir) => ({ dir: `${dir}/`, ...NOTES[dir] })),
  lib: REPO_DIRS.lib.map((dir) => ({
    dir: `lib/${dir}/`,
    ...NOTES[`lib/${dir}` as const],
  })),
  components: REPO_DIRS.components.map((dir) => ({
    dir: `components/${dir}/`,
    ...NOTES[`components/${dir}` as const],
  })),
};
