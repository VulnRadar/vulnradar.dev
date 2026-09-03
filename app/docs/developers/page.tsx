import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Zap } from "lucide-react";
import { FaGithub } from "react-icons/fa";
import {
  APP_NAME,
  APP_URL,
  APP_REPO,
  TOTAL_CHECKS_LABEL,
} from "@/lib/config/constants";
import { ALL_CATEGORIES } from "@/lib/scanner/types";
import { CRAWL_PAGE_SELECTION_LIMITS } from "@/lib/billing/crawl-page-limits";
import type { TocItem } from "@/components/docs/docs-types";
import { DocsTocSpy } from "../docs-toc-spy";
import {
  DocsHero,
  DocsSection,
  CodeBlock,
  EndpointTable,
  FieldTable,
  DocsCallout,
  METHOD_COLORS,
  InlineCode,
  DocsTable,
} from "@/components/docs";
import { cn } from "@/lib/ui/utils";

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "finding-types", label: "Finding Types API" },
  { id: "building-sdks", label: "Building SDKs" },
  { id: "sdk-checklist", label: "SDK Checklist" },
  { id: "development", label: "Development Guide" },
  { id: "prerequisites", label: "Prerequisites" },
  { id: "node-version-policy", label: "Node Version Policy" },
  { id: "quick-start", label: "Quick Start" },
  { id: "scripts", label: "Scripts" },
  { id: "linting", label: "Linting" },
  { id: "typecheck", label: "Type Checking" },
  { id: "commits", label: "Commit Conventions" },
  { id: "pull-requests", label: "Pull Request Process" },
  { id: "structure", label: "Project Structure" },
  { id: "pitfalls", label: "Common Pitfalls" },
  { id: "debugging", label: "Debugging" },
  { id: "contributing", label: "Contributing" },
];

const coreEndpoints = [
  {
    endpoint: "/scan",
    method: "POST",
    description: "Run a security scan on a URL",
  },
  {
    endpoint: "/scan/bulk",
    method: "POST",
    description: "Queue up to 100 URLs in one request, then poll each scan id",
  },
  {
    endpoint: "/scan/crawl",
    method: "POST",
    // Rendered from CRAWL_PAGE_SELECTION_LIMITS rather than typed out: the
    // caps moved from a flat 15 to per-plan values and the hardcoded number
    // was left behind. Reading the table means it cannot drift again.
    description: `Deep-crawl and scan up to ${CRAWL_PAGE_SELECTION_LIMITS.free}/${CRAWL_PAGE_SELECTION_LIMITS.core_supporter}/${CRAWL_PAGE_SELECTION_LIMITS.pro_supporter}/${CRAWL_PAGE_SELECTION_LIMITS.elite_supporter} pages by plan; unlimited when billing is off`,
  },
  {
    endpoint: "/scan/crawl/discover",
    method: "POST",
    description:
      "Discover crawlable URLs, capped by the CRAWL_DISCOVER_MAX_PAGES setting (ships at 500)",
  },
  {
    endpoint: "/scan/discover",
    method: "POST",
    description: "Enumerate subdomains via crt.sh, HackerTarget, etc.",
  },
  {
    endpoint: "/history",
    method: "GET",
    description: "List scan history (up to 100 most recent)",
  },
  {
    endpoint: "/history/[id]",
    method: "GET",
    description: "Get full scan details, findings, and response headers",
  },
  {
    endpoint: "/history",
    method: "DELETE",
    description: "Wipe ALL scans for the authenticated user",
  },
  {
    endpoint: "/history/[id]",
    method: "DELETE",
    description: "Delete a single scan (owner only)",
  },
];

const findingTypeFields = [
  {
    field: "id",
    type: "string",
    description: "Unique identifier (e.g., hsts-missing)",
  },
  {
    field: "type",
    type: "string",
    description: "Detection type (e.g., header, content, combined)",
  },
  {
    field: "title",
    type: "string",
    description: "Human-readable title for display",
  },
  {
    field: "category",
    type: "string",
    description: `One of the ${ALL_CATEGORIES.length} categories in lib/scanner/types.ts: ${ALL_CATEGORIES.join(", ")}`,
  },
  {
    field: "severity",
    type: "string",
    description: "critical | high | medium | low | info",
  },
  {
    field: "description",
    type: "string",
    description: "Short human description",
  },
];

