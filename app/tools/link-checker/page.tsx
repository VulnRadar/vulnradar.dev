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
  title: "Link & Redirect Checker: See Where It Goes",
  description: `See where a link really goes before you click: ${APP_NAME} follows the full redirect chain and checks headers, TLS, and reputation, even behind Cloudflare.`,
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

const LOOKS_AT = [
  {
    title: "The redirect chain",
    body: "Every hop a URL makes and the destination it finally lands on, so a shortened or cloaked link cannot hide where it goes.",
  },
  {
    title: "The security headers",
    body: "HSTS, CSP, X-Frame-Options, and the rest, exactly as the origin (and any Cloudflare layer in front of it) returns them.",
  },
  {
    title: "The TLS and certificate",
    body: "Whether the connection is really encrypted, the certificate is valid and current, and the page is not mixing HTTP resources into an HTTPS load.",
  },
  {
    title: "The destination's reputation",
    body: "The final host is checked against Google Web Risk for known malware, phishing, and unwanted-software listings.",
  },
];

/**
 * An illustrative trace, not a live one. Every host is under a reserved
 * example domain (RFC 2606) so nothing here reads as a claim about a real
 * site, which is the same rule the landing hero's response readout follows.
 *
 * This block is the page's whole subject rendered as itself: the thing a link
 * checker produces is a chain, and the page used to show four numbered
 * circles instead. The hop numbers are real information here (order is what a
 * redirect chain IS), unlike the circles they replace, which numbered a list
 * of unrelated capabilities.
 */
const CHAIN: { host: string; status: string; label: string }[] = [
  { host: "example.com/promo", status: "301", label: "moved permanently" },
  { host: "l.example.net/r/aHR0cHM6", status: "302", label: "found" },
  { host: "click.example.org/t/9f2a", status: "302", label: "found" },
  { host: "secure-login.example.net", status: "200", label: "you land here" },
];

/** `severity` null means the check passed, which is coloured with the success
 *  token rather than a severity: the same rule the real report follows. */
const TRACE_FINDINGS: {
  label: string;
  value: string;
  severity: "high" | "medium" | null;
}[] = [
  {
    label: "strict-transport-security",
    value: "missing",
    severity: "high",
  },
  { label: "certificate issued", value: "3 days ago", severity: "medium" },
  { label: "google web risk", value: "no listing", severity: null },
];

function toneFor(severity: "high" | "medium" | null): string {
  return severity === null
    ? "hsl(var(--success))"
    : `hsl(var(--severity-${severity}))`;
}

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
            Paste a URL and {APP_NAME} follows it end to end: the redirect
            chain, the security headers, the TLS, and the reputation of wherever
            it lands, including links sitting behind Cloudflare. It is the check
            to run before you click something you were sent.
          </p>
        </header>

        <figure className="mt-10">
          <div
            aria-hidden="true"
            className="select-none overflow-hidden rounded-xl border border-border bg-card font-mono text-sm"
          >
            <div className="flex items-baseline gap-2 border-b border-border/60 bg-muted/20 px-4 py-3 sm:px-5">
              <span className="shrink-0 font-semibold text-primary">GET</span>
              <span className="min-w-0 flex-1 truncate text-foreground">
                example.com/promo
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {CHAIN.length} hops
              </span>
            </div>

            <ol className="px-4 py-4 sm:px-5">
              {CHAIN.map((hop, i) => (
                <li
                  key={hop.host}
                  className="flex items-baseline gap-3 py-1 text-xs sm:text-sm"
                >
                  {/* Full-strength --muted-foreground throughout: the token
                      only clears AA at full strength, and an opacity variant
                      on 12px mono text does not. */}
                  <span className="w-4 shrink-0 text-muted-foreground">
                    {i === 0 ? "·" : "↳"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {hop.host}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {hop.status}
                  </span>
                  <span className="hidden shrink-0 text-muted-foreground sm:inline">
                    {hop.label}
                  </span>
                </li>
              ))}
            </ol>

            <div className="border-t border-border/60 px-4 py-4 sm:px-5">
              <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                At the destination
              </p>
              {TRACE_FINDINGS.map((f) => (
                <p
                  key={f.label}
                  // Wraps rather than clips: these labels are ours
                  // ("strict-transport-security" is 25 mono characters) and at
                  // sm:text-sm the row ran out of width before the container
                  // gained any.
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1 text-xs sm:text-sm"
                >
                  <span className="min-w-0 flex-1 text-muted-foreground">
                    {f.label}
                  </span>
                  <span
                    className="shrink-0 font-medium"
                    style={{ color: toneFor(f.severity) }}
                  >
                    {f.value}
                  </span>
                </p>
              ))}
            </div>
          </div>
          <figcaption className="mt-3 text-sm leading-relaxed text-muted-foreground">
            An illustrative trace on reserved example domains. A real one names
            your link&rsquo;s actual hops, and every line at the destination is
            a finding with the same ID, severity, and fix you would get from a
            full scan.
          </figcaption>
        </figure>

        {/* Deliberately a labelled two-column list rather than the numbered
            circles this used to be: these are four things the scan looks at
            at once, not four steps in an order, so a 1/2/3/4 badge was
            encoding a sequence that is not there. */}
        <section className="mt-12" aria-labelledby="what">
          <h2
            id="what"
            className="text-lg sm:text-xl font-semibold tracking-tight border-b border-border/50 pb-2"
          >
            What it looks at
          </h2>
          <dl className="divide-y divide-border/50">
            {LOOKS_AT.map((item) => (
              <div
                key={item.title}
                className="grid grid-cols-1 gap-1 py-5 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] sm:gap-8"
              >
                <dt className="text-sm font-semibold text-foreground sm:pt-0.5">
                  {item.title}
                </dt>
                <dd className="text-sm leading-relaxed text-muted-foreground">
                  {item.body}
                </dd>
              </div>
            ))}
          </dl>
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
