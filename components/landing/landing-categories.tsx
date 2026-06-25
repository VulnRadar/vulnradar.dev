import { getCategoryCounts } from "@/lib/scanner/registry";
import {
  Shield,
  Lock,
  FileCode,
  Cookie,
  Settings,
  Eye,
  Globe,
  Mail,
  Server,
  KeyRound,
  Bug,
  KeySquare,
} from "lucide-react";
import type { Category } from "@/lib/scanner/types";

interface CategoryMeta {
  label: string;
  blurb: string;
  icon: React.ComponentType<{ className?: string }>;
}

const META: Record<Category, CategoryMeta> = {
  headers: {
    label: "Headers",
    blurb: "CSP, HSTS, X-Frame-Options, referrer policy, and the long tail.",
    icon: Shield,
  },
  ssl: {
    label: "SSL",
    blurb: "Certificate chain, signature algorithm, issuer, and expiry.",
    icon: Lock,
  },
  tls: {
    label: "TLS",
    blurb: "Negotiated protocol, cipher suite, ALPN, and OCSP stapling.",
    icon: KeyRound,
  },
  content: {
    label: "Content",
    blurb: "XSS sinks, reflected parameters, open redirects, mixed content.",
    icon: FileCode,
  },
  cookies: {
    label: "Cookies",
    blurb:
      "Secure, HttpOnly, SameSite, scope, and prefix (__Host-, __Secure-).",
    icon: Cookie,
  },
  configuration: {
    label: "Config",
    blurb: "Server banner, framework fingerprint, exposed debug endpoints.",
    icon: Settings,
  },
  "information-disclosure": {
    label: "Info Disclosure",
    blurb: "Source maps, .env files, .git, stack traces in errors.",
    icon: Eye,
  },
  dns: {
    label: "DNS",
    blurb: "SPF, DMARC, DKIM, DNSSEC, CAA records, dangling CNAMEs.",
    icon: Globe,
  },
  email: {
    label: "Email",
    blurb: "MX records, SMTP TLS, SPF alignment, spoofing surface.",
    icon: Mail,
  },
  api: {
    label: "API",
    blurb: "CORS, rate-limit headers, GraphQL introspection, OpenAPI diff.",
    icon: Server,
  },
  code: {
    label: "Code",
    blurb:
      "Inline JS patterns, vulnerable library fingerprints, leaked tokens.",
    icon: Bug,
  },
  "secrets-extended": {
    label: "Secrets",
    blurb: "AWS keys, Stripe, GitHub, OpenAI, generic high-entropy strings.",
    icon: KeySquare,
  },
};

export function LandingCategories() {
  const counts = getCategoryCounts();
  const categories = (Object.keys(META) as Category[]).map((c) => ({
    ...META[c],
    key: c,
    count: counts[c] ?? 0,
  }));

  return (
    <section
      id="categories"
      className="py-16 sm:py-24 border-t border-border/50"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="max-w-2xl mb-10">
          <p className="text-xs font-medium text-primary uppercase tracking-wider mb-2">
            Coverage
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3 text-balance">
            What we actually check
          </h2>
          <p className="text-muted-foreground text-pretty">
            Twelve independent scanners, each with a stable set of checks. Run
            them all or pick the ones that fit the target. Every category is
            gated to a list of URLs it makes sense for.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 min-w-0">
          {categories.map(({ key, label, blurb, icon: Icon, count }) => (
            <div
              key={key}
              className="p-4 sm:p-5 rounded-xl border border-border/50 bg-card/50 hover:bg-card hover:border-border transition-all"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {count} checks
                </span>
              </div>
              <h3 className="text-base font-semibold mb-1.5">{label}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed break-words">
                {blurb}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
