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
  Lightbulb,
  BookOpen,
  ServerCog,
} from "lucide-react";
import { FaGithub } from "react-icons/fa";
import {
  APP_NAME,
  APP_URL,
  APP_VERSION,
  TOTAL_CHECKS_LABEL,
} from "@/lib/config/constants";
import { useDocsContext, type TocItem } from "../layout";
import {
  DocsHero,
  DocsSection,
  CodeBlock,
  EndpointTable,
  FieldTable,
} from "@/components/docs";

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "finding-types", label: "Finding Types API" },
  { id: "building-sdks", label: "Building SDKs" },
  { id: "sdk-checklist", label: "SDK Checklist", level: 2 },
  { id: "community", label: "Community SDKs" },
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
    endpoint: "/scan/crawl",
    method: "POST",
    description: "Deep crawl and scan multiple pages",
  },
  {
    endpoint: "/scan/crawl/discover",
    method: "POST",
    description: "Discover crawlable URLs",
  },
  { endpoint: "/history", method: "GET", description: "Get scan history" },
  {
    endpoint: "/history/:id",
    method: "GET",
    description: "Get specific scan details",
  },
  { endpoint: "/history/:id", method: "DELETE", description: "Delete a scan" },
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
    description: "Category type (e.g., security_header)",
  },
  {
    field: "title",
    type: "string",
    description: "Human-readable title for display",
  },
  { field: "category", type: "string", description: "UI category grouping" },
  {
    field: "severity",
    type: "string",
    description: "One of: critical, high, medium, low, info",
  },
];

