import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  APP_NAME,
  APP_URL,
  APP_VERSION,
  APP_REPO,
  ENGINE_VERSION,
  TOTAL_CHECKS_LABEL,
  API_CURRENT_VERSION,
  ROUTES,
} from "@/lib/config/constants";
import {
  CHECK_CATEGORY_LAST_MODIFIED,
  EXACT_CHECK_CATEGORY_COUNT,
} from "@/lib/config/check-stats.generated";
import { COMMON_PORT_COUNT } from "@/lib/scanner/port-scan";
import type { TocItem } from "@/components/docs/docs-types";
import { DocsTocSpy } from "./docs-toc-spy";
import {
  DocsHero,
  DocsSection,
  DocsSteps,
  CodeBlock,
  InlineCode,
  DOCS_NAV,
  type Step,
} from "@/components/docs";

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "quick-start", label: "First scan" },
  { id: "documentation", label: "The documentation set" },
  { id: "coverage", label: "What gets checked" },
  { id: "exclude-from-scan", label: "Keeping pages out of a scan" },
  { id: "support", label: "Support and versions" },
];

// Step 1 is the no-account path on purpose. Most people arriving on /docs are
// deciding whether this is worth their time, not integrating yet, and the old
// step 1 ("create an account") asked them to sign up before they had seen
// anything run.
const quickStartSteps: Step[] = [
  {
    step: 1,
    title: "Scan one URL, no account",
    description:
      "Open /demo and run a scan. It is the same engine as everything below; an account adds your own history, an API key, and higher limits.",
  },
  {
    step: 2,
    title: "Create an account",
    description:
      "Sign up on the hosted instance, or self-host and register the first user through the normal signup form.",
  },
  {
    step: 3,
    title: "Generate an API key",
    description:
      "Profile, then API Keys, then Generate New Key. The raw key is shown once and never again. How many active keys you may hold is set by your plan: 1 on Free, 3 on Core Supporter, 10 on Pro Supporter, unlimited on Elite Supporter.",
  },
  {
    step: 4,
    title: "Send the first scan",
    description:
      "POST the target to /api/v3/scan with your key as a Bearer token. A bare hostname works: https:// is prepended for you.",
  },
  {
    step: 5,
    title: "Read the findings",
    description:
      "Each finding carries a stable id, a severity, the evidence that triggered it, and fix steps with a copyable snippet.",
  },
];

// Rendered from the generated per-category map rather than hand-listed. That
// map's keys ARE the lib/scanner/checks-data/*.json files the compiler walked,
// so this list and EXACT_CHECK_CATEGORY_COUNT cannot disagree with each other
// or with what the engine ships. Note it includes `active-probes`, which
// ALL_CATEGORIES deliberately omits (see lib/scanner/types.ts).
const CHECK_CATEGORIES = Object.keys(CHECK_CATEGORY_LAST_MODIFIED);

