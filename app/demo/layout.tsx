import type { Metadata } from "next";
import { headers } from "next/headers";
import { DemoShell } from "@/components/demo/demo-shell";
import { pageMetadata } from "@/lib/seo/metadata";
import { SoftwareStructuredData } from "@/components/seo/structured-data";

export const metadata: Metadata = pageMetadata({
  title: "Live Demo: Scan Any URL Without an Account",
  description:
    "Run a real scan of any public URL without signing up. Same detection engine as the full scanner, with the response evidence and a fix for every finding.",
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
