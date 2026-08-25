import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { pageMetadata, clampText } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  FaqStructuredData,
} from "@/components/seo/structured-data";
import {
  SeoPageShell,
  SeverityPill,
  Breadcrumbs,
  ScanCta,
} from "@/lib/seo/seo-ui";
import {
  SEO_CATEGORIES,
  getChecksInCategory,
  getCategoryLabel,
  getCategoryBlurb,
  getCategorySeo,
} from "@/lib/seo/checks-content";
import type { Category, Severity } from "@/lib/scanner/types";
import { APP_NAME } from "@/lib/config/constants";

export const dynamicParams = true;

export function generateStaticParams() {
  return SEO_CATEGORIES.map((category) => ({ category }));
}

const VALID = new Set<string>(SEO_CATEGORIES);

const SEVERITY_ORDER: Severity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category } = await params;
  if (!VALID.has(category)) {
    return pageMetadata({
      title: "Category not found",
      description: "This check category does not exist.",
      path: `/checks/category/${category}`,
      noIndex: true,
    });
  }
  const cat = category as Category;
  const seo = getCategorySeo(cat);
  const count = getChecksInCategory(cat).length;
  return pageMetadata({
    title: seo.heading,
    // Clamp to the ~155-char meta window: several category intros are long
    // enough that appending the count sentence pushed them past 160. The full
    // intro still renders on the page.
    description: clampText(
      `${seo.intro} ${count} checks, each with fix steps and code.`,
    ),
    path: `/checks/category/${cat}`,
    keywords: seo.keywords,
  });
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  if (!VALID.has(category)) notFound();

  const cat = category as Category;
  const nonce = (await headers()).get("x-nonce") ?? "";
  const seo = getCategorySeo(cat);
  const label = getCategoryLabel(cat);
  const blurb = getCategoryBlurb(cat);
  const checks = getChecksInCategory(cat);

  const bySeverity = SEVERITY_ORDER.map((sev) => ({
    sev,
    items: checks.filter((c) => c.severity === sev),
  })).filter((g) => g.items.length > 0);

  const breadcrumb = [
    { name: "Home", path: "/landing" },
    { name: "Checks", path: "/checks" },
    { name: label, path: `/checks/category/${cat}` },
  ];

  const faq = [
    {
      question: `What does the ${label} category check?`,
      answer: `${seo.intro} ${blurb}`,
    },
    {
      question: `How many ${label.toLowerCase()} checks are there?`,
      answer: `${APP_NAME} runs ${checks.length} checks in this category, ranging across ${bySeverity.map((g) => g.sev).join(", ")} severity.`,
    },
    {
      question: `Do I need to install anything to run the ${label.toLowerCase()} checks?`,
      answer:
        "No. Paste a URL and the scanner runs from the browser or the REST API. There is no agent, appliance, or extension to install.",
    },
  ];

  return (
    <SeoPageShell>
      <BreadcrumbStructuredData items={breadcrumb} nonce={nonce} />
      <FaqStructuredData items={faq} nonce={nonce} />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <Breadcrumbs items={breadcrumb} />

        <header className="max-w-3xl">
          <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/5 px-2.5 py-0.5 text-xs font-medium text-primary mb-3">
            {label} · {checks.length} checks
          </span>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-foreground text-balance">
            {seo.heading}
          </h1>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
            {seo.intro}
          </p>
        </header>

        {/* Severity distribution as an inline stat bar, not four cards. */}
        <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm border-t border-border/40 pt-4">
          {bySeverity.map((g) => (
            <span key={g.sev} className="inline-flex items-center gap-1.5">
              <SeverityPill severity={g.sev} className="scale-90" />
              <span className="text-muted-foreground tabular-nums">
                {g.items.length}
              </span>
            </span>
          ))}
        </div>

        <section className="mt-10 space-y-8">
          {bySeverity.map((group) => (
            <div key={group.sev}>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                {group.sev}
              </h2>
              <ul className="divide-y divide-border/50 border-y border-border/50">
                {group.items.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/checks/${c.id}`}
                      className="group flex items-start gap-3 py-3 hover:bg-muted/30 -mx-2 px-2 rounded-md transition-colors"
                    >
                      <SeverityPill
                        severity={c.severity}
                        className="scale-90 shrink-0 mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="block font-medium text-foreground group-hover:text-primary transition-colors">
                          {c.title}
                        </span>
                        <span className="block text-sm text-muted-foreground leading-relaxed line-clamp-2">
                          {c.description}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <p className="mt-10 text-sm">
          <Link href="/checks" className="text-primary hover:underline">
            Back to all checks
          </Link>
        </p>
      </div>

      <ScanCta
        heading={`Run the ${label.toLowerCase()} checks on your site`}
        body={`${APP_NAME} runs all ${checks.length} of these against a URL in seconds, with the evidence and fix for every finding. No agent to install, just paste a URL.`}
      />
    </SeoPageShell>
  );
}
