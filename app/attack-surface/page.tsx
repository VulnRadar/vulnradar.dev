"use client";

import { useState } from "react";
import { Header } from "@/components/scanner/header";
import { Footer } from "@/components/scanner/footer";
import { HistoryViewTabs } from "@/components/history";
import { DomainsSection } from "@/components/profile/tabs/developer/domains-section";

/**
 * First-class attack-surface view: the caller's verified-domain portfolio. The
 * domain-verification backend (app/api/v3/domains, lib/domains) and its
 * management UI (DomainsSection) already existed but were buried in the profile
 * Developer tab; this surfaces them as their own tab alongside History / Assets
 * / Public Scans, since "the domains you own and monitor" is a distinct,
 * portfolio-level view of your attack surface, not a per-scan one.
 */
export default function AttackSurfacePage() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6"
      >
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Attack surface
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Your verified domain portfolio. Verifying a domain proves you own
            it: a verified apex covers every subdomain beneath it and unlocks
            active probing, authenticated scans, and subdomain discovery across
            those assets.
          </p>
        </div>

        <HistoryViewTabs />

        <div className="mt-6 space-y-3">
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          {success && (
            <div className="rounded-md border border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/10 px-3 py-2 text-sm text-[hsl(var(--success))]">
              {success}
            </div>
          )}
          <DomainsSection setError={setError} setSuccess={setSuccess} />
        </div>
      </main>
      <Footer />
    </div>
  );
}
