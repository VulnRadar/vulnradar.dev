import type { TocItem } from "../docs-types";

/** The sections of /docs/github, in page order. */
export const toc: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "how-it-works", label: "How a scan runs" },
  { id: "file-selection", label: "File selection", level: 2 },
  { id: "secret-scanning", label: "Secret scanning", level: 2 },
  { id: "ai-review", label: "AI code review", level: 2 },
  { id: "connect", label: "Connecting GitHub" },
  { id: "running", label: "Running a scan" },
  { id: "budgets", label: "Credits and token budgets" },
  { id: "filing-issues", label: "Filing findings as an issue" },
  { id: "privacy", label: "Privacy and limits" },
  { id: "endpoints", label: "API endpoints" },
];
