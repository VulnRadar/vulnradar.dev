import type { TocItem } from "../docs-types";

/** The sections of /docs/config, in page order. */
export const toc: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "quick-reference", label: "Quick Reference" },
  { id: "architecture", label: "Architecture" },
  { id: "layer-1", label: "Static App Config" },
  { id: "app-metadata", label: "App metadata", level: 2 },
  { id: "emails", label: "Emails", level: 2 },
  { id: "branding", label: "Branding", level: 2 },
  { id: "cookies", label: "Cookies", level: 2 },
  { id: "auth-timeouts", label: "Auth timeouts", level: 2 },
  { id: "rate-limits", label: "Rate limits", level: 2 },
  { id: "scanning", label: "Scanning", level: 2 },
  { id: "api", label: "API", level: 2 },
  { id: "demo-mode", label: "Demo mode", level: 2 },
  { id: "db-constraints", label: "DB constraints", level: 2 },
  { id: "pagination", label: "Pagination", level: 2 },
  { id: "feature-flags", label: "Feature flags", level: 2 },
  { id: "billing", label: "Billing", level: 2 },
  { id: "admin-settings", label: "Admin Settings Page" },
  { id: "layer-2", label: "Runtime Secrets" },
  { id: "oauth-redirect-uris", label: "OAuth redirect URIs", level: 2 },
  { id: "operations-env", label: "Operations and debug flags", level: 2 },
  { id: "ai-models", label: "AI Providers & Models" },
  { id: "checklist", label: "Self-Hosting Checklist" },
  { id: "validation", label: "Validation" },
];
