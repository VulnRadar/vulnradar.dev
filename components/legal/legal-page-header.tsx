const kickerMap = {
  terms: "Legal · Terms of service",
  privacy: "Legal · Privacy",
  disclaimer: "Legal · Disclaimer",
  "acceptable-use": "Legal · Acceptable use",
  accessibility: "Legal · Accessibility",
  dmca: "Legal · DMCA",
};

interface LegalPageHeaderProps {
  title: string;
  /**
   * ISO date (YYYY-MM-DD), from `TERMS_UPDATED_AT` in
   * `lib/config/constants.ts`. Formatted for display here rather than in
   * every page, so there is exactly one place that turns "2026-03-16" into
   * "March 16, 2026".
   */
  lastUpdated: string;
  type?: keyof typeof kickerMap;
}

export function LegalPageHeader({
  title,
  lastUpdated,
  type = "terms",
}: LegalPageHeaderProps) {
  const formatted = new Date(`${lastUpdated}T00:00:00Z`).toLocaleDateString(
    "en-US",
    { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" },
  );

  return (
    <div className="mb-10 border-b border-border/50 pb-6">
      <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-primary/70">
        {kickerMap[type] || kickerMap.terms}
      </p>
      <h1 className="text-3xl font-bold tracking-tight text-foreground">
        {title}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Last updated <time dateTime={lastUpdated}>{formatted}</time>
      </p>
    </div>
  );
}
