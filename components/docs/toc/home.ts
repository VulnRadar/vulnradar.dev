import type { TocItem } from "../docs-types";

/** The sections of /docs, in page order. */
export const toc: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "quick-start", label: "First scan" },
  { id: "documentation", label: "The documentation set" },
  { id: "coverage", label: "What gets checked" },
  { id: "exclude-from-scan", label: "Keeping pages out of a scan" },
  { id: "support", label: "Support and versions" },
];
