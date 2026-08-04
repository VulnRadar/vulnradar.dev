import type { Metadata } from "next";
import { DemoShell } from "@/components/demo/demo-shell";
import { pageMetadata } from "@/lib/seo/metadata";
import { SoftwareStructuredData } from "@/components/seo/structured-data";

export const metadata: Metadata = pageMetadata({
  title: "Live Demo",
  description:
    "Scan any URL and see a full security report in under 3 seconds. No signup, no agent to install. Try the scanner before creating an account.",
  path: "/demo",
  keywords: [
    "free website security scan",
    "online vulnerability scanner",
    "security scan demo",
  ],
});

export default function DemoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SoftwareStructuredData />
      <DemoShell>{children}</DemoShell>
    </>
  );
}