const sdkChecklist = [
  "Bearer token authentication",
  "Configurable base URL",
  "Type-safe response models",
  "Error handling with typed exceptions",
  "Rate limit handling with backoff",
  "Async/await support",
  "Request/response logging option",
  "Comprehensive documentation",
  "Unit tests with mocked responses",
  "Example usage in README",
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
      {/* Hero */}
      <DocsHero
        badge="SDK Development"
        title="Developer Documentation"
        description={`Build SDKs, integrations, and tools for ${APP_NAME}. Everything you need to programmatically interact with our security scanning platform.`}
        stats={[
          { value: TOTAL_CHECKS_LABEL, label: "Security Checks" },
          { value: "MIT", label: "License" },
          { value: "v2", label: "API Version" },
        ]}
      />

      {/* Finding Types API */}
      <DocsSection id="finding-types" title="Finding Types API" icon={FileJson}>
        <p className="text-muted-foreground">
          The Finding Types API returns all security check definitions. Use this
          to understand what findings your SDK should handle, display
          human-readable titles, and categorize results by severity.
        </p>

        <Card className="p-6 border-border/40">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Badge className="bg-blue-600/20 text-blue-600 border-blue-600/30 border font-mono text-xs">
              GET
            </Badge>
            <code className="text-primary font-mono text-sm">
              /api/v2/finding-types
            </code>
            <Badge variant="outline" className="text-xs ml-auto">
              Public - No Auth
            </Badge>
          </div>

          <div className="space-y-6">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Example Request
              </h4>
              <CodeBlock
                code={`curl ${APP_URL}/api/v2/finding-types`}
                language="bash"
              />
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Response
              </h4>
              <CodeBlock
                code={`{
  "version": "${APP_VERSION}",
  "count": 110,
  "types": [
    {
      "id": "hsts-missing",
      "type": "security_header",
      "title": "HSTS Header Missing",
      "category": "Security Headers",
      "severity": "medium"
    },
    {
      "id": "csp-missing",
      "type": "security_header", 
      "title": "Content Security Policy Missing",
      "category": "Security Headers",
      "severity": "medium"
    }
  ]
}`}
              />
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Response Fields
              </h4>
              <FieldTable fields={findingTypeFields} />
            </div>
          </div>
        </Card>
      </DocsSection>

      {/* Building SDKs */}
      <DocsSection id="building-sdks" title="Building SDKs" icon={Package}>
        <p className="text-muted-foreground">
          When building an SDK for {APP_NAME}, follow these guidelines to ensure
          consistency and compatibility.
        </p>

        <Card className="p-6 border-border/40 space-y-8">
          <div>
            <h4 className="font-semibold mb-3">1. Authentication</h4>
            <p className="text-sm text-muted-foreground mb-3">
              All authenticated requests require a Bearer token:
            </p>
            <CodeBlock
              code="Authorization: Bearer YOUR_API_KEY"
              language="http"
            />
          </div>

          <div>
            <h4 className="font-semibold mb-3">2. Base URL</h4>
            <p className="text-sm text-muted-foreground mb-3">
              Use the versioned API base URL:
            </p>
            <CodeBlock code={`${APP_URL}/api/v2`} language="text" />
          </div>

          <div>
            <h4 className="font-semibold mb-3">3. Core Endpoints</h4>
            <EndpointTable endpoints={coreEndpoints} />
          </div>

          <div>
            <h4 className="font-semibold mb-3">4. Error Handling</h4>
            <p className="text-sm text-muted-foreground mb-3">
              Handle these HTTP status codes appropriately:
            </p>
            <ul className="text-sm text-muted-foreground space-y-1.5">
              <li>
                <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">
                  200
                </code>{" "}
                - Success
              </li>
              <li>
                <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">
                  400
                </code>{" "}
                - Bad Request (invalid parameters)
              </li>
              <li>
                <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">
                  401
                </code>{" "}
                - Unauthorized (invalid API key)
              </li>
              <li>
                <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">
                  429
                </code>{" "}
                - Rate Limited
              </li>
              <li>
                <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">
                  500
                </code>{" "}
                - Server Error
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-3">5. Rate Limiting</h4>
            <p className="text-sm text-muted-foreground">
              Implement exponential backoff when receiving 429 responses. Check
              the{" "}
              <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">
                Retry-After
              </code>{" "}
              header for guidance. See{" "}
              <Link
                href="/docs/rate-limits"
                className="text-primary hover:underline"
              >
                Rate Limits
              </Link>{" "}
              for details.
            </p>
          </div>
        </Card>

        {/* SDK Checklist */}
        <div id="sdk-checklist" className="scroll-mt-24">
          <Card className="p-6 border-border/40 bg-primary/5">
            <div className="flex items-center gap-3 mb-4">
              <Lightbulb className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">SDK Checklist</h3>
            </div>
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
      </DocsSection>

      {/* Community SDKs */}
      <DocsSection id="community" title="Community SDKs" icon={GitBranch}>
        <div className="space-y-4">
          {/* Python SDK */}
          <Card className="p-6 border-border/40 hover:border-primary/50 transition-colors">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-600/20 rounded-lg">
                  <Package className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-semibold flex items-center gap-2">
                    Python SDK
                    <Badge variant="outline" className="text-xs">
                      Community
                    </Badge>
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    VulnRadar/Python-SDK
                  </p>
                </div>
              </div>
              <a
                href="https://github.com/VulnRadar/Python-SDK"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <FaGithub className="h-5 w-5" />
              </a>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Community-maintained Python SDK for VulnRadar API integration.
              Supports async operations and comprehensive vulnerability
              scanning.
            </p>
            <CodeBlock
              code={`from vulnradar import VulnRadar

client = VulnRadar(api_key="your-api-key")
result = client.scan("https://example.com")

print(f"Total findings: {result.summary.total}")
print(f"Critical: {result.summary.critical}")
for finding in result.findings:
    print(f"[{finding.severity.value.upper()}] {finding.title}")`}
              language="python"
            />
          </Card>
        </div>

        <Card className="p-6 border-border/40 bg-secondary/30">
          <h4 className="font-semibold mb-3">Building Your Own SDK?</h4>
          <p className="text-sm text-muted-foreground mb-4">
            We welcome community-built SDKs in any language! If you build one,
            let us know and we&apos;ll feature it here.
          </p>
          <div className="p-3 bg-card rounded-lg border border-border/40 text-sm text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">Requirements:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                Use the{" "}
                <Link href="/docs/api" className="text-primary hover:underline">
                  v2 API
                </Link>{" "}
                for all requests
              </li>
              <li>Support Bearer token authentication</li>
              <li>Include comprehensive documentation</li>
              <li>Open source with MIT or compatible license</li>
              <li>Publish to your language&apos;s package manager</li>
            </ul>
          </div>
        </Card>
      </DocsSection>

      {/* Development Guide */}
      <DocsSection id="development" title="Development Guide" icon={Zap}>
        <p className="text-muted-foreground">
          Setup for contributing to VulnRadar. Covers local dev, scripts, commit
          conventions, and common pitfalls.
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
            Node.js 22 LTS is the only supported runtime
          </p>
          <p className="text-sm text-muted-foreground">
            Odd-numbered versions (21, 23) are explicitly excluded by vitest@4,
            balanced-match@4, brace-expansion@5, and minimatch@10 in their{" "}
            <code className="text-xs">engines</code> field. Node 20 LTS works in
            CI and is listed as compatible, but the team standardises on 22 for
            parity. Bug reports on Node versions other than 22 LTS will not be
            investigated — upgrade first, then reproduce. See{" "}
            <a href="#node-version-policy" className="underline">
              Node Version Policy
            </a>{" "}
            below.
          </p>
        </div>
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
          <li>
            <strong>Node.js 22 LTS</strong> (matches <code>Dockerfile</code>,
            CI, and the <code>.nvmrc</code> at the repo root; Node 20 LTS is
            also compatible)
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
          VulnRadar targets <strong>Node.js 22 LTS</strong> and lists Node 20
          LTS as a secondary compatible runtime. Odd-numbered releases (21, 23)
          and any pre-20 build are not supported and are not investigated in bug
          reports. This is not a stylistic choice — it is a consequence of the
          dependency graph.
        </p>
        <p className="text-muted-foreground mt-3">
          The following packages list an explicit{" "}
          <code className="text-xs">engines</code> field that excludes versions
          outside the supported set, and we cannot override their constraints
          from the consumer side:
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
          Switching to the supported Node version is part of fixing the report.
          Before opening an issue or running a debug session, confirm with{" "}
          <code>node --version</code> and switch if needed:
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
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 mt-4">
          <p className="text-sm font-semibold text-red-700 dark:text-red-300 mb-1">
            Bug reports on unsupported Node versions will be closed without
            investigation.
          </p>
          <p className="text-sm text-muted-foreground">
            We do not have the bandwidth to bisect engine-mismatch bugs against
            versions the dependency graph has explicitly opted out of. The fix
            is <code>nvm use</code>, not a code change. If a real bug exists on
            Node 22 LTS, it will reproduce there too — open the report against
            22 and we will look at it.
          </p>
        </div>
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
# Edit .env with your DATABASE_URL, API_KEY_ENCRYPTION_KEY, etc.

# 4. Create the database schema
npm run db:create

# 5. Start the dev server
npm run dev
# → http://localhost:3000`}
        />
        <p className="text-muted-foreground">
          The first run auto-initializes the schema. You&apos;ll see{" "}
          <code>Database initialized</code> in the console. To create an admin
          user, sign up normally, then promote via SQL:
        </p>
        <CodeBlock
          language="sql"
          code={`UPDATE users SET role = 'admin' WHERE email = 'you@example.com';`}
        />
      </DocsSection>

      <DocsSection id="scripts" title="Scripts" icon={Package} className="ml-0">
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
              <tr className="border-b border-border/50">
                <td className="py-2.5">
                  <code>npm run dev</code>
                </td>
                <td className="py-2.5 text-xs">
                  Start Next.js dev server (HMR) on port 3000
                </td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-2.5">
                  <code>npm run build</code>
                </td>
                <td className="py-2.5 text-xs">
                  Production build (runs next build)
                </td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-2.5">
                  <code>npm run start</code>
                </td>
                <td className="py-2.5 text-xs">Run the production build</td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-2.5">
                  <code>npm run lint</code>
                </td>
                <td className="py-2.5 text-xs">
                  Run ESLint over the repo (no --fix)
                </td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-2.5">
                  <code>npm run lint:fix</code>
                </td>
                <td className="py-2.5 text-xs">
                  Run ESLint with --fix (auto-fixes where safe)
                </td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-2.5">
                  <code>npm run typecheck</code>
                </td>
                <td className="py-2.5 text-xs">
                  Run tsc --noEmit (build-time typecheck)
                </td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-2.5">
                  <code>npm run format</code>
                </td>
                <td className="py-2.5 text-xs">
                  Format all source files with Prettier
                </td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-2.5">
                  <code>npm run format:check</code>
                </td>
                <td className="py-2.5 text-xs">
                  Check formatting without writing
                </td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-2.5">
                  <code>npm run db:migrate</code>
                </td>
                <td className="py-2.5 text-xs">
                  Run scripts/migrate.mjs (ad-hoc DB migrations)
                </td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-2.5">
                  <code>npm run db:create</code>
                </td>
                <td className="py-2.5 text-xs">
                  Drop and recreate the database schema
                </td>
              </tr>
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
          ESLint 9 with flat config (<code>.eslint.config.mjs</code>). The
          config wraps <code>next/core-web-vitals</code> for React/Next/TS
          rules. Warnings are non-blocking; CI fails only on errors.
        </p>
        <CodeBlock
          language="bash"
          code={`npm run lint        # check
npm run lint:fix    # auto-fix`}
        />
        <p className="text-muted-foreground">Common rule overrides:</p>
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
          <code>tsc --noEmit</code> runs in CI but is{" "}
          <strong>non-blocking</strong> (legacy <code>next.config.mjs</code> has{" "}
          <code>typescript.ignoreBuildErrors: true</code>). The build is green
          either way. New code should still type-check cleanly.
        </p>
      </DocsSection>

      <DocsSection
        id="commits"
        title="Commit Conventions"
        icon={GitBranch}
        className="ml-0"
      >
        <p className="text-muted-foreground">
          We follow <strong>Conventional Commits</strong>:
        </p>
        <CodeBlock
          language="text"
          code={`<type>(<scope>): <subject>

<body>

<footer>`}
        />
        <div className="overflow-x-auto">
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
              <tr className="border-b border-border/50">
                <td className="py-2.5">
                  <code>feat</code>
                </td>
                <td className="py-2.5 text-xs">New user-facing feature</td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-2.5">
                  <code>fix</code>
                </td>
                <td className="py-2.5 text-xs">Bug fix</td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-2.5">
                  <code>chore</code>
                </td>
                <td className="py-2.5 text-xs">
                  Maintenance, deps, tooling, no production code change
                </td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-2.5">
                  <code>refactor</code>
                </td>
                <td className="py-2.5 text-xs">
                  Code change with no behavior change
                </td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-2.5">
                  <code>docs</code>
                </td>
                <td className="py-2.5 text-xs">Documentation only</td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-2.5">
                  <code>style</code>
                </td>
                <td className="py-2.5 text-xs">
                  Formatting only (no logic change)
                </td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-2.5">
                  <code>test</code>
                </td>
                <td className="py-2.5 text-xs">Adding/updating tests</td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-2.5">
                  <code>perf</code>
                </td>
                <td className="py-2.5 text-xs">Performance improvement</td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-2.5">
                  <code>ci</code>
                </td>
                <td className="py-2.5 text-xs">CI/CD changes</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground">Examples:</p>
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
            <code>npm run build</code> locally
          </li>
          <li>Use the PR template (.github/pull_request_template.md)</li>
          <li>Wait for CI (lint + typecheck + build + auto-applied labels)</li>
          <li>Request review from CODEOWNERS (security/critical paths)</li>
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
            <code>scripts/</code> — Admin / DB scripts
          </li>
          <li>
            <code>instrumentation.ts</code> — Next.js startup hooks
          </li>
          <li>
            <code>middleware.ts</code> — Auth middleware
          </li>
        </ul>
        <p className="text-muted-foreground">
          For a deeper tour, see the{" "}
          <a href="/docs/architecture">Architecture</a> page.
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
            <strong>Adding a new API route</strong> — copy an existing one in{" "}
            <code>app/api/v2/.../route.ts</code>; wrap with{" "}
            <code>withErrorHandling</code>, use <code>parseBody</code> +{" "}
            <code>Validate</code> for input.
          </li>
          <li>
            <strong>Adding a database table</strong> — add the{" "}
            <code>CREATE TABLE</code> to{" "}
            <code>scripts/create-fresh-db.mjs</code> (idempotent) and run{" "}
            <code>npm run db:create</code> to test.
          </li>
          <li>
            <strong>Adding a new icon</strong> — import from{" "}
            <code>lucide-react</code>. Don&apos;t bundle from a different lib.
          </li>
          <li>
            <strong>Adding a constant</strong> — if it&apos;s a value (not a
            path or URL), add it to <code>config-values.ts</code> rather than a
            magic number in the code.
          </li>
        </ol>
      </DocsSection>

      <DocsSection id="debugging" title="Debugging" icon={Zap} className="ml-0">
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
          <li>
            <strong>Server logs:</strong> visible in <code>npm run dev</code>{" "}
            output
          </li>
          <li>
            <strong>Database queries:</strong> add <code>console.log</code> in{" "}
            <code>lib/database/db-utils.ts</code> (temporarily)
          </li>
          <li>
            <strong>Auth issues:</strong> check the session cookie with browser
            devtools
          </li>
          <li>
            <strong>Build issues:</strong> <code>next.config.mjs</code> has{" "}
            <code>output: standalone</code> disabled (Dockerfile copies{" "}
            <code>.next</code> directly)
          </li>
        </ul>
      </DocsSection>

      {/* Contributing */}
      <DocsSection id="contributing" title="Contributing" icon={BookOpen}>
        <Card className="p-6 border-primary/50 bg-primary/5">
          <div className="flex items-start gap-3">
            <Zap className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <h3 className="font-semibold mb-2">Open Source</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {APP_NAME} is open source and welcomes contributions. Whether
                it&apos;s bug fixes, new features, documentation improvements,
                or SDK development - we appreciate all contributions.
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
