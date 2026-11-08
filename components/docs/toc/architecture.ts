import type { TocItem } from "../docs-types";

/** The sections of /docs/architecture, in page order. */
export const toc: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "layout", label: "Where things live" },
  { id: "layout-lib", label: "Inside lib/", level: 2 },
  { id: "layout-components", label: "Inside components/", level: 2 },
  { id: "subsystems", label: "Key Subsystems" },
  { id: "config", label: "Configuration", level: 2 },
  { id: "database", label: "Database", level: 2 },
  { id: "auth", label: "Authentication", level: 2 },
  { id: "scanner", label: "Scanner Engine", level: 2 },
  { id: "api", label: "API Layer", level: 2 },
  { id: "billing", label: "Billing", level: 2 },
  { id: "permissions", label: "Permissions", level: 2 },
  { id: "lifecycle", label: "Request Lifecycle" },
  { id: "cicd", label: "CI/CD" },
];
