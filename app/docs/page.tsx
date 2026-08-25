"use client";

import { useEffect, useRef } from "react";
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
} from "@/lib/config/constants";
import { useDocsContext, type TocItem } from "@/components/docs/docs-shell";
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

const quickStartSteps: Step[] = [
  {
    step: 1,
    title: "Create an account",
    description:
      "Sign up on the hosted instance, or self-host and register the first user through the normal signup form.",
  },
  {
    step: 2,
    title: "Generate an API key",
    description:
      "Profile, then API Keys, then Generate New Key. The raw key is shown once and never again. Up to 3 active keys per account.",
  },
  {
    step: 3,
    title: "Send the first scan",
    description:
      "POST the target to /api/v3/scan with your key as a Bearer token. A bare hostname works: https:// is prepended for you.",
  },
  {
    step: 4,
    title: "Read the findings",
    description:
      "Each finding carries a stable id, a severity, the evidence that triggered it, and fix steps with a copyable snippet.",
  },
];

// From lib/scanner/types.ts. Kept in the same order as ALL_CATEGORIES so the
// two are easy to diff by eye when a category is added.
const CHECK_CATEGORIES = [
  "headers",
  "ssl",
  "tls",
  "content",
  "cookies",
  "configuration",
  "information-disclosure",
  "dns",
  "email",
  "api",
  "code",
  "secrets-extended",
  "vibe-code",
  "client-side",
  "supply-chain",
  "host-validation",
  "reputation",
  "active-probes",
];

const SERVICE_PROBES = ["ssh", "smtp", "imap", "pop3", "ftp", "mongodb"];

export default function DocsPage() {
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

  const curlExample = `curl -X POST "${APP_URL}/api/v3/scan" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url": "example.com", "probes": ["ssh:22", "smtp:587"]}'`;

  return (
    <div className="space-y-12 sm:space-y-16">
      <DocsHero
        badge={`v${APP_VERSION}`}
        title={`${APP_NAME} documentation`}
        description={`Paste a URL, get a ranked list of what is wrong with it and how to fix each one. These pages cover the REST API, webhooks, quotas, self-hosting, and the internals if you want to add a check of your own.`}
        stats={[
          { value: TOTAL_CHECKS_LABEL, label: "checks" },
          { value: String(CHECK_CATEGORIES.length), label: "categories" },
          { value: String(SERVICE_PROBES.length), label: "service probes" },
          { value: API_CURRENT_VERSION, label: "API version" },
        ]}
      />

      <DocsSection id="quick-start" title="First scan">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-10">
          <div className="min-w-0">
            <DocsSteps steps={quickStartSteps} />
          </div>
          <div className="min-w-0">
            <CodeBlock code={curlExample} language="bash" />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              <InlineCode>probes</InlineCode> is optional. Leave it out and only
              the web checks run. Full request and response shapes are on the{" "}
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
            The {CHECK_CATEGORIES.length} categories are{" "}
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
            Service probes are separate and opt-in. They open a bounded TCP
            socket, read the greeting, and report version disclosure and
            reachability for{" "}
            {SERVICE_PROBES.map((probe, i) => (
              <span key={probe}>
                <InlineCode>{probe}</InlineCode>
                {i < SERVICE_PROBES.length - 1 ? ", " : ""}
              </span>
            ))}
            . They do not depend on the URL scheme: you can probe SSH on an{" "}
            <InlineCode>https://</InlineCode> target.
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
