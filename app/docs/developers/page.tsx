"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  FileJson,
  Package,
  GitBranch,
  ExternalLink,
  Zap,
  BookOpen,
  ServerCog,
} from "lucide-react";
import { FaGithub } from "react-icons/fa";
import { APP_NAME, APP_URL, TOTAL_CHECKS_LABEL } from "@/lib/config/constants";
import { useDocsContext, type TocItem } from "../layout";
import {
  DocsHero,
  DocsSection,
  CodeBlock,
  EndpointTable,
  FieldTable,
  DocsCallout,
} from "@/components/docs";

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "finding-types", label: "Finding Types API" },
  { id: "building-sdks", label: "Building SDKs" },
  { id: "sdk-checklist", label: "SDK Checklist", level: 2 },
  { id: "development", label: "Development Guide" },
  { id: "prerequisites", label: "Prerequisites", level: 2 },
  { id: "quick-start", label: "Quick Start", level: 2 },
  { id: "scripts", label: "Scripts", level: 2 },
  { id: "linting", label: "Linting", level: 2 },
  { id: "typecheck", label: "Type Checking", level: 2 },
  { id: "commits", label: "Commit Conventions", level: 2 },
  { id: "pull-requests", label: "Pull Request Process", level: 2 },
  { id: "structure", label: "Project Structure", level: 2 },
  { id: "pitfalls", label: "Common Pitfalls", level: 2 },
  { id: "debugging", label: "Debugging", level: 2 },
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
    description: "Scan up to 100 URLs in one request",
  },
  {
    endpoint: "/scan/crawl",
    method: "POST",
    description: "Deep-crawl and scan up to 15 pages",
  },
  {
    endpoint: "/scan/crawl/discover",
    method: "POST",
    description: "Discover up to 20 crawlable URLs",
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
    description:
      "Detection category: headers, ssl, content, cookies, configuration, information-disclosure, dns",
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
  "Configurable base URL (defaults to APP_URL/api/v2)",
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
  const { setActiveSection, setTocItems } = useDocsContext();
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    setTocItems(tocItems);
    return () => setTocItems([]);
  }, [setTocItems]);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    );

    tocItems.forEach((item) => {
      const el = document.getElementById(item.id);
      if (el) observerRef.current?.observe(el);
    });

    return () => observerRef.current?.disconnect();
  }, [setActiveSection]);

  return (
    <div className="space-y-16">
      <DocsHero
        badge="SDK Development"
        title="Developer Documentation"
        description={`Build SDKs, integrations, and tools for ${APP_NAME}. Everything you need to programmatically interact with the security scanning platform.`}
        stats={[
          { value: TOTAL_CHECKS_LABEL, label: "Detection Checks" },
          { value: "GPL-3.0", label: "License" },
          { value: "v2", label: "API Version" },
        ]}
      />

      <DocsSection id="overview" title="Overview">
        <p>This page covers two audiences:</p>
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground mt-3">
          <li>
            <strong>SDK authors</strong> integrating with <code>/api/v3/*</code>{" "}
            from another language.
          </li>
          <li>
            <strong>Contributors</strong> working on the VulnRadar codebase
            itself.
          </li>
        </ul>
        <p className="mt-4">
          Endpoints, request/response shapes, and rate-limit semantics live on
          the <Link href="/docs/api">API Reference</Link> and{" "}
          <Link href="/docs/rate-limits">Rate Limits</Link> pages. The rest of
          this page is the integration manual.
        </p>
      </DocsSection>

      <DocsSection id="finding-types" title="Finding Types API" icon={FileJson}>
        <p className="text-muted-foreground">
          The Finding Types endpoint returns the full catalogue of detection
          checks. Use it to display human-readable titles, categorize findings,
          or build SDKs that know every check ID ahead of time.
        </p>

        <Card className="p-6 border-border/40">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Badge className="bg-blue-600/20 text-blue-600 border-blue-600/30 border font-mono text-xs">
              GET
            </Badge>
            <code className="text-primary font-mono text-sm">
              /api/v3/finding-types
            </code>
            <Badge variant="outline" className="text-xs ml-auto">
              Public
            </Badge>
          </div>

          <div className="space-y-6">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Request
              </h4>
              <CodeBlock
                code={`curl ${APP_URL}/api/v3/finding-types`}
                language="bash"
              />
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Response
              </h4>
              <CodeBlock
                code={`{
  "success": true,
  "count": 709,
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
                Backed by <code>lib/scanner/checks-data.json</code>. Source of
                truth for finding metadata; update that file when adding a new
                check.
              </p>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Response fields
              </h4>
              <FieldTable fields={findingTypeFields} />
            </div>
          </div>
        </Card>
      </DocsSection>

      <DocsSection id="building-sdks" title="Building SDKs" icon={Package}>
        <p className="text-muted-foreground">
          When building an SDK for {APP_NAME}, follow these guidelines.
        </p>

        <Card className="p-6 border-border/40 space-y-8">
          <div>
            <h4 className="font-semibold mb-3">1. Authentication</h4>
            <p className="text-sm text-muted-foreground mb-3">
              All authenticated requests require a Bearer token. Keys are
              prefixed <code>vr_live_</code>:
            </p>
            <CodeBlock
              code="Authorization: Bearer vr_live_xxxxxxxxxxxxxxxxxxxxxxxx"
              language="http"
            />
          </div>

          <div>
            <h4 className="font-semibold mb-3">2. Base URL</h4>
            <CodeBlock code={`${APP_URL}/api/v2`} language="text" />
          </div>

          <div>
            <h4 className="font-semibold mb-3">3. Core endpoints</h4>
            <EndpointTable endpoints={coreEndpoints} />
            <p className="text-xs text-muted-foreground mt-3">
              Full request/response shapes: see{" "}
              <Link href="/docs/api">API Reference</Link>.
            </p>
          </div>

          <div>
            <h4 className="font-semibold mb-3">4. Error handling</h4>
            <p className="text-sm text-muted-foreground">
              Each non-2xx response includes a JSON body with at minimum an{" "}
              <code>error</code> string. Map HTTP status to typed exceptions
              (400 / 401 / 403 / 404 / 422 / 429 / 500). On 429, honour the{" "}
              <code>Retry-After</code> header and the{" "}
              <code>X-RateLimit-Reset</code> header.
            </p>
          </div>
        </Card>

        <div id="sdk-checklist" className="scroll-mt-24">
          <Card className="p-6 border-border/40 bg-primary/5">
            <h3 className="font-semibold mb-4">SDK Checklist</h3>
            <div className="grid sm:grid-cols-2 gap-3 text-sm text-muted-foreground">
              {sdkChecklist.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <DocsCallout variant="info" title="Building your own SDK?">
          <p>
            No official SDKs are published at this time. A community SDK in any
            language is welcome — open an issue on GitHub with a link and we
            will list it here. Requirements: GPL-3.0 compatible license,
            type-safe models, real tests against a live instance.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="development" title="Development Guide" icon={Zap}>
        <p className="text-muted-foreground">
          Setup for contributing to VulnRadar. Covers local dev, scripts, commit
          conventions, common pitfalls.
        </p>
      </DocsSection>

      <DocsSection
        id="prerequisites"
        title="Prerequisites"
        icon={FileJson}
        className="ml-0"
      >
        <div className="rounded-lg border-2 border-amber-500/40 bg-amber-500/5 p-4 mb-6">
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-300 mb-2">
            Node.js 22 LTS is the standardised runtime
          </p>
          <p className="text-sm text-muted-foreground">
            The package.json engines field accepts Node 20 LTS and Node 22 LTS
            (odd-numbered releases like 21 and 23 are excluded by vitest@4 and
            friends). CI runs on Node 22. The Dockerfile uses{" "}
            <code>node:20-alpine</code> for the runtime image. Local dev should
            match CI: Node 22 LTS. See the Node Version Policy below for the why
            and how.
          </p>
        </div>
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
          <li>
            <strong>Node.js 22 LTS</strong> (the <code>.nvmrc</code> at the repo
            root says <code>22</code>)
          </li>
          <li>
            <strong>npm 10+</strong> (ships with Node 22)
          </li>
          <li>
            <strong>PostgreSQL 14+</strong> (local install or via Docker)
          </li>
          <li>
            <strong>Git</strong>
          </li>
        </ul>
      </DocsSection>

      <DocsSection
        id="node-version-policy"
        title="Node Version Policy"
        icon={ServerCog}
        className="ml-0"
      >
        <p className="text-muted-foreground">
          VulnRadar standardises on <strong>Node.js 22 LTS</strong>. Node 20 LTS
          is also supported (engines field in package.json accepts both).
          Odd-numbered releases (21, 23) and pre-20 builds are not supported and
          are not investigated in bug reports.
        </p>
        <p className="text-muted-foreground mt-3">
          The following packages list an explicit <code>engines</code> field
          that excludes versions outside the supported set:
        </p>
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground mt-2">
          <li>
            <code>vitest@4</code>:{" "}
            <code>^20.0.0 || ^22.0.0 || &gt;=24.0.0</code>
          </li>
          <li>
            <code>balanced-match@4</code>: <code>18 || 20 || &gt;=22</code>
          </li>
          <li>
            <code>brace-expansion@5</code>: <code>18 || 20 || &gt;=22</code>
          </li>
          <li>
            <code>minimatch@10</code>: <code>18 || 20 || &gt;=22</code>
          </li>
        </ul>
        <p className="text-muted-foreground mt-4">
          Confirm with <code>node --version</code> and switch if needed:
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
        <DocsCallout variant="warning">
          <p>
            Bug reports on unsupported Node versions will be closed without
            investigation. The fix is <code>nvm use</code>, not a code change.
            If a real bug exists on Node 22 LTS, it will reproduce there too —
            open the report against 22 and we will look at it.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection
        id="quick-start"
        title="Quick Start"
        icon={Zap}
        className="ml-0"
      >
        <CodeBlock
          language="bash"
          code={`# 1. Clone
git clone https://github.com/VulnRadar/vulnradar.dev.git
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
        <p className="text-muted-foreground">
          The first run auto-initializes the schema via{" "}
          <code>instrumentation.ts</code>. Watch for{" "}
          <code>Database schema verified successfully</code> in the logs. To
          create an admin user, sign up normally, then promote via SQL:
        </p>
        <CodeBlock
          language="sql"
          code={`UPDATE users SET role = 'admin' WHERE email = 'you@example.com';`}
        />
      </DocsSection>

      <DocsSection id="scripts" title="Scripts" icon={Package} className="ml-0">
        <p className="text-muted-foreground mb-3">
          Every npm script and what it does. Defined in{" "}
          <code>package.json</code>.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 font-semibold text-xs">Script</th>
                <th className="text-left py-2 font-semibold text-xs">
                  What it does
                </th>
              </tr>
            </thead>
            <tbody className="text-muted-foreground">
              {[
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
                  what: "tsc --noEmit — hard CI gate",
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
                  what: "Vitest single run (39 tests, 5 files)",
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
                  cmd: "npm run audit:v2-tables",
                  what: "Diff instrumentation.ts vs _snippets.mjs; exit 1 on drift",
                },
              ].map((row, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="py-2.5">
                    <code>{row.cmd}</code>
                  </td>
                  <td className="py-2.5 text-xs">{row.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DocsSection>

      <DocsSection
        id="linting"
        title="Linting"
        icon={FileJson}
        className="ml-0"
      >
        <p className="text-muted-foreground">
          ESLint 9 with flat config (<code>eslint.config.mjs</code>). The config
          wraps <code>next/core-web-vitals</code> for React / Next / TS rules.
          CI runs <code>npm run lint</code> and fails on errors. Warnings
          don&apos;t block the build.
        </p>
        <CodeBlock
          language="bash"
          code={`npm run lint        # check
npm run lint:fix    # auto-fix`}
        />
        <p className="text-muted-foreground mt-3">Notable rule overrides:</p>
        <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
          <li>
            <code>@typescript-eslint/no-unused-vars</code> → <code>warn</code>{" "}
            (with <code>^_</code> underscore convention)
          </li>
          <li>
            <code>@typescript-eslint/no-explicit-any</code> → <code>warn</code>
          </li>
          <li>
            <code>@next/next/no-html-link-for-pages</code> → off (we use{" "}
            <code>&lt;Link&gt;</code> exclusively)
          </li>
          <li>
            <code>react/no-unescaped-entities</code> → off (too noisy for our
            content)
          </li>
        </ul>
      </DocsSection>

      <DocsSection
        id="typecheck"
        title="Type Checking"
        icon={FileJson}
        className="ml-0"
      >
        <p className="text-muted-foreground">
          <code>tsc --noEmit</code> is a hard gate in CI. The build also fails
          on TypeScript errors via Next.js (<code>next.config.mjs</code> has{" "}
          <code>typescript.ignoreBuildErrors</code> unset). All merged code must
          type-check cleanly.
        </p>
      </DocsSection>

      <DocsSection
        id="commits"
        title="Commit Conventions"
        icon={GitBranch}
        className="ml-0"
      >
        <p className="text-muted-foreground">Conventional Commits format:</p>
        <CodeBlock
          language="text"
          code={`<type>(<scope>): <subject>

<body>

<footer>`}
        />
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 font-semibold text-xs">Type</th>
                <th className="text-left py-2 font-semibold text-xs">
                  Used for
                </th>
              </tr>
            </thead>
            <tbody className="text-muted-foreground">
              {[
                ["feat", "New user-facing feature"],
                ["fix", "Bug fix"],
                ["chore", "Maintenance, deps, tooling, no production change"],
                ["refactor", "Code change with no behavior change"],
                ["docs", "Documentation only"],
                ["style", "Formatting only (no logic change)"],
                ["test", "Adding or updating tests"],
                ["perf", "Performance improvement"],
                ["ci", "CI/CD changes"],
              ].map(([type, what], i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="py-2.5">
                    <code>{type}</code>
                  </td>
                  <td className="py-2.5 text-xs">{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground mt-4">Examples:</p>
        <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
          <li>
            <code>feat(scan): add WebSocket CSWSH check</code>
          </li>
          <li>
            <code>fix(auth): correct TOTP clock skew handling</code>
          </li>
          <li>
            <code>chore(deps): bump next to 15.5.19</code>
          </li>
          <li>
            <code>docs: add /docs/architecture page</code>
          </li>
        </ul>
      </DocsSection>

      <DocsSection
        id="pull-requests"
        title="Pull Request Process"
        icon={GitBranch}
        className="ml-0"
      >
        <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
          <li>
            Branch off <code>main</code> (
            <code>git switch -c fix/short-name</code>)
          </li>
          <li>Make focused commits (one logical change per commit)</li>
          <li>
            Run <code>npm run lint</code>, <code>npm run typecheck</code>,{" "}
            <code>npm test</code>, and <code>npm run build</code> locally
          </li>
          <li>
            Use the PR template (<code>.github/pull_request_template.md</code>)
          </li>
          <li>
            Wait for CI (lint + typecheck + test + build + auto-applied labels)
          </li>
          <li>Request review from CODEOWNERS on security-critical paths</li>
          <li>After 1+ approval, squash-merge</li>
        </ol>
      </DocsSection>

      <DocsSection
        id="structure"
        title="Project Structure"
        icon={FileJson}
        className="ml-0"
      >
        <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
          <li>
            <code>app/</code> — Next.js App Router (file-system routing)
          </li>
          <li>
            <code>components/</code> — React components
          </li>
          <li>
            <code>lib/</code> — Server-side libraries
          </li>
          <li>
            <code>hooks/</code> — Custom React hooks
          </li>
          <li>
            <code>public/</code> — Static assets
          </li>
          <li>
            <code>scripts/</code> — Admin / DB scripts (<code>migrate/</code>,{" "}
            <code>create-fresh-db/</code>, <code>_lib/</code>)
          </li>
          <li>
            <code>instrumentation.ts</code> — Next.js startup hooks (schema init
            + version check)
          </li>
          <li>
            <code>middleware.ts</code> — Auth middleware
          </li>
          <li>
            <code>next.config.mjs</code>, <code>tailwind.config.ts</code>,{" "}
            <code>eslint.config.mjs</code>, <code>vitest.config.ts</code>,{" "}
            <code>tsconfig.json</code>
          </li>
        </ul>
        <p className="text-muted-foreground mt-4">
          Deeper tour: see the{" "}
          <Link href="/docs/architecture">Architecture</Link> page.
        </p>
      </DocsSection>

      <DocsSection
        id="pitfalls"
        title="Common Pitfalls"
        icon={Zap}
        className="ml-0"
      >
        <ol className="list-decimal pl-6 space-y-3 text-muted-foreground">
          <li>
            <strong>
              Editing <code>lib/types/config.ts</code> defaults
            </strong>{" "}
            — they are derived from <code>config-values.ts</code>. Edit{" "}
            <code>config-values.ts</code> instead.
          </li>
          <li>
            <strong>Adding a database table</strong> — add the{" "}
            <code>CREATE TABLE IF NOT EXISTS</code> to{" "}
            <code>instrumentation.ts</code> (the canonical source) AND mirror it
            to <code>scripts/migrate/versions/_snippets.mjs</code>.
            <code>npm run audit:v2-tables</code> detects drift between the two.
          </li>
          <li>
            <strong>Adding a new API route</strong> — copy an existing one in{" "}
            <code>app/api/v3/.../route.ts</code>; wrap with{" "}
            <code>withErrorHandling</code>, use <code>parseBody</code> +{" "}
            <code>Validate</code> for input, and pick the right rate-limit
            helper from <code>lib/rate-limiting/</code>.
          </li>
          <li>
            <strong>Adding a new icon</strong> — use <code>lucide-react</code>{" "}
            (default) or <code>react-icons</code>
            (already installed). Don&apos;t bundle a new icon set.
          </li>
          <li>
            <strong>Adding a constant</strong> — if it&apos;s a deployment
            tunable, add it to <code>lib/config/config-values.ts</code> as a{" "}
            <code>CONFIG_*</code>. Avoid magic numbers in route handlers.
          </li>
        </ol>
      </DocsSection>

      <DocsSection id="debugging" title="Debugging" icon={Zap} className="ml-0">
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
          <li>
            <strong>Server logs:</strong> stdout from <code>npm run dev</code>{" "}
            or <code>docker compose logs -f app</code>
          </li>
          <li>
            <strong>Database queries:</strong> temporarily add{" "}
            <code>console.log</code> in <code>lib/database/db-utils.ts</code>{" "}
            (or any <code>pool.query</code> caller)
          </li>
          <li>
            <strong>Auth issues:</strong> inspect the session cookie in browser
            devtools (name: <code>vulnradar_session</code>)
          </li>
          <li>
            <strong>Build issues:</strong> the Dockerfile does{" "}
            <strong>not</strong> use Next.js <code>output: standalone</code>; it
            copies <code>.next</code> + <code>node_modules</code> from the build
            stage. Comments in <code>next.config.mjs</code> explain why.
          </li>
        </ul>
      </DocsSection>

      <DocsSection id="contributing" title="Contributing" icon={BookOpen}>
        <Card className="p-6 border-primary/50 bg-primary/5">
          <div className="flex items-start gap-3">
            <Zap className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <h3 className="font-semibold mb-2">Open source</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {APP_NAME} is GPL-3.0 open source and welcomes contributions:
                bug fixes, new checks, documentation, SDKs, and translations.
              </p>
              <div className="flex flex-wrap gap-3">
                <a
                  href="https://github.com/VulnRadar/vulnradar.dev"
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
