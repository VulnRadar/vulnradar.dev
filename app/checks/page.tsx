import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  FaqStructuredData,
} from "@/components/seo/structured-data";
import {
  SeoPageShell,
  SeverityPill,
  Breadcrumbs,
  ScanCta,
  ContributeCheckCta,
} from "@/lib/seo/seo-ui";
import { ChecksFilter } from "./checks-filter";
import {
  SEO_CATEGORIES,
  getChecksInCategory,
  getSeoCategoryCounts,
  getCategoryLabel,
  getCategoryBlurb,
  getAllChecks,
} from "@/lib/seo/checks-content";
import { APP_NAME, TOTAL_CHECKS_LABEL } from "@/lib/config/constants";
import { EXACT_CHECK_CATEGORY_COUNT } from "@/lib/config/check-stats.generated";

const TITLE = "Every Web Vulnerability Check, With Fixes";
const TOTAL = getAllChecks().length;
// Deliberately NO second count. This page used to print its own rounded
// figure for "checks with a fix guide", which put a third number in front of
// the reader next to the headline count and the category count. The
// distinction it was drawing is real but it belongs in a sentence, not in a
// number nobody can reconcile. One label, from config, everywhere.

// Two numbers, both true, one click apart in the search results: the landing
// page's meta description says TOTAL_CHECKS_LABEL ("795+", counting the
// PageCheck-architecture detectors that deliberately have no standalone page)
// and this page counts only the ones with a public fix guide. Presented alone
// the smaller number read as the larger one having been marketing. State both
// so they reconcile instead of contradicting.
const COUNT_SENTENCE = `The ${TOTAL_CHECKS_LABEL} checks ${APP_NAME} runs against a URL, grouped into ${EXACT_CHECK_CATEGORY_COUNT} categories. Most have a page here explaining what they catch and how to fix it; the rest only fire across several pages at once, so they have no standalone page.`;

export const metadata: Metadata = pageMetadata({
  title: TITLE,
  description: `${COUNT_SENTENCE} Every one has a page explaining the risk and how to fix it.`,
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
    answer: `${APP_NAME} runs ${TOTAL_CHECKS_LABEL} checks across ${EXACT_CHECK_CATEGORY_COUNT} categories, from security headers and TLS to secret detection and DNS. Each documented one has its own page with the risk it catches and the fix. The rest run inside multi-page analysis, where a finding depends on several pages at once, so there is no single-check page to link to.`,
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
            The {TOTAL_CHECKS_LABEL} checks a scan runs, grouped into{" "}
            {EXACT_CHECK_CATEGORY_COUNT} categories. Not a marketing number:
            most have a real page here that tells you what the check catches,
            why it matters, and how to fix it with code you can paste. The rest
            only fire across several pages at once, so there is no single check
            to link to.
          </p>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm border-t border-border/40 pt-4">
            <span className="text-muted-foreground">
              <span className="font-semibold text-foreground tabular-nums">
                {TOTAL_CHECKS_LABEL}
              </span>{" "}
              checks
            </span>
            <span className="text-muted-foreground">
              <span className="font-semibold text-foreground tabular-nums">
                {EXACT_CHECK_CATEGORY_COUNT}
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

        {/* Full crawlable index. Every link is in the server HTML; the filter
            island above only hides rows, so JS-off and crawler views are the
            complete list. */}
        <section className="mt-14" aria-labelledby="all-checks">
          <h2
            id="all-checks"
            className="text-lg sm:text-xl font-semibold tracking-tight mb-2"
          >
            Every check, by category
          </h2>
          <ChecksFilter>
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
                    {/* data-count carries the unfiltered total so the filter
                        island can show a live match count here and put the
                        real one back when the filter is cleared. */}
                    <span
                      data-count={checks.length}
                      className="text-xs text-muted-foreground tabular-nums"
                    >
                      {checks.length}
                    </span>
                  </summary>
                  <ul className="px-4 pb-4 pt-1 grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
                    {checks.map((c) => (
                      <li
                        key={c.id}
                        // Haystack for the filter island: the id matters as
                        // much as the title, since the id is what a finding,
                        // the API and a CI gate all refer to.
                        data-check={`${c.title} ${c.id}`.toLowerCase()}
                        data-severity={c.severity}
                        // items-start, and the title wraps. A check title is a
                        // string from the catalogue, not user data: at one
                        // column on a phone the row has about 195px and
                        // "API Key or Secret Hardcoded in Client JavaScript"
                        // needs roughly 300px, so truncating it cut the row's
                        // only piece of meaning in half. Top alignment keeps
                        // the severity pill on the first line.
                        className="flex items-start gap-2 min-w-0 text-sm"
                      >
                        <SeverityPill
                          severity={c.severity}
                          className="scale-90 shrink-0"
                        />
                        <Link
                          href={`/checks/${c.id}`}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {c.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </ChecksFilter>
        </section>

        <ContributeCheckCta />
      </div>

      <ScanCta
        heading="See which of these fire on your site"
        body={`Paste a URL and ${APP_NAME} runs the relevant checks in seconds, then shows the exact evidence, severity, and fix for each finding.`}
      />
    </SeoPageShell>
  );
}