const sdkChecklist = [
  "Bearer-token authentication via vr_live_ prefix",
  "Configurable base URL (defaults to APP_URL/api/v3)",
  "Type-safe response models matching the Vulnerability type",
  "Typed exception classes for each HTTP status",
  "Rate-limit handling with exponential backoff",
  "Honors X-RateLimit-Reset, Retry-After, X-RateLimit-Remaining",
  "Configurable timeout per request",
  "Supports webhooks verification (HMAC if added later)",
  "Example usage in README",
  "Unit tests with mocked fetch responses",
];

export default function DevelopersPage() {
  return (
    <div className="space-y-12 sm:space-y-16">
      <DocsTocSpy items={tocItems} />
      <DocsHero
        id="top"
        badge="SDK Development"
        title="Developer Documentation"
        description={`Build SDKs, integrations, and tools for ${APP_NAME}: the finding types API, SDK conventions, and the contributor guide for the codebase itself.`}
        stats={[
          { value: TOTAL_CHECKS_LABEL, label: "Detection Checks" },
          { value: "GPL-3.0", label: "License" },
          { value: "v3", label: "API Version" },
        ]}
      />

      <DocsSection id="overview" title="Overview">
        <p className="text-sm text-muted-foreground">
          This page covers two audiences:
        </p>
        <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground mt-3">
          <li>
            <strong className="text-foreground">SDK authors</strong> integrating
            with <InlineCode>/api/v3/*</InlineCode> from another language.
          </li>
          <li>
            <strong className="text-foreground">Contributors</strong> working on
            the {APP_NAME} codebase itself.
          </li>
        </ul>
        <p className="mt-4 text-sm text-muted-foreground">
          Endpoints, request/response shapes, and rate-limit semantics live on
          the{" "}
          <Link
            href="/docs/api"
            className="text-primary underline-offset-2 hover:underline"
          >
            API Reference
          </Link>{" "}
          and{" "}
          <Link
            href="/docs/rate-limits"
            className="text-primary underline-offset-2 hover:underline"
          >
            Rate Limits
          </Link>{" "}
          pages. The rest of this page is the integration manual.
        </p>
      </DocsSection>

      <DocsSection id="finding-types" title="Finding Types API">
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          The Finding Types endpoint returns the full catalogue of detection
          checks. Use it to display human-readable titles, categorize findings,
          or build SDKs that know every check ID ahead of time.
        </p>

        <Card className="p-6 border-border/40">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Badge
              className={cn("border font-mono text-xs", METHOD_COLORS.GET)}
            >
              GET
            </Badge>
            <InlineCode className="text-sm">/api/v3/finding-types</InlineCode>
            <Badge variant="outline" className="text-xs ml-auto">
              Public
            </Badge>
          </div>

          <div className="space-y-6">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Request
              </h3>
              <CodeBlock
                code={`curl ${APP_URL}/api/v3/finding-types`}
                language="bash"
              />
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Response
              </h3>
              <CodeBlock
                code={`{
  "success": true,
  "count": 695,
  "data": [
    {
      "id": "hsts-missing",
      "type": "header",
      "title": "HSTS Header Missing",
      "category": "headers",
      "severity": "medium",
      "description": "HTTP Strict Transport Security header is not set."
    },
    {
      "id": "csp-missing",
      "type": "header",
      "title": "Content Security Policy Header Missing",
      "category": "headers",
      "severity": "medium",
      "description": "Content Security Policy header is not set."
    }
  ]
}`}
                language="json"
              />
              <p className="text-xs text-muted-foreground mt-2">
                Backed by{" "}
                <InlineCode>lib/scanner/checks-data/*.json</InlineCode>, one
                file per category, for the 652 legacy checks. Adding one of
                those means editing the JSON for its category and the matching
                detector in <InlineCode>lib/scanner/checks/</InlineCode>. The
                other 43 checks live on a newer{" "}
                <InlineCode>PageCheck</InlineCode> architecture under{" "}
                <InlineCode>lib/scanner/checks/page-checks/</InlineCode> with
                metadata declared inline; see{" "}
                <Link
                  href="/docs/architecture#scanner"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  Architecture
                </Link>
                .
              </p>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Response fields
              </h3>
              <FieldTable fields={findingTypeFields} />
            </div>
          </div>
        </Card>
      </DocsSection>

      <DocsSection id="building-sdks" title="Building SDKs">
        <p className="text-sm text-muted-foreground">
          When building an SDK for {APP_NAME}, follow these guidelines.
        </p>

        <Card className="p-6 border-border/40 space-y-8">
          <div>
            <h4 className="text-sm font-semibold mb-3">1. Authentication</h4>
            <p className="text-sm text-muted-foreground mb-3">
              All authenticated requests require a Bearer token. Keys are
              prefixed <InlineCode>vr_live_</InlineCode>:
            </p>
            <CodeBlock
              code="Authorization: Bearer vr_live_xxxxxxxxxxxxxxxxxxxxxxxx"
              language="http"
            />
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-3">2. Base URL</h4>
            <CodeBlock code={`${APP_URL}/api/v3`} language="text" />
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-3">3. Core endpoints</h4>
            <EndpointTable endpoints={coreEndpoints} />
            <p className="text-xs text-muted-foreground mt-3">
              Full request/response shapes: see{" "}
              <Link
                href="/docs/api"
                className="text-primary underline-offset-2 hover:underline"
              >
                API Reference
              </Link>
              .
            </p>
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-3">4. Error handling</h4>
            <p className="max-w-[68ch] text-sm text-muted-foreground">
              Each non-2xx response includes a JSON body with at minimum an{" "}
              <InlineCode>error</InlineCode> string. Map HTTP status to typed
              exceptions (400 / 401 / 403 / 404 / 422 / 429 / 500). On 429,
              honour the <InlineCode>Retry-After</InlineCode> header and the{" "}
              <InlineCode>X-RateLimit-Reset</InlineCode> header.
            </p>
          </div>
        </Card>

        <div id="sdk-checklist" className="scroll-mt-24">
          <Card className="p-6 border-border/40 bg-primary/5">
            <h3 className="text-base font-semibold mb-4">SDK Checklist</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-muted-foreground">
              {sdkChecklist.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <DocsCallout variant="info" title="A Python SDK already exists">
          <p>
            <InlineCode>pip install vulnradar</InlineCode> wraps this API with
            typed response models and a proper exception hierarchy. Source and
            usage docs:{" "}
            <a
              href="https://github.com/VulnRadar/Python-SDK"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline-offset-2 hover:underline"
            >
              github.com/VulnRadar/Python-SDK
            </a>
            . Building one in another language? Open an issue on GitHub with a
            link and we will list it here. Requirements: GPL-3.0 compatible
            license, type-safe models, real tests against a live instance.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="development" title="Development Guide">
        <p className="text-sm text-muted-foreground">
          Setup for contributing to {APP_NAME}. Covers local dev, scripts,
          commit conventions, common pitfalls.
        </p>
      </DocsSection>

      <DocsSection id="prerequisites" title="Prerequisites" className="ml-0">
        <DocsCallout
          variant="warning"
          title="Node 22 is required, not just recommended"
        >
          <p>
            The <InlineCode>engines</InlineCode> field in{" "}
            <InlineCode>package.json</InlineCode> is{" "}
            <InlineCode>{`{ "node": ">=22.0.0" }`}</InlineCode>. There is no
            fallback to Node 20: the Dockerfile builds and runs on{" "}
            <InlineCode>node:22.11.0-alpine</InlineCode>, and CI runs the full
            lint, typecheck, test, and build matrix on Node 22 only. Match that
            locally.
          </p>
        </DocsCallout>
        <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground mt-4">
          <li>
            <strong className="text-foreground">Node.js 22 LTS</strong> (the{" "}
            <InlineCode>.nvmrc</InlineCode> at the repo root says{" "}
            <InlineCode>22</InlineCode>)
          </li>
          <li>
            <strong className="text-foreground">npm 10+</strong> (ships with
            Node 22)
          </li>
          <li>
            <strong className="text-foreground">PostgreSQL 14+</strong> (local
            install or via Docker)
          </li>
          <li>
            <strong className="text-foreground">Git</strong>
          </li>
        </ul>
      </DocsSection>

      <DocsSection
        id="node-version-policy"
        title="Node Version Policy"
        className="ml-0"
      >
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          {APP_NAME} targets{" "}
          <strong className="text-foreground">Node.js 22 LTS</strong>{" "}
          exclusively.
          <InlineCode>vitest@4</InlineCode>, the test runner, additionally
          enforces <InlineCode>^20.0.0 || ^22.0.0 || &gt;=24.0.0</InlineCode> in
          its own <InlineCode>engines</InlineCode> field, which is why an
          odd-numbered release like 21 or 23 fails before a single test runs
          rather than failing with a confusing error partway through.
        </p>
        <p className="text-sm text-muted-foreground mt-3">
          Confirm your version and switch if needed:
        </p>
        <CodeBlock
          language="bash"
          code={`# nvm / fnm / volta / asdf will all auto-pick this from the repo root
nvm use          # reads .nvmrc (which says 22)

# or install + use explicitly
nvm install 22
nvm use 22
node --version  # should print v22.x.x`}
        />
        <DocsCallout variant="warning" title="We will ask you to switch first">
          <p>
            Bug reports filed against Node 20 or earlier get closed with a
            request to reproduce on 22 before we look further. If a real bug
            exists, it reproduces on 22 too, so open it there directly and save
            a round trip.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="quick-start" title="Quick Start" className="ml-0">
        <CodeBlock
          language="bash"
          code={`# 1. Clone
git clone https://github.com/${APP_REPO}.git
cd vulnradar.dev

# 2. Install dependencies
npm ci

# 3. Set up environment
cp .env.example .env
# Edit .env: DATABASE_URL, API_KEY_ENCRYPTION_KEY, NEXT_PUBLIC_APP_URL

# 4. Start the dev server (schema auto-creates on first boot)
npm run dev
# → http://localhost:3000`}
        />
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          The first run auto-initializes the schema via{" "}
          <InlineCode>instrumentation.ts</InlineCode>. Watch for{" "}
          <InlineCode>Database schema verified successfully</InlineCode> in the
          logs. The very first account created on a fresh install is made{" "}
          <InlineCode>super_admin</InlineCode> automatically, so on a new
          instance you just sign up and you already have full access. Only run
          the SQL below to promote a <em>later</em> account, and note it grants{" "}
          <InlineCode>admin</InlineCode>, which is one level below the first
          account. Running it against the first account would demote it, and no
          screen in the product can grant <InlineCode>super_admin</InlineCode>{" "}
          back.
        </p>
        <CodeBlock
          language="sql"
          code={`UPDATE users SET role = 'admin' WHERE email = 'someone-else@example.com';`}
        />
      </DocsSection>

      <DocsSection id="scripts" title="Scripts" className="ml-0">
        <p className="max-w-[68ch] text-muted-foreground mb-3">
          Every npm script and what it does. Defined in{" "}
          <InlineCode>package.json</InlineCode>. Not listed:{" "}
          <InlineCode>predev</InlineCode> and <InlineCode>prebuild</InlineCode>,
          which npm runs for you and which both do the same work as{" "}
          <InlineCode>npm run build:knowledge</InlineCode>.
        </p>
        <DocsTable
          caption="Every npm script and what it does"
          columns={[
            {
              key: "cmd",
              header: "Script",
              className: "font-mono whitespace-nowrap",
            },
            { key: "what", header: "What it does", className: "w-full" },
          ]}
          data={[
            {
              cmd: "npm run dev",
              what: "Start Next.js dev server (HMR) on port 3000",
            },
            {
              cmd: "npm run build",
              what: "Production build (next build)",
            },
            {
              cmd: "npm start",
              what: "Run the production build",
            },
            {
              cmd: "npm run lint",
              what: "ESLint over the repo (no --fix)",
            },
            {
              cmd: "npm run lint:fix",
              what: "ESLint with --fix (auto-fixes where safe)",
            },
            {
              cmd: "npm run typecheck",
              what: "tsc --noEmit, the hard CI gate",
            },
            {
              cmd: "npm run format",
              what: "Prettier --write on every supported file type",
            },
            {
              cmd: "npm run format:check",
              what: "Prettier --check (no writes)",
            },
            {
              cmd: "npm test",
              what: "Vitest single run over tests/, mirrors the source tree",
            },
            {
              cmd: "npm run test:watch",
              what: "Vitest in watch mode",
            },
            {
              cmd: "npm run test:coverage",
              what: "Vitest with v8 coverage (per-file thresholds)",
            },
            {
              cmd: "npm run db:migrate",
              what: "Run scripts/migrate/migrate.mjs (interactive)",
            },
            {
              cmd: "npm run db:migrate:dry-run",
              what: "Same, but only prints the plan",
            },
            {
              cmd: "npm run db:create",
              what: "Run scripts/create-fresh-db/create-fresh-db.mjs (side-by-side DB clone)",
            },
            {
              cmd: "npm run db:create:dry-run",
              what: "Same, but only prints the plan",
            },
            {
              cmd: "npm run db:diagnose",
              what: "Introspect the live schema and report data corruption: FK orphans, columns that will not decrypt, bad enum values, impossible timestamps. Read-only",
            },
            {
              cmd: "npm run db:repair",
              what: "Apply the fixes db:diagnose found. Dry run by default; real writes need --apply --admin-id=<id> and are logged to admin_audit_log",
            },
            {
              cmd: "npm run db:diagnose-2fa",
              what: "Report accounts whose 2FA columns are internally inconsistent. Read-only",
            },
            {
              cmd: "npm run db:repair-2fa",
              what: "Fix only the rows db:diagnose-2fa proved corrupt. It cannot unlock a healthy account",
            },
            {
              cmd: "npm run db:repair-sequences",
              what: "Reset the Postgres identity sequences, which is what causes duplicate-key errors on insert after a restore",
            },
            {
              cmd: "npm run db:migrate-avatars",
              what: "One-off: move avatars stored as database blobs onto the filesystem",
            },
            {
              cmd: "npm run db:backup",
              what: "Write a full dump. Run this before any upgrade or repair",
            },
            {
              cmd: "npm run db:restore",
              what: "Restore a dump written by db:backup",
            },
            {
              cmd: "npm run build:knowledge",
              what: "Regenerate every AI knowledge file. CI fails the PR if the committed output does not match, so run this after editing docs, changelog, checks, or legal pages",
            },
            {
              cmd: "npm run docs:compile",
              what: "Regenerate lib/ai/docs-knowledge.md only",
            },
            {
              cmd: "npm run changelog:compile",
              what: "Regenerate the changelog knowledge file only",
            },
            {
              cmd: "npm run checks:compile",
              what: "Regenerate the checks knowledge file and lib/config/check-stats.generated.ts",
            },
            {
              cmd: "npm run legal:compile",
              what: "Regenerate the legal knowledge file only",
            },
            {
              cmd: "npm run audit:new",
              what: "Start a new entry in audits/. The other audit:* scripts (add-finding, list, show, close) work the same record",
            },
          ]}
        />
      </DocsSection>

      <DocsSection id="linting" title="Linting" className="ml-0">
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          ESLint 9 with flat config (<InlineCode>eslint.config.mjs</InlineCode>
          ). The config wraps <InlineCode>next/core-web-vitals</InlineCode> for
          React / Next / TS rules. CI runs <InlineCode>npm run lint</InlineCode>{" "}
          and fails on errors. Warnings don&apos;t block the build.
        </p>
        <CodeBlock
          language="bash"
          code={`npm run lint        # check
npm run lint:fix    # auto-fix`}
        />
        <p className="text-sm text-muted-foreground mt-3">
          Notable rule overrides:
        </p>
        <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
          <li>
            <InlineCode>@typescript-eslint/no-unused-vars</InlineCode> →{" "}
            <InlineCode>warn</InlineCode> (with <InlineCode>^_</InlineCode>{" "}
            underscore convention)
          </li>
          <li>
            <InlineCode>@typescript-eslint/no-explicit-any</InlineCode> →{" "}
            <InlineCode>warn</InlineCode>
          </li>
          <li>
            <InlineCode>@next/next/no-html-link-for-pages</InlineCode> → off (we
            use <InlineCode>&lt;Link&gt;</InlineCode> exclusively)
          </li>
          <li>
            <InlineCode>react/no-unescaped-entities</InlineCode> → off (too
            noisy for our content)
          </li>
        </ul>
      </DocsSection>

      <DocsSection id="typecheck" title="Type Checking" className="ml-0">
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          <InlineCode>tsc --noEmit</InlineCode> is a hard gate in CI. The build
          also fails on TypeScript errors via Next.js (
          <InlineCode>next.config.mjs</InlineCode> has{" "}
          <InlineCode>typescript.ignoreBuildErrors</InlineCode> unset). All
          merged code must type-check cleanly.
        </p>
      </DocsSection>

      <DocsSection id="commits" title="Commit Conventions" className="ml-0">
        <p className="text-sm text-muted-foreground">
          Conventional Commits format:
        </p>
        <CodeBlock
          language="text"
          code={`<type>(<scope>): <subject>

<body>

<footer>`}
        />
        <DocsTable
          className="mt-4"
          caption="Conventional Commits type prefixes and what each is used for"
          columns={[
            {
              key: "type",
              header: "Type",
              className: "font-mono whitespace-nowrap",
            },
            { key: "what", header: "Used for", className: "w-full" },
          ]}
          data={[
            { type: "feat", what: "New user-facing feature" },
            { type: "fix", what: "Bug fix" },
            {
              type: "chore",
              what: "Maintenance, deps, tooling, no production change",
            },
            { type: "refactor", what: "Code change with no behavior change" },
            { type: "docs", what: "Documentation only" },
            { type: "style", what: "Formatting only (no logic change)" },
            { type: "test", what: "Adding or updating tests" },
            { type: "perf", what: "Performance improvement" },
            { type: "ci", what: "CI/CD changes" },
          ]}
        />
        <p className="text-sm text-muted-foreground mt-4">Examples:</p>
        <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
          <li>
            <InlineCode>feat(scan): add WebSocket CSWSH check</InlineCode>
          </li>
          <li>
            <InlineCode>fix(auth): correct TOTP clock skew handling</InlineCode>
          </li>
          <li>
            <InlineCode>chore(deps): bump next to 15.5.19</InlineCode>
          </li>
          <li>
            <InlineCode>docs: add /docs/architecture page</InlineCode>
          </li>
        </ul>
      </DocsSection>

      <DocsSection
        id="pull-requests"
        title="Pull Request Process"
        className="ml-0"
      >
        <ol className="list-decimal pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            Branch off <InlineCode>main</InlineCode> (
            <InlineCode>git switch -c fix/short-name</InlineCode>)
          </li>
          <li>Make focused commits (one logical change per commit)</li>
          <li>
            Run <InlineCode>npm run lint</InlineCode>,{" "}
            <InlineCode>npm run typecheck</InlineCode>,{" "}
            <InlineCode>npm test</InlineCode>, and{" "}
            <InlineCode>npm run build</InlineCode> locally
          </li>
          <li>
            Use the PR template (
            <InlineCode>.github/pull_request_template.md</InlineCode>)
          </li>
          <li>
            Wait for CI (lint + typecheck + test + build + auto-applied labels)
          </li>
          <li>Request review from CODEOWNERS on security-critical paths</li>
          <li>After 1+ approval, squash-merge</li>
        </ol>
      </DocsSection>

      <DocsSection id="structure" title="Project Structure" className="ml-0">
        <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
          <li>
            <InlineCode>app/</InlineCode>: Next.js App Router (file-system
            routing)
          </li>
          <li>
            <InlineCode>components/</InlineCode>: React components
          </li>
          <li>
            <InlineCode>lib/</InlineCode>: Server-side libraries
          </li>
          <li>
            <InlineCode>hooks/</InlineCode>: Custom React hooks
          </li>
          <li>
            <InlineCode>public/</InlineCode>: Static assets
          </li>
          <li>
            <InlineCode>scripts/</InlineCode>: admin and DB scripts (
            <InlineCode>migrate/</InlineCode>,{" "}
            <InlineCode>create-fresh-db/</InlineCode>,{" "}
            <InlineCode>_lib/</InlineCode>)
          </li>
          <li>
            <InlineCode>instrumentation.ts</InlineCode>: Next.js startup hooks
            (schema init + version check)
          </li>
          <li>
            <InlineCode>middleware.ts</InlineCode>: auth middleware
          </li>
          <li>
            <InlineCode>next.config.mjs</InlineCode>,{" "}
            <InlineCode>tailwind.config.mjs</InlineCode>,{" "}
            <InlineCode>eslint.config.mjs</InlineCode>,{" "}
            <InlineCode>vitest.config.ts</InlineCode>,{" "}
            <InlineCode>tsconfig.json</InlineCode>
          </li>
        </ul>
        <p className="text-sm text-muted-foreground mt-4">
          Deeper tour: see the{" "}
          <Link
            href="/docs/architecture"
            className="text-primary underline-offset-2 hover:underline"
          >
            Architecture
          </Link>{" "}
          page.
        </p>
      </DocsSection>

      <DocsSection id="pitfalls" title="Common Pitfalls" className="ml-0">
        <ol className="list-decimal pl-6 space-y-3 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">
              Editing a value in{" "}
              <InlineCode>lib/config/constants.ts</InlineCode> or{" "}
              <InlineCode>registry.ts</InlineCode>:
            </strong>{" "}
            both derive from <InlineCode>config-values.ts</InlineCode>. Edit{" "}
            <InlineCode>config-values.ts</InlineCode> to move the shipped
            default, or change the value in Admin &rarr; Settings if it is
            runtime tier, which 239 of the 268 settings are.
          </li>
          <li>
            <strong className="text-foreground">
              Adding a database table:
            </strong>{" "}
            add the <InlineCode>CREATE TABLE IF NOT EXISTS</InlineCode> to{" "}
            <InlineCode>instrumentation.ts</InlineCode> (the canonical source)
            AND mirror it to{" "}
            <InlineCode>scripts/migrate/versions/_snippets.mjs</InlineCode>.
          </li>
          <li>
            <strong className="text-foreground">Adding a new API route:</strong>{" "}
            copy an existing one in{" "}
            <InlineCode>app/api/v3/.../route.ts</InlineCode>; wrap with{" "}
            <InlineCode>withErrorHandling</InlineCode>, use{" "}
            <InlineCode>parseBody</InlineCode> +{" "}
            <InlineCode>Validate</InlineCode> for input, and pick the right
            rate-limit helper from <InlineCode>lib/rate-limiting/</InlineCode>.
          </li>
          <li>
            <strong className="text-foreground">Adding a new icon:</strong> use{" "}
            <InlineCode>lucide-react</InlineCode> (default) or{" "}
            <InlineCode>react-icons</InlineCode>
            (already installed). Don&apos;t bundle a new icon set.
          </li>
          <li>
            <strong className="text-foreground">Adding a constant:</strong> if
            it&apos;s a deployment tunable, add it to{" "}
            <InlineCode>lib/config/config-values.ts</InlineCode> as a{" "}
            <InlineCode>CONFIG_*</InlineCode>. Avoid magic numbers in route
            handlers. If an admin should be able to change it without a
            redeploy, also add an entry to{" "}
            <InlineCode>lib/config/registry.ts</InlineCode>: a bare constant
            with no registry entry never appears in the admin settings UI.
          </li>
        </ol>
      </DocsSection>

      <DocsSection id="debugging" title="Debugging" className="ml-0">
        <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">Server logs:</strong> stdout
            from <InlineCode>npm run dev</InlineCode> or{" "}
            <InlineCode>docker compose logs -f app</InlineCode>
          </li>
          <li>
            <strong className="text-foreground">Database queries:</strong>{" "}
            temporarily add <InlineCode>console.log</InlineCode> in{" "}
            <InlineCode>lib/database/db-utils.ts</InlineCode> (or any{" "}
            <InlineCode>pool.query</InlineCode> caller)
          </li>
          <li>
            <strong className="text-foreground">Auth issues:</strong> inspect
            the session cookie in browser devtools (name:{" "}
            <InlineCode>vulnradar_session</InlineCode>)
          </li>
          <li>
            <strong className="text-foreground">Build issues:</strong> the
            Dockerfile does <strong className="text-foreground">not</strong> use
            Next.js <InlineCode>output: standalone</InlineCode>; it copies{" "}
            <InlineCode>.next</InlineCode> +{" "}
            <InlineCode>node_modules</InlineCode> from the build stage. Comments
            in <InlineCode>next.config.mjs</InlineCode> explain why.
          </li>
        </ul>
      </DocsSection>

      <DocsSection id="contributing" title="Contributing">
        <Card className="p-6 border-primary/50 bg-primary/5">
          <div className="flex items-start gap-3">
            <Zap className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <h3 className="text-base font-semibold mb-2">Open source</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {APP_NAME} is GPL-3.0 open source and welcomes contributions:
                bug fixes, new checks, documentation, SDKs, and translations.
              </p>
              <div className="flex flex-wrap gap-3">
                <a
                  href={`https://github.com/${APP_REPO}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-background border border-border text-sm font-medium hover:bg-muted transition-colors"
                >
                  <FaGithub className="h-4 w-4" />
                  View on GitHub
                  <ExternalLink className="h-3 w-3 opacity-50" />
                </a>
              </div>
            </div>
          </div>
        </Card>
      </DocsSection>
    </div>
  );
}
