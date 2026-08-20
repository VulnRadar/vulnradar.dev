import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { Button } from "@/components/ui/button";
import { LandingNav } from "@/components/landing/landing-nav";
import { Footer } from "@/components/scanner/footer";
import { ROUTES } from "@/lib/config/constants";
import type { Severity } from "@/lib/scanner/types";

/**
 * Shared chrome for the SEO content pages (checks, alternatives, tools).
 * Server component so each page stays statically renderable; LandingNav and
 * Footer are the same client islands the landing and pricing pages use.
 */
export function SeoPageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <LandingNav />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}

const SEVERITY_TEXT: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Informational",
};

/**
 * Severity badge. Colours come from the shared --severity-* CSS variables via
 * inline style rather than Tailwind arbitrary classes: this component lives in
 * lib/, which is outside Tailwind's content globs, so a class like
 * `bg-[hsl(var(--severity-info))]/10` would never be generated. The vars hold
 * space-separated HSL triplets, so `hsl(var(--x) / 0.1)` is valid and stays
 * theme-aware in light and dark mode automatically.
 */
export function SeverityPill({
  severity,
  className,
}: {
  severity: Severity;
  className?: string;
}) {
  const v = `var(--severity-${severity})`;
  return (
    <span
      style={{
        color: `hsl(${v})`,
        backgroundColor: `hsl(${v} / 0.1)`,
        borderColor: `hsl(${v} / 0.25)`,
      }}
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        className,
      )}
    >
      {SEVERITY_TEXT[severity]}
    </span>
  );
}

/**
 * Visible breadcrumb trail. Mirrors the BreadcrumbStructuredData JSON-LD so
 * the on-page trail and the one search engines read stay identical.
 */
export function Breadcrumbs({
  items,
}: {
  items: { name: string; path?: string }[];
}) {
  return (
    <nav aria-label="Breadcrumb" className="mb-6">
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1.5">
              {item.path && !last ? (
                <Link
                  href={item.path}
                  className="hover:text-foreground transition-colors"
                >
                  {item.name}
                </Link>
              ) : (
                <span className={cn(last && "text-foreground")}>
                  {item.name}
                </span>
              )}
              {!last && <span aria-hidden="true">/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Closing call-to-action used across the SEO pages. Links to the live demo
 * scanner so a reader who came in on a long-tail query can act immediately.
 */
export function ScanCta({ heading, body }: { heading: string; body: string }) {
  return (
    <section className="border-t border-border/50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 sm:p-10">
          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight mb-3 text-balance">
            {heading}
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-6 max-w-2xl">
            {body}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" className="h-11 px-6 gap-2">
              <Link href={ROUTES.DEMO}>
                Run a free scan
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-11 px-6 gap-2"
            >
              <Link href={ROUTES.DOCS}>Read the docs</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
