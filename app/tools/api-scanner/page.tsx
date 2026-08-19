import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  FaqStructuredData,
  SoftwareStructuredData,
} from "@/components/seo/structured-data";
import { SeoPageShell, SeverityPill, Breadcrumbs, ScanCta } from "@/lib/seo/seo-ui";
import { getChecksInCategory } from "@/lib/seo/checks-content";
import { APP_NAME } from "@/lib/config/constants";

const API_CHECKS = getChecksInCategory("api");

export const metadata: Metadata = pageMetadata({
  title: "API Scanner Online",
  description: `Scan an API for security issues online with ${APP_NAME}: CORS policy, rate-limit headers, GraphQL introspection, and exposed OpenAPI docs. No agent to install, just paste the URL.`,
  path: "/tools/api-scanner",
  keywords: [
    "api scanner online",
    "api security scanner",
    "scan api for vulnerabilities",
    "cors misconfiguration checker",
    "graphql introspection scanner",
    "rest api security testing",
  ],
});

const FAQ = [
  {
    question: "Can I scan an API without installing anything?",
    answer: `Yes. Paste the API URL and ${APP_NAME} runs the checks from the browser or the REST API. There is no agent, proxy, or Postman collection to import.`,
  },
  {
    question: "What kinds of API issues does it find?",
    answer:
      "CORS policy mistakes, missing rate-limit headers, GraphQL introspection left enabled, and exposed OpenAPI or Swagger documents that hand an attacker a map of every route.",
  },
  {
    question: "Does it work on GraphQL and REST?",
    answer:
      "Both. It checks REST endpoints for header and CORS issues and specifically looks for GraphQL introspection being reachable in production.",
  },
];

const HIGHLIGHTS = [
  "CORS policy: reflected origins, wildcard with credentials, null origin trust.",
  "Rate-limit headers: whether the API advertises any throttling at all.",
  "GraphQL introspection reachable in production.",
  "Exposed OpenAPI / Swagger documents describing every route.",
];

export default async function ApiScannerPage() {
  const nonce = (await headers()).get("x-nonce") ?? "";
  const breadcrumb = [
    { name: "Home", path: "/landing" },
    { name: "Tools", path: "/tools" },
    { name: "API Scanner", path: "/tools/api-scanner" },
  ];
  const featured = API_CHECKS.slice(0, 8);

  return (
    <SeoPageShell>
      <BreadcrumbStructuredData items={breadcrumb} nonce={nonce} />
      <SoftwareStructuredData nonce={nonce} />
      <FaqStructuredData items={FAQ} nonce={nonce} />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <Breadcrumbs items={breadcrumb} />

        <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-8 lg:gap-12 items-start">
          <header>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-foreground text-balance">
              API scanner, online
            </h1>
            <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
              Paste an API URL and {APP_NAME} checks it the way an attacker would
              probe it from the outside: CORS, rate limiting, GraphQL
              introspection, and any OpenAPI document you left reachable. No
              agent to install, just paste a URL.
            </p>
          </header>

          <ul className="rounded-xl border border-border/60 bg-muted/20 p-5 space-y-2.5">
            {HIGHLIGHTS.map((h, i) => (
              <li
                key={i}
                className="text-sm text-foreground/90 leading-relaxed flex gap-2.5"
              >
                <span className="text-primary" aria-hidden="true">
                  &bull;
                </span>
                {h}
              </li>
            ))}
          </ul>
        </div>

        <section className="mt-12" aria-labelledby="checks">
          <h2
            id="checks"
            className="text-lg sm:text-xl font-semibold tracking-tight mb-2"
          >
            Some of the {API_CHECKS.length} API checks
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Each one is a real check with its own fix guide.{" "}
            <Link
              href="/checks/category/api"
              className="text-primary hover:underline"
            >
              See all {API_CHECKS.length} API checks
            </Link>
            .
          </p>
          <ul className="divide-y divide-border/50 border-y border-border/50">
            {featured.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/checks/${c.id}`}
                  className="group flex items-start gap-3 py-3 hover:bg-muted/30 -mx-2 px-2 rounded-md transition-colors"
                >
                  <SeverityPill
                    severity={c.severity}
                    className="scale-90 flex-shrink-0 mt-0.5"
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
        </section>
      </div>

      <ScanCta
        heading="Scan your API now"
        body={`${APP_NAME} runs the full API check set against a URL in seconds, then shows the exact evidence and fix for every finding. Free tier, no card.`}
      />
    </SeoPageShell>
  );
}
