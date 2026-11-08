import type { TocItem } from "../docs-types";

/** The sections of /docs/setup, in page order. */
export const toc: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "prerequisites", label: "Prerequisites" },
  { id: "installation", label: "Installation" },
  { id: "database", label: "Database Setup" },
  { id: "environment", label: "Environment Config" },
  { id: "config", label: "App Configuration" },
  { id: "running", label: "Running the App" },
  { id: "verification", label: "Verification" },
  { id: "health", label: "Health check", level: 2 },
  { id: "troubleshooting", label: "Troubleshooting" },
  { id: "deployment", label: "Deployment" },
  { id: "docker", label: "Docker Deployment" },
  { id: "migration", label: "Schema Migration" },
  { id: "version", label: "Version Check" },
];
