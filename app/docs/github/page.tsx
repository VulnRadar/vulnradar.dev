"use client";

import { useEffect, useRef } from "react";
import { useDocsContext, type TocItem } from "@/components/docs/docs-shell";
import {
  DocsHero,
  DocsSection,
  DocsSubSection,
  DocsCallout,
  DocsTable,
  CodeBlock,
  EndpointCard,
  EndpointTable,
  InlineCode,
} from "@/components/docs";
import { APP_NAME } from "@/lib/config/constants";
import { GITHUB_CREDIT_TIERS } from "@/lib/billing/github-credit-catalog";

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "how-it-works", label: "How a scan runs" },
  { id: "file-selection", label: "File selection", level: 2 },
  { id: "secret-scanning", label: "Secret scanning", level: 2 },
  { id: "ai-review", label: "AI code review", level: 2 },
  { id: "connect", label: "Connecting GitHub" },
  { id: "running", label: "Running a scan" },
  { id: "budgets", label: "Credits and token budgets" },
  { id: "filing-issues", label: "Filing findings as an issue" },
  { id: "privacy", label: "Privacy and limits" },
  { id: "endpoints", label: "API endpoints" },
];

export default function GithubScanningPage() {
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
          if (entry.isIntersecting) setActiveSection(entry.target.id);
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
        id="top"
        badge="Scanning"
        title="GitHub Scanning"
        description={`Point ${APP_NAME} at a repo you have connected instead of a live URL. It reads the repo's file tree over the GitHub API, runs the same pattern-based secret detectors the URL scanner uses, then sends the source through an AI code review for the flaws a regex never catches. You can push the findings straight back to the repo as a GitHub issue.`}
        stats={[
          { value: "2", label: "Passes: secrets + AI review" },
          { value: "300", label: "Files max per scan" },
          { value: "5 MB", label: "Repo content cap" },
        ]}
      />

      <DocsSection id="overview" title="Overview">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          The GitHub scanner is a separate scanning mode from the live-URL
          scanner. Instead of fetching a website and inspecting its HTTP
          responses, it authenticates as your connected GitHub account, lists a
          repo&apos;s files, fetches the text ones, and reviews the source
          itself. Two passes run over that source: a deterministic secret scan
          that reuses the URL scanner&apos;s credential detectors verbatim, and
          an AI pass that reads whole files looking for injection, weak crypto,
          auth logic mistakes, and secrets the patterns missed.
        </p>
        <DocsCallout variant="info" title="Session only, no API key">
          <p>
            Everything here requires a logged-in session. There is no Bearer-key
            path for GitHub scanning yet, unlike the URL scan API. Requests
            without a session return <InlineCode>401</InlineCode>.
          </p>
        </DocsCallout>
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          The whole flow lives on <InlineCode>/repos</InlineCode>: connect an
          account, curate a working set of repos, scan one, read the findings,
          and file an issue. The sections below map each step to the endpoint
          behind it.
        </p>
      </DocsSection>

      <DocsSection id="how-it-works" title="How a scan runs">
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          <InlineCode>POST /api/v3/scan/github</InlineCode> runs the pipeline in
          order and short-circuits at the first gate that fails, so an oversized
          or empty repo is rejected before a single AI token is spent.
        </p>
        <ol className="list-decimal space-y-2 pl-6 text-sm text-muted-foreground">
          <li>
            Session check, then a per-user request throttle keyed on{" "}
            <InlineCode>scan-github:&lt;userId&gt;</InlineCode>. Over the limit
            returns <InlineCode>429</InlineCode>.
          </li>
          <li>
            Your decrypted GitHub token is loaded. No connection returns{" "}
            <InlineCode>400</InlineCode> with &ldquo;Connect your GitHub account
            first.&rdquo;
          </li>
          <li>
            A quota pre-check runs <em>before</em> any GitHub API call, so a
            request that has no review budget left never spends real GitHub API
            calls. Denied returns <InlineCode>403</InlineCode>.
          </li>
          <li>
            The repo&apos;s default branch and visibility are resolved, then its
            recursive file tree is fetched (a <InlineCode>ref</InlineCode> you
            pass overrides the default branch).
          </li>
          <li>
            The tree is filtered to scannable files and capped. An empty result
            returns <InlineCode>400</InlineCode>.
          </li>
          <li>
            A cheap token estimate from the tree&apos;s byte sizes is compared
            to the per-run ceiling. Too large returns{" "}
            <InlineCode>413</InlineCode> before any file content is fetched.
          </li>
          <li>
            File contents are fetched, the secret scan and AI review run, CVSS
            scores are attached, and the combined result is saved to history
            (private) and returned.
          </li>
        </ol>

        <DocsSubSection id="file-selection" title="File selection">
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            Filtering happens on tree metadata alone, before any content is
            fetched, so it is cheap enough to run as a gate. Directory segments
            like <InlineCode>node_modules</InlineCode>,{" "}
            <InlineCode>vendor</InlineCode>, <InlineCode>dist</InlineCode>,{" "}
            <InlineCode>build</InlineCode>, <InlineCode>.next</InlineCode>,{" "}
            <InlineCode>target</InlineCode>, and <InlineCode>venv</InlineCode>{" "}
            are skipped, as are binary-looking extensions (images, fonts,
            archives, compiled artifacts) and, deliberately,{" "}
            <InlineCode>.lock</InlineCode> and <InlineCode>.map</InlineCode>{" "}
            files. Anything not recognized as binary is fetched and only then
            size-checked, so an unusual-but-valid text extension is not silently
            dropped.
          </p>
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            Three caps bound cost and abuse. They are runtime settings an admin
            can retune, shipped at:
          </p>
          <DocsTable
            caption="GitHub repo scan file caps from lib/config/config-values.ts"
            columns={[
              { key: "cap", header: "Cap" },
              { key: "constant", header: "Constant", className: "font-mono" },
              { key: "value", header: "Default" },
            ]}
            data={[
              {
                cap: "Files per scan",
                constant: "CONFIG_GITHUB_REVIEW_MAX_FILES",
                value: "300",
              },
              {
                cap: "Total content bytes",
                constant: "CONFIG_GITHUB_REVIEW_MAX_TOTAL_BYTES",
                value: "5,000,000",
              },
              {
                cap: "Per-file bytes",
                constant: "CONFIG_GITHUB_REVIEW_MAX_FILE_BYTES",
                value: "300,000",
              },
            ]}
          />
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            When a cap cuts the list short, the scan still runs on what fit and
            the response reports{" "}
            <InlineCode>filesSkippedByCaps: true</InlineCode>.
          </p>
        </DocsSubSection>

        <DocsSubSection id="secret-scanning" title="Secret scanning">
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            The secret pass runs every detector from the URL scanner&apos;s
            secrets-extended check set against each file&apos;s raw text. Those
            detectors already ignore the URL and headers and only read the body,
            so they run unmodified against source. Findings come back with
            confidence <InlineCode>70</InlineCode>, detection method{" "}
            <InlineCode>Source file pattern matching</InlineCode>, and a{" "}
            <InlineCode>location.file</InlineCode> instead of a URL.
          </p>
          <DocsCallout variant="info" title=".env files are not auto-cleared">
            <p>
              A committed <InlineCode>.env</InlineCode> or{" "}
              <InlineCode>.env.example</InlineCode> is not skipped by filename.
              Instead, obvious placeholder values on{" "}
              <InlineCode>KEY=VALUE</InlineCode> lines (
              <InlineCode>your_key_here</InlineCode>,{" "}
              <InlineCode>changeme</InlineCode>,{" "}
              <InlineCode>postgres://user:password@localhost/db</InlineCode>,
              and similar) are redacted before the detectors see them. A
              real-looking value on the same line still fires. Detection follows
              the shape of the value, not the filename.
            </p>
          </DocsCallout>
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            Line numbers are not populated on secret findings: the shared
            detectors return an evidence string, not a match position.
          </p>
        </DocsSubSection>

        <DocsSubSection id="ai-review" title="AI code review">
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            The AI pass batches file contents (grouped by a character budget)
            and prompts a model to find <em>new</em> issues the pattern scan
            would miss: hardcoded secrets, injection (SQL, command, path
            traversal, XSS, SSRF), insecure cryptography,
            authentication/authorization logic flaws, and unsafe
            deserialization. The prompt tells the model this can be any kind of
            project, so it does not report missing HTTP headers or cookie flags
            that only make sense for a live web server.
          </p>
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            Whether the repo is public or private is threaded into the prompt: a
            hardcoded secret in a public repo is treated as already compromised
            and needing rotation now, while the same secret in a private repo is
            a real risk that is not yet publicly disclosed. Findings come back
            with confidence <InlineCode>60</InlineCode>, category{" "}
            <InlineCode>code</InlineCode>, and detection method{" "}
            <InlineCode>AI code review</InlineCode>, and only findings that name
            a file the scan actually sent are kept.
          </p>
          <DocsCallout variant="warning" title="No AI endpoint, no AI findings">
            <p>
              If no AI provider is resolved (the server has none configured and
              you have not connected your own key), the AI pass is skipped
              cleanly: the secret findings still return and the response reports{" "}
              <InlineCode>aiReviewSkipped: true</InlineCode>. AI calls resolve
              your own configured endpoint first and fall back to {APP_NAME}
              &apos;s server endpoint.
            </p>
          </DocsCallout>
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="connect" title="Connecting GitHub">
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          <InlineCode>GET /api/v3/account/github/connect</InlineCode> starts an
          OAuth flow for an already-logged-in user. There is no sign-in variant:
          this always connects an account to an existing session. GitHub OAuth
          Apps allow only one registered callback URL, so this reuses the same
          callback the identity sign-in flow uses and disambiguates with a
          signed state bound to your user id.
        </p>
        <DocsSubSection title="OAuth scope">
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            The connect flow requests the <InlineCode>repo</InlineCode> scope
            (read and write to public and private repositories). Classic GitHub
            OAuth Apps have no scope that grants read-only access to private
            repository contents, and <InlineCode>public_repo</InlineCode> would
            silently exclude private repos from listing and scanning entirely.
            The scan itself only ever reads. The one write the token is used for
            is filing an issue, and only when you explicitly ask for it.
          </p>
        </DocsSubSection>
        <DocsSubSection title="Token storage">
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            The access token is encrypted at rest with the same AES-256-GCM
            helper used for API keys and Discord tokens, stored in{" "}
            <InlineCode>github_connections</InlineCode>, and never returned by
            any endpoint. The status endpoint returns only your GitHub username,
            the granted scopes, timestamps, and your curated repo selection.
            Reconnecting rotates the token and re-records whatever scope GitHub
            actually granted. The server needs a{" "}
            <InlineCode>GITHUB_CLIENT_ID</InlineCode> configured, or connect
            returns <InlineCode>500</InlineCode>.
          </p>
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="running" title="Running a scan">
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          On <InlineCode>/repos</InlineCode>, once connected, load your
          repositories and pick the set you want to keep visible.{" "}
          <InlineCode>GET /api/v3/account/github/repos</InlineCode> lists what
          the account can access, newest-updated first, up to 300 (three pages
          of 100). <InlineCode>PUT</InlineCode> to the same path saves your
          curated working set, which the status endpoint returns on the next
          load so the page has it without a second round trip.
        </p>
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          To scan, send the repo in <InlineCode>owner/repo</InlineCode> form.{" "}
          <InlineCode>ref</InlineCode> is optional: leave it off to scan the
          default branch, or pass a branch name, tag, or commit SHA (GitHub
          resolves any of them).
        </p>
        <CodeBlock
          language="bash"
          code={`curl -X POST https://your-instance/api/v3/scan/github \\
  -H "Content-Type: application/json" \\
  --cookie "session=..." \\
  -d '{"repoFullName":"octocat/hello-world","ref":"main"}'`}
        />
      </DocsSection>

      <DocsSection id="budgets" title="Credits and token budgets">
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          The AI review pass costs real tokens, so it is metered per plan. The
          budget is measured in AI tokens, not a run count, because one large
          repo can burn as many tokens as hundreds of small ones. Usage resets
          on the same fixed 5-hour window as the rest of {APP_NAME}&apos;s AI
          features, and is tracked separately from AI chat and finding
          verification.
        </p>
        <DocsTable
          caption="githubReviewTokensPerWindow per plan, from lib/config/config-values.ts"
          columns={[
            { key: "plan", header: "Plan" },
            { key: "budget", header: "Tokens per 5h window" },
            { key: "notes", header: "Notes", className: "w-full" },
          ]}
          data={[
            {
              plan: "Free",
              budget: "0",
              notes:
                "No standing budget, but a hidden free trial: one review every 24 hours so you can see the feature.",
            },
            {
              plan: "Core Supporter",
              budget: "200,000",
              notes: "Enough for a few small-to-medium repos per window.",
            },
            {
              plan: "Pro Supporter",
              budget: "1,000,000",
              notes: "Staff callers resolve to this cap.",
            },
            {
              plan: "Elite Supporter",
              budget: "5,000,000",
              notes:
                "Never unlimited: AI runs on subsidized provider capacity.",
            },
          ]}
        />
        <DocsCallout variant="success" title="Bring your own AI key">
          <p>
            Connect your own AI provider key in Profile &gt; AI settings and the
            per-window cap is bypassed entirely, because those calls cost{" "}
            {APP_NAME} nothing. The per-run token ceiling below still applies.
          </p>
        </DocsCallout>
        <DocsSubSection title="Per-run ceiling">
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            Independent of plan and of whose AI key is used,{" "}
            <InlineCode>CONFIG_GITHUB_REVIEW_MAX_TOKENS_PER_RUN</InlineCode>{" "}
            (default 300,000 estimated tokens) is a blunt guard against one run
            trying to push an enormous repo through the model. A repo whose
            estimated content exceeds it is rejected upfront with{" "}
            <InlineCode>413</InlineCode> rather than silently truncated.
          </p>
        </DocsSubSection>
        <DocsSubSection title="Buying credits">
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            When billing is on, a one-time top-up at{" "}
            <InlineCode>/checkout/github-credits</InlineCode> adds to a
            purchased balance that never expires and is spent only after the
            window allowance runs out. Credits and the plan window are separate
            balances with separate ledgers. Tiers:
          </p>
          <DocsTable
            caption="One-time GitHub review credit tiers from lib/billing/github-credit-catalog.ts"
            columns={[
              { key: "price", header: "Price" },
              { key: "tokens", header: "Tokens" },
              { key: "rate", header: "Tokens per dollar" },
            ]}
            data={GITHUB_CREDIT_TIERS.map((tier) => {
              const dollars = tier.priceInCents / 100;
              return {
                price: `$${dollars.toFixed(0)}`,
                tokens: tier.tokens.toLocaleString(),
                rate: Math.round(tier.tokens / dollars).toLocaleString(),
              };
            })}
          />
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="filing-issues" title="Filing findings as an issue">
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          <InlineCode>POST /api/v3/scan/github-issue</InlineCode> pushes a
          scan&apos;s findings into a repo as a GitHub issue, using your
          connected token. It is owner-initiated only: you must own the scan (a
          teammate who can view it cannot file it), and you must have a GitHub
          connection. The scan referenced by <InlineCode>scanId</InlineCode> can
          be any scan you own, a URL scan as much as a repo scan, so this
          doubles as a way to open a tracked issue from any {APP_NAME} result.
        </p>
        <DocsSubSection title="What the issue contains">
          <ul className="list-disc space-y-2 pl-6 text-sm text-muted-foreground">
            <li>
              Title:{" "}
              <InlineCode>
                [{APP_NAME}] Security findings for &lt;host&gt; (&lt;count&gt;)
              </InlineCode>
              .
            </li>
            <li>
              A one-line summary, a severity breakdown (critical, high, medium,
              low, info), and the findings listed by severity, up to 50, each as{" "}
              <InlineCode>[SEVERITY] title</InlineCode>. Beyond 50 it appends an{" "}
              &ldquo;and N more&rdquo; line.
            </li>
            <li>
              A footer crediting the {APP_NAME} GitHub Scanner and linking the
              full report at <InlineCode>/host/&lt;host&gt;</InlineCode>.
            </li>
            <li>
              Labels <InlineCode>security</InlineCode> and{" "}
              <InlineCode>vulnradar</InlineCode>.
            </li>
          </ul>
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            On success the response is the created issue&apos;s URL and number.
            If the token lacks write access or the repo has issues disabled, the
            call returns <InlineCode>502</InlineCode> with a message pointing at
            those two causes.
          </p>
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="privacy" title="Privacy and limits">
        <ul className="list-disc space-y-2 pl-6 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">
              Repo scans save private.
            </strong>{" "}
            A repo scan is written to history with{" "}
            <InlineCode>is_public = false</InlineCode>, unlike a URL scan which
            defaults to public. Findings here can quote actual lines of private
            source, including the secrets the scan exists to find, so a share
            link is never one click away by default.
          </li>
          <li>
            <strong className="text-foreground">
              Separate history from URL scans.
            </strong>{" "}
            <InlineCode>GET /api/v3/scan/github/history</InlineCode> is its own
            list, excluded from the main history endpoint. With no query it
            returns the latest scan per repo plus a count; with{" "}
            <InlineCode>?repo=owner/name</InlineCode> it returns that
            repo&apos;s timeline. Both respect your plan&apos;s retention
            window.
          </li>
          <li>
            <strong className="text-foreground">Token never exposed.</strong>{" "}
            The stored token is encrypted at rest and returned by no endpoint.
          </li>
          <li>
            <strong className="text-foreground">
              GitHub calls target a fixed host.
            </strong>{" "}
            Every request goes to <InlineCode>api.github.com</InlineCode>, never
            a user-supplied host, so these calls are not routed through the
            scanner&apos;s SSRF guard, which exists to stop a user pointing the
            scanner at an internal address.
          </li>
        </ul>
      </DocsSection>

      <DocsSection id="endpoints" title="API endpoints">
        <p className="text-sm text-muted-foreground">
          Paths below drop the <InlineCode>/api/v3</InlineCode> prefix. Every
          endpoint is session-authenticated; API keys are not accepted on any of
          them.
        </p>

        <div className="space-y-6">
          <EndpointCard
            id="post-scan-github"
            method="POST"
            path="/scan/github"
            title="Scan a repository"
            description="Runs the secret scan and AI code review against a connected repo's source. Session only."
            requestBody={`{
  "repoFullName": "octocat/hello-world",
  "ref": "main"
}`}
            responseExample={`{
  "url": "octocat/hello-world",
  "scannedAt": "2026-08-24T15:30:00.000Z",
  "duration": 8421,
  "summary": {
    "critical": 0, "high": 1, "medium": 2, "low": 0, "info": 0, "total": 3
  },
  "findings": [ /* Vulnerability[] with location.file */ ],
  "dangerScore": 34,
  "engineConfidence": 78,
  "scanHistoryId": 1234,
  "ref": "main",
  "filesScanned": 128,
  "filesSkippedByCaps": false,
  "aiTokensUsed": 41200,
  "aiReviewSkipped": false
}`}
            notes={[
              "repoFullName is required and must look like owner/repo",
              "ref is optional; it defaults to the repo's default branch and accepts a branch, tag, or commit SHA",
              "The scan is saved to history as private (is_public = false)",
              "aiReviewSkipped is true when no AI endpoint could be resolved",
            ]}
            errors={[
              {
                code: 400,
                description:
                  "No connection, bad repo name, or no scannable files",
              },
              { code: 401, description: "Unauthorized" },
              { code: 403, description: "GitHub review quota exhausted" },
              {
                code: 413,
                description: "Repo too large for the per-run token ceiling",
              },
              { code: 429, description: "Too many requests" },
            ]}
          />

          <EndpointCard
            id="post-github-issue"
            method="POST"
            path="/scan/github-issue"
            title="File findings as a GitHub issue"
            description="Opens an issue in a repo your connected account can write to, built from a scan you own. Owner-initiated only."
            requestBody={`{
  "scanId": "aB3xY7",
  "repo": "octocat/hello-world"
}`}
            responseExample={`{
  "url": "https://github.com/octocat/hello-world/issues/42",
  "number": 42
}`}
            notes={[
              "scanId is a scan's public id; you must own the scan",
              "repo must be owner/name and issues must be enabled on it",
              "Labels security and vulnradar are applied automatically",
            ]}
            errors={[
              {
                code: 400,
                description: "Missing scanId/repo, or no GitHub connection",
              },
              { code: 401, description: "Unauthorized" },
              {
                code: 404,
                description: "Scan not found, or not owned by the caller",
              },
              {
                code: 502,
                description:
                  "GitHub rejected the issue (no write scope or issues disabled)",
              },
            ]}
          />
        </div>

        <DocsSubSection title="Account and history endpoints">
          <EndpointTable
            caption="GitHub account and repo-scan-history endpoints"
            endpoints={[
              {
                method: "GET",
                endpoint: "/account/github",
                description:
                  "Connection status: username, granted scopes, timestamps, and selected repos. Never returns the token.",
              },
              {
                method: "GET",
                endpoint: "/account/github/connect",
                description:
                  "Starts the OAuth connect flow and redirects to GitHub. Requires an existing session.",
              },
              {
                method: "DELETE",
                endpoint: "/account/github",
                description: "Disconnects the GitHub account.",
              },
              {
                method: "GET",
                endpoint: "/account/github/repos",
                description:
                  "Lists repos the account can access, newest-updated first, up to 300.",
              },
              {
                method: "PUT",
                endpoint: "/account/github/repos",
                description:
                  "Saves the curated working set of repo full names, replacing the previous selection (max 300).",
              },
              {
                method: "GET",
                endpoint: "/scan/github/history",
                description:
                  "Repo scan history: latest per repo by default, or one repo's timeline with ?repo=owner/name.",
              },
            ]}
          />
        </DocsSubSection>
      </DocsSection>
    </div>
  );
}
