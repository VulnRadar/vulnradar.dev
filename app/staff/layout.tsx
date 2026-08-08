import type { Metadata } from "next";
import { PublicPageShell } from "@/components/shared/public-page-shell";
import { privatePageMetadata } from "@/lib/seo/metadata";

// noindex: staff status requires a session, so a crawled copy is just the
// login redirect.
export const metadata: Metadata = privatePageMetadata("Staff", "/staff");

export default function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PublicPageShell badge="Staff" maxWidth="max-w-4xl" padding="py-10">
      {children}
    </PublicPageShell>
  );
}
