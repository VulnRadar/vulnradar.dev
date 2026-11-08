import type { TocItem } from "../docs-types";

/** The sections of /docs/reports, in page order. */
export const toc: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "endpoint", label: "The report endpoint" },
  { id: "formats", label: "Report formats" },
  { id: "access", label: "Access control" },
  { id: "sarif", label: "SARIF and CI" },
  { id: "compliance", label: "Compliance crosswalk" },
  { id: "caveats", label: "What the crosswalk is not" },
];
