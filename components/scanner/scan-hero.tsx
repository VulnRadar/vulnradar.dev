import { TOTAL_CHECKS_LABEL } from "@/lib/config/constants";
import { ALL_CATEGORIES } from "@/lib/scanner/types";

export function ScanHero() {
  return (
    <section aria-label="Scanner" className="pt-8 pb-5 sm:pt-10">
      <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
        Scan a host
      </h1>
      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        {TOTAL_CHECKS_LABEL} checks across {ALL_CATEGORIES.length} families.
        Paste a domain or an IPv4 address, choose what runs, and read the
        findings. Nothing to install.
      </p>
    </section>
  );
}
