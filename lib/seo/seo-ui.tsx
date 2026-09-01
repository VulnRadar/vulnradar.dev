import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { Button } from "@/components/ui/button";
import { LandingNav } from "@/components/landing/landing-nav";
import { Footer } from "@/components/scanner/footer";
import { APP_REPO, ROUTES } from "@/lib/config/client-constants";
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
      {/* tabIndex={-1} so the root layout's skip link moves focus here, not
          just the scroll position. */}
      <main id="main-content" tabIndex={-1} className="flex-1">
        {children}
      </main>
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
/**
 * The way in for someone who reads a check page and spots a gap.
 *
 * The check catalog is the one asset here that compounds without headcount,
 * and every competing detection set is closed while this one is open and was
 * advertised nowhere: grepping the /checks tree for "contribute" or the
 * detector issue template returned nothing, so no reader of any of the ~750
 * pages was ever told a check can be proposed. Deliberately a plain block
 * rather than a card grid, and it links the prefilled template rather than a
 * generic "open an issue".
 */
export function ContributeCheckCta({ className }: { className?: string }) {
  return (
    <section
      className={cn("border-t border-border/50 pt-6", className)}
      aria-labelledby="contribute"
    >
      <h2 id="contribute" className="text-sm font-semibold text-foreground">
        Missing a check?
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed max-w-2xl">
        The detection set is open. If you know a misconfiguration this does not
        catch, propose it: the issue template asks for the threat model, how to
        detect it, the false-positive risk, and a test fixture, which is the
        same thing a maintainer would have to work out anyway.
      </p>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <a
          href={`https://github.com/${APP_REPO}/issues/new?template=detector.md`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          Propose a check
        </a>
        <Link href="/docs/developers" className="text-primary hover:underline">
          How a check is built
        </Link>
      </p>
    </section>
  );
}

export function ScanCta({ heading, body }: { heading: string; body: string }) {
  return (
    <section className="border-t border-border/50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 sm:p-10">
          {/* wrap-break-word, not just text-balance: this heading is built from
              a check title, which is often one unbreakable identifier such as
              UnhandledPromiseRejectionWarning. Line breaking never breaks around
              a dot between letters, and text-balance cannot break a word, so on
              a 295px card the tail was clipped away by the page-level
              overflow-x: hidden rather than scrolling. */}
          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight mb-3 text-balance wrap-break-word">
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
