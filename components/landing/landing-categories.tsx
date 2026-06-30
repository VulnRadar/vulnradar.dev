import { getCategoryCounts } from "@/lib/scanner/registry";
import type { Category } from "@/lib/scanner/types";

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
    blurb:
      "Secure, HttpOnly, SameSite, scope, __Host- and __Secure- prefixes.",
  },
  configuration: {
    label: "Config",
    blurb: "Server banner, framework fingerprint, exposed debug endpoints.",
  },
  "information-disclosure": {
    label: "Info Disclosure",
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
    blurb:
      "AWS keys, Stripe, GitHub, OpenAI, generic high-entropy strings.",
  },
};

export function LandingCategories() {
  const counts = getCategoryCounts();

  return (
    <section id="categories" className="py-16 sm:py-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="mb-8">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
            What gets checked
          </h2>
          <p className="text-muted-foreground max-w-xl leading-relaxed">
            Twelve independent scanners running in parallel. Each one covers a
            distinct attack surface. Every check has a stable ID and is gated
            to the URL types it applies to.
          </p>
        </div>

        {/* 3-column grid — overflow-hidden clips edge borders */}
        <div className="rounded-xl border border-border/60 overflow-hidden">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3">
            {(Object.keys(META) as Category[]).map((key) => {
              const { label, blurb } = META[key];
              const count = counts[key] ?? 0;
              return (
                <div
                  key={key}
                  className="p-4 sm:p-5 border-r border-b border-border/40"
                >
                  <div className="flex items-baseline justify-between gap-2 mb-1.5">
                    <span className="text-sm font-semibold text-foreground">
                      {label}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground/70 tabular-nums shrink-0">
                      {count}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {blurb}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
