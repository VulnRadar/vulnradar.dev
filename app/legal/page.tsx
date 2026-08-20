import Link from "next/link";
import { APP_NAME } from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";

const legalPages = [
  {
    href: "/legal/terms",
    title: "Terms of Service",
    description:
      "What you're agreeing to by using an account: authorized scanning only, account responsibilities, API limits, and liability.",
  },
  {
    href: "/legal/privacy",
    title: "Privacy Policy",
    description:
      "What we collect, how passwords and API keys are hashed and encrypted, retention windows, GDPR and CCPA rights.",
  },
  {
    href: "/legal/acceptable-use",
    title: "Acceptable Use Policy",
    description:
      "The authorization requirement in plain terms: what you may and may not scan, and what happens if you don't.",
  },
  {
    href: "/legal/disclaimer",
    title: "Disclaimer",
    description:
      "Scan results are informational, not a warranty or a penetration test. No warranty, liability caps, legal compliance.",
  },
  {
    href: "/legal/accessibility",
    title: "Accessibility Statement",
    description:
      "Conformance target, what's built in today, and how to report a barrier we missed.",
  },
  {
    href: "/legal/dmca",
    title: "DMCA & Copyright Policy",
    description:
      "How to file a copyright notice or a counter-notification, and where it goes.",
  },
];

export default async function LegalIndexPage() {
  const termsUpdatedAt = await getSetting("TERMS_UPDATED_AT");
  const lastUpdatedDisplay = new Date(
    `${termsUpdatedAt}T00:00:00Z`,
  ).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">
          Legal
        </h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          The documents that govern using {APP_NAME}. All six were last revised{" "}
          <time dateTime={termsUpdatedAt}>{lastUpdatedDisplay}</time>.
        </p>
      </div>

      <dl className="divide-y divide-border/50 border-y border-border/50">
        {legalPages.map((page) => (
          <div
            key={page.href}
            className="grid grid-cols-1 gap-1 py-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:gap-6"
          >
            <dt>
              <Link
                href={page.href}
                className="rounded-sm text-sm font-medium text-foreground hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                {page.title}
              </Link>
            </dt>
            <dd className="max-w-prose text-sm leading-relaxed text-muted-foreground">
              {page.description}
            </dd>
          </div>
        ))}
      </dl>

      <p className="max-w-prose text-xs text-muted-foreground">
        Looking for the technical side instead? The{" "}
        <Link href="/docs" className="text-primary hover:underline">
          documentation
        </Link>{" "}
        covers the API, self-hosting, and rate limits. Questions about any of
        the above go through{" "}
        <Link href="/contact" className="text-primary hover:underline">
          contact
        </Link>
        .
      </p>
    </div>
  );
}
