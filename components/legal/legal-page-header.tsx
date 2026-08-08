import {
  Scale,
  FileText,
  Shield,
  AlertTriangle,
  Accessibility,
  Copyright,
} from "lucide-react";

const iconMap = {
  terms: Scale,
  privacy: Shield,
  disclaimer: AlertTriangle,
  "acceptable-use": FileText,
  accessibility: Accessibility,
  dmca: Copyright,
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
  type?: keyof typeof iconMap;
}

export function LegalPageHeader({
  title,
  lastUpdated,
  type = "terms",
}: LegalPageHeaderProps) {
  const Icon = iconMap[type] || Scale;
  const formatted = new Date(`${lastUpdated}T00:00:00Z`).toLocaleDateString(
    "en-US",
    { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" },
  );

  return (
    <div className="mb-8">
      <div className="mb-3 flex items-center gap-3">
        <div className="rounded-xl bg-primary/10 p-2.5">
          <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Last updated <time dateTime={lastUpdated}>{formatted}</time>
      </p>
    </div>
  );
}
