import type { TocItem } from "../docs-types";

/** The sections of /docs/rate-limits, in page order. */
export const toc: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "limits-by-plan", label: "Limits by Plan" },
  { id: "ip-rate-limits", label: "Named Rate Limits" },
  { id: "headers", label: "Rate Limit Headers" },
  { id: "handling", label: "Handling 429s" },
  { id: "best-practices", label: "Best Practices" },
];
