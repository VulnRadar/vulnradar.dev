import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { pageMetadata, clampText } from "@/lib/seo/metadata";
import { buildCheckTitle, buildCheckDescription } from "@/lib/seo/check-meta";
import {
  BreadcrumbStructuredData,
  FaqStructuredData,
  HowToStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";
import { CodeBlock, InlineCode } from "@/components/docs";
import {
  SeoPageShell,
  SeverityPill,
  Breadcrumbs,
  ScanCta,
  ContributeCheckCta,
} from "@/lib/seo/seo-ui";
import {
  getAllChecks,
  getCheckById,
  getChecksInCategory,
  getCategoryLabel,
  getCategorySeo,
  type SeoCheck,
} from "@/lib/seo/checks-content";
import { APP_NAME } from "@/lib/config/constants";

// The root layout reads headers() for its CSP nonce, so the whole app already
// renders per-request. generateStaticParams still declares the valid id space;
// dynamicParams stays true so an unknown id 404s cleanly instead of erroring.
export const dynamicParams = true;

export function generateStaticParams() {
  return getAllChecks().map((c) => ({ id: c.id }));
}

function checkPath(id: string) {
  return `/checks/${id}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const check = getCheckById(id);
  if (!check) {
    return pageMetadata({
      title: "Check not found",
      description: "This security check does not exist.",
      path: checkPath(id),
      noIndex: true,
    });
  }
  return pageMetadata({
    title: buildCheckTitle(check),
    description: buildCheckDescription(check),
    path: checkPath(check.id),
    type: "article",
    // Named explicitly rather than left to Next's opengraph-image file
    // convention: pageMetadata always sets openGraph.images, and an explicit
    // value wins over the convention, so without this every check page would
    // keep unfurling with the site-wide marketing card.
    image: `${checkPath(check.id)}/opengraph-image`,
    keywords: [
      `how to fix ${check.title.toLowerCase()}`,
      check.title.toLowerCase(),
      `${check.severity} vulnerability`,
      ...getCategorySeo(check.category).keywords.slice(0, 2),
      ...(check.cwe ? [check.cwe.toLowerCase()] : []),
    ],
  });
}

// The FAQ used to restate three blocks of the page body verbatim: the
// description, fixSteps.join(" ") and riskImpact all render higher up the same
// page, so the section (and the FAQPage structured data built from it) was a
// second copy of the article on all 749 pages. Only questions whose answer is
// NOT already on the page belong here, which today means the standards
// mapping, plus a severity answer written as a rationale rather than a repeat
// of the "Why it matters" paragraph.
function buildFaq(check: SeoCheck, label: string) {
  const items: { question: string; answer: string }[] = [
    {
      question: `How severe is ${check.title}?`,
      answer: `${APP_NAME} rates this ${check.severity} severity in the ${label.toLowerCase()} category. The severity is fixed per check, not scored per site, so the same finding is the same severity on every scan.`,
    },
    {
      question: `Does ${APP_NAME} check for this automatically?`,
      answer: `Yes. It runs as part of every scan under the check id ${check.id}, which stays the same between runs so you can filter, diff, or gate CI on it.`,
    },
  ];
  if (check.cwe || check.owasp) {
    const parts = [
      check.cwe ? `It maps to ${check.cwe}.` : "",
      check.owasp ? `In the OWASP Top 10 it falls under ${check.owasp}.` : "",
    ].filter(Boolean);
    items.push({
      question: `Which standards does ${check.title} map to?`,
      answer: parts.join(" "),
    });
  }
  return items;
}

const CWE_BASE = "https://cwe.mitre.org/data/definitions/";

function cweUrl(cwe: string): string | null {
  const num = cwe.replace(/[^0-9]/g, "");
  return num ? `${CWE_BASE}${num}.html` : null;
}

export default async function CheckPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const check = getCheckById(id);
  if (!check) notFound();

  const nonce = (await headers()).get("x-nonce") ?? "";
  const label = getCategoryLabel(check.category);
  const categoryPath = `/checks/category/${check.category}`;
  const faq = buildFaq(check, label);

  const siblings = getChecksInCategory(check.category)
    .filter((c) => c.id !== check.id)
    .slice(0, 8);

  const breadcrumb = [
    { name: "Home", path: "/landing" },
    { name: "Checks", path: "/checks" },
    { name: label, path: categoryPath },
    { name: check.title, path: checkPath(check.id) },
  ];

  return (
    <SeoPageShell>
      <TechArticleStructuredData
        title={`How to fix: ${check.title}`}
        description={clampText(check.description, 300)}
        path={checkPath(check.id)}
        nonce={nonce}
      />
      <FaqStructuredData items={faq} nonce={nonce} />
      {check.fixSteps.length > 0 && (
        <HowToStructuredData
          name={`How to fix: ${check.title}`}
          description={clampText(check.riskImpact, 300)}
          steps={check.fixSteps}
          path={checkPath(check.id)}
          nonce={nonce}
        />
      )}
      <BreadcrumbStructuredData items={breadcrumb} nonce={nonce} />

      <article className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <Breadcrumbs items={breadcrumb} />

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <SeverityPill severity={check.severity} />
          <Link
            href={categoryPath}
            className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
          >
            {label}
          </Link>
          {check.owasp && (
            <span className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-mono text-muted-foreground">
              OWASP {check.owasp}
            </span>
          )}
          {check.cwe && (
            <span className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-mono text-muted-foreground">
              {check.cwe}
            </span>
          )}
        </div>

        {/* wrap-break-word: a good number of check titles are a single
            unbreakable identifier (UnhandledPromiseRejectionWarning,
            Range.createContextualFragment, location.replace(userInput)), and
            line breaking never breaks around a dot between letters or a
            bracket. At text-3xl those run past a 343px phone, and
            text-balance only rebalances where lines fall, it cannot break a
            word. */}
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-foreground text-balance wrap-break-word">
          How to fix: {check.title}
        </h1>
        <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
          {check.description}
        </p>

        <section className="mt-10 space-y-4" aria-labelledby="why">
          <h2
            id="why"
            className="text-lg sm:text-xl font-semibold tracking-tight border-b border-border/50 pb-2"
          >
            Why it matters
          </h2>
          <p className="text-sm sm:text-base text-foreground/90 leading-relaxed">
            {check.riskImpact}
          </p>
          {check.explanation && check.explanation !== check.riskImpact && (
            <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
              {check.explanation}
            </p>
          )}
        </section>

        {check.fixSteps.length > 0 && (
          <section className="mt-10 space-y-4" aria-labelledby="fix">
            <h2
              id="fix"
              className="text-lg sm:text-xl font-semibold tracking-tight border-b border-border/50 pb-2"
            >
              How to fix it
            </h2>
            <ol className="space-y-3">
              {check.fixSteps.map((step, i) => (
                <li
                  key={i}
                  className="flex gap-3 text-sm sm:text-base leading-relaxed"
                >
                  <span className="shrink-0 mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold tabular-nums">
                    {i + 1}
                  </span>
                  <span className="text-foreground/90">{step}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {check.codeExamples.length > 0 && (
          <section className="mt-10 space-y-4" aria-labelledby="examples">
            <h2
              id="examples"
              className="text-lg sm:text-xl font-semibold tracking-tight border-b border-border/50 pb-2"
            >
              Code examples
            </h2>
            <div className="space-y-5">
              {check.codeExamples.map((ex, i) => (
                <div key={i} className="space-y-2">
                  <p className="text-sm font-medium text-foreground">
                    {ex.label}
                  </p>
                  <CodeBlock code={ex.code} language={ex.language} />
                </div>
              ))}
            </div>
          </section>
        )}

        {check.references.length > 0 && (
          <section className="mt-10 space-y-3" aria-labelledby="refs">
            <h2
              id="refs"
              className="text-lg sm:text-xl font-semibold tracking-tight border-b border-border/50 pb-2"
            >
              References
            </h2>
            <ul className="space-y-2 text-sm">
              {check.references.map((ref, i) => (
                <li key={i}>
                  <a
                    href={ref}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-primary hover:underline wrap-break-word"
                  >
                    {ref}
                  </a>
                </li>
              ))}
              {check.cwe && cweUrl(check.cwe) && (
                <li>
                  <a
                    href={cweUrl(check.cwe)!}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-primary hover:underline wrap-break-word"
                  >
                    {check.cwe} at MITRE
                  </a>
                </li>
              )}
            </ul>
          </section>
        )}

        <p className="mt-10 text-sm text-muted-foreground">
          Detected automatically by {APP_NAME}. The check id is{" "}
          <InlineCode>{check.id}</InlineCode>, stable across every scan so you
          can filter or diff on it.
        </p>

        {siblings.length > 0 && (
          <section className="mt-10 space-y-3" aria-labelledby="related">
            <h2
              id="related"
              className="text-lg sm:text-xl font-semibold tracking-tight border-b border-border/50 pb-2"
            >
              More {label.toLowerCase()} checks
            </h2>
            <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {siblings.map((c) => (
                <li key={c.id} className="flex items-center gap-2 min-w-0">
                  <SeverityPill
                    severity={c.severity}
                    className="scale-90 shrink-0"
                  />
                  <Link
                    href={checkPath(c.id)}
                    className="text-muted-foreground hover:text-foreground transition-colors truncate"
                  >
                    {c.title}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="pt-1">
              <Link
                href={categoryPath}
                className="text-sm text-primary hover:underline"
              >
                See every {label.toLowerCase()} check
              </Link>
            </p>
          </section>
        )}

        <ContributeCheckCta className="mt-12" />
      </article>

      <ScanCta
        heading={`Scan your own site for ${check.title.toLowerCase()}`}
        body={`${APP_NAME} runs this check and hundreds more against a URL in seconds. No agent to install, just paste a URL.`}
      />
    </SeoPageShell>
  );
}
