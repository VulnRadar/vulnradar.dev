import type { TocItem } from "../docs-types";

/** The sections of /docs/extension, in page order. */
export const toc: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "install", label: "Install" },
  { id: "scanning", label: "Scanning from the popup" },
  { id: "reading-a-result", label: "Reading a result in the popup" },
  { id: "scan-a-link", label: "Scanning a link you haven't opened" },
  { id: "reputation-card", label: "The on-page card" },
  { id: "auto-scan", label: "Auto-scan modes" },
  { id: "notifications", label: "Desktop notifications" },
  { id: "signed-in-pages", label: "Pages you're signed into" },
  { id: "settings", label: "Settings" },
  { id: "permissions", label: "Permissions and privacy" },
];