export default function DocsPage() {
  const curlExample = `curl -X POST "${APP_URL}/api/v3/scan" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url": "example.com", "portScan": true}'`;

  return (
    <div className="space-y-12 sm:space-y-16">
      <DocsTocSpy items={tocItems} />
      <DocsHero
        badge={`v${APP_VERSION}`}
        title={`${APP_NAME} documentation`}
        description={`Paste a URL, get a ranked list of what is wrong with it and how to fix each one. These pages cover the REST API, webhooks, quotas, self-hosting, and the internals if you want to add a check of your own.`}
        stats={[
          { value: TOTAL_CHECKS_LABEL, label: "checks" },
          { value: String(EXACT_CHECK_CATEGORY_COUNT), label: "categories" },
          { value: String(COMMON_PORT_COUNT), label: "ports swept" },
          { value: API_CURRENT_VERSION, label: "API version" },
        ]}
      />

      {/* The two no-setup paths, above the fold. Both were previously only
          reachable from the sidebar, well below an API-key quickstart. */}
      <div className="-mt-8 flex flex-wrap gap-2 sm:-mt-10">
        <Link
          href={ROUTES.DEMO}
          className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
        >
          Scan a URL now, no account
        </Link>
        <Link
          href="/docs/extension"
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          Browser extension
        </Link>
      </div>

      <DocsSection id="quick-start" title="First scan">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-10">
          <div className="min-w-0">
            <DocsSteps steps={quickStartSteps} />
          </div>
          <div className="min-w-0">
            <CodeBlock code={curlExample} language="bash" />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              <InlineCode>portScan</InlineCode> is optional. Leave it out and
              only the web checks run. Full request and response shapes are on
              the{" "}
              <Link
                href="/docs/api"
                className="text-primary underline-offset-2 hover:underline"
              >
                API reference
              </Link>
              .
            </p>
          </div>
        </div>
      </DocsSection>

      <DocsSection id="documentation" title="The documentation set">
        <div className="space-y-8">
          {DOCS_NAV.map((section) => (
            <div key={section.title}>
              <h3 className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {section.title}
              </h3>
              <dl className="divide-y divide-border/50 border-t border-border/50">
                {section.items.map((item) => (
                  <div
                    key={item.href}
                    className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:gap-4"
                  >
                    <dt>
                      <Link
                        href={item.href}
                        className="rounded-sm text-sm font-medium text-foreground hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {item.label}
                      </Link>
                    </dt>
                    <dd className="text-sm leading-relaxed text-muted-foreground">
                      {item.summary}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </DocsSection>

      <DocsSection id="coverage" title="What gets checked">
        <div className="max-w-[68ch] space-y-4 text-sm leading-relaxed text-muted-foreground">
          <p>
            {TOTAL_CHECKS_LABEL} detections live in{" "}
            <InlineCode>lib/scanner/checks-data/</InlineCode>, one JSON file per
            category, each paired with a detector module in{" "}
            <InlineCode>lib/scanner/checks/</InlineCode>. Every check has a
            stable id, so a finding you triage today keeps the same id on the
            next scan and in the API response.
          </p>
          <p>
            The {EXACT_CHECK_CATEGORY_COUNT} categories are{" "}
            {CHECK_CATEGORIES.map((category, i) => (
              <span key={category}>
                <InlineCode>{category}</InlineCode>
                {i < CHECK_CATEGORIES.length - 1 ? ", " : ""}
              </span>
            ))}
            . Pass <InlineCode>scanners</InlineCode> on a scan request to run a
            subset.
          </p>
          <p>
            The port sweep is separate and opt-in behind the single{" "}
            <InlineCode>portScan</InlineCode> boolean. It opens a bounded TCP
            socket against each of {COMMON_PORT_COUNT} curated well-known ports,
            reads whatever greeting comes back, and reports reachability and
            version disclosure per service. It does not depend on the URL
            scheme: SSH on port 22 is probed the same way whether you asked for
            an <InlineCode>https://</InlineCode> target or not.
          </p>
          <p>
            Beyond the check catalogue, every scan also fingerprints the
            software the host runs (server, framework, CDN, analytics, and
            client-side libraries) and correlates any version it can read
            against known CVEs through OSV.dev and the NVD, enriched with CISA
            KEV and FIRST.org EPSS. A vulnerable version raises one aggregated
            finding that lists its CVE IDs.
          </p>
          <p>
            The full catalogue is served, unauthenticated, from{" "}
            <InlineCode>GET /api/v3/finding-types</InlineCode>. Use it if you
            are building an SDK and want every id ahead of time. See{" "}
            <Link
              href="/docs/developers"
              className="text-primary underline-offset-2 hover:underline"
            >
              Developer documentation
            </Link>{" "}
            for the payload shape.
          </p>
        </div>
      </DocsSection>

      <DocsSection id="exclude-from-scan" title="Keeping pages out of a scan">
        <div className="max-w-[68ch] space-y-4 text-sm leading-relaxed text-muted-foreground">
          <p>
            When {APP_NAME} crawls a site for a multi-page scan, its crawler
            identifies itself as <InlineCode>{APP_NAME}</InlineCode> and reads{" "}
            <InlineCode>/robots.txt</InlineCode> before discovering pages. To
            keep specific paths out of a {APP_NAME} scan, add a group that names{" "}
            <InlineCode>{APP_NAME}</InlineCode> with{" "}
            <InlineCode>Disallow</InlineCode> rules:
          </p>
          <CodeBlock
            language="text"
            filename="robots.txt"
            code={`User-agent: ${APP_NAME}\nDisallow: /checks\nDisallow: /generated/`}
          />
          <p>
            Only a group that names <InlineCode>{APP_NAME}</InlineCode>{" "}
            specifically is honored. A blanket{" "}
            <InlineCode>User-agent: *</InlineCode> rule does not fence the
            scanner out, so a site&rsquo;s general bot policy never quietly
            narrows a security scan you asked for. Rules are matched as standard
            robots.txt path prefixes.
          </p>
          <p>
            This affects page discovery only. Search engines follow their own{" "}
            <InlineCode>*</InlineCode> rules, so anything you disallow for{" "}
            {APP_NAME} stays fully indexable for them. And a URL you enter
            directly is always scanned, robots.txt or not: the rule shapes what
            the crawler wanders into, not what you deliberately point it at.
          </p>
        </div>
      </DocsSection>

      <DocsSection id="support" title="Support and versions">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            If something here is wrong or missing, say so. Bug reports and doc
            corrections go to the issue tracker; anything account-specific goes
            through the contact form. Legal terms, the privacy policy, and the
            acceptable-use rules for scanning targets you do not own are on the{" "}
            <Link
              href="/legal"
              className="text-primary underline-offset-2 hover:underline"
            >
              legal pages
            </Link>
            .
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/contact">Contact support</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a
                href={`https://github.com/${APP_REPO}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
            </Button>
          </div>
        </div>

        <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-2 border-t border-border/50 pt-4 font-mono text-xs">
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">app</dt>
            <dd className="text-foreground">{APP_VERSION}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">engine</dt>
            <dd className="text-foreground">{ENGINE_VERSION}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">api</dt>
            <dd className="text-foreground">{API_CURRENT_VERSION}</dd>
          </div>
          <a
            href={`${APP_URL}/api/version`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-sm font-sans text-primary underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            Check for a newer release
          </a>
        </dl>
      </DocsSection>
    </div>
  );
}
