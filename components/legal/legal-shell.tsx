"use client";

import { useTranslations } from "next-intl";
import { Callout } from "@/components/shared/callout";
import { LandingNav } from "@/components/landing/landing-nav";
import { Footer } from "@/components/scanner/footer";
import { LegalNav } from "./legal-nav";

// Split out of app/legal/layout.tsx so that file can be a server component
// and export metadata, which a "use client" layout cannot do. Mirrors the
// docs shell split (components/docs/docs-shell.tsx) for the same reason.
export function LegalShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("legal");
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <LandingNav />
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10"
      >
        <LegalNav />
        {/* Which version of these words is the one that counts. The site can
            be read in six languages and these pages are agreements, so the
            answer has to be on the page itself, in the language the reader is
            reading, rather than left to be worked out later. */}
        <Callout variant="info" title={t("languageTitle")} className="mb-6">
          {t("languageNotice")}
        </Callout>
        {children}
      </main>
      <Footer />
    </div>
  );
}
