import { TOTAL_CHECKS_LABEL } from "@/lib/config/constants";
import { EXACT_CHECK_CATEGORY_COUNT } from "@/lib/config/check-stats.generated";

export function ScanHero() {
  return (
    <section aria-label="Scanner" className="pt-8 pb-5 sm:pt-10">
      <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
        Scan a host
      </h1>
      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        {/* EXACT_CHECK_CATEGORY_COUNT, not ALL_CATEGORIES.length. That list is
            the PASSIVE families the engine runs (lib/scanner/engine.ts reads it
            to decide what fires), so it omits active-probes and came out one
            short: this line said 17 while the landing page and /checks said 18
            for the same idea. The generated count is what every other
            user-facing surface uses. */}
        {TOTAL_CHECKS_LABEL} checks across {EXACT_CHECK_CATEGORY_COUNT}{" "}
        categories. Paste a domain or an IPv4 address, choose what runs, and
        read the findings. Nothing to install.
      </p>
    </section>
  );
}
