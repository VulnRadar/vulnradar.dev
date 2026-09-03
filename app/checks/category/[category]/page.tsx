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
    // The count leads, because it is the only thing that differentiates this
    // snippet from the intro copy already on the page. It used to be appended
    // AFTER the intro and then clamped to 155, which deleted it again on 17 of
    // the 18 categories (the intros are 130 to 160 characters on their own, so
    // a 39-character suffix could never survive the clamp). Now the intro is
    // the part that clamps, and the full intro still renders on the page.
    description: clampText(
      `${count} ${getCategoryLabel(cat).toLowerCase()} checks, each with fix steps and code. ${seo.intro}`,
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

        {/* The list is already grouped by severity, so a severity pill on
            every row restated its own heading forty times over and left a
            phone about 263px for titles that are frequently one unbreakable
            identifier. The severity is said once per group, in the product's
            real severity colour, and carried down the group by a tinted rail;
            the rows get the width back. */}
        <section className="mt-10 space-y-8">
          {bySeverity.map((group) => (
            <div key={group.sev}>
              <h2 className="mb-3 flex items-baseline gap-2.5">
                <SeverityPill severity={group.sev} />
                <span className="text-sm text-muted-foreground tabular-nums">
                  {group.items.length}{" "}
                  {group.items.length === 1 ? "check" : "checks"}
                </span>
              </h2>
              <div
                className="border-l-2 pl-4 sm:pl-5"
                style={{
                  borderColor: `hsl(var(--severity-${group.sev}) / 0.45)`,
                }}
              >
                <ul className="divide-y divide-border/50">
                  {group.items.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/checks/${c.id}`}
                        className="group -mx-2 flex flex-col gap-0.5 rounded-md px-2 py-3 transition-colors hover:bg-muted/30"
                      >
                        {/* wrap-break-word: some check titles are a single
                            unbreakable identifier that line breaking will not
                            break, and text-balance cannot break a word. */}
                        <span className="font-medium text-foreground transition-colors group-hover:text-primary wrap-break-word">
                          {c.title}
                        </span>
                        <span className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                          {c.description}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
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
