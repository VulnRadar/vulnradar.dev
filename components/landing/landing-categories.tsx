import { getCategoryCounts } from "@/lib/scanner/registry";
import type { Category } from "@/lib/scanner/types";
import { cn } from "@/lib/ui/utils";

/**
 * The one category this table calls out with colour: it is the product's
 * named differentiator (see the FAQ and hero copy), not an arbitrary pick,
 * so it earns the accent the other fifteen rows deliberately don't get.
 */
const FLAGSHIP_CATEGORY: Category = "vibe-code";

const META: Record<Category, { label: string; blurb: string }> = {
  headers: {
    label: "Headers",
    blurb: "CSP, HSTS, X-Frame-Options, referrer policy, permissions policy.",
  },
  ssl: {
    label: "SSL",
    blurb: "Certificate chain, signature algorithm, issuer, expiry date.",
  },
  tls: {
    label: "TLS",
    blurb: "Protocol version, cipher suite, ALPN negotiation, OCSP stapling.",
  },
  content: {
    label: "Content",
    blurb: "XSS sinks, reflected parameters, open redirects, mixed content.",
  },
  cookies: {
    label: "Cookies",
    blurb: "Secure, HttpOnly, SameSite, scope, __Host- and __Secure- prefixes.",
  },
  configuration: {
    label: "Config",
    blurb: "Server banner, framework fingerprint, exposed debug endpoints.",
  },
  "information-disclosure": {
    label: "Info disclosure",
    blurb: "Source maps, .env files, .git exposure, stack traces in errors.",
  },
  dns: {
    label: "DNS",
    blurb: "SPF, DMARC, DKIM, DNSSEC, CAA records, dangling CNAMEs.",
  },
  email: {
    label: "Email",
    blurb: "MX records, SMTP TLS, SPF alignment, spoofing surface area.",
  },
  api: {
    label: "API",
    blurb: "CORS policy, rate-limit headers, GraphQL introspection, OpenAPI.",
  },
  code: {
    label: "Code",
    blurb: "Inline JS patterns, vulnerable library versions, leaked tokens.",
  },
  "secrets-extended": {
    label: "Secrets",
    blurb: "AWS keys, Stripe, GitHub, OpenAI, generic high-entropy strings.",
  },
  "vibe-code": {
    label: "AI code",
    blurb:
      "Placeholder auth, disabled TLS verification, weak crypto: the gaps generated code ships with.",
  },
  "client-side": {
    label: "Client-side",
    blurb:
      "DOM XSS sinks, postMessage origin checks, unsafe-inline CSP, prototype pollution.",
  },
  "supply-chain": {
    label: "Supply chain",
    blurb:
      "Exposed lock files, dependency manifests, build artifacts, source maps.",
  },
  "host-validation": {
    label: "Host validation",
    blurb:
      "Open redirects, SSRF through the Host header, subdomain takeover markers.",
  },
};

export function LandingCategories() {
  const counts = getCategoryCounts();
  const keys = Object.keys(META) as Category[];
  const total = keys.reduce((sum, key) => sum + (counts[key] ?? 0), 0);

  return (
    <section
      id="categories"
      className="py-16 sm:py-20 border-t border-border/50"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
          <div>
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-2">
              The whole check list
            </h2>
            <p className="text-muted-foreground max-w-lg leading-relaxed">
              Every check is gated to the URL types it applies to, so a static
              site is not marked down for missing an API rate-limit header.
            </p>
          </div>
          <p className="text-sm text-muted-foreground shrink-0 tabular-nums">
            <span className="font-mono font-semibold text-foreground">
              {total.toLocaleString()}
            </span>{" "}
            checks in {keys.length} categories
          </p>
        </div>

        <div className="sm:hidden space-y-2.5">
          {keys.map((key) => {
            const isFlagship = key === FLAGSHIP_CATEGORY;
            return (
              <div
                key={key}
                className={cn(
                  "rounded-lg border p-4",
                  isFlagship
                    ? "border-primary/25 bg-primary/5"
                    : "border-border/60 bg-card",
                )}
              >
                <div className="flex items-baseline justify-between gap-3 mb-1.5">
                  <span
                    className={cn(
                      "font-semibold",
                      isFlagship ? "text-primary" : "text-foreground",
                    )}
                  >
                    {META[key].label}
                  </span>
                  <span
                    className={cn(
                      "font-mono text-sm tabular-nums shrink-0",
                      isFlagship ? "text-primary" : "text-foreground",
                    )}
                  >
                    {counts[key] ?? 0}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {META[key].blurb}
                </p>
              </div>
            );
          })}
        </div>

        <div className="hidden sm:block overflow-x-auto rounded-xl border border-border/60">
          <table className="w-full min-w-[560px] text-sm border-collapse">
            <caption className="sr-only">
              Scanner categories and how many checks each one contains
            </caption>
            <thead>
              <tr className="border-b border-border/60 bg-muted/30 text-left">
                <th
                  scope="col"
                  className="px-4 sm:px-5 py-3 font-medium text-muted-foreground w-[26%]"
                >
                  Category
                </th>
                <th
                  scope="col"
                  className="px-4 sm:px-5 py-3 font-medium text-muted-foreground"
                >
                  What it looks at
                </th>
                <th
                  scope="col"
                  className="px-4 sm:px-5 py-3 font-medium text-muted-foreground text-right w-[92px]"
                >
                  Checks
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => {
                const isFlagship = key === FLAGSHIP_CATEGORY;
                return (
                  <tr
                    key={key}
                    className={cn(
                      "border-b border-border/40 last:border-0 transition-colors",
                      isFlagship
                        ? "bg-primary/5 hover:bg-primary/10"
                        : "hover:bg-muted/20",
                    )}
                  >
                    <th
                      scope="row"
                      className={cn(
                        "px-4 sm:px-5 py-3 font-semibold text-left align-top",
                        isFlagship ? "text-primary" : "text-foreground",
                      )}
                    >
                      {META[key].label}
                    </th>
                    <td className="px-4 sm:px-5 py-3 text-muted-foreground leading-relaxed align-top">
                      {META[key].blurb}
                    </td>
                    <td
                      className={cn(
                        "px-4 sm:px-5 py-3 text-right align-top font-mono tabular-nums",
                        isFlagship ? "text-primary" : "text-foreground",
                      )}
                    >
                      {counts[key] ?? 0}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
