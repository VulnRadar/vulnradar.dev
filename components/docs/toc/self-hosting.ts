import type { TocItem } from "../docs-types";

/** The sections of /docs/self-hosting, in page order. */
export const toc: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "image-or-build", label: "Prebuilt image or your own build" },
  { id: "hardware", label: "Hardware Requirements" },
  { id: "prerequisites", label: "Prerequisites" },
  { id: "clone", label: "Clone and Configure" },
  { id: "env", label: "Create .env" },
  { id: "ai", label: "AI Features (Optional)" },
  { id: "docker", label: "docker-compose" },
  { id: "start", label: "Start the Stack" },
  { id: "health", label: "Health check", level: 2 },
  { id: "operations", label: "Common operations", level: 2 },
  { id: "admin", label: "First Admin User" },
  { id: "tls", label: "TLS (Reverse Proxy)" },
  { id: "stripe", label: "Configure Stripe Webhook" },
  { id: "backups", label: "Backups" },
  { id: "key-rotation", label: "Rotating the encryption key", level: 2 },
  { id: "updates", label: "Upgrading" },
  { id: "in-app-updater", label: "The in-app updater", level: 2 },
  { id: "network-egress", label: "Network egress" },
  { id: "renaming", label: "Renaming a fork" },
  { id: "troubleshooting", label: "Troubleshooting" },
  { id: "locked-out", label: "Locked out of your own instance", level: 2 },
  { id: "security", label: "Security Checklist" },
];
