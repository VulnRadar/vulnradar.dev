import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  FaqStructuredData,
  SoftwareStructuredData,
} from "@/components/seo/structured-data";
import { SeoPageShell, Breadcrumbs, ScanCta } from "@/lib/seo/seo-ui";
import { APP_NAME } from "@/lib/config/constants";

export const metadata: Metadata = pageMetadata({
  title: "Link & Redirect Checker",
  description: `Check where a link really goes and whether it is safe with ${APP_NAME}: redirect chain, security headers, TLS, and reputation, including links behind Cloudflare. Paste a URL, no signup.`,
  path: "/tools/link-checker",
  keywords: [
    "cloudflare link checker",
    "link checker",
    "redirect checker",
    "url safety checker",
    "check where a link goes",
    "security header checker",
  ],
});

const FAQ = [
  {
    question: "Does this work on links behind Cloudflare?",
    answer: `Yes. ${APP_NAME} requests the URL the same way a browser does, so a site sitting behind Cloudflare is checked normally: you see the redirect chain, the security headers Cloudflare and the origin return, and the reputation of the final destination.`,
  },
  {
    question: "Can I see where a shortened or redirecting link ends up?",
    answer:
      "Yes. The scan follows the redirect chain and reports the final URL, so you can see where a link actually lands before you click it.",
  },
  {
    question: "Is it really free?",
    answer: `The free tier needs no card. ${APP_NAME} is also open source under GPL-3.0, so you can self-host it and check links entirely on your own infrastructure.`,
  },
];

const STEPS = [
  {
    title: "Follows the redirect chain",
    body: "See every hop a URL makes and the final destination it lands on, so a shortened or cloaked link cannot hide where it goes.",
  },
  {
    title: "Reads the security headers",
    body: "HSTS, CSP, X-Frame-Options, and the rest, exactly as the origin (and any Cloudflare layer in front of it) returns them.",
  },
  {
    title: "Checks the TLS and certificate",
    body: "Whether the connection is really encrypted, the certificate is valid and current, and the page is not mixing HTTP resources into an HTTPS load.",
  },
  {
    title: "Looks up reputation",
    body: "The final host is checked against Google Web Risk for known malware, phishing, and unwanted-software listings.",
  },
];

export default async function LinkCheckerPage() {
  const nonce = (await headers()).get("x-nonce") ?? "";
  const breadcrumb = [
    { name: "Home", path: "/landing" },
    { name: "Tools", path: "/tools" },
    { name: "Link Checker", path: "/tools/link-checker" },
  ];

  return (
    <SeoPageShell>
      <BreadcrumbStructuredData items={breadcrumb} nonce={nonce} />
      <SoftwareStructuredData nonce={nonce} />
      <FaqStructuredData items={FAQ} nonce={nonce} />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <Breadcrumbs items={breadcrumb} />

        <header>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-foreground text-balance">
            Check where a link really goes
          </h1>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
            Paste a URL and {APP_NAME} follows it end to end: the redirect chain,
            the security headers, the TLS, and the reputation of wherever it
            lands, including links sitting behind Cloudflare. It is the check to
            run before you click something you were sent.
          </p>
        </header>

        <section className="mt-10 space-y-6" aria-labelledby="what">
          <h2
            id="what"
            className="text-lg sm:text-xl font-semibold tracking-tight border-b border-border/50 pb-2"
          >
            What it looks at
          </h2>
          <ol className="space-y-5">
            {STEPS.map((step, i) => (
              <li key={i} className="flex gap-4">
                <span className="flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-semibold tabular-nums">
                  {i + 1}
                </span>
                <div>
                  <h3 className="font-medium text-foreground">{step.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <p className="mt-8 text-sm text-muted-foreground">
          Want the header detail on its own?{" "}
          <Link
            href="/checks/category/headers"
            className="text-primary hover:underline"
          >
            Browse the security header checks
          </Link>{" "}
          or{" "}
          <Link
            href="/checks/category/host-validation"
            className="text-primary hover:underline"
          >
            the redirect and host checks
          </Link>
          .
        </p>
      </div>

      <ScanCta
        heading="Check a link now"
        body={`Paste any URL and ${APP_NAME} traces it to its destination and grades what it finds. Free tier, no signup, no agent to install.`}
      />
    </SeoPageShell>
  );
}
