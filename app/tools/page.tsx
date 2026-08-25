import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  SoftwareStructuredData,
} from "@/components/seo/structured-data";
import { SeoPageShell, Breadcrumbs, ScanCta } from "@/lib/seo/seo-ui";
import { APP_NAME } from "@/lib/config/constants";

export const metadata: Metadata = pageMetadata({
  title: "Free Online Security Tools, No Signup",
  description: `Free security tools from ${APP_NAME}, no signup: scan an API online, follow a link's real redirect chain, and audit a URL's security headers.`,
  path: "/tools",
  keywords: [
    "free security tools",
    "online vulnerability scanner",
    "free website security checker",
    "url security scanner online",
  ],
});

const TOOLS = [
  {
    href: "/tools/api-scanner",
    name: "API Scanner",
    tagline: "Scan an API endpoint online",
    body: "Point it at an API URL and check CORS policy, rate-limit headers, GraphQL introspection, and exposed OpenAPI docs. No agent, no Postman collection to import.",
  },
  {
    href: "/tools/link-checker",
    name: "Link & Redirect Checker",
    tagline: "See where a link really goes",
    body: "Follow a URL's redirect chain and check its security headers, TLS, and reputation, including links sitting behind Cloudflare. Useful before you click something you were sent.",
  },
];

export default async function ToolsIndexPage() {
  const nonce = (await headers()).get("x-nonce") ?? "";
  const breadcrumb = [
    { name: "Home", path: "/landing" },
    { name: "Tools", path: "/tools" },
  ];

  return (
    <SeoPageShell>
      <BreadcrumbStructuredData items={breadcrumb} nonce={nonce} />
      <SoftwareStructuredData nonce={nonce} />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <Breadcrumbs items={breadcrumb} />

        <header className="max-w-2xl">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-foreground text-balance">
            Free security tools
          </h1>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
            Focused, single-purpose views of the {APP_NAME} scanner. Each one
            runs the same detection engine against a URL you paste, no signup
            and nothing to install.
          </p>
        </header>

        <div className="mt-10 grid gap-4">
          {TOOLS.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="group rounded-lg border border-border/60 bg-card p-5 sm:p-6 hover:border-primary/40 transition-colors"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                    {tool.name}
                  </h2>
                  <p className="text-sm text-primary/80 mt-0.5">
                    {tool.tagline}
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
              </div>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                {tool.body}
              </p>
            </Link>
          ))}
        </div>

        <p className="mt-8 text-sm text-muted-foreground">
          Looking for the whole picture?{" "}
          <Link href="/checks" className="text-primary hover:underline">
            Browse every check {APP_NAME} runs
          </Link>
          .
        </p>
      </div>

      <ScanCta
        heading="Run the full scanner"
        body={`These tools are slices of one engine. Run the complete scan to get every category at once, with severity, evidence, and a fix for each finding.`}
      />
    </SeoPageShell>
  );
}
