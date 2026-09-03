import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { pageMetadata } from "@/lib/seo/metadata";
import { BreadcrumbStructuredData } from "@/components/seo/structured-data";
import { SeoPageShell, Breadcrumbs, ScanCta } from "@/lib/seo/seo-ui";
import { getAllAlternatives } from "@/lib/seo/alternatives";
import { APP_NAME } from "@/lib/config/constants";

const ALTERNATIVES = getAllAlternatives();

// Names come from the data, never a hand-written list: this description used
// to end "...Probely, and IntelliRadar" long after the IntelliRadar entry was
// deleted for having nothing factual to say, so the search snippet promised a
// comparison the page could not show.
const NAME_LIST = ALTERNATIVES.map((a) => a.name);
const NAMES =
  NAME_LIST.length > 1
    ? `${NAME_LIST.slice(0, -1).join(", ")} and ${NAME_LIST[NAME_LIST.length - 1]}`
    : (NAME_LIST[0] ?? "");

export const metadata: Metadata = pageMetadata({
  title: "Open-Source Scanner Alternatives Compared",
  description: `How ${APP_NAME}, an open-source GPL-3.0 scanner, compares to ${NAMES}. Honest, factual comparisons.`,
  path: "/alternatives",
  keywords: [
    "vulnerability scanner alternatives",
    "open source vulnerability scanner",
    "web application scanner comparison",
    ...ALTERNATIVES.map((a) => `${a.name.toLowerCase()} alternative`),
  ],
});

export default async function AlternativesIndexPage() {
  const nonce = (await headers()).get("x-nonce") ?? "";
  const breadcrumb = [
    { name: "Home", path: "/landing" },
    { name: "Alternatives", path: "/alternatives" },
  ];

  return (
    <SeoPageShell>
      <BreadcrumbStructuredData items={breadcrumb} nonce={nonce} />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <Breadcrumbs items={breadcrumb} />

        <header className="max-w-2xl">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-foreground text-balance">
            How {APP_NAME} compares
          </h1>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
            {APP_NAME} is an open-source, GPL-3.0 web vulnerability scanner you
            can self-host, with a free tier and paid plans from $5 a month. Here
            is an honest look at where it fits next to the better-known
            commercial tools. No invented competitor prices, no disparagement.
          </p>
        </header>

        {/* Each row carries the competitor's own pricing model, read from the
            same comparison data its detail page renders. Four rows of name +
            category + prose are four rows that look identical; the pricing
            model is the fact people are actually here to line up, and it was
            buried one click deeper. */}
        <div className="mt-10 space-y-3">
          {ALTERNATIVES.map((alt) => {
            const pricing = alt.rows.find((r) => r.feature === "Pricing model");
            return (
              <Link
                key={alt.slug}
                href={`/alternatives/${alt.slug}`}
                className="group flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-card p-5 hover:border-primary/40 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <h2 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                      {APP_NAME} vs {alt.name}
                    </h2>
                    <span className="text-xs text-muted-foreground">
                      {alt.category}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                    {alt.summary}
                  </p>
                  {pricing && (
                    <p className="mt-2.5 grid gap-x-2 border-t border-border/50 pt-2.5 text-xs sm:grid-cols-[minmax(0,7rem)_minmax(0,1fr)]">
                      <span className="font-mono uppercase tracking-wider text-muted-foreground">
                        Their pricing
                      </span>
                      <span className="text-foreground/90">{pricing.them}</span>
                    </p>
                  )}
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0 mt-1" />
              </Link>
            );
          })}
        </div>
      </div>

      <ScanCta
        heading={`Try ${APP_NAME} before you compare specs`}
        body="Paste a URL and see the findings for yourself in seconds. The free tier needs no card, and the whole engine is open source if you would rather self-host."
      />
    </SeoPageShell>
  );
}
