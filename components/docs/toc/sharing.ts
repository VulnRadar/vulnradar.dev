import type { TocItem } from "../docs-types";

/** The sections of /docs/sharing, in page order. */
export const toc: TocItem[] = [
  { id: "who-can-see", label: "Who can see what" },
  { id: "overview", label: "Overview" },
  { id: "share-links", label: "Sharing a scan" },
  { id: "public-scans", label: "The Public Scans directory" },
  { id: "redaction", label: "What a viewer can see" },
  { id: "host-reports", label: "Per-host reports" },
  { id: "assets", label: "Assets and attack surface" },
  {
    id: "domain-owner-controls",
    label: "Verified domains and site-owner controls",
  },
  { id: "badges", label: "Security badges" },
  { id: "compare", label: "Comparing two scans" },
];
