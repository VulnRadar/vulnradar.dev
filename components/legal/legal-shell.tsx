"use client";

import { LandingNav } from "@/components/landing/landing-nav";
import { Footer } from "@/components/scanner/footer";
import { LegalNav } from "./legal-nav";

// Split out of app/legal/layout.tsx so that file can be a server component
// and export metadata, which a "use client" layout cannot do. Mirrors the
// docs shell split (components/docs/docs-shell.tsx) for the same reason.
export function LegalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <LandingNav />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <LegalNav />
        {children}
      </main>
      <Footer />
    </div>
  );
}
