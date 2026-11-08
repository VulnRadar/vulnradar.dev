import type { TocItem } from "../docs-types";

/** The sections of /docs/troubleshooting, in page order. */
export const toc: TocItem[] = [
  { id: "statuses", label: "What each scan status means" },
  { id: "errors", label: "Failure messages, and what to do" },
  { id: "timeouts", label: "Timeouts" },
  { id: "blocked", label: "Targets we refuse to scan" },
  { id: "recognising-traffic", label: "Recognising scanner traffic" },
  { id: "zero-findings", label: "A scan with no findings" },
  { id: "incomplete", label: "Partial results" },
  { id: "robots", label: "robots.txt and crawling" },
  { id: "quota", label: "Does a failed scan cost quota" },
  { id: "still-stuck", label: "Still stuck" },
];
