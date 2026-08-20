import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  FaqStructuredData,
} from "@/components/seo/structured-data";
import { SeoPageShell, SeverityPill, Breadcrumbs, ScanCta } from "@/lib/seo/seo-ui";
import {
  SEO_CATEGORIES,
  getChecksInCategory,
  getSeoCategoryCounts,
  getCategoryLabel,
  getCategoryBlurb,
  getAllChecks,
} from "@/lib/seo/checks-content";
import { APP_NAME } from "@/lib/config/constants";

const TITLE = "Web Vulnerability Checks";
const TOTAL = getAllChecks().length;

export const metadata: Metadata = pageMetadata({
  title: TITLE,
  description: `The full list of ${TOTAL} security checks ${APP_NAME} runs against a URL, grouped into 18 categories. Every check has a page explaining the risk and how to fix it.`,
  path: "/checks",
  keywords: [
    "web vulnerability checks",
    "security checks list",
    "vulnerability scanner checks",
    "website security checklist",
    "owasp checks list",
  ],
});

const FAQ = [
  {
    question: `How many checks does ${APP_NAME} run?`,
    answer: `${APP_NAME} documents ${TOTAL} checks across 18 categories, from security headers and TLS to secret detection and DNS. Each one has its own page with the risk it catches and the fix.`,
  },
  {
    question: "Do I have to run every check?",
    answer:
      "No. A scan runs the relevant categories for the target automatically, and you can narrow a scan to specific categories. Active probing that submits data to a form is opt-in only.",
  },
  {
    question: "Are the paid plans running more checks than the free one?",
    answer:
      "No. The detection engine is identical on every plan down to the check IDs. Paying raises daily scan quotas, it does not unlock findings.",
  },
];

export default async function ChecksIndexPage() {
  const nonce = (await headers()).get("x-nonce") ?? "";
  const counts = getSeoCategoryCounts();
  const breadcrumb = [
    { name: "Home", path: "/landing" },
    { name: "Checks", path: "/checks" },
  ];

  return (
    <SeoPageShell>
      <BreadcrumbStructuredData items={breadcrumb} nonce={nonce} />
      <FaqStructuredData items={FAQ} nonce={nonce} />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <Breadcrumbs items={breadcrumb} />

        <header className="max-w-3xl">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-foreground text-balance">
            Every check {APP_NAME} runs
          </h1>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
            {TOTAL} security checks, grouped into 18 categories. Not a marketing
            number: every one is a real page that tells you what it catches, why
            it matters, and how to fix it with code you can paste.
          </p>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm border-t border-border/40 pt-4">
            <span className="text-muted-foreground">
              <span className="font-semibold text-foreground tabular-nums">
                {TOTAL}
              </span>{" "}
              documented checks
            </span>
            <span className="text-muted-foreground">
              <span className="font-semibold text-foreground tabular-nums">
                18
              </span>{" "}
              categories
            </span>
            <span className="text-muted-foreground">
              <span className="font-semibold text-foreground tabular-nums">
                0
              </span>{" "}
              agents to install
            </span>
          </div>
        </header>

        {/* Category overview: label + what it inspects + count, linking deep. */}
        <section className="mt-12" aria-labelledby="categories">
          <h2
            id="categories"
            className="text-lg sm:text-xl font-semibold tracking-tight mb-5"
          >
            Browse by category
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {SEO_CATEGORIES.map((cat) => (
              <Link
                key={cat}
                href={`/checks/category/${cat}`}
                className="group rounded-lg border border-border/60 bg-card p-4 sm:p-5 hover:border-primary/40 transition-colors"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-medium text-foreground group-hover:text-primary transition-colors">
                    {getCategoryLabel(cat)}
                  </h3>
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                    {counts[cat]} checks
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                  {getCategoryBlurb(cat)}
                </p>
              </Link>
            ))}
          </div>
        </section>

        {/* Full crawlable index, grouped and collapsible, no JS needed. */}
        <section className="mt-14" aria-labelledby="all-checks">
          <h2
            id="all-checks"
            className="text-lg sm:text-xl font-semibold tracking-tight mb-2"
          >
            Every check, by category
          </h2>
          <p className="text-sm text-muted-foreground mb-5">
            Expand a category to jump straight to any single check.
          </p>
          <div className="space-y-2">
            {SEO_CATEGORIES.map((cat) => {
              const checks = getChecksInCategory(cat);
              return (
                <details
                  key={cat}
                  className="group rounded-lg border border-border/60 bg-card/50"
                >
                  <summary className="flex items-center justify-between gap-3 cursor-pointer px-4 py-3 text-sm font-medium text-foreground list-none">
                    <span className="flex items-center gap-2">
                      <span className="text-muted-foreground group-open:rotate-90 transition-transform">
                        &rsaquo;
                      </span>
                      {getCategoryLabel(cat)}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {checks.length}
                    </span>
                  </summary>
                  <ul className="px-4 pb-4 pt-1 grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
                    {checks.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-center gap-2 min-w-0 text-sm"
                      >
                        <SeverityPill
                          severity={c.severity}
                          className="scale-90 shrink-0"
                        />
                        <Link
                          href={`/checks/${c.id}`}
                          className="text-muted-foreground hover:text-foreground transition-colors truncate"
                        >
                          {c.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        </section>
      </div>

      <ScanCta
        heading="See which of these fire on your site"
        body={`Paste a URL and ${APP_NAME} runs the relevant checks in seconds, then shows the exact evidence, severity, and fix for each finding.`}
      />
    </SeoPageShell>
  );
}
