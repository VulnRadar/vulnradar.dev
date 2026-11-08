import type { TocItem } from "../docs-types";

/** The sections of /docs/cli, in page order. */
export const toc: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "install", label: "Install" },
  { id: "usage", label: "Usage" },
  { id: "example-run", label: "Example run", level: 2 },
  { id: "options", label: "Options" },
  { id: "exit-codes", label: "Exit codes" },
  { id: "incomplete", label: "Incomplete scans" },
  { id: "json", label: "JSON output" },
  { id: "limits", label: "Rate limits and stopping" },
  { id: "ci", label: "CI example" },
];
