import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata({
  title: "REST API Reference: Endpoints and Schema",
  description:
    "REST API reference for the scanner: authentication, scan and bulk-scan endpoints, response schema, finding IDs, severity levels, and error codes.",
  path: "/docs/api",
  keywords: [
    "security scanner API",
    "vulnerability scanning API",
    "REST security API",
  ],
});

// No structured data here. This layout also wraps /docs/api/playground, which
// emits its own breadcrumb and article, so blocks placed here were doubled on
// that page. The reference page emits its own (app/docs/api/page.tsx).
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
