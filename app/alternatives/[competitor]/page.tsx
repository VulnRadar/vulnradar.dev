import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Check } from "lucide-react";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  FaqStructuredData,
} from "@/components/seo/structured-data";
import { SeoPageShell, Breadcrumbs, ScanCta } from "@/lib/seo/seo-ui";
import { getAllAlternatives, getAlternative } from "@/lib/seo/alternatives";
import { APP_NAME } from "@/lib/config/constants";

export const dynamicParams = true;

export function generateStaticParams() {
  return getAllAlternatives().map((a) => ({ competitor: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ competitor: string }>;
}): Promise<Metadata> {
  const { competitor } = await params;
  const alt = getAlternative(competitor);
  if (!alt) {
    return pageMetadata({
      title: "Comparison not found",
      description: "This comparison does not exist.",
      path: `/alternatives/${competitor}`,
      noIndex: true,
    });
  }
  return pageMetadata({
    title: `${alt.name} Alternative: ${APP_NAME}`,
    description:
      `Comparing ${APP_NAME}, an open-source GPL-3.0 scanner, to ${alt.name}. ${alt.positioning}`.slice(
        0,
        175,
      ),
    path: `/alternatives/${alt.slug}`,
    keywords: [
      `${alt.name.toLowerCase()} alternative`,
      `${alt.name.toLowerCase()} pricing`,
      `${alt.name.toLowerCase()} vs ${APP_NAME.toLowerCase()}`,
      `open source ${alt.name.toLowerCase()} alternative`,
      "free vulnerability scanner",
    ],
  });
}

export default async function AlternativePage({
  params,
}: {
  params: Promise<{ competitor: string }>;
}) {
  const { competitor } = await params;
  const alt = getAlternative(competitor);
  if (!alt) notFound();

  const nonce = (await headers()).get("x-nonce") ?? "";
  const breadcrumb = [
    { name: "Home", path: "/landing" },
    { name: "Alternatives", path: "/alternatives" },
    { name: alt.name, path: `/alternatives/${alt.slug}` },
  ];

  return (
    <SeoPageShell>
      <BreadcrumbStructuredData items={breadcrumb} nonce={nonce} />
      <FaqStructuredData items={alt.faq} nonce={nonce} />

      <article className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <Breadcrumbs items={breadcrumb} />

        <header className="max-w-3xl">
          <span className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground mb-3">
            {alt.category}
          </span>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-foreground text-balance">
            {alt.name} alternative: {APP_NAME}
          </h1>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
            {alt.summary}
          </p>
        </header>

        <section className="mt-8 rounded-xl border border-border/60 bg-muted/20 p-5 sm:p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Where {APP_NAME} fits
          </h2>
          <p className="text-sm sm:text-base text-foreground/90 leading-relaxed">
            {alt.positioning}
          </p>
        </section>

        <section className="mt-10" aria-labelledby="table">
          <h2
            id="table"
            className="text-lg sm:text-xl font-semibold tracking-tight mb-4"
          >
            Side by side
          </h2>
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-sm border-collapse min-w-136">
              <thead>
                <tr className="bg-muted/40 text-left">
                  <th className="px-4 py-3 font-medium text-muted-foreground w-1/4">
                    &nbsp;
                  </th>
                  <th className="px-4 py-3 font-semibold text-primary">
                    {APP_NAME}
                  </th>
                  <th className="px-4 py-3 font-semibold text-foreground">
                    {alt.name}
                  </th>
                </tr>
              </thead>
              <tbody>
                {alt.rows.map((row, i) => (
                  <tr key={i} className="border-t border-border/50 align-top">
                    <th
                      scope="row"
                      className="px-4 py-3 font-medium text-foreground text-left"
                    >
                      {row.feature}
                    </th>
                    <td className="px-4 py-3 text-foreground/90 leading-relaxed">
                      {row.vulnradar}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground leading-relaxed">
                      {row.them}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {alt.name} details describe its pricing and delivery model rather
            than a specific quote. Always check {alt.name}&rsquo;s own site for
            current pricing.
          </p>
        </section>

        <section className="mt-10" aria-labelledby="diff">
          <h2
            id="diff"
            className="text-lg sm:text-xl font-semibold tracking-tight mb-4"
          >
            What {APP_NAME} does differently
          </h2>
          <ul className="space-y-2.5">
            {alt.differentiators.map((d, i) => (
              <li
                key={i}
                className="flex gap-2.5 text-sm sm:text-base leading-relaxed"
              >
                <Check className="h-4 w-4 text-primary shrink-0 mt-1" />
                <span className="text-foreground/90">{d}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10" aria-labelledby="faq">
          <h2
            id="faq"
            className="text-lg sm:text-xl font-semibold tracking-tight mb-4"
          >
            Questions
          </h2>
          <dl className="divide-y divide-border/50 border-t border-border/50">
            {alt.faq.map((item) => (
              <div key={item.question} className="py-5">
                <dt className="font-medium text-foreground mb-1.5">
                  {item.question}
                </dt>
                <dd className="text-sm text-muted-foreground leading-relaxed">
                  {item.answer}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <p className="mt-8 text-sm">
          <Link href="/alternatives" className="text-primary hover:underline">
            See all comparisons
          </Link>
        </p>
      </article>

      <ScanCta
        heading={`Compare ${APP_NAME} on your own site`}
        body="The fastest comparison is a real scan. Paste a URL, read the findings, and decide from evidence instead of a feature grid."
      />
    </SeoPageShell>
  );
}
