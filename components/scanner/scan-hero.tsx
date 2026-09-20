import { useTranslations } from "next-intl";
import { TOTAL_CHECKS_LABEL } from "@/lib/config/constants";
import { EXACT_CHECK_CATEGORY_COUNT } from "@/lib/config/check-stats.generated";

export function ScanHero() {
  const t = useTranslations("scan");
  return (
    <section aria-label="Scanner" className="pt-8 pb-5 sm:pt-10">
      <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-balance text-foreground">
        {t("heading")}
      </h1>
      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        {/* EXACT_CHECK_CATEGORY_COUNT, not ALL_CATEGORIES.length. That list is
            the PASSIVE families the engine runs (lib/scanner/engine.ts reads it
            to decide what fires), so it omits active-probes and came out one
            short: this line said 17 while the landing page and /checks said 18
            for the same idea. The generated count is what every other
            user-facing surface uses. */}
        {t("subheading", {
          checks: TOTAL_CHECKS_LABEL,
          categories: EXACT_CHECK_CATEGORY_COUNT,
        })}
      </p>
    </section>
  );
}
