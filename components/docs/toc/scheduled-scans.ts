import type { TocItem } from "../docs-types";

/** The sections of /docs/scheduled-scans, in page order. */
export const toc: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "create", label: "Creating a schedule" },
  { id: "frequencies", label: "Frequencies and plan limits" },
  { id: "timezone", label: "Time of day and timezones" },
  { id: "delivery", label: "Where results go" },
  { id: "control", label: "Pausing, teams, auto-disable" },
  { id: "api", label: "The schedules API" },
  { id: "worker", label: "How runs are triggered" },
  { id: "bulk", label: "Bulk scanning" },
];
