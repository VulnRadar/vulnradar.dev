import type { Metadata } from "next";
import { headers } from "next/headers";
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

export default async function DemoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nonce = (await headers()).get("x-nonce") ?? "";
  return (
    <>
      <SoftwareStructuredData nonce={nonce} />
      <DemoShell>{children}</DemoShell>
    </>
  );
}
