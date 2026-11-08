import type { TocItem } from "../docs-types";

/** The sections of /docs/triage, in page order. */
export const toc: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "remediation", label: "Remediation tracking" },
  { id: "statuses", label: "Statuses", level: 2 },
  { id: "tracking-fields", label: "Assignee, note, due date", level: 2 },
  { id: "rescans", label: "Surviving rescans", level: 2 },
  { id: "bulk", label: "Bulk actions", level: 2 },
  { id: "remediation-api", label: "Remediation API", level: 2 },
  { id: "false-positives", label: "False positives" },
  { id: "tickets", label: "Support tickets" },
  { id: "open-ticket", label: "Opening a ticket", level: 2 },
  { id: "categories-statuses", label: "Categories and statuses", level: 2 },
  { id: "sharing", label: "Sharing a ticket", level: 2 },
  { id: "notifications", label: "Replies and notifications", level: 2 },
  { id: "tickets-api", label: "Support ticket API", level: 2 },
];
